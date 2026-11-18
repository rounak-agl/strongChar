# strongChar: phases

Status: v2 after the red-team review, 18 Nov 2026. Solo, 8+ hours a day. All times UTC.
Real deadline: **1 Dec 23:59**. Platform freeze: 2 Dec 23:59. Workshops: **20 Nov 16:30** (QoreSeal, cross-VM, second-half challenges) and **27 Nov** (submission clinic).

Each phase ends with an exit check. A phase isn't done until its exit check passes and MEMORY.md is updated. Commit small and often, every working day (RULES section 1).

## Overview

| Phase | Dates | Goal |
|---|---|---|
| 0. Foundations and spikes | 19–20 Nov | Repo scaffolding, keys, funding, VMs, answer the remaining scope-changing questions |
| 1. Core and contracts | 20–22 Nov | Python core green under strongChar names; contracts with PQ checks, tested and deployed to diana |
| 2. Sealed training on testnet | 22–25 Nov | Full job with sealing, PQ verdicts, windows and a slashed cheater, end to end on diana |
| 3. Competitions | 25–27 Nov | Script submission, sandbox validation, signed scores, label reveal, settle |
| 4. Web app | 25–28 Nov | Every MVP flow clickable on live testnet data |
| 5. Side entry | 28–29 Nov | Q-Day exposure checker shipped as its own project |
| 6. Ship | 29 Nov–1 Dec | VMs + Vercel live, docs, video, cover, platform checks all Verified |
| — | 2–16 Dec | Freeze, keep backend up for judging, answer jury requests within 48 h |

Phases 3 and 4 overlap on purpose: backend competition work in the mornings, UI in the afternoons. If behind, cut in the order of PRD 5.5 (MEMORY D23).

## Phase 0. Foundations and spikes (19–20 Nov)

Done on 18 Nov
- [x] P0.1a Git repo, `.gitignore`, LICENSE, README stub, leak check.
- [x] P0.2 Public GitHub repo, project page (Encrypted Apps, AI-Native, Quantum Campus, Regional), QoreChain Build GitHub App on the repo.
- [x] P0.6a AWS project on the free plan ($100 credits), Region ap-southeast-2, CLI signed in locally.

Tasks
- [x] P0.1 Empty uv and pnpm workspaces matching ARCHITECTURE section 2; Foundry installed; CI skeleton (pytest, forge test, web typecheck).
- [x] P0.3 (18 Nov: 11 keys; deployer funded with 40 QOR by Rounak; 2.5 QOR sent to each actor) Generate mnemonics for the deployer and the 9 service accounts (printed once for Rounak's offline backup, stored locally outside the repo, never committed). Rounak sends about 40 QOR and 200 fUSD from QoreX to the deployer; the deployer funds the rest.
- [x] P0.4 Register ML-DSA-87 keys with proof of possession for every actor, then KEM keys (both done 18 Nov for all 11).
- [ ] P0.5 Ship Weeks badges from listed addresses: first hybrid tx, first native AMM swap (pool 2 is fine), first QoreSeal key, first contract containing a PQC precompile address.
- [x] P0.6 AWS (18 Nov): three `t4g.small` arm64 Ubuntu 24.04 VMs (edge with Elastic IP and ports 80/443; verifiers and nodes with no inbound), 20 GB encrypted gp3, IMDSv2 hop 1, termination protection, Session Manager only, Docker + log rotation + 2 GB swap, gVisor on verifiers, CloudWatch auto-recovery. Budget alerts pending an email address from Rounak.
- [x] P0.7 `AI_USAGE.md` started as a running log; README credits section started.
- [ ] P0.8 Add the 5 listed addresses (MEMORY D32) to the project page.

Spikes (each writes its answer into MEMORY.md)
- [x] S1 **Windows:** open a scoped window, send an EVM tx inside it, let it lapse, confirm the tx is refused, renew. Measure how many blocks an hour is.
- [x] S2 **pqcVerify format (Q1):** sign a message with ML-DSA-87 in Python and call `pqcVerify` through `eth_call` (free) with raw bytes, a keccak digest and with any context string, until one returns true. Then one real tx to measure gas.
- [~] S3 **QoreSeal (Q5, Q16):** (Python side done 18 Nov; TS round trip and Q16 pending) Python seal → TS open and TS seal → Python open, multi-recipient, with AAD; register a KEM key; check recipient cards against the ML-DSA key; find out whether QoreX can hold a KEM key and open envelopes for a dApp.
- [x] S4 **BERU in the AMM (Q3):** (no: not registrable, pools cost 100 QOR) deploy a test ERC-20 and check whether it appears as an `erc20:0x…` bank coin and can seed a pool. If not, use pool 2 per PRD T2.
- [ ] S5 **Sandbox determinism (Q14):** run one sklearn script twice on the worker VM (arm64) and on the laptop (x86); hashes must match within each machine. Record whether they match across.

Exit check: all five spikes answered; every actor has a possession-proven ML-DSA key and a registered KEM key; both VMs reachable; four Ship Weeks badges green.

Cut line: if S2 fails outright (no format verifies), ask in Discord #builders before Phase 1 contract work; meanwhile continue Phase 1 Python work.

## Phase 1. Core and contracts (20–22 Nov)

Attend the workshop on 20 Nov 16:30 and fold anything new into Phases 1–2.

Tasks
- [ ] P1.1 Core, workloads and datasets packages under `strongchar_*` names; anything out of scope (PRD 5.4) left out. Kernel vectors match. Landed in several small commits.
- [ ] P1.2 Sensitive tabular dataset preset (synthetic, generated by a committed script with a fixed seed, so no real personal data exists).
- [ ] P1.3 `packages/qore`: client creation, hybrid tx build/sign/broadcast, PQ key registration, KEM key registration, window open/check/renew/close, seal/open (single, multi-recipient, epoch), ML-DSA message signing in the format found by S2.
- [ ] P1.4 Contracts: BeruToken, BeruFaucet, NodeRegistry, JobMarket with the `PQ` library; immutable verifier pair; permissionless finalize; refunds; Foundry tests for forged, replayed and expired signatures, unproven and missing keys, copied commitments, slashing, claims and refunds. Mocked precompile via `vm.etch` plus one diana fork test.
- [ ] P1.5 Deploy script driven by `networks/diana.toml`; deploy to diana; ABIs exported to `packages/abi`.

Exit check: `uv run pytest` and `forge test` green; contracts live on diana with addresses in `networks/diana.toml`; the PQ-verification gas figure recorded.

## Phase 2. Sealed training on testnet (22–25 Nov)

Tasks
- [ ] P2.1 Coordinator: hardened blob store (ARCHITECTURE section 8), job drafts, scheduler, chain indexer, REST API, service and SIWQ auth.
- [ ] P2.2 Node: fetch → open shard → exact train → commit → reveal → seal weights to {a, b} → upload. Cheat mode for node-4.
- [ ] P2.3 Verifier: open → replay → judge → merge and gate → sign verdict and settlement with ML-DSA → submit → seal new global weights to next recipients (final round: owner only).
- [ ] P2.4 Windows: every service checks and renews its window before each EVM tx; lapse test.
- [ ] P2.4a Benchmark-ranked node selection (cut item 2).
- [ ] P2.5 `scripts/demo_job.py` runs a 2-round, 4-node MNIST job on diana and prints every tx hash.
- [ ] P2.6 Ciphertext-only test (DB, blob dir, logs) and API hardening tests.
- [ ] P2.7 Native AMM: BERU pool per S4, or pool-2 swap (cut item 3).

Exit check: the demo job completes on diana, node-4 is slashed, honest nodes claim, the owner account opens the final weights with the Python wrapper, ciphertext-only and API tests green.

## Phase 3. Competitions (25–27 Nov)

Tasks
- [ ] P3.1 Sandbox image (`sandbox/Dockerfile`, pinned digest, locked numpy, pandas, scikit-learn) and the sandbox runner with gVisor; every rejection reason; containment tests (network, fork bomb, disk fill, huge output).
- [ ] P3.2 Metrics (accuracy, macro-F1, RMSE, ROC-AUC) with deterministic sums and tests.
- [ ] P3.3 `Competitions` contract: create, submit, validity (2 signed), scores (2 signed, `pqcVerify`), revealLabels (host, or a verifier after the deadline), settle, refund; Foundry tests.
- [ ] P3.4 Verifier competition loop: validate on submit, score after the deadline, publish predictions after scoring.
- [ ] P3.5 `scripts/demo_compete.py`: host on the sensitive CSV, three entries (good, weaker, one that tries the network or crashes), validity, scoring, reveal, settle on diana.

Exit check: the demo competition completes on diana; the bad entry is rejected with the right reason; scores are PQ-verified on-chain; labels verify against the commitment.

Cut line (cut item 1, first to go): if behind on 26 Nov evening, competitions become the scripted demo plus a read-only page, metrics accuracy and RMSE only.

## Phase 4. Web app (25–28 Nov)

Tasks
- [ ] P4.1 Visual style: palette, type, mark (DESIGN section 2).
- [ ] P4.2 Next.js app with `create-qorechain-dapp` packages; QoreX RainbowKit connector; SIWQ.
- [ ] P4.3 Tokens, fonts, signature components (`SealChip`, `ProofStamp`, `WindowMeter`, `RoundTimeline`, `KeyCard`, `SandboxReport`, `Leaderboard`).
- [ ] P4.4 `/start` key setup flow (with KEM key backup per S3); `/jobs` flows with client-side sealing and final-model opening; `/compete` flows with client-side script sealing; `/sealed`; landing; profile; `/how`. Chain fallback when the API is down.
- [ ] P4.5 Playwright smoke run with the QoreX mock wallet.

Exit check: from a fresh browser profile, a person can sign in, set up keys, post and fund a sealed job, watch it settle, open the model, host a competition and submit an entry, all against diana.

Attend the 27 Nov submission clinic with a working draft; confirm every feature reads Verified.

## Phase 5. Side entry (28–29 Nov, 1.5 days)

- [ ] P5.1 Scaffold with `create-qorechain-dapp`, QoreX; exposure checks; hybrid-signed fix actions.
- [ ] P5.2 Deploy, README with credits, AI note, video (≤3 min), cover, platform project in Quantum Pass, GitHub App installed.

Exit check: project page complete, hybrid tx visible on the listed address.

Cut line (cut item 5): if the main entry isn't through Phase 4 exit by 28 Nov evening, the side entry shrinks to the read-only checker plus one fix action.

## Phase 6. Ship (29 Nov–1 Dec)

- [ ] P6.1 Both VMs: `docker compose up`, TLS on the sslip.io hostname, health checks, restart policies, log rotation; Vercel deploy.
- [ ] P6.2 Self-scan of our own edge host only (httpx, nuclei, ffuf): no exposed admin routes, debug pages or default files; fix findings.
- [ ] P6.3 Run one fresh job and one fresh competition on the live stack; keep them visible for judges.
- [ ] P6.4 README (what, why, trust model, how it's made, credits, run it, tx hashes, gas figures, limits), THREAT_MODEL.md, AI_USAGE.md final pass, docs/how-it-works.md.
- [ ] P6.5 Cover image 1600×900.
- [ ] P6.6 Video ≤3:00, recorded against live testnet:
  - 0:00–0:20 hook: data that trains AI today is readable after Q-Day.
  - 0:20–1:10 owner seals a dataset in the browser; `/sealed` shows the edge server only holds ciphertext.
  - 1:10–1:50 round runs, cheater caught, `ProofStamp` on the verdict tx.
  - 1:50–2:30 competition: a cheating script rejected in the sandbox, PQ-signed scores, labels revealed and checked.
  - 2:30–3:00 owner opens the model locally; Verified features list; what comes next.
- [ ] P6.7 Platform page: description, how it's made, 5 addresses, kits and features, video, demo link; "Check again" until all Verified.
- [ ] P6.8 Re-read /rules and /prizes for changes.

Exit check (1 Dec 23:59): every item in PRD section 6 ticked.

## After the freeze (2–16 Dec)

- Keep both VMs up and topped with testnet funds; daily health check; watch the budget alerts.
- Jury change requests: answer within the 48 h window.
- Prepare for the live show on 16 Dec.
- After 16 Dec: ask Rounak whether to stop or delete the AWS resources.
