"""Service login: sign a one-time challenge with the account's on-chain, possession-proven ML-DSA-87 key."""

from __future__ import annotations

import base64
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

from qorsdk.pqc import pqc_verify

CHALLENGE_TTL_S = 120
TOKEN_TTL_S = 30 * 60


def challenge_message(address: str, nonce: str) -> bytes:
    return f"strongchar-auth/v1|{address.lower()}|{nonce}".encode()


@dataclass
class Session:
    address: str
    expires: float


class Auth:
    """pq_key_of(address) returns the account's possession-proven ML-DSA public key, or None."""

    def __init__(self, pq_key_of: Callable[[str], bytes | None]):
        self.pq_key_of = pq_key_of
        self._challenges: dict[str, tuple[str, float]] = {}
        self._tokens: dict[str, Session] = {}
        self._lock = threading.Lock()

    def challenge(self, address: str) -> str:
        nonce = secrets.token_hex(16)
        with self._lock:
            self._challenges[address.lower()] = (nonce, time.time() + CHALLENGE_TTL_S)
        return nonce

    def login(self, address: str, signature_b64: str) -> str | None:
        with self._lock:
            entry = self._challenges.pop(address.lower(), None)  # single use, even on failure
        if entry is None or entry[1] < time.time():
            return None
        key = self.pq_key_of(address)
        if key is None:
            return None
        try:
            sig = base64.b64decode(signature_b64, validate=True)
        except ValueError:
            return None
        if not pqc_verify(key, challenge_message(address, entry[0]), sig):
            return None
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._tokens[token] = Session(address.lower(), time.time() + TOKEN_TTL_S)
        return token

    def who(self, token: str) -> str | None:
        with self._lock:
            s = self._tokens.get(token)
            if s is None or s.expires < time.time():
                self._tokens.pop(token, None)
                return None
            return s.address
