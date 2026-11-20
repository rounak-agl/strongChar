"""Splits a round's fUSD budget equally over the nodes that earned it, plus the community-pool drip.

Nodes on probation are listed with their equal share like everyone else; the contract sends that share to the
community pool instead of to them. Graduated nodes also split the round's drip. Remainders go to the lowest address.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from .aggregate import by_address


def _even(amount: int, addrs: list[str]) -> dict[str, int]:
    if not addrs:
        return {}
    each, rest = divmod(amount, len(addrs))
    shares = dict.fromkeys(addrs, each)
    shares[addrs[0]] += rest
    return shares


def equal(budget: int, eligible: Iterable[str], graduated: Mapping[str, bool] | None = None,
          drip: int = 0) -> dict[str, int]:
    """Whole base units (6 decimals). An empty eligible set pays nobody and leaves the budget with the job.

    graduated: node -> finished probation before the round opened (None means everyone has).
    drip: the fUSD the contract set aside from the pool when the round opened; paid only if someone graduated.
    """
    nodes = by_address(eligible)
    if len(set(a.lower() for a in nodes)) != len(nodes):
        raise ValueError("duplicate address in the eligible set")
    if not nodes:
        return {}
    grads = [n for n in nodes if graduated is None or graduated[n]]
    used = drip if grads else 0
    shares = _even(budget, nodes)
    for n, extra in _even(used, grads).items():
        shares[n] += extra
    check(budget + used, nodes, shares)
    return shares


def drip_paid(eligible: Iterable[str], graduated: Mapping[str, bool] | None, drip: int) -> int:
    """How much of the round's drip the payouts carry (all of it if any payee graduated, else none)."""
    nodes = list(eligible)
    return drip if nodes and (graduated is None or any(graduated[n] for n in nodes)) else 0


def check(total: int, eligible: Iterable[str], shares: dict[str, int]) -> None:
    """The money invariant the contract enforces; run it before signing anything."""
    allowed = set(eligible)
    if not set(shares) <= allowed:
        raise ValueError("payee outside the eligible set")
    if any(v < 0 for v in shares.values()):
        raise ValueError("negative payout")
    if shares and sum(shares.values()) != total:
        raise ValueError("payouts must sum to the round budget plus the drip paid")
