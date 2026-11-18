"""Runs the coordinator: the API plus the keeper thread, against the deployment in networks/diana.toml."""

from __future__ import annotations

import base64
import logging
import os
import threading
from pathlib import Path

import uvicorn
from qorsdk.kem import parse_kem_key
from strongchar_qore import keystore
from strongchar_qore.chain import Chain
from strongchar_qore.market import Contracts
from qorsdk import hex_to_bech32

from .api import ChainView, create_app
from .keeper import Keeper
from .store import Store


def chain_view(chain: Chain, contracts: Contracts) -> ChainView:
    verifiers = {contracts.dep.verifier_a.lower(), contracts.dep.verifier_b.lower()}

    def pq_key_of(addr: str) -> bytes | None:
        acct = chain.pqc_account(hex_to_bech32(addr)).get("account") or {}
        if not acct.get("possession_proven"):
            return None
        return base64.b64decode(acct["public_key"])

    def kem_key_of(addr: str) -> bytes | None:
        res = parse_kem_key(chain.get(f"/qorechain/pqc/v1/kem/{hex_to_bech32(addr)}"))
        return res.key.public_key if res.found and res.key else None

    return ChainView(pq_key_of, kem_key_of, lambda a: a.lower() in verifiers)


def build(data_dir: Path, run_keeper: bool = True):
    store = Store(data_dir)
    chain, contracts = Chain(), Contracts()
    origins = [o for o in os.environ.get("STRONGCHAR_ALLOWED_ORIGINS", "").split(",") if o]
    app = create_app(store, chain_view(chain, contracts), origins)
    keeper = None
    if run_keeper:
        keeper = Keeper(contracts, store, keystore.load("coordinator").account,
                        floor_s=float(os.environ.get("STRONGCHAR_BENCHMARK_FLOOR_S", "600")))
        threading.Thread(target=keeper.run, daemon=True, name="keeper").start()
    return app, keeper


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    app, _ = build(Path(os.environ.get("STRONGCHAR_DATA", "./coordinator-data")))
    uvicorn.run(app, host=os.environ.get("STRONGCHAR_HOST", "127.0.0.1"), port=int(os.environ.get("STRONGCHAR_PORT", "8700")),
                proxy_headers=True, log_level="info")


if __name__ == "__main__":
    main()
