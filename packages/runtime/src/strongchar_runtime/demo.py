"""Offline demo: one exact round with three honest nodes and one cheater, and the hashes every machine must get.

    uv run python -m strongchar_runtime.demo            # prints the round; compares against the pinned vector
    uv run python -m strongchar_runtime.demo --write    # re-pin vectors/kernel/demo_round.json

Training is bit-for-bit reproducible, so a verifier doesn't judge whether a result looks plausible: it reruns the
node's work and compares hashes. If your hashes differ from the vector, this machine isn't reproducing the kernel.
Runs on the synthetic health table (no download, no real people) with the same code the nodes and verifiers use.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from strongchar_core import encodings as enc
from strongchar_core.blob import weights_hash
from strongchar_core.finalize import finalize
from strongchar_core.judge import Verdict, judge
from strongchar_datasets import presets

from . import owner, work

ROOT = Path(__file__).resolve().parents[4]
VECTOR = ROOT / "vectors" / "kernel" / "demo_round.json"
CHAIN_ID, MARKET = 9800, "0x" + "00" * 19 + "01"  # fixed stand-ins so the hashes don't depend on a deployment
JOB = 1
NODES = ["0x" + f"{i + 1:040X}" for i in range(4)]
CHEATER = NODES[3]


def run(rows: int = 8_000) -> dict:
    p = owner.plan(presets.health_csv(rows), rounds=1, shards=len(NODES), quorum=3)
    spec, wl = p.spec, p.spec.workload()
    dom = enc.domain(CHAIN_ID, MARKET)
    start = spec.initial_weights()

    def train(i: int):
        lo, n = spec.shards[i]
        return work.train(spec, dom, JOB, i, lo, p.data.x[lo:lo + n], p.data.y[lo:lo + n], start, 0)

    t0 = time.perf_counter()
    claims = {}
    for i, node in enumerate(NODES):
        if node == CHEATER:  # skips training and claims slightly moved start weights, hoping nobody checks
            fake = (start + np.float32(1e-3)).astype(np.float32)
            claims[node] = (fake, [weights_hash(spec.hash, start)] + [weights_hash(spec.hash, fake)] * (spec.raw["checkpoints"]))
        else:
            final, hashes = train(i)
            claims[node] = (final, hashes)
    train_s = time.perf_counter() - t0

    t0 = time.perf_counter()
    revealed, failed, verdicts = {}, {}, {}
    for i, node in enumerate(NODES):  # a verifier replays every node's whole round from the same start and shard
        replayed, _ = train(i)
        claimed = claims[node][1][-1]
        v = judge(spec.hash, replayed, claimed)
        verdicts[node] = v.value
        revealed[node] = (claimed, replayed)
        if v is not Verdict.OK:
            failed[node] = v
    replay_s = time.perf_counter() - t0

    lo, n = spec.raw["val"]
    xv, yv = p.data.x[lo:lo + n], p.data.y[lo:lo + n]
    fin = finalize(JOB, 1, spec.hash, start, [(node, i) for i, node in enumerate(NODES)], revealed, failed,
                   lambda w: wl.evaluate(w, xv, yv)[0], p.budget)
    st = fin.settlement
    return {
        "chainId": CHAIN_ID, "market": MARKET, "job": JOB, "datasetHash": p.data.card.hash,
        "specHash": "0x" + spec.hash.hex(), "startWeightsHash": "0x" + weights_hash(spec.hash, start).hex(),
        "nodes": [{"node": node, "shard": i, "honest": node != CHEATER, "verdict": verdicts[node],
                   "checkpoints": ["0x" + h.hex() for h in claims[node][1]]} for i, node in enumerate(NODES)],
        "settlement": {"outcome": int(st.outcome), "aggregateHash": "0x" + st.aggregate_hash.hex(),
                       "slashedBitmap": st.slashed_bitmap, "payouts": [[a, v] for a, v in st.payouts],
                       "payloadHash": "0x" + st.payload_hash().hex()},
        "valLoss": {"before": round(wl.evaluate(start, xv, yv)[0], 6), "after": round(wl.evaluate(fin.weights, xv, yv)[0], 6)},
        "seconds": {"trainAllNodes": round(train_s, 2), "replayAllNodes": round(replay_s, 2)},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="save this run as the pinned demo vector")
    a = ap.parse_args()
    r = run()
    for n in r["nodes"]:
        print(f"node {n['node'][:6]}…{n['node'][-4:]} shard {n['shard']}: {n['verdict']}"
              f"{'' if n['honest'] else ' (the cheater)'}")
    s = r["settlement"]
    print(f"merge: {'accepted' if s['outcome'] == 0 else 'reverted'}, slashed bitmap {s['slashedBitmap']:#06b}, "
          f"validation loss {r['valLoss']['before']} -> {r['valLoss']['after']}")
    print(f"train {r['seconds']['trainAllNodes']} s, replay {r['seconds']['replayAllNodes']} s; "
          f"settlement payload {s['payloadHash']}")
    pinned = {k: v for k, v in r.items() if k != "seconds"}  # timings depend on the machine
    if a.write:
        VECTOR.parent.mkdir(parents=True, exist_ok=True)
        VECTOR.write_text(json.dumps(pinned, indent=1) + "\n")
        print(f"wrote {VECTOR.relative_to(ROOT)}")
    elif VECTOR.exists():
        same = json.loads(VECTOR.read_text()) == pinned
        print("every hash matches vectors/kernel/demo_round.json" if same else
              "MISMATCH against vectors/kernel/demo_round.json: this machine doesn't reproduce the kernel")
        sys.exit(0 if same else 1)


if __name__ == "__main__":
    main()
