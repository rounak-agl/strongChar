"""Verifier service: replay every revealed node, judge bit for bit, merge and gate, sign and relay the settlement."""

from __future__ import annotations

import argparse
import base64
import logging
import os
import time

from strongchar_core.encodings import PQKind
from web3.exceptions import ContractCustomError
from strongchar_core.finalize import finalize
from strongchar_core.judge import Verdict, judge
from strongchar_qore import keystore, pq, seal
from strongchar_qore.market import Contracts, TxReverted, WindowManager
from strongchar_qore.seal import Kind, make_card
from strongchar_runtime import chainview as cv
from strongchar_runtime import work
from strongchar_runtime.client import Coordinator
from strongchar_runtime.recipients import recipient
from strongchar_runtime.spec import JobSpec

log = logging.getLogger("strongchar.verifier")
EXPIRY_BLOCKS = 10_000
WRONG_STATE = "0xde4168ba"  # JobMarket.WrongState(): the round is no longer open


class Verifier:
    def __init__(self, name: str, coordinator_url: str):
        self.actor = keystore.load(name)
        self.c = Contracts()
        self.coord = Coordinator(coordinator_url, self.actor.account)
        self.window = WindowManager(self.c.chain, self.actor.account, (self.c.dep.job_market,))
        self.verifiers = [self.c.dep.verifier_a, self.c.dep.verifier_b]
        self.addr = self.actor.evm.lower()

    def publish(self) -> None:
        a = self.actor
        self.coord.put_card(make_card(a.qor, a.seal, a.account.private_key, a.account.pqc.secret_key))

    def step(self) -> None:
        now = time.time()
        for job in range(1, self.c.market.functions.jobCount().call() + 1):
            r = cv.current_round(self.c, job)
            if r is None or r.status != cv.ROUND_OPEN or now <= r.reveal_deadline + 2 or now > r.finalize_by:
                continue
            if r.revealed < r.params[7]:
                continue  # the keeper voids it
            sigs = self.coord.signatures(job, r.round)
            if not any(s["verifier"] == self.addr for s in sigs):
                self._settle_and_sign(r)
                sigs = self.coord.signatures(job, r.round)
            self._submit_if_ready(r, sigs)

    def _settle_and_sign(self, r: cv.RoundView) -> None:
        draft = self.coord.get_draft(r.spec_hash_hex)
        spec = JobSpec(draft["spec"])
        wl = spec.workload()
        contract = self.c.dep.job_market
        settled = cv.settled_rounds(self.c, r.job, r.round)
        start = work.start_weights(spec, r.start_hash, self.c.chain, self.coord, self.actor.seal, contract, r.job,
                                   settled)
        assignment = [a.lower() for a in draft["manifest"]["assignment"]]
        dom = self.c.domain()
        revealed, failed = {}, {}
        for node in r.roster:
            seat = self.c.seat(r.job, r.round, node)
            if not seat[3]:
                continue
            claimed = bytes(seat[4])
            shard = assignment.index(node)
            start_row, x, y = work.open_shard(self.c.chain, self.coord, self.actor.seal, contract, r.job, draft,
                                              shard, self.verifiers)
            replayed, _ = work.train(spec, dom, r.job, shard, start_row, x, y, start, len(settled))
            verdict = judge(spec.hash, replayed, claimed)
            revealed[cv.checksum(node)] = (claimed, replayed)
            if verdict is not Verdict.OK:
                failed[cv.checksum(node)] = verdict
            log.info("job %s round %s node %s: %s", r.job, r.round, node, verdict.value)
        xv, yv = work.open_val(self.c.chain, self.coord, self.actor.seal, contract, r.job, draft, self.verifiers)
        gate = spec.raw["gate"]
        fin = finalize(r.job, r.round, spec.hash, start, [(cv.checksum(n), assignment.index(n)) for n in r.roster],
                       revealed, failed, lambda w: wl.evaluate(w, xv, yv)[0], r.budget,
                       float(gate["relTol"]), float(gate["absTol"]))
        s = fin.settlement
        last = r.round == r.params[6]
        result = fin.weights  # merged when accepted, the start weights when reverted
        if last:
            recips = [r.job_state[0]]  # the final model is sealed to the data owner only
            kind = Kind.MODEL
        else:
            recips = [*draft["manifest"]["assignment"], *self.verifiers]
            kind = Kind.GLOBAL
        recipients, keys = zip(*(recipient(self.c.chain, self.coord, a) for a in recips))
        aad = work.global_aad(contract, r.job, r.round, list(keys), last)
        blob = self.coord.put_blob(seal.seal(list(recipients), work.weights_blob(spec, result), kind, aad), kind.value)
        expiry = cv.opened_block(self.c, r.job, r.round) + EXPIRY_BLOCKS
        msg, sig = pq.sign_message(self.actor.account, 9800, contract, PQKind.SETTLEMENT, s.payload_hash(), expiry)
        body = {"outcome": int(s.outcome), "aggregateHash": "0x" + s.aggregate_hash.hex(), "slashedBitmap": s.slashed_bitmap,
                "aggEvidenceHash": "0x" + s.agg_evidence_hash.hex(), "payEvidenceHash": "0x" + s.pay_evidence_hash.hex(),
                "payouts": [[a, v] for a, v in s.payouts], "globalBlob": blob if not last else None,
                "globalRecipients": recips if not last else None, "modelBlob": blob if last else None,
                "aggEvidence": fin.agg_evidence.decode(), "payEvidence": fin.pay_evidence.decode()}
        self.coord.put_signature(r.job, r.round, {"payloadHash": "0x" + s.payload_hash().hex(), "expiry": expiry,
                                                  "settlement": body, "signature": base64.b64encode(sig).decode()})
        log.info("job %s round %s signed settlement outcome=%s slashed=%s", r.job, r.round, int(s.outcome), s.slashed_bitmap)

    def _submit_if_ready(self, r: cv.RoundView, sigs: list[dict]) -> None:
        by = {s["verifier"]: s for s in sigs}
        a, b = by.get(self.c.dep.verifier_a.lower()), by.get(self.c.dep.verifier_b.lower())
        if not (a and b) or a["payloadHash"] != b["payloadHash"] or a["expiry"] != b["expiry"]:
            if a and b:
                log.error("job %s round %s: verifiers disagree; not submitting", r.job, r.round)
            return
        if cv.current_round(self.c, r.job).status != cv.ROUND_OPEN:
            return  # the other verifier already submitted
        st = a["settlement"]

        class S:  # the tuple Contracts.settlement_tuple expects
            outcome = st["outcome"]
            aggregate_hash = bytes.fromhex(st["aggregateHash"][2:])
            slashed_bitmap = st["slashedBitmap"]
            agg_evidence_hash = bytes.fromhex(st["aggEvidenceHash"][2:])
            pay_evidence_hash = bytes.fromhex(st["payEvidenceHash"][2:])
            payouts = [(p[0], p[1]) for p in st["payouts"]]

        try:
            rec = self.c.finalize(self.actor.account, r.job, r.round, S, a["expiry"], base64.b64decode(a["signature"]),
                                  base64.b64decode(b["signature"]), self.window)
        except ContractCustomError as e:
            if WRONG_STATE in str(e):
                log.info("job %s round %s was finalized by the other verifier first", r.job, r.round)
                return
            raise
        log.info("job %s round %s finalized on-chain (%s)", r.job, r.round, rec.txhash)

    def run(self, poll_s: float = 5.0) -> None:
        while True:  # the coordinator may still be starting
            try:
                self.publish()
                break
            except Exception as e:
                log.warning("publishing card failed (%s); retrying", e)
                time.sleep(5)
        while True:
            try:
                self.step()
            except TxReverted as e:
                log.warning("%s", e)
            except Exception:
                log.exception("verifier step failed")
            time.sleep(poll_s)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--name", required=True, choices=["verifier-a", "verifier-b"])
    ap.add_argument("--coordinator", default=os.environ.get("STRONGCHAR_COORDINATOR", "http://127.0.0.1:8700"))
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format=f"%(asctime)s {a.name} %(message)s")
    Verifier(a.name, a.coordinator).run()


if __name__ == "__main__":
    main()
