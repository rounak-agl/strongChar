"""Deploy the Competitions contract to diana and append its address and ABI. Spends testnet QOR: run when asked."""

from __future__ import annotations

import json
import re
from pathlib import Path

from eth_abi import encode
from web3 import Web3

from strongchar_qore import keystore
from strongchar_qore.chain import Chain
from strongchar_qore.deployment import load
from strongchar_qore.evm import Evm

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    chain, evm, dep = Chain(), Evm(), load()
    a = keystore.load("deployer").account
    art = json.loads((ROOT / "contracts/out/Competitions.sol/Competitions.json").read_text())
    code = bytes.fromhex(art["bytecode"]["object"][2:]) + encode(["address", "address", "address"],
                                                                 [dep.fusd, dep.verifier_a, dep.verifier_b])
    # diana bills at least half the gas limit, so size it from the estimate rather than a round number.
    gas = int(evm.w3.eth.estimate_gas({"from": Web3.to_checksum_address(a.evm), "data": code}) * 1.2)
    chain.open_window(a, blocks=300, max_txs=2, max_value_uqor=max(1_000_000, int(gas * 0.25)))
    r = evm.send(a, to=None, data=code, gas=gas)
    chain.close_window(a)
    assert r.status == 1, r.txhash
    addr = Web3.to_checksum_address(r.contract_address)
    toml = ROOT / "networks/diana.toml"
    text = toml.read_text()
    if "competitions" not in text:
        text = re.sub(r'(job_market = "[^"]+"\n)', rf'\1competitions = "{addr}"\n', text)
    toml.write_text(text)
    (ROOT / "packages/abi/Competitions.json").write_text(json.dumps(art["abi"], indent=1) + "\n")
    print(f"Competitions {addr} gas {r.gas_used} tx {r.txhash}")


if __name__ == "__main__":
    main()
