"""Closes a round: gate and merge, equal pay, both evidence documents, and the settlement both verifiers sign.

Each verifier runs this independently from the same inputs; the contract accepts the settlement only when both
ML-DSA-87 signatures cover the same payload, so this must stay the single copy of the logic.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np

from . import evidence, payout
from .aggregate import by_address, gate, merge, norm64
from .blob import to_blob
from .encodings import Outcome, settlement_payload
from .hashing import k256
from .judge import Verdict


@dataclass(frozen=True)
class Settlement:
    job: int
    round: int
    outcome: Outcome
    aggregate_hash: bytes
    slashed_bitmap: int  # bit i = roster slot i was confirmed as a ReplayMismatch by both verifiers
    agg_evidence_hash: bytes
    pay_evidence_hash: bytes
    payouts: tuple[tuple[str, int], ...]

    def payload_hash(self) -> bytes:
        return settlement_payload(self.job, self.round, int(self.outcome), self.aggregate_hash, self.slashed_bitmap,
                                  self.agg_evidence_hash, self.pay_evidence_hash, self.payouts)


@dataclass
class Finalized:
    weights: np.ndarray
    settlement: Settlement
    agg_evidence: bytes
    pay_evidence: bytes
    weights_blob: bytes  # empty when the round reverts


def _hex(b: bytes) -> str:
    return "0x" + b.hex()


def finalize(job: int, rnd: int, spec_hash: bytes, start: np.ndarray, roster: Sequence[tuple[str, int]],
             revealed: dict[str, tuple[bytes, np.ndarray]], failed: dict[str, Verdict],
             val_loss: Callable[[np.ndarray], float], budget: int,
             rel_tol: float = 0.1, abs_tol: float = 0.01) -> Finalized:
    """roster: [(node, shard)] in slot order. revealed: {node: (final weights hash, weights)} for revealed nodes.
    failed: {node: verdict} that both verifiers agreed on; those nodes are left out of the merge.
    """
    start_hash = k256(to_blob(spec_hash, start))
    slots = [node for node, _ in roster]
    kept = [(n, w) for n, (_, w) in sorted(revealed.items(), key=lambda kv: int(kv[0], 16)) if n not in failed]

    g = gate(start, kept, val_loss, rel_tol, abs_tol)
    accepted = bool(g.accepted) and not g.reverted
    eligible = g.accepted if accepted else []
    weights = g.weights if accepted else start.copy()
    shares = payout.equal(budget, eligible)
    blob = to_blob(spec_hash, weights)
    aggregate_hash = k256(blob) if accepted else start_hash

    used = [(n, w) for n, w in kept if n in eligible]
    trim = merge(start, used).trim
    base = start.astype(np.float64)
    clip_norm = float(np.median([norm64(w.astype(np.float64) - base) for _, w in used])) if used else 0.0
    agg_doc = evidence.canonical({
        "kind": "aggregateEvidence",
        "job": job,
        "round": rnd,
        "start": _hex(start_hash),
        "roster": [{"node": n, "shard": s} for n, s in roster],
        "revealed": [{"node": n, "hash": _hex(h)} for n, (h, _) in sorted(revealed.items(), key=lambda kv: int(kv[0], 16))],
        "failed": [{"node": n, "verdict": v.value} for n, v in sorted(failed.items(), key=lambda kv: int(kv[0], 16))],
        "merge": {"accepted": eligible, "clipNorm": evidence.f64hex(clip_norm), "trimPerSide": trim},
        "gate": {
            "lossBefore": evidence.f64hex(g.loss_before),
            "lossAfter": evidence.f64hex(g.loss_after),
            "band": evidence.f64hex(g.loss_before * (1 + rel_tol) + abs_tol),
            "result": "reverted" if g.reverted else "dropped" if g.dropped else "pass",
            "dropped": g.dropped,
            "leaveOneOut": [{"node": n, "loss": evidence.f64hex(x)} for n, x in g.leave_one_out],
        },
        "aggregate": _hex(aggregate_hash),
        "outcome": "Accepted" if accepted else "Reverted",
    })
    pay_doc = evidence.canonical({
        "kind": "payEvidence",
        "job": job,
        "round": rnd,
        "budget": budget,
        "eligible": by_address(eligible),
        "payouts": [{"node": n, "amount": a} for n, a in sorted(shares.items(), key=lambda kv: int(kv[0], 16))],
    })
    # A cheater is slashed whether or not the merge was kept: the replay proved it lied either way.
    slashed = sum(1 << slots.index(n) for n, v in failed.items() if v is Verdict.REPLAY_MISMATCH and n in slots)
    settlement = Settlement(
        job=job, round=rnd, outcome=Outcome.ACCEPTED if accepted else Outcome.REVERTED,
        aggregate_hash=aggregate_hash, slashed_bitmap=slashed,
        agg_evidence_hash=k256(agg_doc), pay_evidence_hash=k256(pay_doc),
        payouts=tuple(sorted(shares.items(), key=lambda kv: int(kv[0], 16))),
    )
    return Finalized(weights, settlement, agg_doc, pay_doc, blob if accepted else b"")
