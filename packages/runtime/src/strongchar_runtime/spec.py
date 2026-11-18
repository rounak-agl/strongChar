"""Job spec: canonical JSON whose keccak is the specHash the JobMarket stores; everything else derives from it."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from strongchar_core.blob import weights_hash
from strongchar_core.evidence import canonical
from strongchar_core.hashing import k256
from strongchar_workloads.mlp import MLPExact


@dataclass(frozen=True)
class JobSpec:
    raw: dict

    @property
    def hash(self) -> bytes:
        return k256(canonical(self.raw))

    @property
    def shards(self) -> list[tuple[int, int]]:
        return [tuple(s) for s in self.raw["shards"]]

    def workload(self) -> MLPExact:
        r = self.raw
        return MLPExact(r["d_in"], r["n_out"], hidden=r["hidden"], loss=r["loss"], lr=r["lr"])

    def initial_weights(self) -> np.ndarray:
        """Public and deterministic from the seed in the spec, so they need no sealing."""
        return self.workload().init(self.raw["initSeed"])

    def initial_weights_hash(self) -> bytes:
        return weights_hash(self.hash, self.initial_weights())


def make_spec(*, dataset_hash: str, d_in: int, n_out: int, task: str, shards: list[tuple[int, int]],
              val: tuple[int, int], rounds: int, hidden: int = 16, lr: str = "0.1", steps: int = 40,
              checkpoints: int = 4, batch_size: int = 32, init_seed: int = 0) -> JobSpec:
    return JobSpec({
        "version": 1, "workload": "mlp-exact/1", "datasetHash": dataset_hash, "task": task,
        "d_in": d_in, "n_out": n_out, "hidden": hidden, "loss": "ce" if task == "classification" else "mse", "lr": lr,
        "steps": steps, "checkpoints": checkpoints, "batch_size": batch_size, "initSeed": init_seed,
        "shards": [list(s) for s in shards], "val": list(val), "rounds": rounds,
        "gate": {"relTol": "0.1", "absTol": "0.01"},
    })
