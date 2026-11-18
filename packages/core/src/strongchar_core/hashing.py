"""keccak256, the single hash used for commitments, weight hashes and signed payloads."""

from eth_hash.auto import keccak as _keccak


def k256(data: bytes) -> bytes:
    return _keccak(data)


# NIST SHA3-256 differs from Ethereum's keccak256; refuse to import if the wrong backend is wired in.
assert k256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", "not keccak256"
