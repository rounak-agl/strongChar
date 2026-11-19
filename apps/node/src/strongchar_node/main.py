"""Node service: for each round it is seated in, open its shard, train, commit, then reveal after the deadline."""

from __future__ import annotations

import argparse
import json
import logging
import os
import platform
import secrets
import signal
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
        self.state = state_dir or Path.home() / ".local/state/strongchar" / name  # same as state_dir()
        self.state.mkdir(parents=True, exist_ok=True)
        self.addr = self.actor.evm.lower()
        self.stopping = threading.Event()  # set by SIGTERM / `strongchar-node stop`: finish owed reveals, take no seat

    def publish(self) -> None:
        a = self.actor
        self.coord.put_card(make_card(a.qor, a.seal, a.account.private_key, a.account.pqc.secret_key))

    def heartbeat_forever(self) -> None:
        while True:
            try:
                secs, h = benchmark()
                self.coord.heartbeat({"version": "0.1.0", "arch": platform.machine(), "cores": os.cpu_count() or 1,
                                      "benchmark_s": max(secs, 0.001), "selftest": h,
                                      "draining": self.stopping.is_set()})
            except Exception:
                log.exception("heartbeat failed")
            time.sleep(30)

    def _state_path(self, job: int, rnd: int) -> Path:
        return self.state / f"{job}-{rnd}.json"

    def step(self) -> bool:
        """One pass over every job; returns True while this node still owes a reveal."""
        now = time.time()
        owed = False
        for job in range(1, self.c.market.functions.jobCount().call() + 1):
            r = cv.current_round(self.c, job)
            if r is None or r.status != cv.ROUND_OPEN or self.addr not in r.roster:
                continue
            seat = self.c.seat(job, r.round, self.addr)
            committed, revealed = bytes(seat[2]) != bytes(32), seat[3]
            path = self._state_path(job, r.round)
            if not committed and now <= r.commit_deadline and not self.stopping.is_set():
                self._train_and_commit(r, seat[0], path)
                owed = True
            elif committed and not revealed and now <= r.reveal_deadline and path.exists():
                owed = True
            if committed and not revealed and r.commit_deadline < now <= r.reveal_deadline and path.exists():
                st = json.loads(path.read_text())
                fn = self.c.market.functions.reveal(job, r.round, [bytes.fromhex(h) for h in st["hashes"]],
                                                    bytes.fromhex(st["salt"]))
                rec = self.c.send(self.actor.account, fn, self.window)
                log.info("job %s round %s revealed (%s)", job, r.round, rec.txhash)
        return owed

    def _train_and_commit(self, r: cv.RoundView, slot: int, path: Path) -> None:
        feed = self._feed(r)
        if feed is None:
            return  # no verifier has fed this round yet; try again next poll
        draft = self.coord.get_draft(r.spec_hash_hex)
        spec = JobSpec(draft["spec"])
        shard = cv.shard_of(self.c, r.job, r.round)[self.addr]
        if feed["shard"] != shard:
            raise RuntimeError("the feed names a different shard than the chain")
        contract = self.c.dep.job_market
        settled = cv.settled_rounds(self.c, r.job, r.round)
        kem = self.actor.seal.mlkem_public_key
        if feed["weightsBlob"]:
            start = work.open_fed_weights(spec, self.coord, self.actor.seal, contract, r.job, r.round, shard, kem,
                                          feed["weightsBlob"], r.start_hash)
        else:
            start = spec.initial_weights()
        if weights_hash(spec.hash, start) != r.start_hash:
            raise RuntimeError("start weights don't match the round's start hash")
        start_row, x, y = work.open_fed_shard(self.coord, self.actor.seal, contract, r.job, r.round, shard, kem,
                                              feed["shardBlob"], work.shard_hash(draft, shard))
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

    def _feed(self, r: cv.RoundView) -> dict | None:
        """This node's entry in the first verifier feed for the round (verifiers only; anyone else is ignored)."""
        verifiers = {v.lower() for v in self.verifiers}
        for f in self.coord.attestations(work.feed_topic(r.job, r.round)):
            if f["author"] in verifiers and self.addr in f.get("nodes", {}):
                return f["nodes"][self.addr]
        return None

    def run(self, poll_s: float = 4.0) -> None:
        while True:  # the coordinator may still be starting
            try:
                self.publish()
                break
            except Exception as e:
                log.warning("publishing card failed (%s); retrying", e)
                time.sleep(5)
        threading.Thread(target=self.heartbeat_forever, daemon=True).start()
        pid = self.state / "node.pid"
        pid.write_text(str(os.getpid()))
        signal.signal(signal.SIGTERM, lambda *_: self.stopping.set())
        signal.signal(signal.SIGINT, lambda *_: self.stopping.set())
        try:
            while True:
                owed = True
                try:
                    owed = self.step()
                except TxReverted as e:
                    log.warning("%s", e)
                except Exception:
                    log.exception("node step failed")
                if self.stopping.is_set() and not owed:
                    log.info("stopped: no reveal owed")
                    return
                if self.stopping.is_set():
                    log.info("stopping after the reveal this node owes")
                time.sleep(poll_s)
        finally:
            pid.unlink(missing_ok=True)


def state_dir(name: str) -> Path:
    return Path.home() / ".local/state/strongchar" / name


def main() -> None:
    import sys

    from . import setup

    argv = sys.argv[1:]
    if not argv or (argv[0].startswith("-") and argv[0] not in ("-h", "--help")):
        argv = ["run", *argv]  # `strongchar-node --name node-1` keeps working
    ap = argparse.ArgumentParser(prog="strongchar-node", description="strongChar node: train sealed shards for fUSD.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    coord = os.environ.get("STRONGCHAR_COORDINATOR", "http://127.0.0.1:8700")
    for cmd, text in (("init", "make this machine's node key (refuses to overwrite)"),
                      ("setup", "register keys on diana, take BERU, stake and join"),
                      ("doctor", "check everything the keeper checks before seating this node"),
                      ("run", "train in every round this node is seated in"),
                      ("status", "stake, probation, earnings, and whether the node is running"),
                      ("stop", "finish any reveal this node owes, then exit"),
                      ("logs", "show this node's log"),
                      ("claim", "withdraw the fUSD this node has earned")):
        sp = sub.add_parser(cmd, help=text)
        sp.add_argument("--name", default="node")
        if cmd in ("doctor", "run", "status"):
            sp.add_argument("--coordinator", default=coord)
        if cmd == "logs":
            sp.add_argument("-n", type=int, default=40)
            sp.add_argument("-f", "--follow", action="store_true")
        if cmd == "run":
            sp.add_argument("--cheat", action="store_true", help="demo only: reveal weights that were never trained")
    a = ap.parse_args(argv)
    if a.cmd == "init":
        setup.init(a.name)
    elif a.cmd == "setup":
        setup.setup(a.name)
    elif a.cmd == "doctor":
        raise SystemExit(0 if setup.doctor(a.name, a.coordinator) else 1)
    elif a.cmd == "status":
        setup.status(a.name, a.coordinator, state_dir(a.name))
    elif a.cmd == "stop":
        setup.stop(state_dir(a.name))
    elif a.cmd == "logs":
        setup.logs(state_dir(a.name) / "node.log", a.n, a.follow)
    elif a.cmd == "claim":
        setup.claim(a.name)
    else:
        state_dir(a.name).mkdir(parents=True, exist_ok=True)
        fmt = f"%(asctime)s {a.name} %(message)s"
        logging.basicConfig(level=logging.INFO, format=fmt)
        fh = logging.FileHandler(state_dir(a.name) / "node.log")
        fh.setFormatter(logging.Formatter(fmt))
        logging.getLogger().addHandler(fh)
        logging.getLogger("httpx").setLevel(logging.WARNING)
        Node(a.name, a.coordinator, a.cheat).run()


if __name__ == "__main__":
    main()
