"""Native-lane transactions on qorechain-diana: sign (hybrid or bootstrap-classical), size fees, broadcast, confirm."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
from qorsdk import msg
from qorsdk.gas import calculate_fee, estimate_gas
from qorsdk.key_integrity import sign_proof_of_possession
from qorsdk.pqc_dx import build_register_pqc_key
from qorsdk.sign_eth import sign_classical_eth, sign_hybrid_eth
from qorsdk.signbytes import resolve_sign_bytes_version
from qorsdk.tx import broadcast
from qorsdk.unified import UnifiedAccount

CHAIN_ID = "qorechain-diana"
REST_URL = "https://api-testnet.qore.host"
GAS_PRICE = "0.15uqor"
# Some endpoints refuse default library user agents; send a generic client name.
HEADERS = {"user-agent": "strongchar/0.1"}


class TxFailed(RuntimeError):
    def __init__(self, txhash: str | None, code: int, log: str):
        super().__init__(f"tx {txhash} failed with code {code}: {log}")
        self.txhash, self.code, self.log = txhash, code, log


@dataclass(frozen=True)
class TxResult:
    txhash: str
    height: int
    gas_used: int
    gas_wanted: int


class Chain:
    def __init__(self, rest_url: str = REST_URL, chain_id: str = CHAIN_ID):
        self.rest_url = rest_url
        self.chain_id = chain_id
        self.http = httpx.Client(timeout=30.0, headers=HEADERS)

    # --- reads -------------------------------------------------------------
    def get(self, path: str) -> Any:
        r = self.http.get(f"{self.rest_url}{path}")
        r.raise_for_status()
        return r.json()

    def account_numbers(self, address: str) -> tuple[int, int]:
        """(account_number, sequence). Raises if the account has never received funds."""
        acct = self.get(f"/cosmos/auth/v1beta1/accounts/{address}")["account"]
        base = acct.get("base_account", acct)
        return int(base["account_number"]), int(base.get("sequence", 0))

    def balances(self, address: str) -> dict[str, int]:
        data = self.get(f"/cosmos/bank/v1beta1/balances/{address}")
        return {c["denom"]: int(c["amount"]) for c in data["balances"]}

    def pqc_account(self, address: str) -> Any:
        return self.get(f"/qorechain/pqc/v1/account/{address}")

    # --- writes ------------------------------------------------------------
    def submit(self, account: UnifiedAccount, messages: list[Any], *, hybrid: bool = True,
               memo: str = "", wait: bool = True) -> TxResult:
        """Simulate for gas, sign, broadcast and (by default) wait for inclusion."""
        number, sequence = self.account_numbers(account.cosmos)
        version = resolve_sign_bytes_version(self.chain_id, rest_url=self.rest_url, client=self.http)

        def build(fee: dict[str, Any]):
            if hybrid:
                return sign_hybrid_eth(account, self.chain_id, number, messages, fee, sequence,
                                       memo=memo, sign_bytes_version=version)
            return sign_classical_eth(account, self.chain_id, number, messages, fee, sequence, memo=memo)

        probe = build(calculate_fee(400_000, GAS_PRICE))
        gas = estimate_gas(self.rest_url, probe, client=self.http)
        built = build(calculate_fee(gas, GAS_PRICE))
        res = broadcast(self.rest_url, built.tx_raw_bytes, mode="sync", client=self.http)["tx_response"]
        if int(res.get("code", 0)) != 0:
            raise TxFailed(res.get("txhash"), int(res["code"]), res.get("raw_log", ""))
        if not wait:
            return TxResult(res["txhash"], 0, 0, gas)
        return self.wait_for(res["txhash"])

    def wait_for(self, txhash: str, timeout_s: float = 60.0) -> TxResult:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            r = self.http.get(f"{self.rest_url}/cosmos/tx/v1beta1/txs/{txhash}")
            if r.status_code == 200:
                tx = r.json()["tx_response"]
                if int(tx.get("code", 0)) != 0:
                    raise TxFailed(txhash, int(tx["code"]), tx.get("raw_log", ""))
                return TxResult(txhash, int(tx["height"]), int(tx["gas_used"]), int(tx["gas_wanted"]))
            time.sleep(1.5)
        raise TimeoutError(f"tx {txhash} not included after {timeout_s}s")

    # --- composed actions ----------------------------------------------------
    def send(self, account: UnifiedAccount, to: str, coins: dict[str, int]) -> TxResult:
        amount = [{"denom": d, "amount": str(a)} for d, a in coins.items()]
        return self.submit(account, [msg.bank.send(from_address=account.cosmos, to_address=to, amount=amount)])

    def register_pqc_key(self, account: UnifiedAccount) -> TxResult:
        """Register the account's ML-DSA-87 key with proof of possession (bootstrap: classical signature)."""
        proof = sign_proof_of_possession(chain_id=self.chain_id, account=account.cosmos, keypair=account.pqc)
        m = build_register_pqc_key(sender=account.cosmos, dilithium_pubkey=account.pqc.public_key,
                                   ecdsa_pubkey=account.public_key, proof_of_possession=proof)
        return self.submit(account, [m], hybrid=False)
