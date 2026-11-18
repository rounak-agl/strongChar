"""Demo datasets: MNIST from a pinned source, and a synthetic health table generated from a fixed seed."""

from __future__ import annotations

import gzip
import hashlib
import os
import shutil
import threading
import urllib.request
from pathlib import Path

import numpy as np

from .canonical import Canonical, DatasetError, from_arrays

MNIST_URL = "https://storage.googleapis.com/cvdf-datasets/mnist/"
MNIST_FILES = {
    "train-images-idx3-ubyte.gz": "440fcabf73cc546fa21475e81ea370265605f56be210a4024d2ca8f203523609",
    "train-labels-idx1-ubyte.gz": "3552534a0a558bbed6aed32b30c495cca23d567ec52cac8be1a0730e8010255c",
    "t10k-images-idx3-ubyte.gz": "8d422c7b0a1c1c79245a5bcf07fe86e33eeafee792b84584aec276f5a2dbc4e6",
    "t10k-labels-idx1-ubyte.gz": "f7ae60f92e00ec6debd23a6088c31dbd2371eca3ffa0defaefb259924204aec6",
}


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _fetch_mnist(cache: Path) -> dict[str, Path]:
    cache.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, want in MNIST_FILES.items():
        p = cache / name
        if not p.exists():
            # Per-process part files: a stalled or cut-off download never stays cached, and sharers can't collide.
            part = p.with_name(f"{name}.{os.getpid()}.{threading.get_ident()}.part")
            try:
                with urllib.request.urlopen(MNIST_URL + name, timeout=60) as r, open(part, "wb") as f:
                    shutil.copyfileobj(r, f)
                os.replace(part, p)
            finally:
                part.unlink(missing_ok=True)
        if _sha256(p) != want:
            raise DatasetError(f"{name}: sha256 mismatch, refusing to use it")
        out[name] = p
    return out


def parse_idx(raw: bytes) -> np.ndarray:
    """IDX: two zero bytes, type 0x08 (uint8), rank, big-endian uint32 dims, then the data."""
    if raw[:2] != b"\x00\x00" or raw[2] != 0x08:
        raise DatasetError("not a uint8 IDX file")
    rank = raw[3]
    dims = [int.from_bytes(raw[4 + 4 * i:8 + 4 * i], "big") for i in range(rank)]
    data = np.frombuffer(raw, dtype=np.uint8, offset=4 + 4 * rank)
    if data.size != int(np.prod(dims)):
        raise DatasetError("IDX size does not match its header")
    return data.reshape(dims)


def mnist(cache: Path) -> Canonical:
    files = _fetch_mnist(cache)
    read = lambda n: parse_idx(gzip.decompress(files[n].read_bytes()))  # noqa: E731
    x = np.concatenate([read("train-images-idx3-ubyte.gz"), read("t10k-images-idx3-ubyte.gz")])
    y = np.concatenate([read("train-labels-idx1-ubyte.gz"), read("t10k-labels-idx1-ubyte.gz")]).astype(np.int64)
    return from_arrays(x.reshape(len(x), -1), y, task="classification")


HEALTH_COLUMNS = ["age", "bmi", "systolic_bp", "cholesterol", "glucose", "smoker", "exercise_hours", "family_history",
                  "diabetes_risk"]


def health(rows: int = 20_000, seed: int = 20261118) -> tuple[np.ndarray, np.ndarray]:
    """Synthetic patient records with a plausible risk label. Every value is generated; no real person is in it."""
    rng = np.random.default_rng(seed)
    age = rng.integers(18, 90, rows)
    bmi = np.clip(rng.normal(27, 5, rows), 15, 55)
    bp = np.clip(rng.normal(118 + 0.4 * (age - 40), 14, rows), 85, 210)
    chol = np.clip(rng.normal(190 + 0.5 * (age - 40), 35, rows), 110, 340)
    glucose = np.clip(rng.normal(95 + 0.8 * (bmi - 27), 18, rows), 60, 260)
    smoker = (rng.random(rows) < 0.18).astype(np.float64)
    exercise = np.clip(rng.gamma(2.0, 1.5, rows), 0, 20)
    family = (rng.random(rows) < 0.25).astype(np.float64)
    logit = (-5.8 + 0.03 * age + 0.09 * bmi + 0.035 * (glucose - 95) + 0.6 * smoker + 0.9 * family
             - 0.12 * exercise + 0.008 * (bp - 120))
    label = (rng.random(rows) < 1 / (1 + np.exp(-logit))).astype(np.int64)
    x = np.stack([age, bmi, bp, chol, glucose, smoker, exercise, family], axis=1).round(2)
    return x, label


def health_csv(rows: int = 20_000, seed: int = 20261118) -> str:
    x, y = health(rows, seed)
    lines = [",".join(HEALTH_COLUMNS)]
    lines += [",".join(f"{v:g}" for v in r) + f",{int(t)}" for r, t in zip(x, y)]
    return "\n".join(lines) + "\n"
