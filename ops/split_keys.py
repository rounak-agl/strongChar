"""Write one key file per service actor into docker/secrets/, so each container only ever sees its own mnemonic.

Files are mode 600 and owned by the container user (uid 10002) when run as root on a server; run locally, they stay
owned by you, and the copy step to the server must keep mode 600 and chown them there. Nothing is printed but names.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from strongchar_qore import keystore

ROOT = Path(__file__).resolve().parents[1]
SERVICE_UID = 10002
ROLES = {
    "edge": ("coordinator",),
    "nodes": ("node-1", "node-2", "node-3", "node-4"),
    "verifiers": ("verifier-a", "verifier-b"),
}


def write_one(name: str, mnemonic: str, out: Path) -> Path:
    path = out / f"{name}.json"
    path.unlink(missing_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"version": 1, "derivation": "unified-eth-60", "actors": {name: mnemonic}}, f)
    if os.geteuid() == 0:
        os.chown(path, SERVICE_UID, SERVICE_UID)
    return path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("role", choices=sorted(ROLES))
    ap.add_argument("--store", type=Path, default=keystore.DEFAULT_PATH)
    ap.add_argument("--out", type=Path, default=ROOT / "docker/secrets")
    a = ap.parse_args()
    keystore._check_private(a.store)
    actors = json.loads(a.store.read_text())["actors"]
    a.out.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in ROLES[a.role]:
        print(write_one(name, actors[name], a.out).name)


if __name__ == "__main__":
    main()
