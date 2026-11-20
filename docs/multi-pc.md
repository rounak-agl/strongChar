# Running strongChar across several computers

One machine runs the coordinator. It could be the edge server, or any PC the others can reach. The two verifiers
run anywhere that can reach the coordinator and the diana RPC. Every other computer can be a node, and any of them
can post jobs. Nodes talk only to the coordinator and the chain. They need no inbound ports.

## The coordinator

On the edge server, `ops/up.sh` starts it behind Caddy with TLS (`ROLE=edge`). For a quick test on a local
network, run it on one PC and listen on all interfaces:

```sh
STRONGCHAR_HOST=0.0.0.0 STRONGCHAR_ADMIN_TOKEN=$(openssl rand -hex 16) \
  uv run python -m strongchar_coordinator.main
```

Check it from another PC with `curl http://<host>:8700/v1/health`. If that hangs, open port 8700 in the host's
firewall. Plain HTTP is only for a network you trust: logins are signed with ML-DSA-87 and blobs are sealed, but
metadata travels in the clear.

## Each node computer

```sh
git clone https://github.com/rounak-agl/strongChar && cd strongChar
uv sync --package strongchar-node
export STRONGCHAR_COORDINATOR=http://<host>:8700     # or https://<edge hostname>
uv run strongchar-node init                         # prints the address to fund with ~2 testnet QOR
uv run strongchar-node setup                        # registers keys, takes BERU from the faucet, stakes, joins
uv run strongchar-node doctor                       # every check the coordinator makes before seating a node
uv run strongchar-node run                          # trains whenever it is seated
```

To follow and control the node:

- `strongchar-node status` shows its stake, probation progress, earnings and last heartbeat.
- `strongchar-node logs -f` follows its log.
- `strongchar-node claim` withdraws the fUSD it has earned.
- `strongchar-node stop` finishes any reveal the node owes, then exits. While it stops, its heartbeat tells the
  coordinator not to seat it, so it isn't penalised for a missed reveal.

## Posting a job

From any computer with an account that has registered its keys:

```sh
uv run strongchar-job quote data.csv --rounds 3 --shards 4     # the price; nothing is sent
uv run strongchar-job post  data.csv --rounds 3 --shards 4     # seals the data, funds the job and follows it
```

The last column of the CSV is the target. When the job finishes, `post` opens the final model, which is sealed to
the owner alone. It saves the model to `model.npy` and scores it on the holdout rows, which never left the machine.

## Operator controls

These need the coordinator's admin token in an `x-admin-token` header:

- `POST /v1/admin/jobs/{id}/pause` and `/resume` stop and restart the seating of new rounds for a job.
- `POST /v1/admin/nodes/{address}/rearm` lets a node benched for missed commits be seated again.

## Trying it on one computer

Docker can stand in for several computers. Give every container its own address on a private network, run the
coordinator in one container, and run each node in its own container with only its own key file:

```sh
docker build -f docker/app.Dockerfile -t strongchar-app:1 .
docker network create --subnet 172.30.0.0/24 strongchar-lan
docker run -d --name coordinator --network strongchar-lan --ip 172.30.0.2 -e STRONGCHAR_HOST=0.0.0.0 ... strongchar-app:1 \
  python -m strongchar_coordinator.main
docker run -d --name pc-1 --network strongchar-lan --ip 172.30.0.11 \
  -e STRONGCHAR_COORDINATOR=http://172.30.0.2:8700 -e STRONGCHAR_KEYSTORE=/keys/node.json \
  -v ./pc-1:/keys strongchar-app:1 strongchar-node run --name pc-1
```

The coordinator's log then shows each heartbeat and login arriving from a different address.
