#!/usr/bin/env bash
# Prepares a strongChar VM: updates, Docker with log rotation, swap, unattended upgrades; gVisor when ROLE=verifiers.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
ROLE="${ROLE:-generic}"

apt-get update -q
apt-get -yq -o Dpkg::Options::=--force-confold upgrade
apt-get install -yq docker.io docker-compose-v2 unattended-upgrades ca-certificates curl gnupg

# 2 GB swap: these are 2 GB machines and Python processes spike during training.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "3"}, "live-restore": true}
JSON

if [ "$ROLE" = "verifiers" ]; then
  # gVisor gives untrusted competition scripts a user-space kernel instead of the host's.
  curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor --yes -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
    > /etc/apt/sources.list.d/gvisor.list
  apt-get update -q && apt-get install -yq runsc
  runsc install
fi

systemctl enable docker
systemctl restart docker
docker info --format '{{.ServerVersion}} runtimes={{json .Runtimes}}' | tr -d '\n'; echo
if [ "$ROLE" = "verifiers" ]; then
  docker run --rm --runtime=runsc --network none busybox:1.37 sh -c 'echo gvisor-ok; dmesg | head -1'
fi
free -m | head -3
echo "BOOTSTRAP_DONE role=$ROLE"
