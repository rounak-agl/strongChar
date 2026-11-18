"""Verdict agreement and score tables: the pure decisions both verifiers must reach identically."""

from strongchar_verifier.compete import agree, score_table

H = "0x" + "11" * 32


def test_valid_only_when_both_ran_cleanly_and_agree():
    ok = {"ok": True, "predHash": H, "reason": "Ok"}
    assert agree(ok, ok).ok and agree(ok, ok).pred_hash == bytes.fromhex(H[2:])
    other = {"ok": True, "predHash": "0x" + "22" * 32, "reason": "Ok"}
    assert agree(ok, other).reason == "NondeterministicOutput" and not agree(ok, other).ok
    crash = {"ok": False, "predHash": None, "reason": "Crash"}
    assert agree(ok, crash).reason == "Crash" and agree(crash, ok) == agree(ok, crash)


def test_score_table_is_ordered_and_signed_the_same_way_by_both():
    preds = {2: [1, 0, 1, 1], 0: [1, 1, 1, 1]}
    ids, scores = score_table([2, 0], preds, [1, 0, 1, 1], "accuracy", 2)
    assert ids == [0, 2] and scores == [750_000, 1_000_000]
    ids, scores = score_table([1], {1: [0.5, 0.5]}, [0.0, 1.0], "rmse", None)
    assert scores == [-500_000]
