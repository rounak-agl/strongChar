"""Verifier work for competitions: run each sealed script in the sandbox, agree on validity with the other verifier,
score the valid entries after the deadline, and push both signed results on-chain.

The hidden labels never enter the sandbox: scripts see the public train set and the test features only.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path

from eth_utils import keccak
from strongchar_compete import metrics
from strongchar_compete.predictions import canonical_bytes
from strongchar_compete.sandbox import run_script
from strongchar_core.encodings import PQKind, scores_payload, validity_payload
from strongchar_qore import pq, seal
from strongchar_qore.deployment import abi
from strongchar_qore.market import Contracts, WindowManager, first_log
from strongchar_qore.seal import Kind
from strongchar_runtime.client import Coordinator
from strongchar_runtime.work import kem_keys
from web3 import Web3

log = logging.getLogger("strongchar.compete")
EXPIRY_BLOCKS = 50_000
PENDING, VALID = 0, 1


@dataclass(frozen=True)
class Verdict:
    ok: bool
    pred_hash: bytes
    reason: str


def agree(a: dict, b: dict) -> Verdict:
    """Both verifiers' raw runs -> the one verdict both sign. Valid only if both ran cleanly and agree byte for byte."""
    if a["ok"] and b["ok"]:
        if a["predHash"] == b["predHash"]:
            return Verdict(True, bytes.fromhex(a["predHash"][2:]), "Ok")
        return Verdict(False, bytes(32), "NondeterministicOutput")
    reasons = sorted(r["reason"] for r in (a, b) if not r["ok"])
    return Verdict(False, bytes(32), reasons[0])


def score_table(valid_entries: list[int], preds: dict[int, list], labels: list, metric: str,
                classes: int | None) -> tuple[list[int], list[int]]:
    entries = sorted(valid_entries)
    return entries, [metrics.to_e6(metric, metrics.score(metric, labels, preds[e], classes)) for e in entries]


def parse_labels(blob: bytes, task: str) -> list:
    lines = blob.decode().strip().splitlines()
    return [int(v) for v in lines] if task == "classification" else [float(v) for v in lines]


class CompeteVerifier:
    def __init__(self, actor, c: Contracts, coord: Coordinator, state: Path):
        self.actor, self.c, self.coord = actor, c, coord
        self.addr = actor.evm.lower()
        self.contract = Web3.to_checksum_address(c.dep.competitions)
        self.comp = c.evm.w3.eth.contract(address=self.contract, abi=abi("Competitions"))
        self.window = WindowManager(c.chain, actor.account, (self.contract,))
        self.verifiers = [c.dep.verifier_a.lower(), c.dep.verifier_b.lower()]
        self.state = state / "competitions"
        self.state.mkdir(parents=True, exist_ok=True)
        self._bundles: dict[int, dict] = {}
        self._created: dict[int, int] = {}

    # ---- helpers ------------------------------------------------------------
    def _send(self, fn) -> str:
        return self.c.send(self.actor.account, fn, self.window).txhash

    def _bundle(self, cid: int, meta_hash: str) -> dict:
        """The host's sealed test bundle (features, labels, salt), opened once and kept in memory."""
        if cid not in self._bundles:
            draft = self.coord.get_draft(meta_hash)
            keys = kem_keys(self.c.chain, self.verifiers)
            data = seal.open_(self.coord.get_blob(draft["manifest"]["test"]), self.actor.seal, Kind.TEST_FEATURES,
                              seal.aad(self.contract, cid, 0, 0, Kind.TEST_FEATURES, keys))
            b = json.loads(data)
            b["meta"] = draft["spec"]
            b["train"] = self.coord.get_public(draft["spec"]["train"])
            self._bundles[cid] = b
        return self._bundles[cid]

    def _expiry(self, cid: int) -> int:
        if cid not in self._created:
            log = first_log(self.comp.events.Created, self.c.dep.deploy_block, self.c.evm.w3.eth.block_number, {"id": cid})
            if log is None:
                raise LookupError(f"no Created event for competition {cid}")
            self._created[cid] = log["blockNumber"]
        return self._created[cid] + EXPIRY_BLOCKS

    def _sign(self, kind: PQKind, payload: bytes, expiry: int) -> str:
        _, sig = pq.sign_message(self.actor.account, 9800, self.contract, kind, payload, expiry)
        return base64.b64encode(sig).decode()

    def _mine(self, topic: str) -> dict | None:
        return next((x for x in self.coord.attestations(topic) if x["author"] == self.addr), None)

    def _pair(self, topic: str) -> tuple[dict, dict] | None:
        by = {x["author"]: x for x in self.coord.attestations(topic)}
        a, b = by.get(self.verifiers[0]), by.get(self.verifiers[1])
        return (a, b) if a and b else None

    # ---- one pass ----------------------------------------------------------
    def step(self) -> None:
        for cid in range(1, self.comp.functions.count().call() + 1):
            c = self.comp.functions.getCompetition(cid).call()
            if c[9]:  # settled
                continue
            self._competition(cid, c)

    def _competition(self, cid: int, c) -> None:
        meta_hash = "0x" + bytes(c[1]).hex()
        deadline, reveal_deadline, scores_posted, revealed = c[4], c[5], c[7], c[8]
        entries = self.comp.functions.getEntries(cid).call()
        bundle = self._bundle(cid, meta_hash)
        meta = bundle["meta"]
        for i, e in enumerate(entries):
            if e[3] == PENDING:
                self._validity(cid, i, e, bundle, meta)
        now = time.time()
        if now <= deadline:
            return
        entries = self.comp.functions.getEntries(cid).call()
        if not scores_posted and all(e[3] != PENDING for e in entries):
            self._scores(cid, entries, bundle, meta)
        if not revealed and now > reveal_deadline:
            labels, salt = bytes.fromhex(bundle["labels"][2:]), bytes.fromhex(bundle["salt"][2:])
            log.info("competition %s: host missed the reveal; revealing labels (%s)", cid,
                     self._send(self.comp.functions.revealLabels(cid, labels, salt)))
        c = self.comp.functions.getCompetition(cid).call()
        if c[7] and c[8] and not c[9]:
            log.info("competition %s settled (%s)", cid, self._send(self.comp.functions.settle(cid)))

    def _validity(self, cid: int, i: int, e, bundle: dict, meta: dict) -> None:
        run_topic, val_topic = f"comp-{cid}-run-{i}", f"comp-{cid}-validity-{i}"
        if self._mine(run_topic) is None:
            env = self.coord.get_blob("0x" + bytes(e[2]).hex())
            keys = kem_keys(self.c.chain, self.verifiers)
            script = seal.open_(env, self.actor.seal, Kind.SCRIPT, seal.aad(self.contract, cid, 0, 0, Kind.SCRIPT, keys))
            if keccak(script) != bytes(e[1]):
                body = {"ok": False, "predHash": None, "reason": "ScriptMismatch"}
            else:
                r = run_script(script, bundle["train"], bundle["features"].encode(), meta["rows"], meta["task"],
                               meta.get("classes"), timeout_s=meta.get("timeoutS", 600))
                body = {"ok": r.ok, "predHash": "0x" + r.pred_hash.hex() if r.ok else None, "reason": r.reason,
                        "detail": r.detail[:200], "runtimeS": round(r.runtime_s, 2)}
                if r.ok:
                    (self.state / f"{cid}-{i}.json").write_text(json.dumps(r.predictions))
            self.coord.attest(run_topic, body)
            log.info("competition %s entry %s ran: %s", cid, i, body["reason"])
        pair = self._pair(run_topic)
        if pair is None:
            return
        v = agree(*pair)
        expiry = self._expiry(cid)
        if self._mine(val_topic) is None:
            sig = self._sign(PQKind.VALIDITY, validity_payload(cid, i, v.ok, v.pred_hash), expiry)
            self.coord.attest(val_topic, {"ok": v.ok, "predHash": "0x" + v.pred_hash.hex(), "reason": v.reason,
                                          "expiry": expiry, "signature": sig})
        sigs = self._pair(val_topic)
        if sigs and self.comp.functions.getEntries(cid).call()[i][3] == PENDING:
            a, b = sigs
            tx = self._send(self.comp.functions.postValidity(cid, i, v.ok, v.pred_hash, expiry,
                                                             base64.b64decode(a["signature"]),
                                                             base64.b64decode(b["signature"])))
            log.info("competition %s entry %s validity %s posted (%s)", cid, i, v.reason, tx)

    def _scores(self, cid: int, entries, bundle: dict, meta: dict) -> None:
        topic = f"comp-{cid}-scores"
        valid = [i for i, e in enumerate(entries) if e[3] == VALID]
        labels = parse_labels(bytes.fromhex(bundle["labels"][2:]), meta["task"])
        preds = {i: json.loads((self.state / f"{cid}-{i}.json").read_text()) for i in valid}
        ids, scores = score_table(valid, preds, labels, meta["metric"], meta.get("classes"))
        expiry = self._expiry(cid)
        if self._mine(topic) is None:
            sig = self._sign(PQKind.SCORES, scores_payload(cid, ids, scores), expiry)
            self.coord.attest(topic, {"entries": ids, "scores": scores, "expiry": expiry, "signature": sig})
            log.info("competition %s scores signed: %s", cid, dict(zip(ids, scores)))
        pair = self._pair(topic)
        if pair and pair[0]["entries"] == pair[1]["entries"] and pair[0]["scores"] == pair[1]["scores"]:
            if not self.comp.functions.getCompetition(cid).call()[7]:
                a, b = pair
                tx = self._send(self.comp.functions.postScores(cid, ids, scores, expiry,
                                                               base64.b64decode(a["signature"]),
                                                               base64.b64decode(b["signature"])))
                log.info("competition %s scores posted (%s)", cid, tx)
            # Publish the canonical predictions of valid entries so anyone can recompute the scores.
            if self.addr == self.verifiers[0]:
                for i in valid:
                    self.coord.put_public(canonical_bytes(preds[i]), f"comp-{cid}-entry-{i}-predictions.csv")
