"""ML-DSA-87 signatures over strongChar's contract messages (the exact bytes pqcVerify checks, spike S2)."""

from __future__ import annotations

from qorsdk.pqc import pqc_sign, pqc_verify
from qorsdk.unified import UnifiedAccount
from strongchar_core.encodings import PQKind, pq_message


def sign_message(account: UnifiedAccount, chain_id: int, contract: str, kind: PQKind, payload_hash: bytes,
                 expiry_block: int) -> tuple[bytes, bytes]:
    """(message, signature). Deterministic ML-DSA-87, so both a verifier and a test can reproduce it."""
    message = pq_message(chain_id, contract, kind, payload_hash, expiry_block)
    return message, pqc_sign(account.pqc.secret_key, message)


def verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    return pqc_verify(public_key, message, signature)
