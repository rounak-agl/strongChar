"""Shared steps for one round: open sealed inputs, find the start weights, train or replay a shard.

Nodes call these to train and verifiers call the same functions to replay, so the two can never disagree by
having different code.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from qorsdk import hex_to_bech32
from qorsdk.kem import parse_kem_key
from strongchar_core.blob import from_blob, to_blob, weights_hash
from strongchar_datasets.shards import Rows, parse
from strongchar_qore import seal
from strongchar_qore.chain import Chain
from strongchar_qore.seal import Kind
from strongchar_workloads.runner import run_round, sampler

from .client import Coordinator
from .spec import JobSpec

ROUND_SETTLED = 2


def kem_keys(chain: Chain, addresses: Sequence[str]) -> list[bytes]:
    out = []
    for a in addresses:
        res = parse_kem_key(chain.get(f"/qorechain/pqc/v1/kem/{hex_to_bech32(a)}"))
        if not res.found or res.key is None:
            raise ValueError(f"{a} has no registered ML-KEM key")
        out.append(res.key.public_key)
    return out


def shard_recipients(draft: dict, shard: int, verifiers: Sequence[str]) -> list[str]:
    return [draft["manifest"]["assignment"][shard], *verifiers]


def open_shard(chain: Chain, coord: Coordinator, keys, contract: str, job: int, draft: dict, shard: int,
               verifiers: Sequence[str]) -> tuple[int, np.ndarray, np.ndarray]:
    """(start row, x, y) of one shard, after checking its bytes against the hash the owner committed to."""
    text = coord.get_blob(draft["manifest"]["shards"][shard])
    aad = seal.aad(contract, job, 0, shard, Kind.SHARD, kem_keys(chain, shard_recipients(draft, shard, verifiers)))
    data = seal.open_(text, keys, Kind.SHARD, aad)
    expected = bytes.fromhex(draft["manifest"]["shardHashes"][shard][2:])
    return parse(data, expected)


def open_val(chain: Chain, coord: Coordinator, keys, contract: str, job: int, draft: dict,
             verifiers: Sequence[str]) -> tuple[np.ndarray, np.ndarray]:
    text = coord.get_blob(draft["manifest"]["val"])
    aad = seal.aad(contract, job, 0, 0, Kind.VAL, kem_keys(chain, verifiers))
    data = seal.open_(text, keys, Kind.VAL, aad)
    _, x, y = parse(data, bytes.fromhex(draft["manifest"]["valHash"][2:]))
    return x, y


def global_aad(contract: str, job: int, rnd: int, recipients_kem: Sequence[bytes], final: bool) -> bytes:
    return seal.aad(contract, job, rnd, 0, Kind.MODEL if final else Kind.GLOBAL, recipients_kem)


def start_weights(spec: JobSpec, job_weights_hash: bytes, chain: Chain, coord: Coordinator, keys, contract: str,
                  job: int, settled_rounds: Sequence[int]) -> np.ndarray:
    """The weights whose hash the job currently holds: the seeded initial weights, or the merged weights a
    verifier sealed after the latest accepted round."""
    w0 = spec.initial_weights()
    if weights_hash(spec.hash, w0) == job_weights_hash:
        return w0
    for rnd in sorted(settled_rounds, reverse=True):
        for s in coord.signatures(job, rnd):
            blob = s["settlement"].get("globalBlob")
            recips = s["settlement"].get("globalRecipients")
            if not blob or not recips:
                continue
            try:
                data = seal.open_(coord.get_blob(blob), keys, Kind.GLOBAL,
                                  global_aad(contract, job, rnd, kem_keys(chain, recips), False))
            except Exception:
                continue
            w = from_blob(spec.hash, data, spec.workload().n_params())
            if weights_hash(spec.hash, w) == job_weights_hash:
                return w
    raise LookupError("no sealed global weights match the job's current weights hash")


def train(spec: JobSpec, dom: bytes, job: int, shard: int, start_row: int, x: np.ndarray, y: np.ndarray,
          start: np.ndarray, rounds_done: int) -> tuple[np.ndarray, list[bytes]]:
    r = spec.raw
    rows = sampler(dom, job, shard, start_row, len(x), rounds_done, r["steps"], r["batch_size"])
    return run_round(spec.workload(), start, Rows(x, start_row), Rows(y, start_row), rows,
                     r["steps"], r["checkpoints"], spec.hash)


def weights_blob(spec: JobSpec, w: np.ndarray) -> bytes:
    return to_blob(spec.hash, w)
