"""strongchar-job: post a sealed training job from your own CSV, follow it, and open the trained model.

  strongchar-job quote data.csv --rounds 3 --shards 4        # price only; nothing is sent
  strongchar-job post  data.csv --rounds 3 --shards 4        # seal, fund and create the job, then follow it
  strongchar-job model data.csv --job 7 --out model.npy      # open the final model and score it on your holdout

The CSV is numeric with the target in the last column. Only ciphertext leaves this machine: every shard and the
validation split are sealed to the two verifiers, and the final model is sealed to you alone.
"""

from __future__ import annotations

import argparse
import os
import secrets
from pathlib import Path

import numpy as np
from strongchar_qore import keystore
from strongchar_qore.market import Contracts

from . import owner
from .client import Coordinator


def _plan(a) -> owner.Plan:
    return owner.plan(Path(a.csv).read_text(), rounds=a.rounds, shards=a.shards, quorum=a.quorum, hidden=a.hidden,
                      steps=a.steps, batch_size=a.batch, price_units_per_gop=int(float(a.price) * 10**6),
                      salt=("0x" + secrets.token_hex(16)) if a.salt is None else (a.salt or None))


def main() -> None:
    ap = argparse.ArgumentParser(prog="strongchar-job", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for cmd in ("quote", "post", "model"):
        sp = sub.add_parser(cmd)
        sp.add_argument("csv")
        sp.add_argument("--rounds", type=int, default=3)
        sp.add_argument("--shards", type=int, default=4, help="training shards; up to this many nodes per round")
        sp.add_argument("--quorum", type=int, default=3, help="fewest nodes a round may run with")
        sp.add_argument("--hidden", type=int, default=16)
        sp.add_argument("--steps", type=int, default=40, help="training steps per node per round")
        sp.add_argument("--batch", type=int, default=32)
        sp.add_argument("--price", default="1", help="fUSD per Gop of training (default 1)")
        sp.add_argument("--salt", default=None, help="hex salt for the spec (default: random, so every job is unique)")
        sp.add_argument("--name", default="data-owner", help="your actor name in the key store")
        sp.add_argument("--coordinator", default=os.environ.get("STRONGCHAR_COORDINATOR", "http://127.0.0.1:8700"))
        if cmd == "model":
            sp.add_argument("--job", type=int, required=True)
            sp.add_argument("--out", default="model.npy")
    a = ap.parse_args()
    if a.cmd == "model" and a.salt is None:
        # Re-derive this job's spec: its salt is in the draft stored under the spec hash on chain.
        params, _ = Contracts().job(a.job)
        draft = Coordinator(a.coordinator, None).get_draft("0x" + bytes(params[0]).hex())
        a.salt = draft["spec"].get("salt", "")
    p = _plan(a)
    print(f"{p.data.card.rows:,} rows, {p.data.card.x_shape[0]} features, {p.data.card.task}; "
          f"{p.ops_per_round / 1e9:.4f} Gop per node per round")
    print(f"price: {p.budget / 1e6} fUSD for {a.rounds} rounds x {a.shards} seats")
    if a.cmd == "quote":
        return
    c, actor = Contracts(), keystore.load(a.name)
    coord = Coordinator(a.coordinator, actor.account)
    if a.cmd == "post":
        job = owner.post(c, actor, coord, p)
        owner.watch(c, job)
        a.job = job
    w = owner.open_model(c, actor, coord, a.job, p.spec)
    np.save(a.out, w)
    before, after = owner.holdout_accuracy(p, w)
    print(f"model saved to {a.out}; holdout score {before:.3f} -> {after:.3f} on rows that never left this machine")


if __name__ == "__main__":
    main()
