"""Round merge and validation gate, written so two verifiers on any CPU produce identical bytes."""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import numpy as np

Update = tuple[str, np.ndarray]  # (node address "0x..", final weights)


def by_address(addrs):
    """Numeric address order: independent of checksum casing and of the order callers pass things in."""
    return sorted(addrs, key=lambda a: int(a, 16))


def norm64(v: np.ndarray) -> float:
    # math.fsum is correctly rounded; np.linalg.norm's summation order depends on the CPU and BLAS build.
    v = np.asarray(v, dtype=np.float64)
    return math.sqrt(math.fsum((v * v).tolist()))


def _as_f32(x: np.ndarray) -> np.ndarray:
    return x.astype(np.float32) + np.float32(0)


def trim_per_side(n: int) -> int:
    return max(1, n // 5) if n >= 3 else 0


@dataclass
class Merged:
    weights: np.ndarray
    clip: list[float]
    trim: int


def merge(start: np.ndarray, updates: Sequence[Update]) -> Merged:
    """Clip each update's delta to the median norm, then take a coordinate-wise trimmed mean."""
    if not updates:
        return Merged(start.copy(), [], 0)
    ordered = sorted(updates, key=lambda u: int(u[0], 16))
    base = start.astype(np.float64)
    deltas = np.stack([w.astype(np.float64) - base for _, w in ordered])
    norms = [norm64(row) for row in deltas]
    median = float(np.median(norms))
    clip = [1.0 if n <= median else median / n for n in norms]
    deltas *= np.array(clip)[:, None]
    n, t = len(ordered), trim_per_side(len(ordered))
    total = np.zeros_like(base)
    # One row at a time keeps the summation order fixed; np.sum may pairwise-reorder.
    for row in np.sort(deltas, axis=0)[t:n - t]:
        total += row
    return Merged(_as_f32(base + total / (n - 2 * t)), clip, t)


@dataclass
class Gated:
    weights: np.ndarray
    accepted: list[str]
    dropped: str | None
    reverted: bool
    loss_before: float
    loss_after: float
    leave_one_out: list[tuple[str, float]] = field(default_factory=list)


def gate(start: np.ndarray, updates: Sequence[Update], val_loss: Callable[[np.ndarray], float],
         rel_tol: float = 0.1, abs_tol: float = 0.01) -> Gated:
    """Keep the merge if validation loss stays within the band; else drop the one node that explains it; else revert.

    val_loss must evaluate in a fixed order so both verifiers reach the same verdict. The defaults gave no false
    revert or exclusion over 120 simulated honest rounds.
    """
    before = val_loss(start)
    limit = before * (1 + rel_tol) + abs_tol
    nodes = by_address(op for op, _ in updates)
    full = merge(start, updates)
    after = val_loss(full.weights)
    if after <= limit:
        return Gated(full.weights, nodes, None, False, before, after)
    loo: list[tuple[str, float]] = []
    best: tuple[str, float, Merged] | None = None
    for op in nodes:
        candidate = merge(start, [u for u in updates if u[0] != op])
        loss = val_loss(candidate.weights)
        loo.append((op, loss))
        if best is None or loss < best[1]:
            best = (op, loss, candidate)
    if best is not None and best[1] <= limit:
        op, loss, candidate = best
        return Gated(candidate.weights, [o for o in nodes if o != op], op, False, before, loss, loo)
    return Gated(start.copy(), [], None, True, before, after, loo)
