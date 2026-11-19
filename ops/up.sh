#!/usr/bin/env bash
# Runs on a bootstrapped server (ops/bootstrap.sh) from a checkout of the repo: builds the service image (and the
# sandbox image on the verifiers server) and starts that server's compose file. Key files must already be in
# docker/secrets/, mode 600, owned by uid 10002 (ops/split_keys.py does this when run as root).
# Usage: ROLE=edge|nodes|verifiers API_HOST=32-237-26-58.sslip.io [WEB_ORIGIN=https://...] sudo -E ops/up.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ROLE:?ROLE must be edge, nodes or verifiers}" "${API_HOST:?API_HOST must be set}"

for f in docker/secrets/*.json; do
  [ "$(stat -c '%a %u' "$f")" = "600 10002" ] || { echo "$f must be mode 600 and owned by 10002" >&2; exit 1; }
done

docker build -f docker/app.Dockerfile -t strongchar-app:1 .
if [ "$ROLE" = verifiers ]; then
  docker build -f sandbox/Dockerfile -t strongchar-sandbox:1 sandbox
  mkdir -p /tmp/strongchar-runs && chmod 1777 /tmp/strongchar-runs
  export DOCKER_GID="$(getent group docker | cut -d: -f3)"
fi
export API_HOST WEB_ORIGIN="${WEB_ORIGIN:-}"
docker compose -f "docker/compose.$ROLE.yml" -p "strongchar-$ROLE" up -d
docker compose -f "docker/compose.$ROLE.yml" -p "strongchar-$ROLE" ps
