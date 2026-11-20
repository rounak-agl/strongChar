"""Turn a laptop into a strongChar node: make its keys, register them on diana, take BERU, stake and join.

Every step reads chain state first and skips what is already done, so `setup` can be rerun after a failure.
"""

from __future__ import annotations

import os
import signal
import subprocess
import time
from pathlib import Path

import httpx
from qorsdk import msg
from qorsdk.kem import parse_kem_key
from strongchar_qore import keystore
from strongchar_qore.market import Contracts, WindowManager
from strongchar_workloads.mlp import selftest

STAKE = 200 * 10**6  # BERU base units; matches the stake the demo jobs ask of each node
MIN_UQOR = 1_000_000  # 1 QOR covers registration, windows and many rounds of commit/reveal gas
SELFTEST = "389ba66fd29475c50d58de428233954f328c27f0b5959e3ee0c182fc4cfc79d4"


def init(name: str) -> None:
    path = keystore.DEFAULT_PATH
    keystore.create(path, actors=(name,))
    a = keystore.load(name)
    print(f"created {path} (mode 600). Back it up offline: it holds this node's only key.")
    print(f"address  {a.qor}\n         {a.evm}")
    print(f"Send this address about 2 QOR on qorechain-diana (for gas), then run: strongchar-node setup --name {name}")


def _kem_on_chain(c: Contracts, qor: str) -> bytes | None:
    res = parse_kem_key(c.chain.get(f"/qorechain/pqc/v1/kem/{qor}"))
    return res.key.public_key if res.found and res.key else None


def _proven(c: Contracts, qor: str) -> bool:
    acct = c.chain.pqc_account(qor).get("account") or {}
    return bool(acct.get("possession_proven"))


def setup(name: str) -> None:
    a = keystore.load(name)
    c = Contracts()
    uqor = c.chain.balances(a.qor).get("uqor", 0)
    if uqor < MIN_UQOR:
        raise SystemExit(f"{a.qor} holds {uqor / 1e6:.3f} QOR; fund it with at least {MIN_UQOR / 1e6:.0f} QOR first")
    if not _proven(c, a.qor):
        c.chain.register_pqc_key(a.account)
        print("registered the ML-DSA-87 key with proof of possession")
    if _kem_on_chain(c, a.qor) != a.seal.mlkem_public_key:
        c.chain.submit(a.account, [msg.pqc.register_kem_key(sender=a.qor, public_key=a.seal.mlkem_public_key)])
        print("registered the ML-KEM-1024 key (shards are sealed to it)")
    w = WindowManager(c.chain, a.account, (c.dep.beru_faucet, c.dep.beru, c.dep.node_registry))
    node = c.registry.functions.getNode(a.evm).call()
    if not node[0]:
        c.send(a.account, c.registry.functions.join(), w)
        print("joined the node registry")
    if node[1] < STAKE:
        if c.beru.functions.balanceOf(a.evm).call() < STAKE - node[1]:
            c.send(a.account, c.faucet.functions.claim(), w)
            print("claimed BERU from the faucet")
        c.send(a.account, c.beru.functions.approve(c.dep.node_registry, STAKE - node[1]), w)
        c.send(a.account, c.registry.functions.depositStake(STAKE - node[1]), w)
        print(f"staked {STAKE / 1e6:.0f} BERU")
    c.chain.close_window(a.account)
    print(f"ready. Start training with: strongchar-node run --name {name} --coordinator <url>")


def doctor(name: str, coordinator: str) -> bool:
    """Check everything the keeper checks before seating this node, and say how to fix what fails."""
    checks: list[tuple[str, bool, str]] = []
    try:
        a = keystore.load(name)
        checks.append(("key file", True, str(keystore.DEFAULT_PATH)))
    except Exception as e:  # noqa: BLE001 - shown to the operator as the failed check
        print(f"FAIL key file: {e} (run: strongchar-node init --name {name})")
        return False
    c = Contracts()
    uqor = c.chain.balances(a.qor).get("uqor", 0)
    checks.append(("QOR for gas", uqor >= MIN_UQOR / 10, f"{uqor / 1e6:.3f} QOR"))
    checks.append(("ML-DSA-87 key proven", _proven(c, a.qor), "run setup"))
    checks.append(("ML-KEM-1024 key registered", _kem_on_chain(c, a.qor) == a.seal.mlkem_public_key, "run setup"))
    node = c.registry.functions.getNode(a.evm).call()
    checks.append(("joined", node[0], "run setup"))
    checks.append(("stake", node[1] >= STAKE, f"{node[1] / 1e6:.0f} BERU staked"))
    checks.append(("self-test", selftest() == SELFTEST, "this machine's exact kernel disagrees; it can't be seated"))
    try:
        ok = httpx.get(f"{coordinator}/v1/health", timeout=5).json().get("ok") is True
    except httpx.HTTPError:
        ok = False
    checks.append(("coordinator reachable", ok, coordinator))
    for label, passed, note in checks:
        print(f"{'ok  ' if passed else 'FAIL'} {label}{'' if passed and label not in ('stake', 'QOR for gas') else f'  ({note})'}")
    return all(p for _, p, _ in checks)


def _running(state: Path) -> int | None:
    pid_file = state / "node.pid"
    try:
        pid = int(pid_file.read_text())
        os.kill(pid, 0)
        return pid
    except (OSError, ValueError):
        return None


def status(name: str, coordinator: str, state: Path) -> None:
    a = keystore.load(name)
    c = Contracts()
    n = c.registry.functions.getNode(a.evm).call()
    work = c.registry.functions.verifiedWorkSeconds(a.evm).call()
    need = c.registry.functions.PROBATION_SECONDS().call()
    graduated = c.registry.functions.graduatedAt(a.evm).call() != 0 or need == 0
    pid = _running(state)
    print(f"node      {a.evm}  ({'running, pid ' + str(pid) if pid else 'not running'})")
    print(f"registry  {'joined' if n[0] else 'not joined'}, stake {n[1] / 1e6:g} BERU, "
          f"{'busy in job ' + str(n[2]) + ' round ' + str(n[3]) if n[2] else 'idle'}")
    print(f"probation {'graduated' if graduated else 'on probation'} ({work} of {need} s verified work); "
          f"{'paid directly' if graduated else 'round pay goes to the community pool until then'}")
    print(f"earnings  {c.market.functions.claimable(a.evm).call() / 1e6} fUSD claimable "
          f"(community pool {c.market.functions.communityPool().call() / 1e6} fUSD)")
    try:
        beat = httpx.get(f"{coordinator}/v1/nodes", timeout=5).json()["nodes"].get(a.evm.lower())
        print(f"heartbeat {'%.0f s ago' % (time.time() - beat['seen']) if beat else 'none'} at {coordinator}")
    except httpx.HTTPError:
        print(f"heartbeat coordinator {coordinator} unreachable")


def stop(state: Path, timeout_s: float = 900) -> None:
    pid = _running(state)
    if pid is None:
        print("not running")
        return
    os.kill(pid, signal.SIGTERM)
    print(f"asked pid {pid} to stop; it finishes any reveal it owes first (up to one reveal window)")
    deadline = time.time() + timeout_s
    while _running(state) and time.time() < deadline:
        time.sleep(2)
    print("stopped" if not _running(state) else "still finishing; check `strongchar-node logs`")


def logs(path: Path, n: int, follow: bool) -> None:
    if not path.exists():
        raise SystemExit(f"no log yet at {path}")
    subprocess.run(["tail", f"-n{n}", *(["-f"] if follow else []), str(path)], check=False)


def claim(name: str) -> None:
    a = keystore.load(name)
    c = Contracts()
    amount = c.market.functions.claimable(a.evm).call()
    if amount == 0:
        print("nothing to claim yet")
        return
    w = WindowManager(c.chain, a.account, (c.dep.job_market,))
    r = c.send(a.account, c.market.functions.claim(), w)
    c.chain.close_window(a.account)
    print(f"claimed {amount / 1e6} fUSD: {r.txhash}")
