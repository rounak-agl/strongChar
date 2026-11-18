"""Fixed-order numeric kernel: matmul, sums, max, exp and log that give the same bits on every CPU.

BLAS and libm choose their summation order and polynomial per CPU; these loops and series never do.
"""

import math

import numpy as np


def mm(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    acc = np.zeros((a.shape[0], b.shape[1]), a.dtype)
    for t in range(a.shape[1]):
        acc = acc + a[:, t:t + 1] * b[t:t + 1, :]
    return acc


def colsum(a: np.ndarray) -> np.ndarray:
    acc = np.zeros(a.shape[1], a.dtype)
    for t in range(a.shape[0]):
        acc = acc + a[t]
    return acc


def rowsum(a: np.ndarray) -> np.ndarray:
    acc = a[:, 0].copy()
    for j in range(1, a.shape[1]):
        acc = acc + a[:, j]
    return acc


def rowmax(a: np.ndarray) -> np.ndarray:
    acc = a[:, 0].copy()
    for j in range(1, a.shape[1]):
        acc = np.maximum(acc, a[:, j])
    return acc


LN2_HI, LN2_LO, INV_LN2 = 6.93147180369123816490e-01, 1.90821492927058770002e-10, 1.4426950408889634
_EXP_COEFFS = [1.0 / math.factorial(i) for i in range(13, -1, -1)]
_LOG_COEFFS = [1.0 / k for k in range(41, 0, -2)]


def exp64(x: np.ndarray) -> np.ndarray:
    """exp for float64 x <= 0 from +, * and ldexp only: range-reduce by ln2, then a degree-13 Horner polynomial."""
    k = np.rint(x * INV_LN2)
    r = (x - k * LN2_HI) - k * LN2_LO
    p = np.full_like(r, _EXP_COEFFS[0])
    for c in _EXP_COEFFS[1:]:
        p = p * r + c
    return np.ldexp(p, k.astype(np.int32))


def log64(x: np.ndarray) -> np.ndarray:
    """log for float64 x > 0 via frexp and the atanh series."""
    m, e = np.frexp(x)
    # Keep m in [sqrt(1/2), sqrt(2)) so log near 1 doesn't come from cancelling e*ln2 against log(m).
    low = m < 0.7071067811865476
    m, e = np.where(low, 2.0 * m, m), np.where(low, e - 1, e)
    s = (m - 1.0) / (m + 1.0)
    s2 = s * s
    acc = np.full_like(s, _LOG_COEFFS[0])
    for c in _LOG_COEFFS[1:]:
        acc = acc * s2 + c
    return e * LN2_HI + (2.0 * s * acc + e * LN2_LO)
