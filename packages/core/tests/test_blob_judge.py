"""Weight blobs (format, signed zero, non-finite) and the exact replay judge."""

import numpy as np
import pytest

from strongchar_core.blob import BlobError, from_blob, to_blob, weights_hash
from strongchar_core.hashing import k256
from strongchar_core.judge import Verdict, judge

SH = k256(b"strongchar-test")


def test_header_length_and_roundtrip():
    w = np.random.default_rng(0).standard_normal(1000).astype(np.float32)
    b = to_blob(SH, w)
    assert b[:32] == SH and b[32:36] == b"\x01\x00\x00\x00" and len(b) == 36 + 4000
    assert np.array_equal(from_blob(SH, b, 1000), w)


def test_negative_zero_hashes_like_zero():
    assert weights_hash(SH, np.array([-0.0], np.float32)) == weights_hash(SH, np.array([0.0], np.float32))


@pytest.mark.parametrize("bad", [np.nan, np.inf, -np.inf])
def test_non_finite_rejected(bad):
    with pytest.raises(BlobError):
        to_blob(SH, np.array([1.0, bad], np.float32))
    with pytest.raises(BlobError):
        from_blob(SH, SH + b"\x01\x00\x00\x00" + np.array([bad], "<f4").tobytes(), 1)


def test_wrong_spec_or_length_rejected():
    b = to_blob(SH, np.ones(3, np.float32))
    with pytest.raises(BlobError):
        from_blob(k256(b"other"), b, 3)
    with pytest.raises(BlobError):
        from_blob(SH, b, 4)


def test_judge_is_bit_exact():
    w = np.array([1.0, 2.0, 2.0], np.float32)
    h = weights_hash(SH, w)
    assert judge(SH, w.copy(), h) is Verdict.OK
    off = w.copy()
    off[0] = np.nextafter(off[0], np.float32(2))  # one ulp
    assert judge(SH, off, h) is Verdict.REPLAY_MISMATCH
    assert judge(SH, None, h) is Verdict.DATA_UNAVAILABLE
