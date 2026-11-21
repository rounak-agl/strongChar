"""The data owner's side of a job: price it, seal the data to the verifiers, fund it, watch it, open the model.

Prices follow the compute: a job costs `price` fUSD per Gop (10^9 float ops) of training, for every seated node
and round, and each seat must stake at least the contract's floor (twice one node's share of a round).
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
from eth_utils import keccak
from strongchar_core import encodings as enc
from strongchar_core.blob import from_blob
from strongchar_datasets.canonical import Canonical, Split, from_csv, split, standardise
from strongchar_datasets.shards import cut
from strongchar_qore import seal
from strongchar_qore.market import Contracts, WindowManager
from strongchar_qore.seal import Kind, make_card
from strongchar_workloads.compute import job_budget, round_ops

from . import chainview as cv
from .client import Coordinator
from .funding import ensure_fusd
from .recipients import recipient
from .spec import JobSpec, make_spec
from .work import global_aad, kem_keys

WINDOWS = (240, 180, 1200)  # commit, reveal and finalize windows in seconds
STATUS = ["-", "Open", "Settled", "Reverted", "Void", "Expired"]


@dataclass
class Plan:
    data: Canonical
    split: Split
    spec: JobSpec
    ops_per_round: int
    budget: int  # fUSD base units
    ref_work: int  # verified-work seconds credited per paid round
    quorum: int
    max_nodes: int


def plan(csv_text: str, *, rounds: int, shards: int, quorum: int, hidden: int = 16, steps: int = 40,
         batch_size: int = 32, lr: str = "0.1", price_units_per_gop: int = 10**6, task: str | None = None) -> Plan:
    """Canonicalise the CSV (last column is the target), split it and price the job. Nothing leaves the machine."""
    if not 1 <= quorum <= shards:
        raise ValueError("quorum must be between 1 and the number of shards")
    raw = from_csv(csv_text, task)
    sp = split(raw.card.rows, shards, "0.1", "0.1")
    data = standardise(raw, sp.train)
    n_out = data.card.classes or 1  # regression predicts one value
    spec = make_spec(dataset_hash=data.card.hash, d_in=data.card.x_shape[0], n_out=n_out,
                     task=data.card.task, shards=list(sp.shards), val=sp.val, rounds=rounds, hidden=hidden,
                     steps=steps, batch_size=batch_size, lr=lr)
    loss = "ce" if data.card.task == "classification" else "mse"
    ops = round_ops(steps, batch_size, data.card.x_shape[0], hidden, n_out, loss)
    budget = max(job_budget(ops, rounds, shards, price_units_per_gop), rounds * shards)
    return Plan(data, sp, spec, ops, budget, -(-ops // 10**9), quorum, shards)


def post(c: Contracts, owner_actor, coord: Coordinator, p: Plan, log=print) -> int:
    """Seal every shard and the validation split to the two verifiers, store the draft, fund and create the job."""
    owner = owner_actor.account
    coord.put_card(make_card(owner_actor.qor, owner_actor.seal, owner.private_key, owner.pqc.secret_key))
    contract = c.dep.job_market
    verifiers = [c.dep.verifier_a, c.dep.verifier_b]
    job_id = c.market.functions.jobCount().call() + 1  # bound into every AAD; checked again after createJob
    pieces = cut(p.data, p.split)
    recips, keys = zip(*(recipient(c.chain, coord, v) for v in verifiers))
    shard_ids, shard_hashes = [], []
    for i, blob in enumerate(pieces["train"]):
        aad = seal.aad(contract, job_id, 0, i, Kind.SHARD, list(keys))
        shard_ids.append(coord.put_blob(seal.seal(list(recips), blob, Kind.SHARD, aad), "shard"))
        shard_hashes.append("0x" + keccak(blob).hex())
    val_blob = pieces["val"][0]
    val_id = coord.put_blob(seal.seal(list(recips), val_blob, Kind.VAL,
                                      seal.aad(contract, job_id, 0, 0, Kind.VAL, list(keys))), "val")
    manifest = {"shards": shard_ids, "shardHashes": shard_hashes, "val": val_id,
                "valHash": "0x" + keccak(val_blob).hex()}
    sh = coord.put_draft(p.spec.raw, manifest)
    if sh != "0x" + p.spec.hash.hex():
        raise RuntimeError("coordinator computed a different spec hash")
    log(f"sealed {len(shard_ids)} shards and the validation split to both verifiers; spec {sh[:18]}…")

    rounds = p.spec.raw["rounds"]
    stake = c.market.functions.minStake(p.budget, rounds, p.quorum).call()
    ensure_fusd(c, owner, p.budget)
    w = WindowManager(c.chain, owner, (c.dep.fusd, contract))
    c.send(owner, c.fusd.functions.approve(contract, p.budget), w)
    params = (p.spec.hash, p.spec.initial_weights_hash(), enc.shard_table_hash(p.spec.shards),
              keccak(b"".join(bytes.fromhex(h[2:]) for h in [*shard_hashes, manifest["valHash"]])),
              p.budget, stake, rounds, p.quorum, p.max_nodes, WINDOWS, p.ref_work)
    r = c.send(owner, c.market.functions.createJob(params), w)
    c.chain.close_window(owner)
    if c.market.functions.jobCount().call() != job_id:
        raise RuntimeError(f"another job took id {job_id}; post again")
    log(f"job {job_id} created: {p.budget / 1e6} fUSD, {stake / 1e6:g} BERU stake per seat: {r.txhash}")
    return job_id


def watch(c: Contracts, job_id: int, names: dict[str, str] | None = None, log=print, poll_s: float = 10) -> None:
    """Print each round's state change until the job closes."""
    names, seen = names or {}, set()
    while True:
        _, js = c.job(job_id)
        for rnd in range(1, js[2] + 1):
            rv, roster = c.round(job_id, rnd)
            if (rnd, rv[0]) not in seen:
                seen.add((rnd, rv[0]))
                who = [names.get(n.lower(), n[:10]) for n in roster]
                log(f"round {rnd}: {STATUS[rv[0]]}, seated {who}, revealed {rv[1]}, slashed bitmap {rv[10]:#06b}")
        if js[1] != cv.JOB_ACTIVE:
            return
        time.sleep(poll_s)


def open_model(c: Contracts, owner_actor, coord: Coordinator, job_id: int, spec: JobSpec) -> np.ndarray:
    """The final weights, sealed to the owner alone by the verifiers after the last round."""
    rounds = spec.raw["rounds"]
    sigs = coord.signatures(job_id, rounds)
    blob_id = next((s["settlement"]["modelBlob"] for s in sigs if s["settlement"].get("modelBlob")), None)
    if blob_id is None:
        raise LookupError(f"job {job_id} has no final model yet")
    keys = kem_keys(c.chain, [owner_actor.evm])
    blob = seal.open_(coord.get_blob(blob_id), owner_actor.seal, Kind.MODEL,
                      global_aad(c.dep.job_market, job_id, rounds, keys, True))
    return from_blob(spec.hash, blob, spec.workload().n_params())


def holdout_accuracy(p: Plan, w: np.ndarray) -> tuple[float, float]:
    """(initial, final) score on the held-out rows, which never left this machine."""
    ha, hn = p.split.holdout
    xh, yh = p.data.x[ha:ha + hn], p.data.y[ha:ha + hn]
    wl = p.spec.workload()
    return wl.evaluate(p.spec.initial_weights(), xh, yh)[1], wl.evaluate(w, xh, yh)[1]
