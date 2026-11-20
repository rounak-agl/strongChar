"""The coordinator's clock: seats the best available nodes in each job's next round; voids and expires stalled ones.

Stateless by design: every tick re-reads jobs and rounds from the contract, so a restart loses nothing and a
repeated action is refused by the contract rather than applied twice.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field

from eth_utils import keccak
from strongchar_qore.market import Contracts, TxReverted, WindowManager
from web3 import Web3

from .store import Store

log = logging.getLogger("strongchar.keeper")

JOB_ACTIVE, ROUND_OPEN = 1, 1


ONLINE_WITHIN = 60  # seconds since the last heartbeat
BENCH_AFTER = 2  # missed commits in a row before a node sits out


@dataclass
class Plan:
    job: int
    nodes: list[str]
    shards: list[int]


@dataclass
class Fleet:
    """Everything the matcher knows about the nodes, gathered once per tick."""
    chain: dict[str, tuple[bool, int, int]]  # node -> (joined, stake, busy job) from NodeRegistry
    beats: dict[str, dict]  # node -> latest heartbeat body plus "seen"
    missed: dict[str, int] = field(default_factory=dict)  # node -> missed commits in a row
    last_seated: dict[str, float] = field(default_factory=dict)  # node -> when it was last seated
    taken: set[str] = field(default_factory=set)  # seated earlier in this tick


def blocker(f: Fleet, node: str, stake: int, now: float, floor_s: float, selftest: str) -> str | None:
    """Why this node can't be seated in a job's next round, or None if it can. The first failing rule wins."""
    joined, staked, busy = f.chain.get(node, (False, 0, 0))
    hb = f.beats.get(node)
    if not joined:
        return "not joined"
    if staked < stake:
        return "stake below the job's requirement"
    if hb is None or now - hb["seen"] > ONLINE_WITHIN:
        return "offline"
    if hb.get("draining"):
        return "stopping"
    if busy != 0 or node in f.taken:
        return "busy in another round"
    if hb.get("selftest") != selftest:
        return "self-test result doesn't match"
    if hb["benchmark_s"] > floor_s:
        return "slower than the benchmark floor"
    if f.missed.get(node, 0) >= BENCH_AFTER:
        return "benched after missed commits"
    return None


def pick(f: Fleet, job: int, round_id: int, stake: int, quorum: int, max_nodes: int, n_shards: int,
         shard_last: dict[int, int], now: float, floor_s: float, selftest: str) -> tuple[Plan | None, dict]:
    """Seat the best available nodes for a job's next round, from the whole live fleet.

    Fastest benchmark first, then longest idle, then a per-round hash so ties don't always favour one address.
    Shards trained longest ago go first, so every shard keeps moving even when fewer nodes than shards are up.
    Returns the plan (None if fewer than `quorum` nodes qualify) and a diagnosis for the Nodes page.
    """
    blocked: dict[str, str] = {}
    ok = []
    for node in sorted(set(f.chain) | set(f.beats)):
        why = blocker(f, node, stake, now, floor_s, selftest)
        if why is None:
            ok.append(node)
        else:
            blocked[node] = why
    tie = lambda n: keccak(job.to_bytes(32, "big") + round_id.to_bytes(32, "big") + bytes.fromhex(n[2:]))
    ok.sort(key=lambda n: (f.beats[n]["benchmark_s"], f.last_seated.get(n, 0.0), tie(n)))
    seated = ok[:min(max_nodes, n_shards)]
    diag = {"eligible": len(ok), "quorum": quorum, "seated": seated, "blocked": blocked}
    if len(seated) < quorum:
        return None, diag
    shards = sorted(range(n_shards), key=lambda i: (shard_last.get(i, 0), i))[:len(seated)]
    return Plan(job, seated, shards), diag


# Weight hash every honest machine gets from strongchar_workloads.mlp.selftest() (pinned in the workloads tests).
SELFTEST = "389ba66fd29475c50d58de428233954f328c27f0b5959e3ee0c182fc4cfc79d4"


class Keeper:
    def __init__(self, contracts: Contracts, store: Store, coordinator, floor_s: float = 600.0, tick_s: float = 10.0):
        self.c, self.store, self.acct = contracts, store, coordinator
        self.window = WindowManager(contracts.chain, coordinator, (contracts.dep.job_market,))
        self.floor_s, self.tick_s = floor_s, tick_s
        self._stop = threading.Event()

    # ---- small persisted maps (the store survives restarts; everything else is re-read from chain) ----------
    def _get(self, key: str) -> dict:
        return json.loads(self.store.kv_get(key) or "{}")

    def _put(self, key: str, value: dict) -> None:
        self.store.kv_set(key, json.dumps(value))

    def fleet(self) -> Fleet:
        beats = self.store.live_nodes(within_s=86_400)  # every node seen today; "offline" is decided per rule
        chain = {}
        for node in beats:
            n = self.c.registry.functions.getNode(Web3.to_checksum_address(node)).call()
            chain[node] = (n[0], n[1], n[2])
        return Fleet(chain, beats, self._get("missed"), self._get("last_seated"))

    def tick(self) -> None:
        now = time.time()
        ready = []
        for job_id in range(1, self.c.market.functions.jobCount().call() + 1):
            try:
                if (r := self._housekeep(job_id, now)) is not None:
                    ready.append(r)
            except TxReverted as e:
                log.warning("job %s: %s", job_id, e)
            except Exception:
                log.exception("job %s tick failed", job_id)
        if ready:
            f = self.fleet()
            for _, job_id, params, job, n_shards in sorted(ready):  # best-paying next round first, then oldest job
                try:
                    self._seat(f, job_id, params, job, n_shards, now)
                except TxReverted as e:
                    log.warning("job %s: %s", job_id, e)
                except Exception:
                    log.exception("job %s seating failed", job_id)
        self.store.drop_unpinned(3600)

    def _housekeep(self, job_id: int, now: float):
        """Void or expire a stalled round, tally finished ones; return a sort key if the job needs a new round."""
        params, job = self.c.job(job_id)
        if job[1] != JOB_ACTIVE:
            return None
        rid = job[2]
        self._tally(job_id, rid)
        if rid > 0:
            r, _ = self.c.round(job_id, rid)
            if r[0] == ROUND_OPEN:
                reveal_deadline, finalize_by, revealed = r[3], r[4], r[1]
                if now > finalize_by + 5:
                    self.c.send(self.acct, self.c.market.functions.expireRound(job_id, rid), self.window)
                    log.info("job %s round %s expired", job_id, rid)
                elif now > reveal_deadline + 5 and revealed < params[7]:
                    self.c.send(self.acct, self.c.market.functions.voidRound(job_id, rid), self.window)
                    log.info("job %s round %s voided (%s reveals)", job_id, rid, revealed)
                return None
        if rid >= params[6] or self.store.kv_get(f"paused/{job_id}"):
            return None
        draft = self.store.get_draft("0x" + bytes(params[0]).hex())
        if draft is None:
            return None
        next_budget = job[3] // (params[6] - rid)
        return (-next_budget, job_id, params, job, len(draft["manifest"]["shards"]))

    def _tally(self, job_id: int, upto: int) -> None:
        """Count missed commits once each round has closed: a commit resets a node's count, a miss adds one."""
        done = self._get(f"tallied/{job_id}")
        missed = self._get("missed")
        changed = False
        for rid in range(1, upto + 1):
            if str(rid) in done:
                continue
            r, roster = self.c.round(job_id, rid)
            if r[0] == ROUND_OPEN:
                break
            for node in roster:
                committed = bytes(self.c.seat(job_id, rid, node)[2]) != bytes(32)
                missed[node.lower()] = 0 if committed else missed.get(node.lower(), 0) + 1
            done[str(rid)] = True
            changed = True
        if changed:
            self._put("missed", missed)
            self._put(f"tallied/{job_id}", done)

    def _seat(self, f: Fleet, job_id: int, params, job, n_shards: int, now: float) -> None:
        shard_last = {int(k): v for k, v in self._get(f"shard_last/{job_id}").items()}
        rid = job[2] + 1
        plan, diag = pick(f, job_id, rid, params[5], params[7], params[8], n_shards, shard_last, now, self.floor_s,
                          SELFTEST)
        self._put(f"matcher/{job_id}", {**diag, "at": now})
        if plan is None:
            return
        r = self.c.open_round(self.acct, plan.job, plan.nodes, plan.shards, self.window)
        f.taken.update(plan.nodes)
        last = self._get("last_seated")
        for n in plan.nodes:
            last[n] = now
            f.last_seated[n] = now
        self._put("last_seated", last)
        self._put(f"shard_last/{job_id}", {**{str(k): v for k, v in shard_last.items()},
                                           **{str(s): rid for s in plan.shards}})
        log.info("job %s opened round %s: seated %s on shards %s (%s)", job_id, rid, plan.nodes, plan.shards, r.txhash)

    def run(self) -> None:
        while not self._stop.is_set():
            self.tick()
            self._stop.wait(self.tick_s)

    def stop(self) -> None:
        self._stop.set()
