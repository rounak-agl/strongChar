"""End-to-end sealed training job on diana, acting as the data owner. Spends a little testnet QOR and fUSD.

Prerequisites: coordinator, nodes and both verifiers running (scripts/run_local.sh) and nodes staked
(scripts/setup_nodes.py). Uses a synthetic health table (no real people) and the same steps as `strongchar-job`.
"""

from __future__ import annotations

import argparse

from strongchar_datasets import presets
from strongchar_qore import keystore
from strongchar_qore.market import Contracts
from strongchar_runtime import owner
from strongchar_runtime.client import Coordinator

NODES = ["node-1", "node-2", "node-3", "node-4"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--coordinator", default="http://127.0.0.1:8700")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--rows", type=int, default=8_000)
    ap.add_argument("--shards", type=int, default=3, help="training shards; the keeper seats up to this many nodes")
    ap.add_argument("--quorum", type=int, default=2, help="fewest nodes a round may run with")
    a = ap.parse_args()

    c, actor = Contracts(), keystore.load("data-owner")
    coord = Coordinator(a.coordinator, actor.account)
    p = owner.plan(presets.health_csv(a.rows), rounds=a.rounds, shards=a.shards, quorum=a.quorum)
    print(f"priced at {p.budget / 1e6} fUSD ({p.ops_per_round / 1e9:.4f} Gop per node per round)")
    job = owner.post(c, actor, coord, p)
    names = {keystore.load(n).evm.lower(): n for n in NODES}
    owner.watch(c, job, names)
    before, after = owner.holdout_accuracy(p, owner.open_model(c, actor, coord, job, p.spec))
    print(f"holdout accuracy: initial {before:.3f} -> final {after:.3f} (model opened locally by the owner only)")
    reg = c.registry.functions
    for n, name in sorted(names.items(), key=lambda kv: kv[1]):
        node = c.registry.functions.getNode(c.evm.w3.to_checksum_address(n)).call()
        print(f"{name}: claimable {c.market.functions.claimable(c.evm.w3.to_checksum_address(n)).call() / 1e6} fUSD, "
              f"stake {node[1] / 1e6:g} BERU, verified work {reg.verifiedWorkSeconds(c.evm.w3.to_checksum_address(n)).call()} s")
    print(f"community pool: {c.market.functions.communityPool().call() / 1e6} fUSD")


if __name__ == "__main__":
    main()
