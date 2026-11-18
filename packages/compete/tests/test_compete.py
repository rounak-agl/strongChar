"""Metrics against independent oracles, canonical-prediction properties, and real sandbox containment."""

import math
import shutil
import subprocess

import numpy as np
import pytest

from strongchar_compete import metrics
from strongchar_compete.predictions import BadOutput, canonical_bytes, parse, prediction_hash
from strongchar_compete.sandbox import run_script

RNG = np.random.default_rng(0)


def test_metrics_match_independent_oracles():
    for _ in range(200):
        n, k = int(RNG.integers(1, 60)), int(RNG.integers(2, 6))
        y, p = RNG.integers(0, k, n).tolist(), RNG.integers(0, k, n).tolist()
        assert metrics.accuracy(y, p) == float(np.mean(np.array(y) == np.array(p)))
        f1 = []
        for c in range(k):
            yt, pt = np.array(y) == c, np.array(p) == c
            tp, fp, fn = (yt & pt).sum(), (~yt & pt).sum(), (yt & ~pt).sum()
            f1.append(0.0 if tp == 0 else 2 * tp / (2 * tp + fp + fn))
        assert math.isclose(metrics.macro_f1(y, p, k), float(np.mean(f1)), rel_tol=1e-12)
        yr, pr = RNG.normal(size=n).tolist(), RNG.normal(size=n).tolist()
        assert math.isclose(metrics.rmse(yr, pr), float(np.sqrt(np.mean((np.array(yr) - np.array(pr)) ** 2))), rel_tol=1e-9)


def test_score_scale_makes_higher_always_better():
    assert metrics.to_e6("accuracy", 0.75) == 750_000 and metrics.to_e6("rmse", 0.5) == -500_000
    assert metrics.to_e6("rmse", 0.4) > metrics.to_e6("rmse", 0.5)


def test_canonical_parse_is_idempotent_and_order_stable():
    for _ in range(100):
        n = int(RNG.integers(1, 40))
        vals = (RNG.normal(size=n) * 1000).tolist()
        p = parse("\n".join(repr(v) for v in vals).encode(), n, "regression", None)
        assert parse(canonical_bytes(p), n, "regression", None) == p  # canonical form parses back to itself
        assert prediction_hash(p) == prediction_hash(parse(canonical_bytes(p), n, "regression", None))


def test_parse_rejects_bad_outputs_with_reasons():
    cases = [(b"1\n2\n", 3, "BadOutputShape"), (b"0\n5\n1\n", 3, "BadOutputRange"), (b"0\nnan\n1\n", 3, "BadOutputRange"),
             (b"0\nx\n1\n", 3, "BadOutputShape"), (b"0\n1.5\n1\n", 3, "BadOutputRange")]
    for raw, rows, reason in cases:
        with pytest.raises(BadOutput) as e:
            parse(raw, rows, "classification", 3)
        assert e.value.reason == reason
    assert parse(b"prediction\n2\n0\n1\n", 3, "classification", 3) == [2, 0, 1]


needs_docker = pytest.mark.skipif(
    shutil.which("docker") is None or subprocess.run(["docker", "image", "inspect", "strongchar-sandbox:1"],
                                                     capture_output=True).returncode != 0,
    reason="needs docker and the strongchar-sandbox:1 image")

TRAIN = b"a,b,label\n" + b"".join(f"{i % 7},{i % 3},{int(i % 7 > 3)}\n".encode() for i in range(200))
TEST = b"a,b\n" + b"".join(f"{i % 7},{i % 5}\n".encode() for i in range(50))
GOOD = b"""
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
tr = pd.read_csv('/data/train.csv'); te = pd.read_csv('/data/test_features.csv')
m = LogisticRegression().fit(tr[['a','b']], tr['label'])
pd.Series(m.predict(te[['a','b']]), name='prediction').to_csv('/out/predictions.csv', index=False)
"""


@pytest.fixture(autouse=True)
def local_runtime(monkeypatch):
    import strongchar_compete.sandbox as sb
    monkeypatch.setattr(sb, "RUNTIME", "runc")  # gVisor runs on the verifiers server; runc is enough for CI-style checks


@needs_docker
def test_good_script_runs_deterministically():
    a = run_script(GOOD, TRAIN, TEST, 50, "classification", 2, timeout_s=120)
    b = run_script(GOOD, TRAIN, TEST, 50, "classification", 2, timeout_s=120)
    assert a.ok and b.ok and a.pred_hash == b.pred_hash, (a.reason, a.detail)


@needs_docker
@pytest.mark.parametrize("script,reason", [
    (b"import urllib.request; urllib.request.urlopen('http://1.1.1.1', timeout=3)", "Crash"),
    (b"open('/data/train.csv','a').write('x')", "Crash"),
    (b"import os\nwhile True: os.fork()", None),
    (b"raise SystemExit(3)", "Crash"),
    (b"open('/out/predictions.csv','w').write('0\\n'*3)", "BadOutputShape"),
    (b"import time; time.sleep(30)", "Timeout"),
])
def test_hostile_scripts_are_contained(script, reason):
    r = run_script(script, TRAIN, TEST, 50, "classification", 2, timeout_s=8)
    assert not r.ok
    if reason:
        assert r.reason == reason, (r.reason, r.detail)
