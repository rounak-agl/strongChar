"""Canonical predictions: raw floats differ across CPU architectures, canonical forms don't (spike S5, D40)."""

from __future__ import annotations

import math

from strongchar_core.hashing import k256

MAX_BYTES = 20 * 2**20


class BadOutput(ValueError):
    def __init__(self, reason: str, detail: str):
        super().__init__(f"{reason}: {detail}")
        self.reason, self.detail = reason, detail


def parse(raw: bytes, rows: int, task: str, classes: int | None) -> list:
    """One value per line (an optional header 'prediction' is allowed). Strict: no eval, no pandas."""
    if len(raw) > MAX_BYTES:
        raise BadOutput("OutputTooLarge", f"predictions over {MAX_BYTES} bytes")
    try:
        lines = raw.decode("ascii").strip().splitlines()
    except UnicodeDecodeError:
        raise BadOutput("BadOutputShape", "predictions must be ASCII") from None
    if lines and lines[0].strip().lower() == "prediction":
        lines = lines[1:]
    if len(lines) != rows:
        raise BadOutput("BadOutputShape", f"expected {rows} predictions, got {len(lines)}")
    out = []
    for i, line in enumerate(lines):
        try:
            v = float(line.strip())
        except ValueError:
            raise BadOutput("BadOutputShape", f"line {i + 1} is not a number") from None
        if not math.isfinite(v):
            raise BadOutput("BadOutputRange", f"line {i + 1} is not finite")
        if task == "classification":
            if v != int(v) or not 0 <= v < (classes or 0):
                raise BadOutput("BadOutputRange", f"line {i + 1} is not a class in 0..{(classes or 0) - 1}")
            out.append(int(v))
        else:
            out.append(round(v, 6))
    return out


def canonical_bytes(preds: list) -> bytes:
    """Fixed formatting: integers as-is, floats with exactly six decimals."""
    return "\n".join(str(p) if isinstance(p, int) else f"{p:.6f}" for p in preds).encode() + b"\n"


def prediction_hash(preds: list) -> bytes:
    return k256(canonical_bytes(preds))
