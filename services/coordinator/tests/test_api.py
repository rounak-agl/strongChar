"""Coordinator API offline: ML-DSA login, ciphertext-only uploads, recipient-only reads, drafts, verifier-only relay."""

import base64

import pytest
import qoreseal as qs
from fastapi.testclient import TestClient
from qorsdk import generate_mnemonic
from qorsdk.pqc import pqc_sign
from qorsdk.unified import derive_unified_account

from strongchar_coordinator.api import ChainView, create_app
from strongchar_coordinator.auth import challenge_message
from strongchar_coordinator.store import Store


class Party:
    def __init__(self):
        m = generate_mnemonic(256)
        self.acct = derive_unified_account(m)
        self.seal = qs.derive_seal_keys(m)
        self.addr = self.acct.evm.lower()


@pytest.fixture
def world(tmp_path):
    parties = {n: Party() for n in ("owner", "node", "verifier", "stranger")}
    by_addr = {p.addr: p for p in parties.values()}
    chain = ChainView(
        pq_key_of=lambda a: by_addr[a.lower()].acct.pqc.public_key if a.lower() in by_addr else None,
        kem_key_of=lambda a: by_addr[a.lower()].seal.mlkem_public_key if a.lower() in by_addr else None,
        is_verifier=lambda a: a.lower() == parties["verifier"].addr,
    )
    client = TestClient(create_app(Store(tmp_path), chain))
    return client, parties


def login(client, p: Party) -> dict:
    nonce = client.get("/v1/auth/challenge", params={"address": p.addr}).json()["nonce"]
    sig = pqc_sign(p.acct.pqc.secret_key, challenge_message(p.addr, nonce))
    r = client.post("/v1/auth/login", json={"address": p.addr, "signature": base64.b64encode(sig).decode()})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def envelope(recipients, data=b"rows", anonymous=False) -> str:
    env = qs.seal_envelope("qorechain-diana", "strongchar/shard/v1", [qs.recipient_of(r.seal) for r in recipients],
                           data, None, qs.SealMode.HYBRID, anonymous)
    return qs.envelope_to_text(env)


def test_login_needs_the_right_key_and_is_single_use(world):
    client, ps = world
    nonce = client.get("/v1/auth/challenge", params={"address": ps["owner"].addr}).json()["nonce"]
    wrong = pqc_sign(ps["stranger"].acct.pqc.secret_key, challenge_message(ps["owner"].addr, nonce))
    r = client.post("/v1/auth/login", json={"address": ps["owner"].addr, "signature": base64.b64encode(wrong).decode()})
    assert r.status_code == 401
    good = pqc_sign(ps["owner"].acct.pqc.secret_key, challenge_message(ps["owner"].addr, nonce))
    r = client.post("/v1/auth/login", json={"address": ps["owner"].addr, "signature": base64.b64encode(good).decode()})
    assert r.status_code == 401  # the challenge was consumed by the failed attempt
    assert client.post("/v1/blobs", content=b"x", headers={"X-Kind": "shard"}).status_code == 401


def test_only_named_envelopes_are_stored_and_only_recipients_read_them(world):
    client, ps = world
    h = login(client, ps["owner"])
    for bad in (b"plaintext rows", b"qoreseal:notbase64!!", envelope([ps["node"]], anonymous=True).encode()):
        assert client.post("/v1/blobs", content=bad, headers={**h, "X-Kind": "shard"}).status_code == 400
    assert client.post("/v1/blobs", content=envelope([ps["node"]]).encode(),
                       headers={**h, "X-Kind": "unknown"}).status_code == 400
    r = client.post("/v1/blobs", content=envelope([ps["node"], ps["verifier"]]).encode(), headers={**h, "X-Kind": "shard"})
    assert r.status_code == 200
    blob = r.json()["id"]
    got = client.get(f"/v1/blobs/{blob}", headers=login(client, ps["node"]))
    assert got.status_code == 200 and got.json()["envelope"].startswith("qoreseal:")
    assert client.get(f"/v1/blobs/{blob}", headers=login(client, ps["stranger"])).status_code == 403
    assert client.get(f"/v1/blobs/{blob}", headers=h).status_code == 403  # the uploader isn't a recipient either
    listing = client.get("/v1/sealed").json()["blobs"]
    assert listing[0]["id"] == blob and set(listing[0]) == {"id", "kind", "size", "created", "pinned"}


def test_drafts_pin_blobs_and_belong_to_their_creator(world):
    client, ps = world
    h = login(client, ps["owner"])
    blob = client.post("/v1/blobs", content=envelope([ps["node"]]).encode(), headers={**h, "X-Kind": "shard"}).json()["id"]
    spec = {"workload": "mlp-exact/1", "rounds": 2}
    assert client.post("/v1/jobs/draft", json={"spec": spec, "manifest": {"shards": ["0x" + "00" * 32]}},
                       headers=h).status_code == 400
    r = client.post("/v1/jobs/draft", json={"spec": spec, "manifest": {"shards": [blob]}}, headers=h)
    assert r.status_code == 200
    sh = r.json()["specHash"]
    assert client.get(f"/v1/jobs/draft/{sh}").json()["manifest"]["shards"] == [blob]
    other = login(client, ps["stranger"])
    assert client.post("/v1/jobs/draft", json={"spec": spec, "manifest": {}}, headers=other).status_code == 409
    assert client.get("/v1/sealed").json()["blobs"][0]["pinned"] is True


def test_only_verifiers_post_settlement_signatures(world):
    client, ps = world
    body = {"payloadHash": "0x" + "ab" * 32, "expiry": 10, "settlement": {"outcome": 0}, "signature": "c2ln"}
    assert client.post("/v1/rounds/1/1/signatures", json=body, headers=login(client, ps["node"])).status_code == 403
    assert client.post("/v1/rounds/1/1/signatures", json=body, headers=login(client, ps["verifier"])).status_code == 200
    sigs = client.get("/v1/rounds/1/1/signatures").json()["signatures"]
    assert len(sigs) == 1 and sigs[0]["verifier"] == ps["verifier"].addr


def test_login_is_rate_limited(world):
    client, ps = world
    codes = [client.get("/v1/auth/challenge", params={"address": ps["owner"].addr}).status_code for _ in range(12)]
    assert codes[:10] == [200] * 10 and 429 in codes[10:]


def test_security_headers(world):
    client, _ = world
    r = client.get("/v1/health")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["cache-control"] == "no-store"


def test_coordinator_stores_only_ciphertext(world, tmp_path):
    import numpy as np
    from strongchar_datasets.shards import encode

    from strongchar_coordinator.audit import scan

    client, ps = world
    rows = encode("0x" + "ab" * 32, 0, np.arange(40, dtype=np.float32).reshape(10, 4), np.arange(10))
    secret = b"PATIENT-RECORD-7731"
    h = login(client, ps["owner"])
    for payload in (rows, rows + secret):
        text = envelope([ps["node"], ps["verifier"]], payload)
        assert client.post("/v1/blobs", content=text.encode(), headers={**h, "X-Kind": "shard"}).status_code == 200
    root = tmp_path  # the Store in the fixture writes here
    assert any(root.rglob("*")), "nothing was stored"
    assert scan(root, [secret]) == []


def test_admin_routes_are_off_without_a_token_and_need_the_exact_token(tmp_path, monkeypatch):
    store = Store(tmp_path / "a")
    nobody = ChainView(pq_key_of=lambda a: None, kem_key_of=lambda a: None, is_verifier=lambda a: False)
    off = TestClient(create_app(store, nobody))
    assert off.post("/v1/admin/jobs/1/pause").status_code == 403
    monkeypatch.setenv("STRONGCHAR_ADMIN_TOKEN", "s3cret-admin")
    on = TestClient(create_app(store, nobody))
    assert on.post("/v1/admin/jobs/1/pause", headers={"x-admin-token": "wrong"}).status_code == 403
    assert on.post("/v1/admin/jobs/1/pause", headers={"x-admin-token": "s3cret-admin"}).json()["paused"]
    assert store.kv_get("paused/1") == "1"
    store.kv_set("missed", '{"0xabc": 2}')
    assert on.post("/v1/admin/nodes/0xABC/rearm", headers={"x-admin-token": "s3cret-admin"}).status_code == 200
    assert store.kv_get("missed") == '{"0xabc": 0}'


def test_settlement_blobs_are_pinned_so_later_rounds_and_the_owner_can_still_fetch_them(world, tmp_path):
    client, ps = world
    hv = login(client, ps["verifier"])
    blob = client.post("/v1/blobs", content=envelope([ps["verifier"]]).encode(),
                       headers={**hv, "X-Kind": "global"}).json()["id"]
    body = {"payloadHash": "0x" + "11" * 32, "expiry": 5, "signature": "AA==", "settlement": {"globalBlob": blob}}
    bad = {**body, "settlement": {"globalBlob": "0x" + "22" * 32}}
    assert client.post("/v1/rounds/1/1/signatures", json=bad, headers=hv).status_code == 400
    assert client.post("/v1/rounds/1/1/signatures", json=body, headers=hv).status_code == 200
    store = Store(tmp_path)  # the fixture's store
    assert store.drop_unpinned(-1) == 0  # even "older than now", a settlement's weights survive cleanup
    assert store.get_blob(blob) is not None


def test_no_schema_or_docs_and_hardening_headers(world):
    client, _ = world
    for path in ("/openapi.json", "/docs", "/redoc"):
        assert client.get(path).status_code == 404
    h = client.get("/v1/health").headers
    assert h["strict-transport-security"].startswith("max-age=")
    assert "default-src 'none'" in h["content-security-policy"]
    assert h["x-frame-options"] == "DENY" and h["x-content-type-options"] == "nosniff"
