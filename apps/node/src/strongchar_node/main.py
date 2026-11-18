"""Node service: for each round it is seated in, open its shard, train, commit, then reveal after the deadline."""

from __future__ import annotations

import argparse
import json
import logging
import os
import platform
import secrets
import threading
import time
from pathlib import Path

import numpy as np
from strongchar_core import encodings as enc
from strongchar_core.blob import weights_hash
from strongchar_qore import keystore
from strongchar_qore.market import Contracts, TxReverted, WindowManager
from strongchar_qore.seal import make_card
from strongchar_runtime import chainview as cv
from strongchar_runtime import work
from strongchar_runtime.client import Coordinator
from strongchar_runtime.spec import JobSpec
from strongchar_workloads.mlp import selftest

log = logging.getLogger("strongchar.node")


def benchmark() -> tuple[float, str]:
    t = time.perf_counter()
    h = selftest()
    return time.perf_counter() - t, h


class Node:
    def __init__(self, name: str, coordinator_url: str, cheat: bool = False, state_dir: Path | None = None):
        self.actor = keystore.load(name)
        self.c = Contracts()
        self.coord = Coordinator(coordinator_url, self.actor.account)
        self.window = WindowManager(self.c.chain, self.actor.account, (self.c.dep.job_market,))
        self.verifiers = [self.c.dep.verifier_a, self.c.dep.verifier_b]
        self.cheat = cheat
        self.state = state_dir or Path.home() / ".local/state/strongchar" / name
        self.state.mkdir(parents=True, exist_ok=True)
        self.addr = self.actor.evm.lower()

    def publish(self) -> None:
        a = self.actor
        self.coord.put_card(make_card(a.qor, a.seal, a.account.private_key, a.account.pqc.secret_key))

    def heartbeat_forever(self) -> None:
        while True:
            try:
                secs, h = benchmark()
                self.coord.heartbeat({"version": "0.1.0", "arch": platform.machine(), "cores": os.cpu_count() or 1,
                                      "benchmark_s": max(secs, 0.001), "selftest": h})
            except Exception:
                log.exception("heartbeat failed")
            time.sleep(30)

    def _state_path(self, job: int, rnd: int) -> Path:
        return self.state / f"{job}-{rnd}.json"

    def step(self) -> None:
        now = time.time()
        for job in range(1, self.c.market.functions.jobCount().call() + 1):
            r = cv.current_round(self.c, job)
            if r is None or r.status != cv.ROUND_OPEN or self.addr not in r.roster:
                continue
            seat = self.c.seat(job, r.round, self.addr)
            committed, revealed = bytes(seat[2]) != bytes(32), seat[3]
            path = self._state_path(job, r.round)
            if not committed and now <= r.commit_deadline:
                self._train_and_commit(r, seat[0], path)
            elif committed and not revealed and r.commit_deadline < now <= r.reveal_deadline and path.exists():
                st = json.loads(path.read_text())
                fn = self.c.market.functions.reveal(job, r.round, [bytes.fromhex(h) for h in st["hashes"]],
                                                    bytes.fromhex(st["salt"]))
                rec = self.c.send(self.actor.account, fn, self.window)
                log.info("job %s round %s revealed (%s)", job, r.round, rec.txhash)

    def _train_and_commit(self, r: cv.RoundView, slot: int, path: Path) -> None:
        draft = self.coord.get_draft(r.spec_hash_hex)
        spec = JobSpec(draft["spec"])
        shard = [a.lower() for a in draft["manifest"]["assignment"]].index(self.addr)
        contract = self.c.dep.job_market
        settled = cv.settled_rounds(self.c, r.job, r.round)
        start = work.start_weights(spec, bytes(r.job_state[4]), self.c.chain, self.coord, self.actor.seal, contract,
                                   r.job, settled)
        if weights_hash(spec.hash, start) != r.start_hash:
            raise RuntimeError("start weights don't match the round's start hash")
        start_row, x, y = work.open_shard(self.c.chain, self.coord, self.actor.seal, contract, r.job, draft, shard,
                                          self.verifiers)
        final, hashes = work.train(spec, self.c.domain(), r.job, shard, start_row, x, y, start, len(settled))
        if self.cheat:
            # Skip the honest result and claim nudged weights: the verifiers' replay will not match.
            fake = (start + np.float32(1e-3)).astype(np.float32)
            hashes = [hashes[0]] + [weights_hash(spec.hash, fake)] * (len(hashes) - 1)
        salt = secrets.token_bytes(32)
        path.write_text(json.dumps({"hashes": [h.hex() for h in hashes], "salt": salt.hex()}))
        commit = enc.commit_hash(self.c.domain(), r.job, r.round, cv.checksum(self.addr), enc.checkpoint_root(hashes), salt)
        rec = self.c.send(self.actor.account, self.c.market.functions.commit(r.job, r.round, commit), self.window)
        log.info("job %s round %s trained shard %s and committed (%s)%s", r.job, r.round, shard, rec.txhash,
                 " [cheating]" if self.cheat else "")

    def run(self, poll_s: float = 4.0) -> None:
        while True:  # the coordinator may still be starting
            try:
                self.publish()
                break
            except Exception as e:
                log.warning("publishing card failed (%s); retrying", e)
                time.sleep(5)
        threading.Thread(target=self.heartbeat_forever, daemon=True).start()
        while True:
            try:
                self.step()
            except TxReverted as e:
                log.warning("%s", e)
            except Exception:
                log.exception("node step failed")
            time.sleep(poll_s)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--name", required=True)
    ap.add_argument("--coordinator", default=os.environ.get("STRONGCHAR_COORDINATOR", "http://127.0.0.1:8700"))
    ap.add_argument("--cheat", action="store_true", help="demo only: reveal weights that were never trained")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format=f"%(asctime)s {a.name} %(message)s")
    Node(a.name, a.coordinator, a.cheat).run()


if __name__ == "__main__":
    main()
