"""Shard files: the exact bytes that get sealed to a node and its verifiers, and parsed back after opening."""

from __future__ import annotations

import json

import numpy as np
from strongchar_core.hashing import k256

from .canonical import Canonical, DatasetError, Split

MAGIC = b"strongchar-shard/1\n"


def encode(dataset_hash: str, start: int, x: np.ndarray, y: np.ndarray) -> bytes:
    # Hand-rolled instead of .npz, whose zip timestamps would give the same rows different bytes on every run.
    head = json.dumps({"datasetHash": dataset_hash, "start": start, "x": [x.dtype.str, list(x.shape)],
                       "y": [y.dtype.str, list(y.shape)]}, sort_keys=True, separators=(",", ":")).encode()
    return MAGIC + len(head).to_bytes(4, "big") + head + x.tobytes() + y.tobytes()


def parse(data: bytes, expected_hash: bytes | None = None) -> tuple[int, np.ndarray, np.ndarray]:
    """(start row, x, y). If expected_hash is given, the bytes must be the ones the job committed to."""
    if expected_hash is not None and k256(data) != expected_hash:
        raise DatasetError("shard bytes do not match their committed hash")
    if not data.startswith(MAGIC):
        raise DatasetError("not a strongChar shard file")
    n = int.from_bytes(data[len(MAGIC):len(MAGIC) + 4], "big")
    body = len(MAGIC) + 4 + n
    head = json.loads(data[len(MAGIC) + 4:body])
    (xd, xs), (yd, ys) = head["x"], head["y"]
    xn = int(np.dtype(xd).itemsize * np.prod(xs))
    if len(data) != body + xn + int(np.dtype(yd).itemsize * np.prod(ys)):
        raise DatasetError("shard length does not match its header")
    x = np.frombuffer(data, xd, offset=body, count=int(np.prod(xs))).reshape(xs)
    y = np.frombuffer(data, yd, offset=body + xn, count=int(np.prod(ys))).reshape(ys)
    return int(head["start"]), x, y


def cut(c: Canonical, s: Split) -> dict[str, list[bytes]]:
    """{"train": [shard bytes per node], "val": [validation bytes]} as the browser seals them."""
    train = [encode(c.card.hash, a, c.x[a:a + n], c.y[a:a + n]) for a, n in s.shards]
    va, vn = s.val
    return {"train": train, "val": [encode(c.card.hash, va, c.x[va:va + vn], c.y[va:va + vn])]}


class Rows:
    """One shard's rows indexed by dataset row number, so the trainer's x[rows] works on a shard alone."""

    def __init__(self, a: np.ndarray, start: int):
        self.a, self.start = a, start

    def __len__(self) -> int:
        return len(self.a)

    def __getitem__(self, rows):
        i = np.asarray(rows) - self.start
        if i.size and (i.min() < 0 or i.max() >= len(self.a)):
            raise IndexError("row is outside this shard")
        return self.a[i]
