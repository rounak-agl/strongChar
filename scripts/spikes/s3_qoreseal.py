"""Spike S3: register ML-KEM-1024 keys, bind them with signed recipient cards, seal one shard to three recipients."""

from __future__ import annotations

import base64

import qoreseal as qs
from qorsdk import msg
from qorsdk.kem import parse_kem_key

from strongchar_qore import keystore
from strongchar_qore.chain import CHAIN_ID, Chain

PURPOSE = "strongchar/shard/v1"


def kem_key_on_chain(chain: Chain, address: str) -> bytes | None:
    res = parse_kem_key(chain.get(f"/qorechain/pqc/v1/kem/{address}"))
    return res.key.public_key if res.found and res.key else None


def pq_key_on_chain(chain: Chain, address: str) -> bytes:
    return base64.b64decode(chain.pqc_account(address)["account"]["public_key"])


def main() -> None:
    chain = Chain()
    actors = {a.name: a for a in keystore.load_all()}

    print("1. register ML-KEM-1024 keys (hybrid-signed)")
    for a in actors.values():
        if kem_key_on_chain(chain, a.qor) == a.seal.mlkem_public_key:
            print(f"  {a.name:12} already registered")
            continue
        r = chain.submit(a.account, [msg.pqc.register_kem_key(sender=a.qor, public_key=a.seal.mlkem_public_key)])
        ok = kem_key_on_chain(chain, a.qor) == a.seal.mlkem_public_key
        print(f"  {a.name:12} {r.txhash[:16]}… on-chain key matches: {ok}")

    print("2. recipient cards: sign with both keys, verify against the chain")
    cards = {}
    for name in ("node-1", "verifier-a", "verifier-b"):
        a = actors[name]
        fields = qs.recipient_card_fields(CHAIN_ID, a.qor, a.seal.mlkem_public_key, a.seal.x25519_public_key)
        cards[name] = qs.sign_recipient_card(fields, a.account.private_key, a.account.pqc.secret_key,
                                             "eth_secp256k1")
    recipients = []
    for name, card in cards.items():
        a = actors[name]
        r = qs.verify_recipient_card(card, CHAIN_ID, pq_key_on_chain(chain, a.qor),
                                     kem_key_on_chain(chain, a.qor), a.qor)
        recipients.append(r)
        print(f"  {name:12} card verified against on-chain ML-DSA + ML-KEM keys")
    forged = cards["node-1"].replace(actors["node-1"].qor, actors["node-2"].qor)
    try:
        qs.verify_recipient_card(forged, CHAIN_ID, pq_key_on_chain(chain, actors["node-2"].qor),
                                 kem_key_on_chain(chain, actors["node-2"].qor), actors["node-2"].qor)
        print("  forged card: ACCEPTED (bad)")
    except qs.QoreSealError as e:
        print(f"  forged card rejected: {e}")

    print("3. seal one shard to {node-1, verifier-a, verifier-b} with AAD")
    shard = bytes(range(256)) * 400  # ~100 KB stand-in shard
    aad = f"{CHAIN_ID}|jobmarket|job=1|round=0|shard=3|kind=shard".encode()
    env = qs.seal_envelope(CHAIN_ID, PURPOSE, recipients, shard, aad, qs.SealMode.HYBRID, False)
    text = qs.envelope_to_text(env)
    print(f"  plaintext {len(shard)} B → envelope {len(env)} B (overhead {len(env) - len(shard)} B), text prefix {text[:12]}…")
    for name in ("node-1", "verifier-a", "verifier-b"):
        out = qs.open_envelope(CHAIN_ID, PURPOSE, env, actors[name].seal, aad)
        print(f"  {name:12} opens: {out == shard}")
    for label, fn in (
        ("data-owner (not a recipient)", lambda: qs.open_envelope(CHAIN_ID, PURPOSE, env, actors["data-owner"].seal, aad)),
        ("verifier-a with wrong AAD", lambda: qs.open_envelope(CHAIN_ID, PURPOSE, env, actors["verifier-a"].seal, aad.replace(b"shard=3", b"shard=4"))),
        ("verifier-a with wrong purpose", lambda: qs.open_envelope(CHAIN_ID, "strongchar/weights/v1", env, actors["verifier-a"].seal, aad)),
    ):
        try:
            fn()
            print(f"  {label}: OPENED (bad)")
        except qs.QoreSealError as e:
            print(f"  {label}: refused ({e})")
    parsed = qs.parse_envelope(env)
    print(f"  envelope header readable without keys: {parsed}"[:240])


if __name__ == "__main__":
    main()
