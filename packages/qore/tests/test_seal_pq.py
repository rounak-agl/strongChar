"""Offline checks of sealing (AAD binding, recipients, cards) and ML-DSA message signing."""

import pytest
import qoreseal as qs
from qorsdk import generate_mnemonic
from qorsdk.unified import derive_unified_account
from strongchar_core.encodings import PQKind, pq_message

from strongchar_qore import pq, seal

MARKET = "0x" + "11" * 20


def _party():
    m = generate_mnemonic(256)
    return derive_unified_account(m), qs.derive_seal_keys(m)


def test_seal_open_binding_and_recipients():
    parties = [_party() for _ in range(4)]
    recipients = [qs.recipient_of(k) for _, k in parties[:3]]
    keys = [k.mlkem_public_key for _, k in parties[:3]]
    a = seal.aad(MARKET, 7, 1, 3, seal.Kind.SHARD, keys)
    assert seal.aad(MARKET, 7, 1, 3, seal.Kind.SHARD, list(reversed(keys))) == a  # order of recipients doesn't matter
    text = seal.seal(recipients, b"rows", seal.Kind.SHARD, a)
    assert text.startswith("qoreseal:") and seal.is_envelope(text) and not seal.is_envelope("qoreseal:abc")
    for _, k in parties[:3]:
        assert seal.open_(text, k, seal.Kind.SHARD, a) == b"rows"
    for wrong in (seal.aad(MARKET, 7, 1, 4, seal.Kind.SHARD, keys), seal.aad(MARKET, 8, 1, 3, seal.Kind.SHARD, keys),
                  seal.aad(MARKET, 7, 1, 3, seal.Kind.SHARD, keys[:2])):
        with pytest.raises(qs.QoreSealError):
            seal.open_(text, parties[0][1], seal.Kind.SHARD, wrong)
    with pytest.raises(qs.QoreSealError):
        seal.open_(text, parties[0][1], seal.Kind.WEIGHTS, a)  # purpose is bound too
    with pytest.raises(qs.QoreSealError):
        seal.open_(text, parties[3][1], seal.Kind.SHARD, a)  # not a recipient


def test_card_must_match_registered_keys():
    (acct, keys), (_, other) = _party(), _party()
    card = seal.make_card(acct.cosmos, keys, acct.private_key, acct.pqc.secret_key)
    r = seal.recipient_from_card(card, acct.cosmos, acct.pqc.public_key, keys.mlkem_public_key)
    assert r is not None
    with pytest.raises(qs.QoreSealError):
        seal.recipient_from_card(card, acct.cosmos, acct.pqc.public_key, other.mlkem_public_key)


def test_pq_message_signature_verifies_and_is_bound():
    acct, _ = _party()
    msg, sig = pq.sign_message(acct, 9800, MARKET, PQKind.SETTLEMENT, b"\x05" * 32, 1000)
    assert msg == pq_message(9800, MARKET, PQKind.SETTLEMENT, b"\x05" * 32, 1000)
    assert pq.verify(acct.pqc.public_key, msg, sig)
    other = pq_message(9800, MARKET, PQKind.SCORES, b"\x05" * 32, 1000)
    assert not pq.verify(acct.pqc.public_key, other, sig)
    assert len(sig) == 4627 and len(acct.pqc.public_key) == 2592


def test_convert_coin_encoding_matches_protobuf_layout():
    from strongchar_qore.erc20 import convert_coin_msg

    m = convert_coin_msg(denom="erc20:0xAB", amount=5, receiver_evm="0x01", sender_qor="qor1x")
    coin = b"\x0a\x0aerc20:0xAB\x12\x015"
    assert m["value"] == b"\x0a" + bytes([len(coin)]) + coin + b"\x12\x040x01\x1a\x05qor1x"
