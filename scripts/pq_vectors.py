"""Writes vectors/pq_signatures.json: the vector settlement message signed by the real verifier keys on diana."""

import json
from pathlib import Path

from strongchar_core import vectors
from strongchar_core.encodings import PQKind

from strongchar_qore import keystore, pq

OUT = Path(__file__).resolve().parents[1] / "vectors" / "pq_signatures.json"


def main() -> None:
    v = vectors.build()
    payload = bytes.fromhex(v["pqMessage"]["payloadHash"][2:])
    out = {"message": None, "signers": []}
    for name in ("verifier-a", "verifier-b"):
        actor = keystore.load(name)
        msg, sig = pq.sign_message(actor.account, 9800, v["jobMarket"], PQKind.SETTLEMENT, payload,
                                   v["pqMessage"]["expiryBlock"])
        assert pq.verify(actor.account.pqc.public_key, msg, sig)
        out["message"] = "0x" + msg.hex()
        out["signers"].append({"name": name, "address": actor.evm, "signature": "0x" + sig.hex()})
    assert out["message"] == v["pqMessage"]["message"]
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
