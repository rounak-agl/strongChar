"""Typed access to strongChar's contracts, with every write sent inside an EVM window that is renewed when short."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from qorsdk.unified import UnifiedAccount
from web3 import Web3

from . import deployment
from .chain import Chain
from .evm import Evm, EvmReceipt

# A window admits value + gas limit x max fee per tx; max fee is twice the base fee (200 gwei on diana),
# so each 1M gas of limit reserves 0.2 QOR (200,000 uqor) of the window.
UQOR_PER_GAS = 0.2
WINDOW_BLOCKS = 3_000  # about 70 minutes at ~1.4 s blocks
WINDOW_TXS = 20
MIN_BLOCKS_LEFT = 120


class TxReverted(RuntimeError):
    pass


@dataclass
class WindowManager:
    """Opens, checks and renews one account's scoped window. Opening advances the nonce, so it runs before signing."""

    chain: Chain
    account: UnifiedAccount
    targets: tuple[str, ...]
    value_cap_uqor: int = 2_000_000

    def ensure(self, txs: int = 1, gas_limit: int = 1_000_000) -> None:
        need = int(txs * gas_limit * UQOR_PER_GAS)
        w = self.chain.window(self.account.cosmos)
        want = {t.lower() for t in self.targets}
        have = {t.lower() for t in w.allowed_targets}
        if (w.live and want <= have and w.remaining_txs >= txs and w.remaining_value >= need
                and w.remaining_blocks >= MIN_BLOCKS_LEFT):
            return
        if w.live:
            self.chain.close_window(self.account)
        self.chain.open_window(self.account, blocks=WINDOW_BLOCKS, max_txs=max(WINDOW_TXS, txs),
                               max_value_uqor=max(self.value_cap_uqor, need),
                               targets=[Web3.to_checksum_address(t) for t in self.targets])


class Contracts:
    def __init__(self, dep: deployment.Deployment | None = None, evm: Evm | None = None, chain: Chain | None = None):
        self.dep = dep or deployment.load()
        self.evm = evm or Evm()
        self.chain = chain or Chain()
        w3 = self.evm.w3
        self.market = w3.eth.contract(address=Web3.to_checksum_address(self.dep.job_market), abi=deployment.abi("JobMarket"))
        self.registry = w3.eth.contract(address=Web3.to_checksum_address(self.dep.node_registry),
                                        abi=deployment.abi("NodeRegistry"))
        self.beru = w3.eth.contract(address=Web3.to_checksum_address(self.dep.beru), abi=deployment.ERC20_ABI)
        self.fusd = w3.eth.contract(address=Web3.to_checksum_address(self.dep.fusd), abi=deployment.ERC20_ABI)
        self.faucet = w3.eth.contract(address=Web3.to_checksum_address(self.dep.beru_faucet),
                                      abi=deployment.abi("BeruFaucet"))

    def send(self, account: UnifiedAccount, fn: Any, window: WindowManager | None = None) -> EvmReceipt:
        """Estimate first (so a revert surfaces with its reason and costs nothing), then send inside the window."""
        sender = Web3.to_checksum_address(account.evm)
        data = fn._encode_transaction_data()
        to = fn.address
        gas = int(self.evm.w3.eth.estimate_gas({"from": sender, "to": to, "data": data}) * 1.25) + 20_000
        if window is not None:
            window.ensure(txs=1, gas_limit=gas)
        r = self.evm.send(account, to=to, data=data, gas=gas)
        if r.status != 1:
            raise TxReverted(f"{fn.fn_name} reverted in {r.txhash}")
        return r

    # ---- reads -------------------------------------------------------------
    def job(self, job_id: int) -> tuple[Any, Any]:
        return self.market.functions.getJob(job_id).call()

    def round(self, job_id: int, round_id: int) -> tuple[Any, list[str]]:
        return self.market.functions.getRound(job_id, round_id).call()

    def seat(self, job_id: int, round_id: int, node: str) -> Any:
        return self.market.functions.getSeat(job_id, round_id, Web3.to_checksum_address(node)).call()

    def domain(self) -> bytes:
        return self.market.functions.domain().call()

    def events(self, name: str, from_block: int, to_block: int | str = "latest", contract: str = "market") -> list:
        c = self.market if contract == "market" else self.registry
        to = self.evm.w3.eth.block_number if to_block == "latest" else to_block
        return [x for lo, hi in reversed(list(windows(from_block, to))) for x in getattr(c.events, name).get_logs(from_block=lo, to_block=hi)]

    # ---- writes ------------------------------------------------------------
    def settlement_tuple(self, s) -> tuple:
        """strongchar_core.finalize.Settlement -> the ABI tuple finalizeRound takes."""
        return (int(s.outcome), s.aggregate_hash, s.slashed_bitmap, s.agg_evidence_hash, s.pay_evidence_hash,
                [(Web3.to_checksum_address(a), v) for a, v in s.payouts])

    def finalize(self, account: UnifiedAccount, job_id: int, round_id: int, settlement, expiry: int,
                 sig_a: bytes, sig_b: bytes, window: WindowManager | None = None) -> EvmReceipt:
        fn = self.market.functions.finalizeRound(job_id, round_id, self.settlement_tuple(settlement), expiry, sig_a, sig_b)
        return self.send(account, fn, window)

    def open_round(self, account: UnifiedAccount, job_id: int, nodes: Sequence[str], shards: Sequence[int],
                   window: WindowManager | None = None) -> EvmReceipt:
        fn = self.market.functions.openRound(job_id, [Web3.to_checksum_address(n) for n in nodes], list(shards))
        return self.send(account, fn, window)


LOG_SPAN = 10_000  # diana's RPC refuses eth_getLogs over more blocks than this


def windows(lo: int, hi: int, span: int = LOG_SPAN):
    """[lo, hi] as inclusive block ranges of at most `span` blocks, newest first."""
    while hi >= lo:
        yield max(lo, hi - span + 1), hi
        hi -= span


def first_log(event, from_block: int, latest: int, argument_filters: dict) -> dict | None:
    """The newest matching log, scanning back from `latest` a window at a time (ids here match exactly one event)."""
    for lo, hi in windows(from_block, latest):
        logs = event.get_logs(from_block=lo, to_block=hi, argument_filters=argument_filters)
        if logs:
            return logs[-1]
    return None
