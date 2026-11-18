"""Shared encodings: domain, commitments, seeds, the epoch shuffle, batches and the post-quantum signed messages.

vectors/encodings.json pins every value; the contracts compute the on-chain ones identically.
"""

from __future__ import annotations

from collections.abc import Sequence
from enum import IntEnum
from functools import lru_cache

from eth_abi import encode

from .hashing import k256

# Every PQ-signed message starts with this tag, so a strongChar signature can't be replayed as anything else.
PQ_DOMAIN_TAG = k256(b"strongChar/pq/v1")


class Outcome(IntEnum):
    ACCEPTED = 0
    REVERTED = 1


class PQKind(IntEnum):
    SETTLEMENT = 1  # a round's verdicts, merge result and payouts, signed by both verifiers
    VALIDITY = 2  # one competition entry ran cleanly in the sandbox
    SCORES = 3  # a competition's final score table


def domain(chain_id: int, market: str) -> bytes:
    """Binds seeds and commitments to one deployment, so nothing carries over between chains or contracts."""
    return k256(encode(["uint256", "address"], [chain_id, market]))


def checkpoint_root(hashes: Sequence[bytes]) -> bytes:
    return k256(b"".join(hashes))


def commit_hash(dom: bytes, job: int, rnd: int, node: str, root: bytes, salt: bytes) -> bytes:
    """The node's address is inside the hash, so one node can't post another node's commitment as its own."""
    return k256(encode(["bytes32", "uint256", "uint256", "address", "bytes32", "bytes32"],
                       [dom, job, rnd, node, root, salt]))


def task_seed(dom: bytes, job: int, rnd: int, shard: int, start_weights_hash: bytes) -> bytes:
    return k256(encode(["bytes32", "uint256", "uint256", "uint256", "bytes32"],
                       [dom, job, rnd, shard, start_weights_hash]))


def round_seed(blockhash: bytes, dom: bytes, job: int, rnd: int) -> bytes:
    """blockhash of the first block after the commit deadline; prevrandao is always 0 on this chain."""
    return k256(encode(["bytes32", "bytes32", "uint256", "uint256"], [blockhash, dom, job, rnd]))


def epoch_seed(dom: bytes, job: int, shard: int, epoch: int) -> bytes:
    return k256(encode(["bytes32", "uint256", "uint256", "uint256"], [dom, job, shard, epoch]))


@lru_cache(maxsize=64)
def permutation(seed: bytes, n: int) -> tuple[int, ...]:
    """Fisher-Yates from the top: swap i with j = keccak(seed ‖ uint256(i)) mod (i + 1)."""
    p = list(range(n))
    for i in range(n - 1, 0, -1):
        j = int.from_bytes(k256(seed + i.to_bytes(32, "big")), "big") % (i + 1)
        p[i], p[j] = p[j], p[i]
    return tuple(p)


def shard_rows(start: int, length: int) -> range:
    return range(start, start + length)


def cursor(rounds_done: int, steps: int, batch_size: int) -> int:
    """Samples already trained on a shard; rounds_done counts only accepted rounds that trained it."""
    return rounds_done * steps * batch_size


def batch(dom: bytes, job: int, shard: int, rows: Sequence[int], rounds_done: int, steps: int,
          batch_size: int, step: int) -> list[int]:
    """Rows of one step. An epoch is one pass over the shard without replacement; batches run across epochs."""
    n = len(rows)
    first = cursor(rounds_done, steps, batch_size) + step * batch_size
    return [rows[permutation(epoch_seed(dom, job, shard, i // n), n)[i % n]] for i in range(first, first + batch_size)]


def shard_table_hash(shards: Sequence[tuple[int, int]]) -> bytes:
    """keccak(abi.encode((uint256 start, uint256 len)[]))."""
    return k256(encode(["(uint256,uint256)[]"], [list(shards)]))


def payouts_hash(payouts: Sequence[tuple[str, int]]) -> bytes:
    return k256(encode(["(address,uint256)[]"], [list(payouts)]))


def settlement_payload(job: int, rnd: int, outcome: int, aggregate_hash: bytes, slashed_bitmap: int,
                       agg_evidence_hash: bytes, pay_evidence_hash: bytes, payouts: Sequence[tuple[str, int]]) -> bytes:
    return k256(encode(["uint256", "uint256", "uint8", "bytes32", "uint32", "bytes32", "bytes32", "bytes32"],
                       [job, rnd, outcome, aggregate_hash, slashed_bitmap, agg_evidence_hash, pay_evidence_hash,
                        payouts_hash(payouts)]))


def pq_message(chain_id: int, contract: str, kind: PQKind, payload_hash: bytes, expiry_block: int) -> bytes:
    """The exact bytes a verifier signs with ML-DSA-87 and the contract passes to pqcVerify (no hashing, spike S2)."""
    return encode(["bytes32", "uint256", "address", "uint8", "bytes32", "uint64"],
                  [PQ_DOMAIN_TAG, chain_id, contract, int(kind), payload_hash, expiry_block])


def validity_payload(competition: int, entry: int, ok: bool, pred_hash: bytes) -> bytes:
    return k256(encode(["uint256", "uint256", "bool", "bytes32"], [competition, entry, ok, pred_hash]))


def scores_payload(competition: int, entries: Sequence[int], scores_e6: Sequence[int]) -> bytes:
    return k256(encode(["uint256", "uint256[]", "int256[]"], [competition, list(entries), list(scores_e6)]))


def label_commit(labels: bytes, salt: bytes) -> bytes:
    """What a host commits to before anyone submits: keccak(abi.encode(keccak(labels), salt))."""
    return k256(encode(["bytes32", "bytes32"], [k256(labels), salt]))
