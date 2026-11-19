"""Deploy a new NodeRegistry and JobMarket (stake floor, probation and community pool) and point diana.toml at them.

BeruToken, BeruFaucet and Competitions stay. The old JobMarket is kept in diana.toml as `job_market_v1` so its jobs
stay linkable. Nodes withdraw their stake from the old registry first (scripts/setup_nodes.py restakes). Spends
testnet QOR: run when asked.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from eth_abi import encode
from strongchar_qore import keystore
from strongchar_qore.chain import Chain
from strongchar_qore.deployment import load
from strongchar_qore.evm import Evm
from strongchar_qore.market import Contracts, WindowManager
from web3 import Web3

ROOT = Path(__file__).resolve().parents[1]
NODES = ("node-1", "node-2", "node-3", "node-4")


def artifact(name: str) -> dict:
    return json.loads((ROOT / f"contracts/out/{name}.sol/{name}.json").read_text())


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--probation-seconds", type=int, default=3,
                    help="reference seconds of verified work before a node is paid directly (1 s = 1 Gop)")
    a = ap.parse_args()
    chain, evm, dep = Chain(), Evm(), load()
    old = Contracts()

    for name in NODES:  # free the stake held by the old registry so it can be restaked in the new one
        n = keystore.load(name).account
        stake = old.registry.functions.getNode(n.evm).call()[1]
        if stake:
            w = WindowManager(chain, n, (dep.node_registry,))
            old.send(n, old.registry.functions.withdrawStake(stake), w)
            chain.close_window(n)
            print(f"{name}: withdrew {stake / 1e6:.0f} BERU from the old registry")

    d = keystore.load("deployer").account
    names = {n: keystore.load(n).evm for n in ("coordinator", "verifier-a", "verifier-b")}
    chain.open_window(d, blocks=600, max_txs=4, max_value_uqor=4_000_000)

    def deploy(name: str, types: list[str], args: list) -> str:
        code = bytes.fromhex(artifact(name)["bytecode"]["object"][2:]) + encode(types, args)
        # diana bills at least half the gas limit, so size it from the estimate rather than a round number.
        gas = int(evm.w3.eth.estimate_gas({"from": Web3.to_checksum_address(d.evm), "data": code}) * 1.2)
        r = evm.send(d, to=None, data=code, gas=gas)
        assert r.status == 1, f"{name} deploy failed {r.txhash}"
        print(f"{name:13} {r.contract_address}  gas {r.gas_used}  tx {r.txhash}")
        return Web3.to_checksum_address(r.contract_address)

    registry = deploy("NodeRegistry", ["address", "uint64"], [dep.beru, a.probation_seconds])
    market = deploy("JobMarket", ["address", "address", "address", "address", "address"],
                    [dep.fusd, registry, names["coordinator"], names["verifier-a"], names["verifier-b"]])
    data = Web3.keccak(text="setMarket(address)")[:4] + encode(["address"], [market])
    r = evm.send(d, to=registry, data=data, gas=120_000)
    assert r.status == 1, r.txhash
    chain.close_window(d)
    block = evm.w3.eth.block_number

    toml = ROOT / "networks/diana.toml"
    text = toml.read_text()
    if "job_market_v1" not in text:
        text = re.sub(r'job_market = "([^"]+)"\n', r'job_market_v1 = "\1"\njob_market = "\1"\n', text)
    text = re.sub(r'node_registry = "[^"]+"', f'node_registry = "{registry}"', text)
    text = re.sub(r'\njob_market = "[^"]+"', f'\njob_market = "{market}"', text)
    # deploy_block stays: event scans must still reach competition 1 and the jobs on the old market.
    toml.write_text(text)
    for name in ("NodeRegistry", "JobMarket"):
        (ROOT / "packages/abi" / f"{name}.json").write_text(json.dumps(artifact(name)["abi"], indent=1) + "\n")
    print(f"diana.toml updated at block {block}; probation {a.probation_seconds} s")


if __name__ == "__main__":
    main()
