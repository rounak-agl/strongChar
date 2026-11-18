"""Spike S1: EVM windows on diana — refusal without a window, deploy inside one, scoped targets, block time."""

from __future__ import annotations

import json
from pathlib import Path

from eth_utils import keccak
from web3 import Web3

from strongchar_qore import keystore
from strongchar_qore.chain import Chain
from strongchar_qore.evm import Evm

ART = Path(__file__).resolve().parents[2] / "contracts/out/PQProbe.sol/PQProbe.json"
WALLET = "0x15310d5a5d5488840dbf9965d803f710ed34dba2"  # Rounak's QoreX wallet (registered, not proven)


def sel(sig: str) -> bytes:
    return keccak(text=sig)[:4]


def show(label: str, fn):
    try:
        out = fn()
        print(f"  {label}: OK {out}")
        return out
    except Exception as e:  # spike: record the refusal text
        print(f"  {label}: REFUSED {type(e).__name__}: {str(e)[:220]}")
        return None


def main() -> None:
    chain, evm = Chain(), Evm()
    dep = keystore.load("deployer").account
    va = keystore.load("verifier-a").account
    bytecode = bytes.fromhex(json.loads(ART.read_text())["bytecode"]["object"].removeprefix("0x"))

    latest = evm.w3.eth.get_block("latest")
    older = evm.w3.eth.get_block(latest["number"] - 1000)
    print(f"block time ≈ {(latest['timestamp'] - older['timestamp']) / 1000:.3f}s; 17280 blocks ≈ "
          f"{17280 * (latest['timestamp'] - older['timestamp']) / 1000 / 3600:.1f} h")

    print("1. no window")
    print("  window:", chain.window(dep.cosmos))
    show("deploy without window", lambda: evm.send(dep, to=None, data=bytecode, gas=600_000))

    print("2. open unscoped window (deploy needs no target)")
    show("open", lambda: chain.open_window(dep, blocks=600, max_txs=2, max_value_uqor=300_000).txhash)
    rec = show("deploy PQProbe", lambda: evm.send(dep, to=None, data=bytecode, gas=600_000))
    if not rec or rec.status != 1:
        return
    probe = rec.contract_address
    print(f"  probe at {probe}, gas {rec.gas_used}, fee {rec.fee_wei / 1e18:.6f} QOR")
    code = evm.code(probe).hex()
    for name, a in (("pqcVerify", "0a01"), ("pqcKeyStatus", "0a02")):
        print(f"  runtime code has full {name} address: {('0' * 36 + a) in code}")
    for who, addr in (("deployer", dep.evm), ("QoreX wallet", WALLET)):
        r = evm.call(probe, sel("proven(address)") + bytes(12) + bytes.fromhex(addr[2:]))
        print(f"  proven({who}) = {bool(int.from_bytes(r, 'big'))}")
    w = chain.window(dep.cosmos)
    print(f"  window used: txs {w.used_txs}/{w.max_txs}, value {w.used_value}/{w.max_value} uqor")
    show("close", lambda: chain.close_window(dep).txhash)
    show("call after close", lambda: evm.send(dep, to=probe, data=sel("ping()"), gas=120_000))

    print("3. scoped window: targets = [probe]")
    show("open scoped", lambda: chain.open_window(dep, blocks=600, max_txs=3, max_value_uqor=300_000,
                                                  targets=[Web3.to_checksum_address(probe)]).txhash)
    show("ping() on probe", lambda: evm.send(dep, to=probe, data=sel("ping()"), gas=120_000))
    show("1 wei to verifier-a (outside targets)", lambda: evm.send(dep, to=va.evm, value=1, gas=21_000))
    w = chain.window(dep.cosmos)
    print(f"  window used: txs {w.used_txs}/{w.max_txs}, value {w.used_value}/{w.max_value} uqor")
    show("close", lambda: chain.close_window(dep).txhash)
    print("deployer balance:", chain.balances(dep.cosmos))
    print("PROBE", probe)


if __name__ == "__main__":
    main()
