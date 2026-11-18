"""EVM-lane transactions on diana (chain 9800): deploy and call contracts from inside an open window."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from eth_account import Account
from qorsdk.unified import UnifiedAccount
from web3 import Web3
from web3.exceptions import ContractLogicError

EVM_RPC = "https://evm-testnet.qore.host"
CHAIN_ID = 9800
HEADERS = {"user-agent": "strongchar/0.1", "content-type": "application/json"}


@dataclass(frozen=True)
class EvmReceipt:
    txhash: str
    status: int
    gas_used: int
    contract_address: str | None
    fee_wei: int


class Evm:
    def __init__(self, rpc: str = EVM_RPC):
        self.w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"headers": HEADERS, "timeout": 30}))

    def _fees(self) -> tuple[int, int]:
        base = self.w3.eth.get_block("latest")["baseFeePerGas"]
        tip = 0
        return base * 2, tip

    def send(self, account: UnifiedAccount, *, to: str | None, data: bytes = b"", value: int = 0,
             gas: int | None = None) -> EvmReceipt:
        """Sign and send one EIP-1559 tx. The nonce is read here, so open the window first."""
        sender = Web3.to_checksum_address(account.evm)
        max_fee, tip = self._fees()
        tx: dict[str, Any] = {"chainId": CHAIN_ID, "from": sender, "nonce": self.w3.eth.get_transaction_count(sender),
                              "value": value, "data": data, "maxFeePerGas": max_fee, "maxPriorityFeePerGas": tip,
                              "type": 2}
        if to is not None:
            tx["to"] = Web3.to_checksum_address(to)
        tx["gas"] = gas or int(self.w3.eth.estimate_gas(tx) * 1.2)
        signed = Account.sign_transaction(tx, account.private_key)
        h = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        r = self.w3.eth.wait_for_transaction_receipt(h, timeout=90)
        return EvmReceipt("0x" + h.hex().removeprefix("0x"), r["status"], r["gasUsed"],
                          r.get("contractAddress"), r["gasUsed"] * r["effectiveGasPrice"])

    def call(self, to: str, data: bytes) -> bytes:
        return bytes(self.w3.eth.call({"to": Web3.to_checksum_address(to), "data": data}))

    def code(self, address: str) -> bytes:
        return bytes(self.w3.eth.get_code(Web3.to_checksum_address(address)))


__all__ = ["Evm", "EvmReceipt", "ContractLogicError"]
