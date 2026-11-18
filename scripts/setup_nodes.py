"""Give each node BERU from the faucet, join the registry and stake. Spends a little testnet QOR per node."""

from __future__ import annotations

from strongchar_qore import keystore
from strongchar_qore.market import Contracts, WindowManager

STAKE = 200 * 10**6  # BERU base units each node keeps staked


def main() -> None:
    c = Contracts()
    for name in ("node-1", "node-2", "node-3", "node-4"):
        a = keystore.load(name).account
        w = WindowManager(c.chain, a, (c.dep.beru_faucet, c.dep.beru, c.dep.node_registry))
        node = c.registry.functions.getNode(a.evm).call()
        if c.beru.functions.balanceOf(a.evm).call() < STAKE and node[1] < STAKE:
            c.send(a, c.faucet.functions.claim(), w)
        if not node[0]:
            c.send(a, c.registry.functions.join(), w)
        if node[1] < STAKE:
            c.send(a, c.beru.functions.approve(c.dep.node_registry, STAKE), w)
            c.send(a, c.registry.functions.depositStake(STAKE - node[1]), w)
        node = c.registry.functions.getNode(a.evm).call()
        print(f"{name}: joined={node[0]} stake={node[1] / 1e6:.0f} BERU  QOR={c.chain.balances(a.cosmos).get('uqor', 0) / 1e6:.3f}")
        c.chain.close_window(a)


if __name__ == "__main__":
    main()
