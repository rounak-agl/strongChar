"""Deterministic metrics on canonical predictions; fixed-order sums so two verifiers get identical numbers."""

from __future__ import annotations

import math

METRICS = ("accuracy", "macro_f1", "rmse")
HIGHER_IS_BETTER = {"accuracy": True, "macro_f1": True, "rmse": False}


def accuracy(y: list[int], p: list[int]) -> float:
    return sum(1 for a, b in zip(y, p) if a == b) / len(y)


def macro_f1(y: list[int], p: list[int], classes: int) -> float:
    f1s = []
    for c in range(classes):
        tp = sum(1 for a, b in zip(y, p) if a == c and b == c)
        fp = sum(1 for a, b in zip(y, p) if a != c and b == c)
        fn = sum(1 for a, b in zip(y, p) if a == c and b != c)
        f1s.append(0.0 if tp == 0 else 2 * tp / (2 * tp + fp + fn))
    return math.fsum(f1s) / classes


def rmse(y: list[float], p: list[float]) -> float:
    return math.sqrt(math.fsum((a - b) ** 2 for a, b in zip(y, p)) / len(y))


def score(metric: str, y: list, p: list, classes: int | None = None) -> float:
    if len(y) != len(p) or not y:
        raise ValueError("labels and predictions must be non-empty and the same length")
    if metric == "accuracy":
        return accuracy(y, p)
    if metric == "macro_f1":
        return macro_f1(y, p, classes or (max(y) + 1))
    if metric == "rmse":
        return rmse(y, p)
    raise ValueError(f"unknown metric {metric}")


def to_e6(metric: str, value: float) -> int:
    """On-chain scores are integers ×1e6 where higher is always better (RMSE is negated)."""
    v = round(value * 1_000_000)
    return v if HIGHER_IS_BETTER[metric] else -v
