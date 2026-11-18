"""Turn addresses into QoreSeal recipients, but only after their cards verify against the keys on chain."""

from __future__ import annotations

import base64

import qoreseal as qs
from qorsdk import hex_to_bech32
from qorsdk.kem import parse_kem_key
from strongchar_qore.chain import Chain
from strongchar_qore.seal import recipient_from_card

from .client import Coordinator


def recipient(chain: Chain, coord: Coordinator, evm_address: str) -> tuple[qs.SealRecipient, bytes]:
    """(recipient, its ML-KEM key). Raises if the card, ML-DSA key or ML-KEM key doesn't line up."""
    qor = hex_to_bech32(evm_address)
    acct = chain.pqc_account(qor)["account"]
    if not acct or not acct.get("possession_proven"):
        raise ValueError(f"{evm_address} has no possession-proven ML-DSA key")
    kem = parse_kem_key(chain.get(f"/qorechain/pqc/v1/kem/{qor}"))
    if not kem.found or kem.key is None:
        raise ValueError(f"{evm_address} has no registered ML-KEM key")
    r = recipient_from_card(coord.get_card(evm_address), qor, base64.b64decode(acct["public_key"]), kem.key.public_key)
    return r, kem.key.public_key
