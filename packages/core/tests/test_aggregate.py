"""Merge (clipping, trimming, order independence) and the validation gate (pass, drop one, revert)."""

import random

import numpy as np

from strongchar_core.aggregate import gate, merge, trim_per_side
from strongchar_core.blob import weights_hash
from strongchar_core.hashing import k256

G = np.zeros(4, np.float32)
TARGET = np.ones(4)
A, B = "0x" + "0a" * 20, "0x" + "0b" * 20


def nodes(n):
    return ["0x" + f"{i + 1:040x}" for i in range(n)]


def loss(w):
    return float(((w - TARGET) ** 2).sum())


def toward(k):
    return (G + k * (TARGET - G)).astype(np.float32)


def test_empty_and_small_merges():
    assert np.array_equal(merge(G, []).weights, G)
    a, b = np.full(4, 1.0, np.float32), np.full(4, 3.0, np.float32)
    r = merge(G, list(zip(nodes(2), [a, b])))
    # Norms 2 and 6, median 4: b is clipped to value 2, mean of 1 and 2.
    assert r.trim == 0 and np.allclose(r.weights, 1.5)


def test_trim_counts():
    assert [trim_per_side(n) for n in (1, 2, 3, 6, 10)] == [0, 0, 1, 1, 2]


def test_outlier_is_trimmed():
    ups = [(n, np.ones(4, np.float32)) for n in nodes(5)] + [(nodes(6)[5], np.full(4, 1000.0, np.float32))]
    assert np.allclose(merge(G, ups).weights, 1.0, atol=1e-6)


def test_bytes_do_not_depend_on_input_order():
    rng = np.random.default_rng(1)
    ups = [(n, rng.standard_normal(4).astype(np.float32)) for n in nodes(7)]
    shuffled = ups[:]
    random.Random(2).shuffle(shuffled)
    sh = k256(b"t")
    assert weights_hash(sh, merge(G, ups).weights) == weights_hash(sh, merge(G, shuffled).weights)


def test_gate_pass_drop_revert():
    ok = gate(G, [(A, toward(0.5)), (B, toward(0.4))], loss)
    assert not ok.reverted and ok.dropped is None and ok.loss_after < ok.loss_before
    poisoned = gate(G, [(A, toward(1.0)), (B, toward(-5.0))], loss)
    assert poisoned.dropped == B and poisoned.accepted == [A]
    bad = gate(G, [(A, toward(-2.0)), (B, toward(-3.0))], loss)
    assert bad.reverted and bad.accepted == [] and np.array_equal(bad.weights, G) and len(bad.leave_one_out) == 2
