"""The coordinator's clock: opens rounds for assigned, live, staked nodes; voids and expires stalled rounds.

Stateless by design: every tick re-reads jobs and rounds from the contract, so a restart loses nothing and a
repeated action is refused by the contract rather than applied twice.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass

from strongchar_qore.market import Contracts, TxReverted, WindowManager
from web3 import Web3

from .store import Store

log = logging.getLogger("strongchar.keeper")

JOB_ACTIVE, ROUND_OPEN = 1, 1


@dataclass
class Plan:
    job: int
    nodes: list[str]
    shards: list[int]


def eligible(c: Contracts, store: Store, node: str, stake: int, floor_s: float) -> str | None:
    """None when the node can be seated, otherwise the reason it can't (shown on the Nodes page)."""
    n = c.registry.functions.getNode(Web3.to_checksum_address(node)).call()
    joined, staked, busy = n[0], n[1], n[2]
    if not joined:
        return "not joined"
    if staked < stake:
        return "stake below the job's requirement"
    if busy != 0:
        return "busy in another round"
    hb = store.live_nodes().get(node.lower())
    if hb is None:
        return "no heartbeat in the last 2 minutes"
    if hb["benchmark_s"] > floor_s:
        return f"benchmark {hb['benchmark_s']:.1f}s is slower than the {floor_s:.0f}s floor"
    return None


def plan_round(c: Contracts, store: Store, job_id: int, floor_s: float) -> Plan | None:
    params, job = c.job(job_id)
    if job[1] != JOB_ACTIVE or job[2] >= params[6]:
        return None
    if job[2] > 0 and c.round(job_id, job[2])[0][0] == ROUND_OPEN:
        return None
    draft = store.get_draft("0x" + bytes(params[0]).hex())
    if draft is None:
        return None
    assignment = draft["manifest"].get("assignment", [])
    nodes, shards, why = [], [], {}
    for shard, node in enumerate(assignment):
        reason = eligible(c, store, node, params[5], floor_s)
        if reason is None:
            nodes.append(node)
            shards.append(shard)
        else:
            why[node] = reason
    store.kv_set(f"blocked/{job_id}", str(why))
    if len(nodes) < params[7]:
        return None
    return Plan(job_id, nodes, shards)


class Keeper:
    def __init__(self, contracts: Contracts, store: Store, coordinator, floor_s: float = 600.0, tick_s: float = 10.0):
        self.c, self.store, self.acct = contracts, store, coordinator
        self.window = WindowManager(contracts.chain, coordinator, (contracts.dep.job_market,))
        self.floor_s, self.tick_s = floor_s, tick_s
        self._stop = threading.Event()

    def tick(self) -> None:
        now = time.time()
        for job_id in range(1, self.c.market.functions.jobCount().call() + 1):
            try:
                self._job(job_id, now)
            except TxReverted as e:
                log.warning("job %s: %s", job_id, e)
            except Exception:
                log.exception("job %s tick failed", job_id)
        self.store.drop_unpinned(3600)

    def _job(self, job_id: int, now: float) -> None:
        params, job = self.c.job(job_id)
        if job[1] != JOB_ACTIVE:
            return
        rid = job[2]
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
                return
        plan = plan_round(self.c, self.store, job_id, self.floor_s)
        if plan:
            r = self.c.open_round(self.acct, plan.job, plan.nodes, plan.shards, self.window)
            log.info("job %s opened round %s for %s (%s)", job_id, rid + 1, plan.nodes, r.txhash)

    def run(self) -> None:
        while not self._stop.is_set():
            self.tick()
            self._stop.wait(self.tick_s)

    def stop(self) -> None:
        self._stop.set()
