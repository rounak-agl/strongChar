"""Run one untrusted competition script in a locked-down container and return a typed result.

Containment: no network, read-only root, non-root user, all capabilities dropped, no-new-privileges, pids, memory,
CPU, file-handle, /tmp and output caps, a wall-clock limit, and gVisor (runsc) on the verifiers server. The script
sees the public train set and the test features only; labels never enter the sandbox.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from .predictions import BadOutput, parse, prediction_hash

IMAGE = os.environ.get("STRONGCHAR_SANDBOX_IMAGE", "strongchar-sandbox:1")
RUNTIME = os.environ.get("STRONGCHAR_SANDBOX_RUNTIME", "runsc")  # "runc" only for local development
SEED = "20261118"


@dataclass(frozen=True)
class RunResult:
    ok: bool
    reason: str  # "Ok" or a rejection reason shown to the entrant
    detail: str
    runtime_s: float
    pred_hash: bytes | None
    predictions: list | None


def run_script(script: bytes, train_csv: bytes, test_features_csv: bytes, rows: int, task: str, classes: int | None,
               timeout_s: int = 600, memory: str = "2g") -> RunResult:
    work = Path(tempfile.mkdtemp(prefix="strongchar-run-"))
    try:
        (work / "data").mkdir()
        (work / "out").mkdir()
        (work / "data" / "train.csv").write_bytes(train_csv)
        (work / "data" / "test_features.csv").write_bytes(test_features_csv)
        (work / "solution.py").write_bytes(script)
        os.chmod(work / "out", 0o777)  # the sandbox user (uid 10001) writes only here
        cmd = ["docker", "run", "--rm", f"--runtime={RUNTIME}", "--network=none", "--read-only",
               "--tmpfs=/tmp:size=256m", "--cpus=1", f"--memory={memory}", "--memory-swap", memory,
               "--pids-limit=128", "--ulimit", "nofile=256:256", "--cap-drop=ALL",
               "--security-opt=no-new-privileges", "--user=10001:10001",
               "-e", f"STRONGCHAR_SEED={SEED}", "-e", "PYTHONHASHSEED=0",
               "-v", f"{work / 'data'}:/data:ro", "-v", f"{work / 'solution.py'}:/work/solution.py:ro",
               "-v", f"{work / 'out'}:/out", IMAGE, "python", "/work/solution.py"]
        start = time.monotonic()
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=timeout_s + 30)
        except subprocess.TimeoutExpired:
            return RunResult(False, "Timeout", f"over {timeout_s}s", time.monotonic() - start, None, None)
        took = time.monotonic() - start
        if took > timeout_s:
            return RunResult(False, "Timeout", f"over {timeout_s}s", took, None, None)
        if proc.returncode == 137:
            return RunResult(False, "OOM", f"killed at the {memory} memory cap", took, None, None)
        if proc.returncode != 0:
            last = proc.stderr.decode(errors="replace").strip().splitlines()[-1:] or [""]
            return RunResult(False, "Crash", f"exit {proc.returncode}: {last[0][:200]}", took, None, None)
        out = work / "out" / "predictions.csv"
        if not out.exists():
            return RunResult(False, "BadOutputShape", "no /out/predictions.csv written", took, None, None)
        try:
            preds = parse(out.read_bytes()[: 20 * 2**20 + 1], rows, task, classes)
        except BadOutput as e:
            return RunResult(False, e.reason, e.detail, took, None, None)
        return RunResult(True, "Ok", "", took, prediction_hash(preds), preds)
    finally:
        shutil.rmtree(work, ignore_errors=True)
