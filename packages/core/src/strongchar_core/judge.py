"""Exact replay judge: a node's committed weights must equal, bit for bit, what the verifier's replay produced."""

from enum import Enum

import numpy as np

from .blob import weights_hash


class Verdict(str, Enum):
    OK = "Ok"
    REPLAY_MISMATCH = "ReplayMismatch"
    DATA_UNAVAILABLE = "DataUnavailable"


def judge(spec_hash: bytes, replayed: np.ndarray | None, claimed_hash: bytes) -> Verdict:
    """The training kernel is bit-exact, so there is no tolerance band to argue about: equal hashes or a cheat."""
    if replayed is None:
        return Verdict.DATA_UNAVAILABLE
    return Verdict.OK if weights_hash(spec_hash, replayed) == claimed_hash else Verdict.REPLAY_MISMATCH
