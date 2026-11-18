"""Equal split of a round's fUSD budget over the nodes that earned it; the remainder goes to the lowest address."""

from __future__ import annotations

from collections.abc import Iterable

from .aggregate import by_address


def equal(budget: int, eligible: Iterable[str]) -> dict[str, int]:
    """Whole base units (6 decimals). An empty eligible set pays nobody and leaves the budget with the job."""
    nodes = by_address(eligible)
    if len(set(a.lower() for a in nodes)) != len(nodes):
        raise ValueError("duplicate address in the eligible set")
    if not nodes:
        return {}
    each, rest = divmod(budget, len(nodes))
    shares = dict.fromkeys(nodes, each)
    shares[nodes[0]] += rest
    check(budget, nodes, shares)
    return shares


def check(budget: int, eligible: Iterable[str], shares: dict[str, int]) -> None:
    """The money invariant the contract enforces; run it before signing anything."""
    allowed = set(eligible)
    if not set(shares) <= allowed:
        raise ValueError("payee outside the eligible set")
    if any(v < 0 for v in shares.values()):
        raise ValueError("negative payout")
    if shares and sum(shares.values()) != budget:
        raise ValueError("payouts must sum to the round budget")
