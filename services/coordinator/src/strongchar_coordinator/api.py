"""Coordinator REST API: ciphertext-only blobs with recipient-only reads, drafts, signature relay, heartbeats."""


import json
import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any

import qoreseal as qs
from eth_utils import keccak
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from strongchar_core.evidence import canonical

from qorsdk import hex_to_bech32

from .auth import Auth
from .store import Store

PRIVATE_KINDS = {"shard": 60, "test": 60, "val": 60, "global": 25, "model": 25, "weights": 25, "script": 2,
                 "test-features": 60, "test-labels": 10}  # MB cap per blob
QUOTA_BYTES = 400 * 2**20
MAX_DRAFT_BYTES = 2 * 2**20
HEX32 = r"^0x[0-9a-f]{64}$"
ADDRESS = r"^0x[0-9a-fA-F]{40}$"


@dataclass
class ChainView:
    """What the API needs from the chain; injected so tests run offline."""

    pq_key_of: Callable[[str], bytes | None]  # possession-proven ML-DSA-87 key, or None
    kem_key_of: Callable[[str], bytes | None]  # registered ML-KEM-1024 key, or None
    is_verifier: Callable[[str], bool]


class RateLimiter:
    """Sliding-window counter per key; enough for one coordinator process."""

    def __init__(self, limit: int, window_s: float):
        self.limit, self.window = limit, window_s
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and q[0] < now - self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


class LoginBody(BaseModel):
    address: str = Field(pattern=ADDRESS)
    signature: str = Field(max_length=8000)


class DraftBody(BaseModel):
    spec: dict[str, Any]
    manifest: dict[str, Any]
    cards: dict[str, str] = {}


class SignatureBody(BaseModel):
    payloadHash: str = Field(pattern=HEX32)
    expiry: int = Field(ge=0)
    settlement: dict[str, Any]
    signature: str = Field(max_length=8000)


class HeartbeatBody(BaseModel):
    version: str = Field(max_length=40)
    arch: str = Field(max_length=20)
    cores: int = Field(ge=1, le=1024)
    benchmark_s: float = Field(gt=0, lt=3600)
    selftest: str = Field(max_length=80)


def _bech32_of(evm: str) -> str:
    return hex_to_bech32(evm).lower()


def spec_hash(spec: dict) -> str:
    return "0x" + keccak(canonical(spec)).hex()


BLOB_FIELDS = ("shards", "val", "test")  # manifest fields that name uploaded envelopes


def blob_ids(manifest: dict) -> list[str]:
    out: list[str] = []
    for v in (manifest.get(f) for f in BLOB_FIELDS if f in manifest):
        out += v if isinstance(v, list) else [v]
    return [b for b in out if isinstance(b, str)]


def create_app(store: Store, chain: ChainView, allowed_origins: list[str] | None = None) -> FastAPI:
    app = FastAPI(title="strongChar coordinator", version="0.1.0", docs_url=None, redoc_url=None)
    auth = Auth(chain.pq_key_of)
    login_limit = RateLimiter(10, 60)
    upload_limit = RateLimiter(120, 60)
    if allowed_origins:
        app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_methods=["GET", "POST"],
                           allow_headers=["authorization", "content-type", "x-kind", "x-name"])

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    def caller(authorization: Annotated[str | None, Header()] = None) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "sign in first")
        who = auth.who(authorization.removeprefix("Bearer "))
        if who is None:
            raise HTTPException(401, "session expired, sign in again")
        return who

    Caller = Annotated[str, Depends(caller)]

    def client_key(request: Request) -> str:
        return request.client.host if request.client else "unknown"

    @app.get("/v1/health")
    def health() -> dict:
        return {"ok": True, "time": time.time()}

    @app.get("/v1/auth/challenge")
    def challenge(address: str, request: Request) -> dict:
        # Per IP and account: several services legitimately share one IP (all nodes on one server).
        if not login_limit.allow(f"{client_key(request)}|{address.lower()}"):
            raise HTTPException(429, "too many sign-in attempts, wait a minute")
        if not (address.startswith("0x") and len(address) == 42):
            raise HTTPException(400, "bad address")
        return {"nonce": auth.challenge(address)}

    @app.post("/v1/auth/login")
    def login(body: LoginBody, request: Request) -> dict:
        if not login_limit.allow(f"{client_key(request)}|{body.address.lower()}"):
            raise HTTPException(429, "too many sign-in attempts, wait a minute")
        token = auth.login(body.address, body.signature)
        if token is None:
            raise HTTPException(401, "signature does not verify against the account's on-chain ML-DSA-87 key")
        return {"token": token}

    @app.post("/v1/blobs")
    async def put_blob(request: Request, who: Caller, x_kind: Annotated[str, Header()]) -> dict:
        if not upload_limit.allow(who):
            raise HTTPException(429, "too many uploads, slow down")
        if x_kind not in PRIVATE_KINDS:
            raise HTTPException(400, "unknown kind")
        raw = await request.body()
        if len(raw) > PRIVATE_KINDS[x_kind] * 2**20:
            raise HTTPException(413, "too large for this kind")
        if not raw.isascii():
            raise HTTPException(400, "not a QoreSeal envelope")
        text = raw.decode("ascii")
        try:
            parsed = qs.parse_envelope(qs.envelope_from_text(text))
        except Exception:
            raise HTTPException(400, "not a QoreSeal envelope") from None
        if parsed.version != 1 or not parsed.entries or any(e.hint == bytes(16) for e in parsed.entries):
            raise HTTPException(400, "envelope must name its recipients (version 1, not anonymous)")
        if store.uploader_bytes(who) + len(raw) > QUOTA_BYTES:
            raise HTTPException(429, "upload quota reached")
        blob_id = "0x" + keccak(raw).hex()
        store.put_blob(blob_id, x_kind, text, who)
        return {"id": blob_id, "size": len(raw)}

    @app.get("/v1/blobs/{blob_id}")
    def get_blob(blob_id: str, who: Caller) -> dict:
        got = store.get_blob(blob_id)
        if got is None:
            raise HTTPException(404, "no such blob")
        kind, text = got
        kem = chain.kem_key_of(who)
        parsed = qs.parse_envelope(qs.envelope_from_text(text))
        # Recipient-only reads: the caller's registered ML-KEM key must match one of the envelope's hints.
        if kem is None or all(e.hint != qs.recipient_hint(parsed.salt, kem) for e in parsed.entries):
            raise HTTPException(403, "not a recipient of this envelope")
        return {"id": blob_id, "kind": kind, "envelope": text}

    @app.get("/v1/sealed")
    def sealed() -> dict:
        """Everything the server holds: ciphertext ids, kinds and sizes. There is nothing else to show."""
        return {"blobs": store.list_blobs()}

    @app.post("/v1/jobs/draft")
    def put_draft(body: DraftBody, who: Caller) -> dict:
        if len(json.dumps(body.model_dump())) > MAX_DRAFT_BYTES:
            raise HTTPException(413, "draft too large")
        h = spec_hash(body.spec)
        existing = store.get_draft(h)
        if existing is not None and existing.get("owner") != who:
            raise HTTPException(409, "a draft with this spec belongs to someone else")
        ids = blob_ids(body.manifest)
        if any(store.get_blob(b) is None for b in ids):
            raise HTTPException(400, "manifest names a blob that was never uploaded")
        store.put_draft(h, who, {**body.model_dump(), "owner": who, "specHash": h})
        store.pin(ids)
        return {"specHash": h}

    @app.get("/v1/jobs/draft/{h}")
    def get_draft(h: str) -> dict:
        d = store.get_draft(h)
        if d is None:
            raise HTTPException(404, "no such draft")
        return d

    @app.post("/v1/rounds/{job}/{rnd}/signatures")
    def put_signature(job: int, rnd: int, body: SignatureBody, who: Caller) -> dict:
        if not chain.is_verifier(who):
            raise HTTPException(403, "only the job market's two verifiers sign settlements")
        store.put_signature(job, rnd, who, body.payloadHash, body.expiry, body.settlement, body.signature)
        return {"ok": True}

    @app.get("/v1/rounds/{job}/{rnd}/signatures")
    def get_signatures(job: int, rnd: int) -> dict:
        return {"signatures": store.signatures(job, rnd)}

    @app.post("/v1/heartbeat")
    def heartbeat(body: HeartbeatBody, who: Caller) -> dict:
        store.heartbeat(who, body.model_dump())
        return {"ok": True}

    class CardBody(BaseModel):
        card: str = Field(max_length=20000)

    @app.post("/v1/cards")
    def put_card(body: CardBody, who: Caller) -> dict:
        """An account publishes its own recipient card; senders still verify it against the chain before sealing."""
        try:
            fields = qs.recipient_card_from_json(body.card)
        except Exception:
            raise HTTPException(400, "not a recipient card") from None
        if fields.address.lower() not in (who, _bech32_of(who)):
            raise HTTPException(403, "you can only publish your own card")
        store.put_card(who, body.card)
        return {"ok": True}

    @app.get("/v1/cards/{address}")
    def get_card(address: str) -> dict:
        card = store.get_card(address)
        if card is None:
            raise HTTPException(404, "no card for this address")
        return {"card": card}

    TOPIC = r"^(comp-[0-9]{1,9}-(run|validity|scores)(-[0-9]{1,4})?|job-[0-9]{1,9}-round-[0-9]{1,4}-feed)$"

    @app.post("/v1/attest/{topic}")
    def attest(topic: str, body: dict[str, Any], who: Caller) -> dict:
        """Verifier-only notes: competition run results, verdicts and score tables, and each round's feed (the
        shards and start weights a verifier re-sealed to the nodes seated in that round)."""
        import re

        if not re.match(TOPIC, topic) or not chain.is_verifier(who):
            raise HTTPException(403, "only the verifiers post attestations")
        if len(json.dumps(body)) > 64 * 1024:
            raise HTTPException(413, "attestation too large")
        if topic.endswith("-feed"):
            ids = [b for e in body.get("nodes", {}).values() if isinstance(e, dict)
                   for b in (e.get("shardBlob"), e.get("weightsBlob")) if isinstance(b, str)]
            if any(store.get_blob(b) is None for b in ids):
                raise HTTPException(400, "feed names a blob that was never uploaded")
            store.pin(ids)
        store.attest(topic, who, body)
        return {"ok": True}

    @app.get("/v1/attest/{topic}")
    def get_attest(topic: str) -> dict:
        return {"attestations": store.attestations(topic)}

    @app.post("/v1/public")
    async def put_public(request: Request, who: Caller, x_name: Annotated[str, Header()]) -> dict:
        """Data that is public by design (a competition's training set, predictions published after the reveal)."""
        if not upload_limit.allow(who):
            raise HTTPException(429, "too many uploads, slow down")
        raw = await request.body()
        if len(raw) > 30 * 2**20 or not raw.isascii() or len(x_name) > 80:
            raise HTTPException(400, "public files are ASCII text up to 30 MB")
        file_id = "0x" + keccak(raw).hex()
        store.put_public(file_id, x_name, raw, who)
        return {"id": file_id}

    @app.get("/v1/public/{file_id}")
    def get_public(file_id: str):
        from fastapi.responses import Response

        got = store.get_public(file_id)
        if got is None:
            raise HTTPException(404, "no such file")
        return Response(got[1], media_type="text/csv", headers={"X-Name": got[0]})

    @app.get("/v1/nodes")
    def nodes() -> dict:
        return {"nodes": store.live_nodes()}

    @app.get("/v1/jobs/{job}/matcher")
    def matcher(job: int) -> dict:
        """The keeper's last seating decision for a job: who was seated, and why every other node wasn't."""
        raw = store.kv_get(f"matcher/{job}")
        if raw is None:
            raise HTTPException(404, "the keeper hasn't tried to seat this job yet")
        return json.loads(raw)

    return app
