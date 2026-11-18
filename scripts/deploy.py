"""Deploy strongChar's contracts to qorechain-diana from the deployer account and record addresses and ABIs.

Spends testnet QOR: run only when asked. Usage: uv run python scripts/deploy.py [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from eth_abi import encode
from eth_utils import keccak
from web3 import Web3

from strongchar_qore import keystore
from strongchar_qore.chain import Chain
from strongchar_qore.evm import Evm

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "contracts" / "out"
FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA"  # the event's FestUSD ERC-20, 6 decimals
BERU_SUPPLY = 1_000_000_000 * 10**6
FAUCET_SHARE = 400_000_000 * 10**6
FAUCET_ALLOCATION = 1_000 * 10**6
FAUCET_COOLDOWN = 24 * 3600


def artifact(name: str) -> dict:
    return json.loads((OUT / f"{name}.sol" / f"{name}.json").read_text())


def creation(name: str, types: list[str], args: list) -> bytes:
    code = bytes.fromhex(artifact(name)["bytecode"]["object"].removeprefix("0x"))
    return code + encode(types, args)


def call_data(sig: str, types: list[str], args: list) -> bytes:
    return keccak(text=sig)[:4] + encode(types, args)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print the plan and gas estimate, send nothing")
    a = ap.parse_args()
    chain, evm = Chain(), Evm()
    dep = keystore.load("deployer").account
    names = {n: keystore.load(n).evm for n in ("coordinator", "verifier-a", "verifier-b")}
    print("deployer", dep.evm, "balance", chain.balances(dep.cosmos))
    print("roles", names)
    if a.dry_run:
        return

    w = chain.window(dep.cosmos)
    if not w.live:
        print("open window", chain.open_window(dep, blocks=900, max_txs=8, max_value_uqor=6_000_000).txhash)

    def deploy(name: str, types: list[str], args: list) -> str:
        r = evm.send(dep, to=None, data=creation(name, types, args), gas=6_000_000)
        assert r.status == 1, f"{name} deploy failed {r.txhash}"
        print(f"{name:13} {r.contract_address}  gas {r.gas_used}  tx {r.txhash}")
        return Web3.to_checksum_address(r.contract_address)

    def send(to: str, sig: str, types: list[str], args: list) -> None:
        r = evm.send(dep, to=to, data=call_data(sig, types, args), gas=200_000)
        assert r.status == 1, f"{sig} failed {r.txhash}"
        print(f"  {sig} tx {r.txhash}")

    faucet = deploy("BeruFaucet", ["uint256", "uint256"], [FAUCET_ALLOCATION, FAUCET_COOLDOWN])
    beru = deploy("BeruToken", ["address", "address", "uint256", "uint256"],
                  [faucet, dep.evm, BERU_SUPPLY, FAUCET_SHARE])
    send(faucet, "setToken(address)", ["address"], [beru])
    registry = deploy("NodeRegistry", ["address"], [beru])
    market = deploy("JobMarket", ["address", "address", "address", "address", "address"],
                    [FUSD, registry, names["coordinator"], names["verifier-a"], names["verifier-b"]])
    send(registry, "setMarket(address)", ["address"], [market])
    print("close window", chain.close_window(dep).txhash)

    block = evm.w3.eth.block_number
    (ROOT / "networks" / "diana.toml").write_text(
        "# strongChar deployment on qorechain-diana (EVM chain 9800). Written by scripts/deploy.py.\n"
        "[chain]\nchain_id = \"qorechain-diana\"\nevm_chain_id = 9800\n"
        "rest = \"https://api-testnet.qore.host\"\nrpc = \"https://rpc-testnet.qore.host\"\n"
        "evm_rpc = \"https://evm-testnet.qore.host\"\n\n"
        f"[contracts]\nfusd = \"{FUSD}\"\nberu = \"{beru}\"\nberu_faucet = \"{faucet}\"\n"
        f"node_registry = \"{registry}\"\njob_market = \"{market}\"\ndeploy_block = {block}\n\n"
        f"[roles]\ncoordinator = \"{names['coordinator']}\"\nverifier_a = \"{names['verifier-a']}\"\n"
        f"verifier_b = \"{names['verifier-b']}\"\n")
    for name in ("BeruToken", "BeruFaucet", "NodeRegistry", "JobMarket"):
        (ROOT / "packages" / "abi" / f"{name}.json").write_text(json.dumps(artifact(name)["abi"], indent=1) + "\n")

    vec = json.loads((ROOT / "vectors" / "pq_signatures.json").read_text())
    msg = bytes.fromhex(vec["message"][2:])
    for s in vec["signers"]:
        data = call_data("checkSignature(address,bytes,bytes)", ["address", "bytes", "bytes"],
                         [s["address"], msg, bytes.fromhex(s["signature"][2:])])
        ok = evm.call(market, data)
        print(f"live pqcVerify through JobMarket for {s['name']}: {bool(int.from_bytes(ok, 'big'))}")
    print("deployer balance after", chain.balances(dep.cosmos))


if __name__ == "__main__":
    sys.exit(main())
