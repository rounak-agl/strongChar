"""Counts the float ops one round costs and prices them in fUSD at the job's own rate."""

from __future__ import annotations


def step_ops(batch_size: int, d_in: int, hidden: int, n_out: int, loss: str = "ce") -> int:
    """Adds, multiplies and divides in one mlp-exact step (the uint8 → float scaling is left out, about 0.2%)."""
    params = d_in * hidden + hidden + hidden * n_out + n_out
    b = batch_size
    return 4 * b * d_in * hidden + 6 * b * hidden * n_out + 2 * b * hidden + (37 if loss == "ce" else 4) * b * n_out + 2 * params


def round_ops(steps: int, batch_size: int, d_in: int, hidden: int, n_out: int, loss: str = "ce") -> int:
    return steps * step_ops(batch_size, d_in, hidden, n_out, loss)


def job_budget(ops_per_round: int, rounds: int, nodes: int, units_per_gop: int) -> int:
    """fUSD base units (6 decimals) for the whole job, rounded down; units_per_gop is the job's price."""
    return rounds * nodes * ops_per_round * units_per_gop // 10**9
