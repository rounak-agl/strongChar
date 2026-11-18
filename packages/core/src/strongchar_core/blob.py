"""Weight blobs: specHash (32) | dtype tag 0x01000000 | little-endian float32 weights. Hashing one names the weights."""

import numpy as np

from .hashing import k256

DTYPE_F32 = b"\x01\x00\x00\x00"
HEADER_LEN = 36


class BlobError(ValueError):
    pass


def to_blob(spec_hash: bytes, w: np.ndarray) -> bytes:
    if len(spec_hash) != 32:
        raise BlobError("spec hash must be 32 bytes")
    # Adding +0.0 turns -0.0 into +0.0, so numerically equal weights always hash the same.
    w = np.ascontiguousarray(w, dtype="<f4") + np.float32(0)
    if not np.isfinite(w).all():
        raise BlobError("weights contain NaN or infinity")
    return spec_hash + DTYPE_F32 + w.tobytes()


def from_blob(spec_hash: bytes, blob: bytes, n_params: int) -> np.ndarray:
    if blob[:32] != spec_hash:
        raise BlobError("blob belongs to a different spec")
    if blob[32:HEADER_LEN] != DTYPE_F32 or len(blob) != HEADER_LEN + 4 * n_params:
        raise BlobError("blob has the wrong dtype tag or length")
    w = np.frombuffer(blob, dtype="<f4", offset=HEADER_LEN).copy()
    if not np.isfinite(w).all():
        raise BlobError("weights contain NaN or infinity")
    return w


def weights_hash(spec_hash: bytes, w: np.ndarray) -> bytes:
    return k256(to_blob(spec_hash, w))
