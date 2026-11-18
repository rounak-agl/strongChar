"""One round of local training, shared by nodes (training) and verifiers (full replay)."""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
from strongchar_core import encodings as enc
from strongchar_core.blob import weights_hash


def run_round(wl, start: np.ndarray, x: np.ndarray, y: np.ndarray, batch_rows: Callable[[int], np.ndarray],
              steps: int, checkpoints: int, spec_hash: bytes,
              on_checkpoint: Callable[[int, np.ndarray], None] | None = None) -> tuple[np.ndarray, list[bytes]]:
    """Train `steps` SGD steps from the round's start weights; return final weights and [h_0 .. h_K].

    The optimizer restarts every round, so weights alone are the whole state.
    """
    if steps % checkpoints:
        raise ValueError("steps must be a multiple of checkpoints")
    per = steps // checkpoints
    w = start.copy()
    hashes = [weights_hash(spec_hash, w)]
    for k in range(checkpoints):
        for s in range(k * per, (k + 1) * per):
            rows = batch_rows(s)
            w = wl.step(w, x[rows], y[rows])
        if on_checkpoint:
            on_checkpoint(k + 1, w)
        hashes.append(weights_hash(spec_hash, w))
    return w, hashes


def sampler(dom: bytes, job: int, shard: int, start: int, length: int, rounds_done: int, steps: int,
            batch_size: int) -> Callable[[int], np.ndarray]:
    """batch_rows(s) from the shared epoch shuffle; rounds_done counts accepted rounds that trained this shard."""
    rows = enc.shard_rows(start, length)
    return lambda s: np.asarray(enc.batch(dom, job, shard, rows, rounds_done, steps, batch_size, s), dtype=np.int64)
