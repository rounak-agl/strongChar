"""Loads networks/<name>.toml and the contract ABIs, so every service talks to the same deployment."""

from __future__ import annotations

import json
import os
import tomllib
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(os.environ.get("STRONGCHAR_ROOT", Path(__file__).resolve().parents[4]))


@dataclass(frozen=True)
class Deployment:
    fusd: str
    beru: str
    beru_faucet: str
    node_registry: str
    job_market: str
    deploy_block: int
    coordinator: str
    verifier_a: str
    verifier_b: str
    competitions: str = ""  # empty until Competitions is deployed


def load(network: str = "diana") -> Deployment:
    d = tomllib.loads((ROOT / "networks" / f"{network}.toml").read_text())
    c, r = d["contracts"], d["roles"]
    return Deployment(c["fusd"], c["beru"], c["beru_faucet"], c["node_registry"], c["job_market"],
                      int(c["deploy_block"]), r["coordinator"], r["verifier_a"], r["verifier_b"],
                      c.get("competitions", ""))


def abi(name: str) -> list:
    return json.loads((ROOT / "packages" / "abi" / f"{name}.json").read_text())


ERC20_ABI = [
    {"type": "function", "name": "approve", "stateMutability": "nonpayable",
     "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"type": "function", "name": "allowance", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"type": "function", "name": "balanceOf", "stateMutability": "view",
     "inputs": [{"name": "a", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
]
