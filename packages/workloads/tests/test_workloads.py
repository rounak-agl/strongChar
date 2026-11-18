"""Exact MLP: pinned self-test hash, bit-exact round replay, cheat detection, op counts."""

import numpy as np
from strongchar_core import encodings as enc
from strongchar_core.hashing import k256
from strongchar_core.judge import Verdict, judge

from strongchar_workloads.compute import job_budget, round_ops
from strongchar_workloads.kernel import exp64, log64
from strongchar_workloads.mlp import MLPExact, selftest
from strongchar_workloads.runner import run_round, sampler

# Measured on x86_64 (laptop) and aarch64 under gVisor (verifiers server) on 18 Nov 2026: identical.
SELFTEST = "389ba66fd29475c50d58de428233954f328c27f0b5959e3ee0c182fc4cfc79d4"
SH = k256(b"strongchar-test")


def test_selftest_hash_is_pinned():
    assert selftest() == SELFTEST


def test_exp_log_accuracy():
    x = -np.linspace(0, 700, 5001)
    assert np.max(np.abs(exp64(x) - np.exp(x)) / np.exp(x)) < 1e-14
    y = np.linspace(1e-6, 1e6, 5001)
    assert np.max(np.abs(log64(y) - np.log(y))) < 1e-13


def _round(wl, start, x, y, rounds_done=0):
    dom = enc.domain(9800, "0x" + "11" * 20)
    rows = sampler(dom, 1, 0, 0, len(x), rounds_done, 20, 16)
    return run_round(wl, start, x, y, rows, steps=20, checkpoints=4, spec_hash=SH)


def test_round_replays_bit_for_bit_and_catches_a_cheat():
    rng = np.random.default_rng(0)
    x, y = rng.random((200, 12), dtype=np.float32), rng.integers(0, 3, 200)
    wl = MLPExact(12, 3, hidden=8)
    start = wl.init(1)
    node_w, node_hashes = _round(wl, start, x, y)
    replay_w, replay_hashes = _round(wl, start, x, y)
    assert node_hashes == replay_hashes and len(node_hashes) == 5
    assert judge(SH, replay_w, node_hashes[-1]) is Verdict.OK
    lazy = start + np.float32(1e-3)  # a node that skipped training and nudged the weights
    from strongchar_core.blob import weights_hash
    assert judge(SH, replay_w, weights_hash(SH, lazy)) is Verdict.REPLAY_MISMATCH


def test_training_reduces_loss():
    rng = np.random.default_rng(2)
    x = rng.random((300, 6), dtype=np.float32)
    y = (x[:, 0] > 0.5).astype(np.int64)
    wl = MLPExact(6, 2, hidden=8, lr="0.5")
    w0 = wl.init(0)
    w1, _ = _round(wl, w0, x, y)
    assert wl.evaluate(w1, x, y)[0] < wl.evaluate(w0, x, y)[0]


def test_op_count_and_budget():
    ops = round_ops(steps=200, batch_size=64, d_in=784, hidden=128, n_out=10)
    assert ops > 0 and job_budget(ops, rounds=2, nodes=4, units_per_gop=1_000) == 2 * 4 * ops * 1_000 // 10**9
