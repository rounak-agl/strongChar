"""Evidence documents: canonical JSON (sorted keys, no whitespace, no floats) so equal content gives equal bytes."""

from __future__ import annotations

import json
import struct
from typing import Any


def f64hex(x: float) -> str:
    """A float64 as its IEEE-754 bit pattern in 16 big-endian hex digits; JSON floats don't round-trip byte for byte."""
    return struct.pack(">d", x).hex()


def _reject_floats(value: Any) -> None:
    if isinstance(value, float):
        raise TypeError("write floats with f64hex")
    if isinstance(value, dict):
        for child in value.values():
            _reject_floats(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            _reject_floats(child)


def canonical(doc: dict) -> bytes:
    """Readers hash exactly the bytes they receive and never re-serialise."""
    _reject_floats(doc)
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
