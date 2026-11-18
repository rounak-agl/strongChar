"""QoreSeal for strongChar: hybrid ML-KEM-1024 envelopes with AAD bound to the job, item, kind and recipient set."""

from __future__ import annotations

from collections.abc import Sequence
from enum import Enum

import qoreseal as qs
from eth_utils import keccak

CHAIN_ID = "qorechain-diana"


class Kind(str, Enum):
    SHARD = "shard"
    VAL = "val"
    WEIGHTS = "weights"
    GLOBAL = "global"
    MODEL = "model"
    SCRIPT = "script"
    TEST_FEATURES = "test-features"
    TEST_LABELS = "test-labels"


def purpose(kind: Kind) -> str:
    return f"strongchar/{kind.value}/v1"


def recipient_set_hash(recipients: Sequence[bytes]) -> bytes:
    """Order-independent: the sorted ML-KEM public keys of everyone the envelope is sealed to."""
    return keccak(b"".join(sorted(recipients)))


def aad(contract: str, job: int, rnd: int, index: int, kind: Kind, recipient_mlkem_keys: Sequence[bytes]) -> bytes:
    """Binds an envelope to one slot; moving it to another job, round, item, kind or audience fails authentication."""
    return "|".join([CHAIN_ID, contract.lower(), str(job), str(rnd), str(index), kind.value,
                     recipient_set_hash(recipient_mlkem_keys).hex()]).encode()


def seal(recipients: Sequence[qs.SealRecipient], plaintext: bytes, kind: Kind, aad_bytes: bytes) -> str:
    """Text form ("qoreseal:…") so the coordinator can reject anything that isn't an envelope."""
    env = qs.seal_envelope(CHAIN_ID, purpose(kind), list(recipients), plaintext, aad_bytes, qs.SealMode.HYBRID, False)
    return qs.envelope_to_text(env)


def open_(text: str, keys: qs.SealKeyPair, kind: Kind, aad_bytes: bytes) -> bytes:
    return qs.open_envelope(CHAIN_ID, purpose(kind), qs.envelope_from_text(text), keys, aad_bytes)


def is_envelope(text: str) -> bool:
    """Structural check the coordinator runs on every upload: parses, version 1, at least one recipient."""
    try:
        parsed = qs.parse_envelope(qs.envelope_from_text(text))
    except (qs.QoreSealError, ValueError):
        return False
    return parsed.version == 1 and len(parsed.entries) >= 1


def make_card(address: str, keys: qs.SealKeyPair, classical_private_key: bytes, pq_secret_key: bytes) -> str:
    """A recipient card signed with both the account's secp256k1 and ML-DSA-87 keys."""
    fields = qs.recipient_card_fields(CHAIN_ID, address, keys.mlkem_public_key, keys.x25519_public_key)
    return qs.sign_recipient_card(fields, classical_private_key, pq_secret_key, "eth_secp256k1")


def recipient_from_card(card_json: str, address: str, pq_public_key: bytes, mlkem_public_key: bytes) -> qs.SealRecipient:
    """Never seal to anyone without this: the card must match the ML-DSA and ML-KEM keys registered on chain."""
    return qs.verify_recipient_card(card_json, CHAIN_ID, pq_public_key, mlkem_public_key, address)
