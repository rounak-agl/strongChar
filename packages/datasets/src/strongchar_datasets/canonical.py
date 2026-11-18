"""Turn uploaded arrays or a CSV into canonical arrays, a dataset card, and a job's split."""

from __future__ import annotations

import io
import json
from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal

import numpy as np
from strongchar_core.hashing import k256

MAX_BYTES = 200 * 2**20
MIN_ROWS = 1000
MAX_CLASSES = 100


class DatasetError(ValueError):
    pass


@dataclass(frozen=True)
class DatasetCard:
    hash: str
    rows: int
    x_shape: tuple[int, ...]  # one row's shape, e.g. (784,)
    task: str  # "classification" | "regression"
    classes: int | None
    x_dtype: str = "float32"  # "float32" | "uint8"


@dataclass
class Canonical:
    x: np.ndarray
    y: np.ndarray
    card: DatasetCard


def dataset_hash(x: np.ndarray, y: np.ndarray) -> str:
    # Covers the arrays and their layout, not any container format, so equal data always gives an equal hash.
    head = json.dumps({"x": [x.dtype.str, list(x.shape)], "y": [y.dtype.str, list(y.shape)]}, sort_keys=True)
    return "0x" + k256(b"strongchar-dataset/1" + head.encode() + x.tobytes() + y.tobytes()).hex()


def from_csv(text: str, task: str | None = None) -> Canonical:
    """Numeric CSV, last column is the target, optional header row."""
    if len(text.encode()) > MAX_BYTES:
        raise DatasetError(f"CSV over {MAX_BYTES} bytes")
    first = text.split("\n", 1)[0].split(",")
    try:
        [float(v) for v in first]
        skip = 0
    except ValueError:
        skip = 1
    try:
        a = np.loadtxt(io.StringIO(text), delimiter=",", skiprows=skip, dtype=np.float64, ndmin=2)
    except ValueError as e:
        raise DatasetError(f"non-numeric value: {e}") from None
    return from_arrays(a[:, :-1], a[:, -1], task=task)


def from_arrays(x: np.ndarray, y: np.ndarray, task: str | None = None) -> Canonical:
    if len(x) != len(y) or len(x) < MIN_ROWS:
        raise DatasetError(f"need at least {MIN_ROWS} rows with one target each")
    x = x if x.dtype == np.uint8 else x.astype(np.float32)
    y = y.astype(np.float64).reshape(len(y))
    if not (np.isfinite(y).all() and (x.dtype == np.uint8 or np.isfinite(x).all())):
        raise DatasetError("NaN or infinity in the data")
    integral = bool(np.all(y == np.round(y)))
    labels = np.unique(y)
    if task is None:
        task = "classification" if integral and len(labels) <= MAX_CLASSES else "regression"
    if task == "classification":
        if not integral or not 2 <= len(labels) <= MAX_CLASSES:
            raise DatasetError(f"classification needs 2 to {MAX_CLASSES} integer labels")
        y = np.searchsorted(labels, y).astype(np.int64)  # renumber labels 0..C-1 in sorted order
    elif task == "regression":
        y = y.astype(np.float32)
    else:
        raise DatasetError("task must be classification or regression")
    # Row order comes from keccak of the row index, so every party derives the same order from the same file.
    order = sorted(range(len(y)), key=lambda i: k256(i.to_bytes(32, "big")))
    x, y = np.ascontiguousarray(x[order]), np.ascontiguousarray(y[order])
    card = DatasetCard(dataset_hash(x, y), len(y), tuple(x.shape[1:]), task,
                       len(labels) if task == "classification" else None, "uint8" if x.dtype == np.uint8 else "float32")
    return Canonical(x, y, card)


def _count(rows: int, frac: str) -> int:
    # Fractions arrive as decimal strings; Decimal avoids 0.29 * 100 becoming 28.
    return int((Decimal(frac) * rows).to_integral_value(ROUND_FLOOR))


@dataclass(frozen=True)
class Split:
    train: tuple[int, int]  # (start, length)
    val: tuple[int, int]
    holdout: tuple[int, int]  # stays with the data owner for the final in-browser evaluation
    shards: tuple[tuple[int, int], ...]


def split(rows: int, n_shards: int, val_frac: str, holdout_frac: str) -> Split:
    """[train | val | holdout] in canonical order; train cut into n_shards contiguous ranges, larger ones first."""
    val, holdout = _count(rows, val_frac), _count(rows, holdout_frac)
    train = rows - val - holdout
    if n_shards < 1 or train < n_shards:
        raise DatasetError("not enough training rows for that many shards")
    q, r = divmod(train, n_shards)
    shards, start = [], 0
    for i in range(n_shards):
        n = q + (1 if i < r else 0)
        shards.append((start, n))
        start += n
    return Split((0, train), (train, val), (train + val, holdout), tuple(shards))


def standardise(c: Canonical, train: tuple[int, int]) -> Canonical:
    """Scale features to zero mean and unit variance using the train rows only, with fixed-order sums.

    Raw columns such as age (~50) next to smoker (0/1) make SGD diverge; computing the statistics from train rows
    alone keeps the validation and holdout rows unseen.
    """
    import math

    a, n = train
    x = c.x.astype(np.float64)
    cols = x[a:a + n].T
    mean = np.array([math.fsum(col.tolist()) / n for col in cols])
    std = np.array([math.sqrt(math.fsum(((col - m) ** 2).tolist()) / n) for col, m in zip(cols, mean)])
    std[std == 0] = 1.0
    z = ((x - mean) / std).astype(np.float32)
    card = DatasetCard(dataset_hash(z, c.y), c.card.rows, c.card.x_shape, c.card.task, c.card.classes, "float32")
    return Canonical(np.ascontiguousarray(z), c.y, card)
