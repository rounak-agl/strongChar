"""Spike S2: find the message encoding diana's pqcVerify precompile accepts, using free eth_call."""

from __future__ import annotations

import json
import urllib.request

from eth_abi import encode
from eth_utils import keccak
from qorsdk.pqc import generate_pqc_keypair, pqc_sign, pqc_verify

EVM_RPC = "https://evm-testnet.qore.host"
PQC_VERIFY = "0x0000000000000000000000000000000000000a01"
SELECTOR = keccak(text="pqcVerify(bytes,bytes,bytes)")[:4]


def eth_call(data: bytes) -> dict:
    body = {"jsonrpc": "2.0", "id": 1, "method": "eth_call",
            "params": [{"to": PQC_VERIFY, "data": "0x" + data.hex(), "gas": hex(5_000_000)}, "latest"]}
    req = urllib.request.Request(EVM_RPC, json.dumps(body).encode(), {"content-type": "application/json", "user-agent": "strongchar/0.1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def precompile_says(pub: bytes, sig: bytes, msg: bytes) -> str:
    res = eth_call(SELECTOR + encode(["bytes", "bytes", "bytes"], [pub, sig, msg]))
    if "error" in res:
        return f"error: {res['error'].get('message')}"
    out = res["result"]
    if out in ("0x", ""):
        return "empty (inactive?)"
    return "true" if int(out, 16) == 1 else "false"


def estimate_gas(pub: bytes, sig: bytes, msg: bytes) -> int | str:
    data = SELECTOR + encode(["bytes", "bytes", "bytes"], [pub, sig, msg])
    body = {"jsonrpc": "2.0", "id": 1, "method": "eth_estimateGas",
            "params": [{"to": PQC_VERIFY, "data": "0x" + data.hex()}]}
    req = urllib.request.Request(EVM_RPC, json.dumps(body).encode(), {"content-type": "application/json", "user-agent": "strongchar/0.1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.load(r)
    return int(res["result"], 16) if "result" in res else res.get("error", {}).get("message", "?")


def main() -> None:
    kp = generate_pqc_keypair()
    payload = encode(["string", "uint256", "bytes32"], ["strongChar", 9800, keccak(b"payload")])
    digest = keccak(payload)

    cases = {
        "raw message, signed raw": (payload, pqc_sign(kp.secret_key, payload)),
        "digest message, signed digest": (digest, pqc_sign(kp.secret_key, digest)),
        "raw message, signed digest": (payload, pqc_sign(kp.secret_key, digest)),
        "digest message, signed raw": (digest, pqc_sign(kp.secret_key, payload)),
    }
    for name, (msg, sig) in cases.items():
        local = pqc_verify(kp.public_key, msg, sig)
        print(f"{name:32} local={local!s:5} chain={precompile_says(kp.public_key, sig, msg)}")

    sig = bytearray(pqc_sign(kp.secret_key, payload))
    sig[10] ^= 1
    print(f"{'tampered signature':32} chain={precompile_says(kp.public_key, bytes(sig), payload)}")
    good = pqc_sign(kp.secret_key, payload)
    print(f"{'extra trailing byte':32} chain={precompile_says(kp.public_key, good + b'\\x00', payload)}")
    print(f"gas for one verify (eth_estimateGas, {len(payload)}-byte message): {estimate_gas(kp.public_key, good, payload)}")


if __name__ == "__main__":
    main()
