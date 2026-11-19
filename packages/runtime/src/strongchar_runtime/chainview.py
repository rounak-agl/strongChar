"""Small typed reads of JobMarket state that nodes and verifiers both need."""

from __future__ import annotations

from dataclasses import dataclass

from strongchar_qore.market import Contracts, first_log
from web3 import Web3

ROUND_OPEN, ROUND_SETTLED = 1, 2
JOB_ACTIVE, JOB_COMPLETED = 1, 2


@dataclass
class RoundView:
    job: int
    round: int
    status: int
    revealed: int
    commit_deadline: int
    reveal_deadline: int
    finalize_by: int
    budget: int
    start_hash: bytes
    roster: list[str]
    params: tuple
    job_state: tuple

    @property
    def spec_hash_hex(self) -> str:
        return "0x" + bytes(self.params[0]).hex()


def current_round(c: Contracts, job: int) -> RoundView | None:
    params, js = c.job(job)
    rid = js[2]
    if rid == 0:
        return None
    r, roster = c.round(job, rid)
    return RoundView(job, rid, r[0], r[1], r[2], r[3], r[4], r[5], bytes(r[6]), [a.lower() for a in roster], params, js)


def settled_rounds(c: Contracts, job: int, before: int) -> list[int]:
    return [r for r in range(1, before) if c.round(job, r)[0][0] == ROUND_SETTLED]


def opened_block(c: Contracts, job: int, rnd: int) -> int:
    """Block of the RoundOpened event; both verifiers derive the signature expiry from it."""
    log = first_log(c.market.events.RoundOpened, c.dep.deploy_block, c.evm.w3.eth.block_number,
                    {"jobId": job, "roundId": rnd})
    if log is None:
        raise LookupError(f"no RoundOpened for job {job} round {rnd}")
    return log["blockNumber"]


def checksum(a: str) -> str:
    return Web3.to_checksum_address(a)
