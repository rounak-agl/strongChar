"""Equal pay, canonical evidence, and finalize: honest round, slashed cheater, reverted round."""

import numpy as np
import pytest

from strongchar_core import evidence, payout
from strongchar_core.blob import weights_hash
from strongchar_core.encodings import Outcome
from strongchar_core.finalize import finalize
from strongchar_core.hashing import k256
from strongchar_core.judge import Verdict

SH = k256(b"strongchar-test")
G = np.zeros(4, np.float32)
TARGET = np.ones(4)
N = ["0x" + f"{i + 1:040x}" for i in range(4)]


def loss(w):
    return float(((w - TARGET) ** 2).sum())


def toward(k):
    return (G + k * (TARGET - G)).astype(np.float32)


def test_equal_split_dust_to_lowest_and_invariants():
    shares = payout.equal(1_000_001, [N[2], N[0], N[1]])
    assert shares[N[0]] == 333_335 and shares[N[1]] == shares[N[2]] == 333_333
    assert payout.equal(5, []) == {}
    with pytest.raises(ValueError):
        payout.equal(10, [N[0], N[0].upper().replace("0X", "0x")])


def test_canonical_evidence_rejects_floats_and_sorts_keys():
    assert evidence.canonical({"b": 1, "a": [2]}) == b'{"a":[2],"b":1}'
    with pytest.raises(TypeError):
        evidence.canonical({"x": 0.5})


def _revealed(ws):
    return {n: (weights_hash(SH, w), w) for n, w in ws.items()}


def test_honest_round_pays_everyone():
    ws = {N[0]: toward(0.5), N[1]: toward(0.6), N[2]: toward(0.55)}
    f = finalize(7, 0, SH, G, [(n, i) for i, n in enumerate(N[:3])], _revealed(ws), {}, loss, 3_000_000)
    s = f.settlement
    assert s.outcome is Outcome.ACCEPTED and s.slashed_bitmap == 0
    assert sum(a for _, a in s.payouts) == 3_000_000 and len(s.payouts) == 3
    assert s.aggregate_hash == weights_hash(SH, f.weights) and f.weights_blob


def test_cheater_slashed_and_unpaid_even_if_round_reverts():
    roster = [(n, i) for i, n in enumerate(N)]
    ws = {N[0]: toward(0.5), N[1]: toward(0.6), N[2]: toward(0.55), N[3]: toward(0.9)}
    f = finalize(7, 1, SH, G, roster, _revealed(ws), {N[3]: Verdict.REPLAY_MISMATCH}, loss, 3_000_000)
    assert f.settlement.slashed_bitmap == 1 << 3 and N[3] not in dict(f.settlement.payouts)
    bad = {N[0]: toward(-2.0), N[1]: toward(-3.0)}
    r = finalize(7, 2, SH, G, roster, _revealed(bad), {N[3]: Verdict.REPLAY_MISMATCH}, loss, 3_000_000)
    assert r.settlement.outcome is Outcome.REVERTED and r.settlement.payouts == ()
    assert r.settlement.slashed_bitmap == 1 << 3 and r.weights_blob == b""
    assert r.settlement.aggregate_hash == weights_hash(SH, G)


def test_both_verifiers_get_identical_settlements():
    ws = {N[0]: toward(0.5), N[1]: toward(0.6), N[2]: toward(0.55)}
    args = (7, 0, SH, G, [(n, i) for i, n in enumerate(N[:3])], _revealed(ws), {}, loss, 3_000_000)
    a, b = finalize(*args), finalize(*args)
    assert a.settlement == b.settlement and a.settlement.payload_hash() == b.settlement.payload_hash()
    assert a.agg_evidence == b.agg_evidence and a.pay_evidence == b.pay_evidence
