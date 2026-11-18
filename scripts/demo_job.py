"""End-to-end sealed training job on diana, acting as the data owner. Spends a little testnet QOR and fUSD.

Prerequisites: coordinator, 4 nodes and 2 verifiers running (scripts/run_local.sh) and nodes staked
(scripts/setup_nodes.py). Prints every transaction so the run can be checked on the explorer.
"""

from __future__ import annotations

import argparse
import time

from eth_utils import keccak
from strongchar_core import encodings as enc
from strongchar_core.blob import from_blob
from strongchar_datasets import presets
from strongchar_datasets.canonical import from_csv, split, standardise
from strongchar_datasets.shards import cut
from strongchar_qore import keystore, seal
from strongchar_qore.market import Contracts, WindowManager
from strongchar_qore.seal import Kind, make_card
from strongchar_runtime import chainview as cv
from strongchar_runtime.client import Coordinator
from strongchar_runtime.funding import ensure_fusd
from strongchar_runtime.recipients import recipient
from strongchar_runtime.spec import make_spec
from strongchar_runtime.work import global_aad, kem_keys

NODES = ["node-1", "node-2", "node-3", "node-4"]
STAKE = 100 * 10**6


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--coordinator", default="http://127.0.0.1:8700")
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--budget", type=int, default=20_000, help="fUSD base units (6 decimals)")
    ap.add_argument("--rows", type=int, default=8_000)
    a = ap.parse_args()

    c = Contracts()
    owner_actor = keystore.load("data-owner")
    owner = owner_actor.account
    coord = Coordinator(a.coordinator, owner)
    coord.put_card(make_card(owner_actor.qor, owner_actor.seal, owner.private_key, owner.pqc.secret_key))
    contract = c.dep.job_market
    verifiers = [c.dep.verifier_a, c.dep.verifier_b]
    nodes = [keystore.load(n).evm for n in NODES]

    raw = from_csv(presets.health_csv(a.rows))
    sp = split(raw.card.rows, len(nodes), "0.1", "0.1")
    data = standardise(raw, sp.train)
    pieces = cut(data, sp)
    spec = make_spec(dataset_hash=data.card.hash, d_in=data.card.x_shape[0], n_out=data.card.classes, task=data.card.task,
                     shards=list(sp.shards), val=sp.val, rounds=a.rounds)
    job_id = c.market.functions.jobCount().call() + 1  # bound into every AAD; checked again after createJob

    shard_ids, shard_hashes = [], []
    for i, blob in enumerate(pieces["train"]):
        who = [nodes[i], *verifiers]
        recips, keys = zip(*(recipient(c.chain, coord, w) for w in who))
        aad = seal.aad(contract, job_id, 0, i, Kind.SHARD, list(keys))
        shard_ids.append(coord.put_blob(seal.seal(list(recips), blob, Kind.SHARD, aad), "shard"))
        shard_hashes.append("0x" + keccak(blob).hex())
    recips, keys = zip(*(recipient(c.chain, coord, w) for w in verifiers))
    val_blob = pieces["val"][0]
    val_id = coord.put_blob(seal.seal(list(recips), val_blob, Kind.VAL, seal.aad(contract, job_id, 0, 0, Kind.VAL, list(keys))), "val")
    manifest = {"shards": shard_ids, "shardHashes": shard_hashes, "val": val_id, "valHash": "0x" + keccak(val_blob).hex(),
                "assignment": nodes}
    sh = coord.put_draft(spec.raw, manifest)
    assert sh == "0x" + spec.hash.hex(), "coordinator computed a different spec hash"
    print(f"sealed {len(shard_ids)} shards (each to its node + both verifiers) and the validation split; spec {sh[:18]}…")

    ensure_fusd(c, owner, a.budget)
    w = WindowManager(c.chain, owner, (c.dep.fusd, contract))
    c.send(owner, c.fusd.functions.approve(contract, a.budget), w)
    params = (spec.hash, spec.initial_weights_hash(), enc.shard_table_hash(spec.shards),
              keccak(b"".join(bytes.fromhex(h[2:]) for h in [*shard_hashes, manifest["valHash"]])),
              a.budget, STAKE, a.rounds, 3, len(nodes), (240, 180, 1200))
    r = c.send(owner, c.market.functions.createJob(params), w)
    created = c.market.functions.jobCount().call()
    assert created == job_id, f"another job took id {job_id}; rerun"
    print(f"job {job_id} created and funded with {a.budget / 1e6} fUSD: {r.txhash}")
    c.chain.close_window(owner)

    seen = set()
    while True:
        params_, js = c.job(job_id)
        for rnd in range(1, js[2] + 1):
            rv, roster = c.round(job_id, rnd)
            key = (rnd, rv[0])
            if key not in seen:
                seen.add(key)
                print(f"round {rnd}: status {['-', 'Open', 'Settled', 'Reverted', 'Void', 'Expired'][rv[0]]}, "
                      f"revealed {rv[1]}, slashed bitmap {rv[10]:#06b}")
        if js[1] != cv.JOB_ACTIVE:
            break
        time.sleep(10)

    sigs = coord.signatures(job_id, a.rounds)
    model_blob = next(s["settlement"]["modelBlob"] for s in sigs if s["settlement"].get("modelBlob"))
    keys = kem_keys(c.chain, [owner.evm])
    blob = seal.open_(coord.get_blob(model_blob), owner_actor.seal, Kind.MODEL, global_aad(contract, job_id, a.rounds, keys, True))
    wl = spec.workload()
    final = from_blob(spec.hash, blob, wl.n_params())
    ha, hn = sp.holdout
    xh, yh = data.x[ha:ha + hn], data.y[ha:ha + hn]
    print(f"holdout accuracy: initial {wl.evaluate(spec.initial_weights(), xh, yh)[1]:.3f} -> "
          f"final {wl.evaluate(final, xh, yh)[1]:.3f} (model opened locally by the owner only)")
    for n in NODES:
        acct = keystore.load(n)
        print(f"{n}: claimable {c.market.functions.claimable(acct.evm).call() / 1e6} fUSD, "
              f"stake {c.registry.functions.getNode(acct.evm).call()[1] / 1e6} BERU")


if __name__ == "__main__":
    main()
