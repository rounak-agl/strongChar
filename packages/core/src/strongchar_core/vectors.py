"""Builds vectors/encodings.json, the cross-language fixtures the Solidity tests check. Rewrite with `python -m strongchar_core.vectors`."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from . import encodings as enc
from .blob import weights_hash
from .hashing import k256

PATH = Path(__file__).resolve().parents[4] / "vectors" / "encodings.json"


def h(label: str) -> bytes:
    return k256(label.encode())


def hx(b: bytes) -> str:
    return "0x" + b.hex()


def addr(label: str) -> str:
    # Deterministic dummy addresses from public labels; they guard nothing.
    return "0x" + k256(b"strongchar-vector/" + label.encode())[12:].hex()


def build() -> dict:
    market = addr("jobMarket")
    dom = enc.domain(9800, market)
    roots = [h(f"ckpt{i}") for i in range(3)]
    payouts = sorted([(addr("node1"), 1_500_001), (addr("node2"), 1_499_999)], key=lambda p: int(p[0], 16))
    sh = k256(b"strongchar-test")
    w = np.random.default_rng(0).standard_normal(16).astype(np.float32)
    out: dict = {"version": 1, "chainId": 9800, "jobMarket": market, "domain": hx(dom)}
    out["commitHash"] = [{"jobId": j, "roundId": r, "node": n, "root": hx(rt), "salt": hx(s),
                          "hash": hx(enc.commit_hash(dom, j, r, n, rt, s))}
                         for j, r, n, rt, s in [(7, 3, addr("node1"), enc.checkpoint_root(roots), h("salt")),
                                                (0, 0, "0x" + "00" * 20, b"\0" * 32, b"\0" * 32)]]
    out["roundSeed"] = [{"blockhash": hx(h("block")), "jobId": 7, "roundId": 3,
                         "seed": hx(enc.round_seed(h("block"), dom, 7, 3))}]
    out["permutation"] = [{"seed": hx(enc.epoch_seed(dom, 7, 0, 0)), "n": n,
                           "perm": list(enc.permutation(enc.epoch_seed(dom, 7, 0, 0), n))} for n in (1, 2, 10)]
    out["batch"] = [{"jobId": 7, "shard": 0, "start": 100, "len": 10, "steps": 3, "batchSize": 4, "roundsDone": d,
                     "batches": [enc.batch(dom, 7, 0, enc.shard_rows(100, 10), d, 3, 4, s) for s in range(3)]}
                    for d in (0, 1)]
    out["shardTableHash"] = [{"shards": [[0, 6000], [6000, 6000]],
                              "hash": hx(enc.shard_table_hash([(0, 6000), (6000, 6000)]))}]
    out["payoutsHash"] = [{"payouts": [[a, v] for a, v in p], "hash": hx(enc.payouts_hash(p))} for p in (payouts, [])]
    payload = enc.settlement_payload(7, 3, 0, h("agg"), 0b1000, h("aggEv"), h("payEv"), payouts)
    out["settlement"] = {"jobId": 7, "roundId": 3, "outcome": 0, "aggregateHash": hx(h("agg")), "slashedBitmap": 8,
                         "aggEvidenceHash": hx(h("aggEv")), "payEvidenceHash": hx(h("payEv")),
                         "payouts": [[a, v] for a, v in payouts], "payloadHash": hx(payload)}
    out["pqMessage"] = {"domainTag": hx(enc.PQ_DOMAIN_TAG), "kind": int(enc.PQKind.SETTLEMENT),
                        "payloadHash": hx(payload), "expiryBlock": 12_345_678,
                        "message": hx(enc.pq_message(9800, market, enc.PQKind.SETTLEMENT, payload, 12_345_678))}
    out["weights"] = {"specHash": hx(sh), "weights": w.astype("<f4").tobytes().hex(), "hash": hx(weights_hash(sh, w))}
    return out


def dump(v: dict) -> str:
    return json.dumps(v, indent=1) + "\n"


if __name__ == "__main__":
    PATH.write_text(dump(build()))
    sys.stdout.write(f"wrote {PATH}\n")
