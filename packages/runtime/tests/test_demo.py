"""The offline demo reproduces the pinned round bit for bit, and a job's price follows its compute."""

import json

from strongchar_datasets import presets
from strongchar_runtime import demo, owner


def test_demo_round_matches_the_pinned_vector():
    got = {k: v for k, v in demo.run().items() if k != "seconds"}
    assert got == json.loads(demo.VECTOR.read_text())
    verdicts = {n["node"]: n["verdict"] for n in got["nodes"]}
    assert verdicts[demo.CHEATER] == "ReplayMismatch" and list(verdicts.values()).count("Ok") == 3
    assert got["settlement"]["slashedBitmap"] == 1 << 3


def test_price_scales_with_compute_seats_and_rounds():
    csv = presets.health_csv(2_000)
    base = owner.plan(csv, rounds=2, shards=2, quorum=2, price_units_per_gop=10**9)
    assert base.budget == 2 * 2 * base.ops_per_round  # 1 base unit per op at this price
    assert owner.plan(csv, rounds=4, shards=2, quorum=2, price_units_per_gop=10**9).budget == 2 * base.budget
    assert owner.plan(csv, rounds=2, shards=2, quorum=2, steps=80, price_units_per_gop=10**9).budget == 2 * base.budget
    tiny = owner.plan(csv, rounds=3, shards=4, quorum=2, price_units_per_gop=1)
    assert tiny.budget == 3 * 4  # never below one base unit per seat per round
    assert base.ref_work == 1  # under a Gop per round still credits one reference second


def test_salt_keeps_jobs_on_the_same_data_apart():
    csv = presets.health_csv(1_000)
    plain = owner.plan(csv, rounds=1, shards=2, quorum=2)
    a = owner.plan(csv, rounds=1, shards=2, quorum=2, salt="0x01")
    b = owner.plan(csv, rounds=1, shards=2, quorum=2, salt="0x02")
    assert len({plain.spec.hash, a.spec.hash, b.spec.hash}) == 3  # each job gets its own draft
    assert owner.plan(csv, rounds=1, shards=2, quorum=2, salt="0x01").spec.hash == a.spec.hash  # and can be re-derived
    assert "salt" not in plain.spec.raw  # specs without a salt hash exactly as before
    assert a.spec.initial_weights_hash() != b.spec.initial_weights_hash()  # weights are bound to their own spec
