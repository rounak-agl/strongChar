# strongChar: architecture

Status: v2 after the red-team review, 18 Nov 2026. Items marked **[verify]** depend on an open question in MEMORY.md and are settled by the Phase 0 spikes.

## 1. System map

```
                         ┌────────────────────────── QoreChain testnet qorechain-diana ───────────────────────────┐
                         │ Native lane (hybrid secp256k1 + ML-DSA-87,      │ EVM lane (chain 9800, Prague rules)   │
                         │ hybrid mode "required", no classical fallback)  │                                       │
                         │  • PQC key registry (ML-DSA-87, PoP)            │  • BeruToken (ERC-20) + BeruFaucet    │
                         │  • QoreSeal KEM key registry (ML-KEM-1024)      │  • NodeRegistry                       │
                         │  • EVM windows (MsgOpenEVMWindow, scoped)       │  • JobMarket  ──► pqcVerify 0x…0a01   │
                         │  • Native AMM (MsgCreatePool / SwapExactIn)     │  • Competitions ─► pqcKeyStatus 0x…0a02│
                         └───────────────▲──────────────────────────────────────────▲──────────────────────────┘
                                         │ qorsdk + qoresign (Python)               │ web3.py / viem (inside a window)
   ┌─────────────────────────────────────┴──────────────┐   ┌───────────────────────┴────────────────────────────┐
   │ Edge VM (public, t4g.small)                        │   │ Worker VMs (private, 2 × t4g.small, no inbound)    │
   │  Caddy (TLS)  →  coordinator (FastAPI + SQLite)    │◄──┤  verifier-a, verifier-b                            │
   │  ciphertext blob store, scheduler, indexer, API    │   │  node-1..3 (honest), node-4 (cheat)                │
   │  holds NO decryption key; only its own tx key      │   │  sandbox runner (gVisor) for competition scripts   │
   └─────────────────────────────▲──────────────────────┘   │  outbound HTTPS only; each service its own secrets │
                                 │ HTTPS (REST, ciphertext)  └────────────────────────────────────────────────────┘
   ┌─────────────────────────────┴───────────────────────────────────────────┐
   │ Web app (Next.js on Vercel)                                             │
   │  QoreX + SIWQ, key setup, EVM window, client-side seal/open (QoreSeal) │
   │  jobs, rounds, competitions, open final model in the browser           │
   │  falls back to reading the chain directly when the API is down         │
   └─────────────────────────────────────────────────────────────────────────┘
```

Trust boundaries:
- **Edge VM** is internet-facing and holds only ciphertext and the coordinator's transaction key. Taking it over yields no plaintext.
- **Worker VM** holds the node and verifier keys, so it is where plaintext exists. It accepts no inbound connections.
- **Browser** holds the data owner's, host's and entrant's keys. Plaintext datasets and the final model exist only there.
- In the demo the team runs both verifiers on one worker VM. The protocol supports independent operators; the README says the demo shares a host.

## 2. Repository layout

```
.
├── apps/
│   ├── web/                 Next.js app (pnpm)
│   ├── node/                strongchar-node CLI (Python)
│   └── verifier/            strongchar-verifier CLI (Python)
├── services/
│   ├── coordinator/         FastAPI REST API, blob store, scheduler, indexer
│   └── sandbox-runner/      the only service allowed to start sandbox containers
├── packages/
│   ├── core/                strongchar_core: encodings, hashing, blob, aggregate, judge, finalize, settle, ledger
│   ├── workloads/           strongchar_workloads: exact kernel, exact MLP, round runner, demo
│   ├── datasets/            strongchar_datasets: canonicalise, split, shard, presets (MNIST, sensitive CSV)
│   ├── qore/                strongchar_qore: one wrapper over qorsdk, qoresign, qoreseal (keys, windows, seal/open, PQ sign)
│   ├── compete/             strongchar_compete: sandbox client, output schema, metrics, score table
│   └── abi/                 generated ABIs shared by Python and web
├── contracts/               Foundry: src/, test/, script/
├── sandbox/                 Dockerfile for the pinned competition image + lockfile
├── docker/                  compose.edge.yml, compose.worker.yml, compose.dev.yml, Caddyfile
├── networks/                diana.toml, local.toml
├── vectors/                 kernel and encoding test vectors, job spec schema
├── scripts/                 deploy, fund, seed, demo drivers, leak check
├── docs/
│   ├── plan/                PRD, ARCHITECTURE, DESIGN, PHASES, RULES, MEMORY
│   └── how-it-works.md
├── README.md  THREAT_MODEL.md  AI_USAGE.md  LICENSE  CLAUDE.md
```

Gitignored: `.env*`, `.private/`, `research_notes/`, `reports/`, `CLAUDE.local.md`, `.venv/`, `node_modules/`, `contracts/out`, `contracts/cache`, coordinator data.

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| Python | 3.12, uv workspace, lockfile committed | The exact kernel, merge, judge and dataset code are Python with deep tests |
| QoreChain (Python) | `qorechain-sdk` 0.14 (`qorsdk`), `qorechain-qoresign` 0.2, `qorechain-qoreseal` 0.1, `qorechain-pqc` 0.2.3, pinned exactly | Official and byte-compatible with the TS packages; 0.x versions can break, so pins are exact. Listed in pyproject so the platform marks the kits Verified |
| EVM (Python) | web3.py + eth-account | Contract calls inside an open window |
| API | FastAPI + uvicorn, SQLite | Small and enough for one coordinator |
| Contracts | Solidity, Foundry, OpenZeppelin, `evm_version = "cancun"` | Chain runs Prague rules (Cancun is a safe subset). Compiler settings kept in the repo because the explorer can't verify source |
| Web | Next.js 16, React 19, TanStack Query, Tailwind 4, viem | |
| QoreChain (web) | `@qorechain/sdk`, `@qorechain/react`, `@qorechain/evm`, `@qorechain/qorex-rainbowkit`, `@qorechain/qorex-wallet-mock` (tests), `@qorechain/qoreseal`, `@qorechain/qoresign` | Client-side seal and open, SIWQ, windows; kit credit in package.json |
| Sandbox | Docker with gVisor (`runsc`), pinned `python:3.12-slim` digest + locked numpy, pandas, scikit-learn | Deterministic CPU runs for untrusted scripts with a kernel boundary |
| Hosting | Vercel (web). AWS ap-southeast-2: three `t4g.small` (2 GB + 2 GB swap), arm64, Ubuntu 24.04: edge, verifiers, nodes | Splits the ciphertext-only edge from key-holding workers, and verifiers from nodes. The Free plan only allows free-tier types. About $59 of the $100 credits to 16 Dec |

## 4. Identities and keys

Every actor (data owner, host, entrant, coordinator, verifier-a, verifier-b, node-1..4) has one QoreChain account derived from its own mnemonic:

| Key | Algorithm | Registered via | Used for |
|---|---|---|---|
| Classical | secp256k1 | — | Native tx (hybrid half), EVM tx (inside window) |
| PQ identity | ML-DSA-87 | PQC key registration with proof of possession | Native tx (hybrid half), signing verdicts, settlements, validity, scores |
| Seal key | ML-KEM-1024 (+ X25519 in hybrid mode) | `MsgRegisterKEMKey` | Receiving sealed shards, weights, scripts, test sets |

**Key binding [verify Q5].** The KEM key must be provably owned by the ML-DSA identity. Plan: register the KEM key from the same hybrid-signed account and use QoreSeal recipient cards (`verify_recipient_card`). Senders only seal to a KEM key whose card is signed by a possession-proven ML-DSA key. The browser and the CLIs refuse to seal to a recipient that fails this check.

**Browser KEM key custody [verify Q16].** If QoreX manages QoreSeal keys and can open envelopes, the web app uses that. Otherwise the browser generates the ML-KEM key, stores it encrypted with a passphrase in IndexedDB, and makes the user download an encrypted backup before registering it. Losing it means losing access to sealed results, and the UI says so.

**Server secrets.** Each service gets only its own mnemonic, in its own file (mode 600), loaded from AWS SSM Parameter Store (SecureString) at start. The deployer mnemonic never reaches either VM. All mnemonics are also backed up offline by Rounak.

**Browser signatures.** QoreX `signArbitrary` signs a prefixed message, so browser ML-DSA signatures are only used for login (SIWQ). Every signature a contract checks with `pqcVerify` comes from a verifier's Python key.

## 5. EVM windows

Every EVM transaction needs an open window, because every actor has a registered ML-DSA key (confirmed in the event FAQ). Windows are opened with a hybrid-signed `MsgOpenEVMWindow`:

| Actor | allowedTargets | Max value | Max txs | Blocks |
|---|---|---|---|---|
| Data owner / host / entrant (browser) | BeruToken, JobMarket, Competitions | 0 native (BERU moves by ERC-20 calls) | 10 | about 1 hour |
| Coordinator | JobMarket, Competitions | 0 | per round | rolling |
| Verifiers | JobMarket, Competitions | 0 | per round | rolling |
| Nodes | BeruToken, NodeRegistry, JobMarket | 0 | per round | rolling |

Rules:
- Native value caps are in `aqor` (18 decimals, the EVM's unit), not `uqor` (6 decimals, the bank's unit). Every window above caps native value at 0 because all payments are in BERU.
- Before each EVM transaction the sender checks its window (`fetchEvmWindow`). If fewer than 20 blocks or 2 txs remain, it renews first. A test lets a window lapse mid-round and checks the round still completes.
- Windows are closed when an actor goes idle. A stolen classical key alone can open nothing (hybrid signing is required) and can only spend inside an open window's targets.
- Fallback if windows prove unworkable for services: agent keys with spending rules (`MsgExecuteEVM`, no window, re-link every 30 days).

## 6. Contracts (EVM, chain 9800)

| Contract | Responsibility | Notes |
|---|---|---|
| `BeruToken` | Capped ERC-20 Beru (BERU, 6 decimals) for stakes, budgets and prizes | |
| `BeruFaucet` | Capped drip per address per day, total cap | |
| `NodeRegistry` | Operator stake, join, exit | Joining requires `pqcKeyStatus(op).registered && possessionProven` |
| `JobMarket` | Jobs, rounds, commits, reveals, verdicts, settlement, slashing, claims, refunds | Verifier pair fixed at deploy (immutable, no admin setter). `finalizeRound` is callable by anyone holding both valid verifier signatures, so the coordinator is a convenience, not a trust point |
| `Competitions` | Create, submit, validity, scores, label reveal, settle, refunds | Section 9 |
| `PQ` library | Wraps both precompiles, decodes all four `pqcKeyStatus` outputs, reverts on empty return | |

**PQ-signed message format.** `msg = abi.encode(DOMAIN, chainid, address(this), kind, payloadHash, expiry)`. `kind` is `VERDICT`, `SETTLEMENT`, `VALIDITY` or `SCORES`. `payloadHash` always includes the job or competition id and the round or entry id, so a signature can't be replayed elsewhere. `expiry` is a block number after which the contract rejects it. **[verify Q1]** whether `pqcVerify` takes raw bytes or a digest and whether a context string is applied; tested free of charge with `eth_call` in spike S2, and the Python signer is matched to it.

**Commitments.** `commit = keccak256(abi.encode(node, jobId, round, weightsHash, salt))`, so one node can't copy another's commitment.

**Randomness.** `prevrandao` is always 0 on this chain and is never used. Round seeds are `blockhash` of the first block after the commit deadline (the chain serves 8,192 blocks of history). In the demo the team runs every node, so block-producer bias doesn't matter; THREAT_MODEL.md notes it for open networks.

**Money paths that can't get stuck.**
- A job that can't seat a quorum, or stalls past its deadline, refunds the unspent budget to the owner.
- A competition with no valid entries refunds the prize to the host.
- If the host doesn't reveal labels by the reveal deadline, either verifier may reveal them (both hold the sealed labels and salt).
- Stakes of honest nodes are always withdrawable after exit.

**Gas.** About 112.5 gwei gas price. `pqcVerify` costs about 85–90k gas (≈0.01 QOR); a settlement with two signatures about 0.05 QOR. Signatures are 4,627 bytes of calldata. Measured in Phase 1 and shown in the README.

## 7. Training job data flow

```
Browser (owner)                 Coordinator (edge)       Node i (worker)        Verifier a / b (worker)   Chain
───────────────                 ──────────────────       ───────────────        ───────────────────────   ─────
canonicalise CSV/MNIST
shard; seal shard i to
{node i, ver a, ver b};
seal val split to {a, b}
upload ciphertext ───────────►  store blobs (ct only)
createJob + fund (window) ───────────────────────────────────────────────────────────────────────────►  JobCreated
                                openRound ───────────────────────────────────────────────────────────►  RoundOpened
                                                         fetch ct (signed req)
                                                         open shard
                                                         exact-train K steps
                                                         commit ─────────────────────────────────────►  Committed
                                                         reveal; seal weights
                                                         to {a, b}, upload ──►  store ct
                                                                                open shard + weights
                                                                                exact replay, judge
                                                                                merge + gate (both)
                                                                                ML-DSA sign verdict ──►  pqcVerify ✓
                                                                                ML-DSA sign settlement►  pqcVerify ✓ ×2
                                                                                seal new global weights
                                                                                to next round's set ──►  store ct
                                                                                                         Settled / Slashed
last round: global weights sealed to {owner}
open in the browser, evaluate on the owner's held-out split
```

Design decisions:
- **D1. The coordinator never decrypts.** Merge and gate run on both verifiers, which must produce identical merged bytes (the merge is deterministic). The coordinator schedules, stores ciphertext and relays.
- **D2. One envelope per shard, multi-recipient.** QoreSeal multi-recipient envelopes to exactly {node, verifier a, verifier b}. Group epoch keys (`EpochKeyManager`) for per-round global weights shared by many recipients. AAD binds `chainId | contract | jobId | round | shardIdx | kind | recipientSetHash`.
- **D3. Commitments are over plaintext hashes, storage is ciphertext.** The chain stores the ciphertext hash next to each commitment so the UI can show "this ciphertext ↔ this commitment".
- **D4. Cheating node.** node-4 skips training and returns nudged weights; caught as `ReplayMismatch`, reported by both verifiers, slashed at settlement.

## 7a. Coordinator responsibilities (lean)

The coordinator is a keeper and a switchboard. It never holds a decryption key and never merges.

| Job | Detail |
|---|---|
| Chain indexer | Rebuild job, round, node and competition state from contract events each tick; restart from the deploy block on a partial sync failure |
| Fleet tracking | Heartbeats from nodes: version, arch, cores, RAM, busy flag, per-workload self-test, benchmark seconds |
| Scheduling | Pick each round's roster and shards (below), best-paying job first, one job per node at a time |
| Round keeper | Send `openRound`; after the reveal window report non-revealers and void rounds under quorum; trigger refunds on stalled jobs |
| Signature relay | Collect both verifiers' ML-DSA signatures and send `finalizeRound` (anyone else can too) |
| Blob store | Section 8 rules |
| Job and competition drafts | Validate specs, store them, return the hash the contract commits to |
| Read API | Everything the web app shows |
| Admin | Pause and resume scheduling, re-arm a benched node. No power over funds |
| Windows | Open and renew scoped EVM windows for its own account |

### Node selection (benchmark-ranked)

A node is eligible for a job's next round when it is joined, staked at least `stakePerNode`, heartbeated in the last 60 s, not busy, passing the workload's self-test, not benched (2 missed commits in a row), has a possession-proven ML-DSA key and a bound KEM key, and its benchmark is under the speed floor. Eligible nodes are ranked by benchmark (fastest first), then longest-idle, then a seed-derived tiebreak; one seat per owner; shards used longest ago go first. The benchmark is a fixed exact-kernel training run of known size, timed by the node and spot-checked by the verifiers against the round's actual commit time. The floor is set from measurements (Q15). When a job can't seat a quorum, the API reports how many nodes were blocked and why. Cut line: plain eligibility plus longest-idle (PRD 5.5).

## 8. Coordinator API

```
POST /v1/auth/siwq                    SIWQ login (web) → short-lived bearer token (15 min, refresh by re-signing)
POST /v1/auth/service                 node/verifier login: ML-DSA-signed challenge → bearer token
GET  /v1/keys/{address}               PQ key, KEM key, card, window status (proxy of chain REST)
POST /v1/blobs                        upload ciphertext (rules below)
GET  /v1/blobs/{hash}                 fetch ciphertext (rules below)
POST /v1/jobs/draft                   validate job spec
GET  /v1/jobs, /v1/jobs/{id}, /v1/jobs/{id}/rounds/{r}
GET  /v1/nodes, /v1/nodes/{op}
POST /v1/competitions/draft
GET  /v1/competitions, /v1/competitions/{id}
POST /v1/competitions/{id}/entries    sealed script upload, returns entry id
GET  /v1/competitions/{id}/entries/{e}   validity status from both verifiers
GET  /v1/sealed                       everything stored, as ciphertext hashes next to on-chain commitments
GET  /v1/health
```

Hardening:
- **Uploads.** Require a bearer token. The body must parse as a QoreSeal envelope (header, recipients, AAD), not just start with `qoreseal:`. Blobs are content-addressed (id = hash). Size caps per kind (shard, weights, script, test set). Per-account quota and rate limit. An upload that no draft or on-chain record references within 1 hour is deleted.
- **Fetches.** Only a recipient listed in the envelope, holding a service token, can fetch shards, weights, scripts and test sets. Public items (competition train sets, published predictions after reveal) are open.
- **Auth.** Users pay for their own transactions through their own windows; the coordinator never sends a transaction on a user's behalf, so the API can't be used to drain it.
- **Web.** CORS allows only the Vercel origin. Strict Content-Security-Policy. React rendering only, no raw HTML from user text. Request bodies size-limited. Logs never include bodies.

## 9. Competitions (Kaggle-style, verified)

Lifecycle and roles:

| Step | Who | Off-chain | On-chain |
|---|---|---|---|
| 1. Create | Host (browser) | Public train set uploaded in clear; hidden test features + labels sealed to {verifier a, b}; labels committed `keccak256(keccak256(labels), salt)` | `create(meta, metric, labelCommit, prize, deadline, revealDeadline, maxEntries)` locks the prize |
| 2. Submit | Entrant (browser) | Script sealed to {a, b}, uploaded | `submit(id, scriptCtHash, scriptHash)`, at most `maxEntries` per entrant |
| 3. Validate | Verifiers a and b | Each opens the script and test features, runs the sandbox, checks exit code, output schema and range, records `predHash` | Both post ML-DSA-signed `validity(entry, ok, predHash)`; valid only if both say ok and the hashes match |
| 4. Score | Verifiers, after the deadline | Each computes the metric for every valid entry on the hidden labels and builds the same score table, including each entry's `predHash` | Both post the ML-DSA-signed score table; `pqcVerify` ×2 |
| 5. Reveal | Host, or either verifier after `revealDeadline` | Predictions of valid entries published as clear blobs | `revealLabels(labels, salt)` checked against the commitment |
| 6. Settle | Anyone | — | Pays the top-ranked valid entry; ties go to the earlier submission; no valid entries refunds the host |

Sandbox (what "honest script" means):
- Verifiers never touch Docker. They ask the **sandbox runner** to run a script; it is the only service with the Docker socket, and it accepts only requests signed by a verifier.
- Runtime: gVisor (`runsc`), `--network none`, read-only root, `--tmpfs /tmp:size=256m`, `--cpus 1`, `--memory 2g`, `--pids-limit 128`, `--ulimit nofile=256`, `--cap-drop ALL`, `--security-opt no-new-privileges`, default seccomp, non-root user, wall-clock cap (default 10 min), output capped at 20 MB.
- Environment: `PYTHONHASHSEED=0`, `OMP_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1`, `MKL_NUM_THREADS=1`, seed in `STRONGCHAR_SEED`.
- Input mounted read-only at `/data`: `train.csv` (public), `test_features.csv` (decrypted by the verifier, never the labels). Each run gets only its own script and a fresh `/tmp`.
- Output: `/out/predictions.csv`, parsed with a strict CSV reader (no eval), exactly one row per test item, correct type and class range.
- Rejection reasons shown to the entrant: `Timeout`, `Crash`, `OOM`, `BadOutputShape`, `BadOutputRange`, `OutputTooLarge`, `NondeterministicOutput` (hashes differ between verifiers), `ImageMismatch`.
- Image pinned by digest; the digest and the CPU architecture (arm64) are part of the competition record so anyone can rerun on the same architecture **[verify Q14]**.
- Known limit: an entrant learns one bit per entry (valid or not), which a script could tie to hidden test features. The per-entrant entry cap bounds it; THREAT_MODEL.md documents it.

Metrics: accuracy, macro-F1, RMSE, ROC-AUC, all in `strongchar_compete.metrics`, with fixed-order float64 sums so both verifiers get identical numbers. Scores go on-chain as integers (×1e6). Cut line: accuracy and RMSE only.

## 10. Deployment

- **Edge VM** (`t4g.small`, arm64, Elastic IP): `docker compose -f docker/compose.edge.yml up -d` runs the coordinator and Caddy. Security group opens 80 and 443 only. API hostname `<elastic-ip-with-dashes>.sslip.io`, so Caddy gets a Let's Encrypt certificate without a bought domain.
- **Verifiers VM** (`t4g.small`, arm64): `docker compose -f docker/compose.verifiers.yml up -d` runs verifier-a, verifier-b and the sandbox runner with gVisor (runsc installed by `ops/bootstrap.sh`).
- **Nodes VM** (`t4g.small`, arm64): `docker compose -f docker/compose.nodes.yml up -d` runs node-1..4.
- Both worker VMs share a security group with no inbound rules; they talk to the edge over HTTPS and to the chain RPC. Every VM enforces IMDSv2 with hop limit 1, so containers can't reach instance credentials.
- **Access:** no SSH port; AWS Systems Manager Session Manager only.
- **Resilience:** Docker restart policies, log rotation, health checks; CloudWatch status-check alarms with automatic instance recovery; AWS Budgets alerts at $70 and $85.
- **Web:** Vercel, env `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CHAIN=diana`, contract addresses from `packages/abi`. When the API is unreachable, pages read state from the chain directly.
- **Chain config:** `networks/diana.toml` holds RPC, REST, EVM RPC, chain IDs, contract addresses, deploy block, window policy, round windows.
- **Secrets:** section 4.

## 11. Testing

| Layer | Tooling | Must cover |
|---|---|---|
| Python core | pytest | Kernel vectors, merge determinism, judge, finalize, metrics determinism |
| QoreChain wrapper | pytest against testnet (marked `live`) + offline vectors | Seal/open round trip Python↔TS, hybrid sign, PQ message signing, AAD binding rejects a swapped job or recipient set |
| Contracts | Foundry | `pqcVerify` path with a mocked precompile (`vm.etch`) + one fork test against diana; unproven key rejected; forged, replayed and expired signatures rejected; copied commitment rejected; slashing; refunds; label reveal by verifier after the deadline; anyone can finalize with two valid signatures |
| Windows | pytest `live` | A window lapses mid-round and the round still completes |
| Sandbox | pytest + Docker | Each rejection reason; determinism across two runs; network, fork-bomb, disk-fill and large-output scripts all contained |
| API | pytest | Upload rejects non-envelopes, oversized and unauthenticated bodies; fetch rejects non-recipients; CORS |
| Ciphertext-only | pytest | Edge DB, blob dir and logs contain no plaintext markers after a full local round |
| Web | typecheck, Playwright smoke run with the QoreX mock wallet | Sign-in, key setup, post job, submit entry |
| E2E | scripts/demo_diana.py | Full job + competition on testnet, prints all tx hashes |
| Self-scan | httpx, nuclei, ffuf against our own edge host only (Phase 6) | No exposed admin routes, debug pages or default files; TLS correct |
