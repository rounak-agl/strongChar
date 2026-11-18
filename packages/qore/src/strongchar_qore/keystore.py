"""Local key store: one mnemonic per strongChar actor, kept outside the repo."""

from __future__ import annotations

import json
import os
import stat
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path

from qoreseal import SealKeyPair, derive_seal_keys
from qorsdk import generate_mnemonic
from qorsdk.unified import UnifiedAccount, derive_unified_account

ACTORS: tuple[str, ...] = (
    "deployer",
    "coordinator",
    "verifier-a",
    "verifier-b",
    "node-1",
    "node-2",
    "node-3",
    "node-4",
    "data-owner",
    "host",
    "entrant",
)

DEFAULT_PATH = Path(os.environ.get("STRONGCHAR_KEYSTORE", Path.home() / ".config/strongchar/accounts.json"))


@dataclass(frozen=True)
class Actor:
    name: str
    # UnifiedAccount's own repr prints the private key, so never let it reach a log.
    account: UnifiedAccount = field(repr=False)
    # Kept so seal keys can be derived; repr=False keeps it out of logs and tracebacks.
    _mnemonic: str = field(repr=False, default="")

    @cached_property
    def seal(self) -> SealKeyPair:
        """ML-KEM-1024 + X25519 seal keys, derived from the same mnemonic (index 0)."""
        return derive_seal_keys(self._mnemonic)

    def __repr__(self) -> str:
        return f"Actor({self.name}, {self.qor}, {self.evm})"

    @property
    def qor(self) -> str:
        return self.account.cosmos

    @property
    def evm(self) -> str:
        return self.account.evm


def _check_private(path: Path) -> None:
    # Refuse a key file anyone but the owner can read, so a loose chmod can't go unnoticed.
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        raise PermissionError(f"{path} must be mode 600, is {oct(mode)}")


def create(path: Path = DEFAULT_PATH, actors: tuple[str, ...] = ACTORS) -> None:
    """Write a fresh mnemonic for every actor. Never overwrites an existing store."""
    if path.exists():
        raise FileExistsError(f"{path} already exists; refusing to overwrite keys")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    data = {"version": 1, "derivation": "unified-eth-60", "actors": {a: generate_mnemonic(256) for a in actors}}
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)


def load(name: str, path: Path = DEFAULT_PATH) -> Actor:
    """Load one actor. Mnemonics stay inside this process and are never printed."""
    _check_private(path)
    mnemonics = json.loads(path.read_text())["actors"]
    if name not in mnemonics:
        raise KeyError(f"unknown actor {name!r}")
    return Actor(name, derive_unified_account(mnemonics[name]), mnemonics[name])


def load_all(path: Path = DEFAULT_PATH) -> list[Actor]:
    _check_private(path)
    mnemonics = json.loads(path.read_text())["actors"]
    return [Actor(n, derive_unified_account(m), m) for n, m in mnemonics.items()]
