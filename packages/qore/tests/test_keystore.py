"""Key store: unique keys per actor, no overwrite, owner-only permissions, unified addresses."""

from __future__ import annotations

import os

import pytest
from qorsdk import bech32_to_hex

from strongchar_qore import keystore


def test_create_and_load(tmp_path):
    path = tmp_path / "accounts.json"
    keystore.create(path, actors=("a", "b"))
    assert oct(os.stat(path).st_mode & 0o777) == "0o600"
    a, b = keystore.load("a", path), keystore.load("b", path)
    assert a.qor != b.qor
    # One account, two encodings: the qor1 and 0x forms carry the same 20 bytes.
    assert bech32_to_hex(a.qor).lower() == a.evm.lower()
    assert len(a.account.pqc.public_key) == 2592


def test_refuses_overwrite(tmp_path):
    path = tmp_path / "accounts.json"
    keystore.create(path, actors=("a",))
    with pytest.raises(FileExistsError):
        keystore.create(path, actors=("a",))


def test_refuses_loose_permissions(tmp_path):
    path = tmp_path / "accounts.json"
    keystore.create(path, actors=("a",))
    os.chmod(path, 0o644)
    with pytest.raises(PermissionError):
        keystore.load("a", path)


def test_unknown_actor(tmp_path):
    path = tmp_path / "accounts.json"
    keystore.create(path, actors=("a",))
    with pytest.raises(KeyError):
        keystore.load("nobody", path)


def test_repr_never_shows_secrets(tmp_path):
    path = tmp_path / "accounts.json"
    keystore.create(path, actors=("a",))
    actor = keystore.load("a", path)
    text = repr(actor) + str(actor)
    assert actor.account.private_key.hex() not in text
    assert actor._mnemonic.split()[0] not in text.split()
    assert actor.qor in text
