"""HTTP client for the coordinator. Logs in by signing a challenge with the account's ML-DSA-87 key."""

from __future__ import annotations

import base64
import time

import httpx
from qorsdk.pqc import pqc_sign
from qorsdk.unified import UnifiedAccount

HEADERS = {"user-agent": "strongchar/0.1"}


def challenge_message(address: str, nonce: str) -> bytes:
    return f"strongchar-auth/v1|{address.lower()}|{nonce}".encode()


class Coordinator:
    def __init__(self, base_url: str, account: UnifiedAccount):
        self.base, self.account = base_url.rstrip("/"), account
        self.http = httpx.Client(timeout=60.0, headers=HEADERS)
        self._token: str | None = None
        self._token_at = 0.0

    def _auth(self) -> dict:
        if self._token is None or time.time() - self._token_at > 20 * 60:
            addr = self.account.evm.lower()
            nonce = self.http.get(f"{self.base}/v1/auth/challenge", params={"address": addr}).raise_for_status().json()["nonce"]
            sig = pqc_sign(self.account.pqc.secret_key, challenge_message(addr, nonce))
            r = self.http.post(f"{self.base}/v1/auth/login",
                               json={"address": addr, "signature": base64.b64encode(sig).decode()}).raise_for_status()
            self._token, self._token_at = r.json()["token"], time.time()
        return {"Authorization": f"Bearer {self._token}"}

    def put_blob(self, envelope: str, kind: str) -> str:
        r = self.http.post(f"{self.base}/v1/blobs", content=envelope.encode(), headers={**self._auth(), "X-Kind": kind})
        return r.raise_for_status().json()["id"]

    def get_blob(self, blob_id: str) -> str:
        return self.http.get(f"{self.base}/v1/blobs/{blob_id}", headers=self._auth()).raise_for_status().json()["envelope"]

    def put_card(self, card: str) -> None:
        self.http.post(f"{self.base}/v1/cards", json={"card": card}, headers=self._auth()).raise_for_status()

    def get_card(self, address: str) -> str:
        return self.http.get(f"{self.base}/v1/cards/{address.lower()}").raise_for_status().json()["card"]

    def put_draft(self, spec: dict, manifest: dict) -> str:
        r = self.http.post(f"{self.base}/v1/jobs/draft", json={"spec": spec, "manifest": manifest}, headers=self._auth())
        return r.raise_for_status().json()["specHash"]

    def get_draft(self, spec_hash: str) -> dict:
        return self.http.get(f"{self.base}/v1/jobs/draft/{spec_hash}").raise_for_status().json()

    def put_signature(self, job: int, rnd: int, body: dict) -> None:
        self.http.post(f"{self.base}/v1/rounds/{job}/{rnd}/signatures", json=body, headers=self._auth()).raise_for_status()

    def signatures(self, job: int, rnd: int) -> list[dict]:
        return self.http.get(f"{self.base}/v1/rounds/{job}/{rnd}/signatures").raise_for_status().json()["signatures"]

    def heartbeat(self, body: dict) -> None:
        self.http.post(f"{self.base}/v1/heartbeat", json=body, headers=self._auth()).raise_for_status()
