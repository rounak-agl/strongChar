"""mlp-exact/1: a one-hidden-layer MLP trained with plain SGD on the fixed-order kernel, so replays are bit-exact."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from strongchar_core.blob import weights_hash
from strongchar_core.hashing import k256

from .kernel import colsum, exp64, log64, mm, rowmax, rowsum

f32 = np.float32
WORKLOAD_ID = "mlp-exact/1"
MAX_INPUTS = 4096


def as_f32(x: np.ndarray) -> np.ndarray:
    return x.astype(f32) / f32(255) if x.dtype == np.uint8 else x.astype(f32, copy=False)


@dataclass(frozen=True)
class RoundDefaults:
    steps: int  # H: SGD steps per round
    checkpoints: int  # K: checkpoint hashes per round
    batch_size: int  # B
    lr: str  # decimal string so a spec never depends on float parsing


class MLPExact:
    id = WORKLOAD_ID

    def __init__(self, d_in: int, n_out: int, hidden: int = 128, loss: str = "ce", lr: str = "0.05"):
        if loss not in ("ce", "mse"):
            raise ValueError("loss must be 'ce' or 'mse'")
        if d_in > MAX_INPUTS:
            raise ValueError(f"at most {MAX_INPUTS} inputs")
        self.shapes = [(d_in, hidden), (hidden,), (hidden, n_out), (n_out,)]
        self.loss = loss
        self.lr = f32(float(lr))

    def n_params(self) -> int:
        return sum(math.prod(s) for s in self.shapes)

    def _unpack(self, w: np.ndarray) -> list[np.ndarray]:
        out, o = [], 0
        for s in self.shapes:
            out.append(w[o:o + math.prod(s)].reshape(s))
            o += math.prod(s)
        return out

    def init(self, seed: int) -> np.ndarray:
        rng = np.random.default_rng(seed)
        (d_in, h), _, (_, n_out), _ = self.shapes
        w1 = rng.normal(0, math.sqrt(2 / d_in), (d_in, h))
        w2 = rng.normal(0, math.sqrt(2 / h), (h, n_out))
        return np.concatenate([w1.ravel(), np.zeros(h), w2.ravel(), np.zeros(n_out)]).astype(f32)

    def _forward(self, w: np.ndarray, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        w1, b1, w2, b2 = self._unpack(w)
        h = np.maximum(mm(x, w1) + b1, f32(0))
        return h, mm(h, w2) + b2

    @staticmethod
    def _softmax_parts(z: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        z = z.astype(np.float64)
        e = exp64(z - rowmax(z)[:, None])
        return e, rowsum(e)

    def step(self, w: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        x = as_f32(x)
        _, _, w2, _ = self._unpack(w)
        b = x.shape[0]
        h, z = self._forward(w, x)
        if self.loss == "ce":
            e, s = self._softmax_parts(z)
            p = (e / s[:, None]).astype(f32)
            p[np.arange(b), y] -= f32(1)
            p = p / f32(b)
        else:
            p = (z - y.reshape(z.shape).astype(f32)) * f32(2 / b)
        dh = np.where(h > 0, mm(p, w2.T), f32(0))
        grad = np.concatenate([mm(x.T, dh).ravel(), colsum(dh), mm(h.T, p).ravel(), colsum(p)])
        return w - self.lr * grad

    def evaluate(self, w: np.ndarray, x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
        """(loss, metric) in fixed order: accuracy for classification, MSE for regression."""
        _, z = self._forward(w, as_f32(x))
        if self.loss == "ce":
            e, s = self._softmax_parts(z)
            zz = z.astype(np.float64)
            per_row = rowmax(zz) + log64(s) - zz[np.arange(len(y)), y]
            return math.fsum(per_row.tolist()) / len(y), float((z.argmax(1) == y).mean())
        d = (z - y.reshape(z.shape)).astype(np.float64)
        mse = math.fsum(rowsum(d * d).tolist()) / len(y)
        return mse, mse

    def predict(self, w: np.ndarray, x: np.ndarray) -> np.ndarray:
        _, z = self._forward(w, as_f32(x))
        return z.argmax(1) if self.loss == "ce" else z[:, 0]

    @staticmethod
    def defaults() -> RoundDefaults:
        return RoundDefaults(steps=200, checkpoints=4, batch_size=64, lr="0.05")


def selftest() -> str:
    """Weight hash after 10 steps on a fixed batch. Every machine must print the value pinned in the vectors."""
    wl = MLPExact(8, 4, hidden=16)
    w = wl.init(0)
    rng = np.random.default_rng(1)
    x, y = rng.random((32, 8), dtype=f32), rng.integers(0, 4, 32)
    for _ in range(10):
        w = wl.step(w, x, y)
    return weights_hash(k256(b"strongchar-selftest"), w).hex()
