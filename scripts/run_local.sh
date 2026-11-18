#!/usr/bin/env bash
# Runs the coordinator, four nodes (node-4 cheats) and both verifiers locally against diana; logs in ./run-logs.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p run-logs
# Laptop runs: plain runc (gVisor is installed on the verifiers server only).
export STRONGCHAR_SANDBOX_RUNTIME="${STRONGCHAR_SANDBOX_RUNTIME:-runc}"
export STRONGCHAR_COORDINATOR="${STRONGCHAR_COORDINATOR:-http://127.0.0.1:8700}"
STRONGCHAR_DATA=./run-logs/coordinator-data uv run python -m strongchar_coordinator.main > run-logs/coordinator.log 2>&1 &
echo $! > run-logs/pids
sleep 6
for n in 1 2 3; do uv run strongchar-node --name node-$n > run-logs/node-$n.log 2>&1 & echo $! >> run-logs/pids; done
uv run strongchar-node --name node-4 --cheat > run-logs/node-4.log 2>&1 & echo $! >> run-logs/pids
for v in a b; do uv run strongchar-verifier --name verifier-$v > run-logs/verifier-$v.log 2>&1 & echo $! >> run-logs/pids; done
echo "started; stop with: kill \$(cat run-logs/pids)"
