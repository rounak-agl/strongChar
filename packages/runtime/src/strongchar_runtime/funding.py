"""Get fUSD where a contract can pull it: swap QOR in native AMM pool 2, then convert the bank coin to the ERC-20."""

from __future__ import annotations

from qorsdk import msg
from strongchar_qore.erc20 import convert_coin_msg
from strongchar_qore.market import Contracts

POOL_FUSD_QOR = 2


def ensure_fusd(c: Contracts, account, need: int) -> list[str]:
    """Returns the native tx hashes it sent (empty if the ERC-20 balance already covers `need`)."""
    denom = f"erc20:{c.dep.fusd}"
    txs = []
    have = c.fusd.functions.balanceOf(account.evm).call() + c.chain.balances(account.cosmos).get(denom, 0)
    if have < need:
        pool = [p for p in c.chain.get("/qorechain/amm/v1/pools")["pools"] if p["id"] == str(POOL_FUSD_QOR)][0]
        ra, rb = int(pool["reserve_a"]), int(pool["reserve_b"])  # a = fUSD, b = uqor
        want = (need - have) * 12 // 10
        amount_in = rb * want // (ra - want) * 10_000 // 9_960 + 1
        m = msg.amm.swap_exact_in(sender=account.cosmos, pool_id=POOL_FUSD_QOR,
                                  token_in={"denom": "uqor", "amount": str(amount_in)}, denom_out=denom,
                                  min_out=str(need - have))
        txs.append(c.chain.submit(account, [m]).txhash)
    bank = c.chain.balances(account.cosmos).get(denom, 0)
    if bank:
        txs.append(c.chain.submit(account, [convert_coin_msg(denom=denom, amount=bank, receiver_evm=account.evm,
                                                             sender_qor=account.cosmos)]).txhash)
    return txs
