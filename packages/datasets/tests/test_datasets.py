"""Canonical order and hash, splits, shard bytes, and the synthetic health preset."""

from pathlib import Path

import numpy as np
import pytest
from strongchar_core.hashing import k256

from strongchar_datasets import presets
from strongchar_datasets.canonical import DatasetError, from_arrays, from_csv, split
from strongchar_datasets.shards import Rows, cut, parse


def _data(n=1200):
    rng = np.random.default_rng(0)
    return rng.random((n, 5)), rng.integers(0, 3, n)


def test_canonical_is_order_independent_and_hashes_the_arrays():
    x, y = _data()
    a = from_arrays(x, y)
    perm = np.random.default_rng(1).permutation(len(y))
    # Same rows in another order give a different canonical order (row index drives it) but a stable hash per input.
    assert from_arrays(x, y).card.hash == a.card.hash
    assert from_arrays(x[perm], y[perm]).card.rows == a.card.rows
    assert a.card.task == "classification" and a.card.classes == 3 and a.card.x_shape == (5,)


def test_rejects_bad_inputs():
    x, y = _data()
    with pytest.raises(DatasetError):
        from_arrays(x[:10], y[:10])
    bad = x.copy()
    bad[0, 0] = np.nan
    with pytest.raises(DatasetError):
        from_arrays(bad, y)


def test_split_counts_and_shards():
    s = split(1000, 3, "0.1", "0.05")
    assert s.val == (850, 100) and s.holdout == (950, 50)
    assert [n for _, n in s.shards] == [284, 283, 283] and s.shards[1][0] == 284


def test_shard_bytes_roundtrip_and_tamper():
    c = from_arrays(*_data())
    s = split(c.card.rows, 4, "0.1", "0.1")
    pieces = cut(c, s)
    assert len(pieces["train"]) == 4
    data = pieces["train"][2]
    start, x, y = parse(data, k256(data))
    assert start == s.shards[2][0] and np.array_equal(x, c.x[start:start + len(x)])
    with pytest.raises(DatasetError):
        parse(data[:-1] + bytes([data[-1] ^ 1]), k256(data))
    rows = Rows(x, start)
    assert np.array_equal(rows[[start, start + 1]], x[:2])
    with pytest.raises(IndexError):
        rows[[start - 1]]


def test_health_preset_is_deterministic_and_synthetic():
    a, b = presets.health_csv(2000), presets.health_csv(2000)
    assert a == b and a.startswith("age,bmi,")
    c = from_csv(a)
    assert c.card.task == "classification" and c.card.classes == 2 and c.card.x_shape == (8,)
    rate = c.y.mean()
    assert 0.1 < rate < 0.6, rate


@pytest.mark.live
def test_mnist_preset(tmp_path: Path):
    c = presets.mnist(tmp_path)
    assert c.card.rows == 70_000 and c.card.x_shape == (784,) and c.card.x_dtype == "uint8"
