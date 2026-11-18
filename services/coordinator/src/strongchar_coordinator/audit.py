"""Scan everything the coordinator stored for plaintext: it must hold only QoreSeal ciphertext and metadata."""

from __future__ import annotations

import sys
from pathlib import Path

# Bytes every plaintext shard file or raw CSV starts with. Job specs (public metadata such as the dataset hash and
# row ranges, needed to check the on-chain specHash) are expected and are not data.
MARKERS = [b"strongchar-shard/1", b"age,bmi,"]


def scan(root: Path, extra: list[bytes] = ()) -> list[tuple[str, bytes]]:
    hits = []
    for path in root.rglob("*"):
        if path.is_file():
            data = path.read_bytes()
            hits += [(str(path), m) for m in (*MARKERS, *extra) if m in data]
    return hits


def main() -> None:
    root = Path(sys.argv[1])
    hits = scan(root)
    files = sum(1 for p in root.rglob("*") if p.is_file())
    if hits:
        for p, m in hits:
            print(f"PLAINTEXT {m!r} in {p}")
        sys.exit(1)
    print(f"ciphertext-only: {files} files under {root} contain no plaintext markers")


if __name__ == "__main__":
    main()
