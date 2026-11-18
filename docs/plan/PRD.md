# strongChar: product requirements

Status: v2 after the red-team review, 18 Nov 2026. Owner: Rounak (solo).
Event: Build Before Q-Day: The QoreChain Developer Fest. Category: **Encrypted Apps**.
Hard deadline: project page freezes **2 Dec 2026 23:59 UTC**. Internal deadline: **1 Dec 2026 23:59 UTC**.

## 1. One-line pitch

Tagline: **Your data, sealed to only the machines that need it. Every step proven.**

strongChar lets anyone train a model on private data using strangers' computers, and run Kaggle-style competitions where the hidden test set never leaks. Every byte of data is sealed with post-quantum encryption (ML-KEM-1024) to only the node and verifiers that work on it; the server in the middle only ever holds ciphertext. Every result is checked by two verifiers who replay the work exactly, and their verdicts are post-quantum signed (ML-DSA-87) and checked on-chain.

## 2. Problem

1. Data that trains today's models (medical, financial, user records) is what "harvest now, decrypt later" adversaries store until a quantum computer can read it. Classical encryption on that data has an expiry date.
2. Renting untrusted compute means trusting the worker to really do the training. A lazy or malicious worker can return plausible-looking weights.
3. Kaggle-style competitions trust the platform with the hidden test labels, and a submitted script can be broken, can try to read data it shouldn't, or can game the scorer. Entrants also hand their code to the platform in the clear.

## 3. Solution

- **Sealed training jobs.** A data owner uploads a dataset in the browser. It is canonicalised, sharded and sealed (QoreSeal, ML-KEM-1024) to the registered keys of exactly the node and the two verifiers that need each shard. The coordinator and blob store only ever hold ciphertext.
- **Exact replay.** Training uses a bit-exact CPU kernel, so a verifier reruns a node's work and compares hashes. A mismatch is a cheat, with no tolerance to argue about.
- **Post-quantum verdicts.** Each verifier signs its verdict and the round settlement with ML-DSA-87. The JobMarket contract checks both signatures with the `pqcVerify` precompile and requires `pqcKeyStatus(...).possessionProven`. Cheaters are slashed, honest nodes are paid.
- **Scoped money movement.** Every EVM transaction runs inside a scoped EVM authorisation window that only admits strongChar's contracts with capped value and count, so a stolen classical key can't drain anything.
- **Verified competitions.** Hosts lock a prize and a sealed hidden test set. Entrants submit Python scripts sealed to the verifiers. Each script runs in a pinned, network-less, seeded CPU sandbox on both verifiers; a crash, timeout, bad output or a mismatch between the two runs rejects the entry. After the deadline the verifiers score every valid entry, sign the scores with ML-DSA-87, the contract checks them, and the labels are revealed on-chain so anyone can recheck.

## 4. Users

| Persona | Wants | Touches |
|---|---|---|
| Data owner (job poster) | A trained model without exposing the data | Web app: post job, fund, watch rounds, decrypt final model |
| Node operator | Earn tokens for honest CPU training | `strongchar-node` CLI (in the demo, all run by the team) |
| Verifier | Earn fees for replaying and signing | `strongchar-verifier` CLI (in the demo, two run by the team) |
| Competition host | Best model for a task without leaking the test set | Web app: host competition, lock prize, reveal labels |
| Competition entrant | Fair, cheat-proof competition, code kept private from rivals | Web app: submit script, see validity and final rank |
| Judge / visitor | Understand it in 3 minutes, click through live data | Landing page, explorer links, video |

## 5. Scope

### 5.1 In scope (MVP, must ship)

**Identity and keys**
- M1. Connect QoreX wallet (RainbowKit connector) and Sign In With QoreChain (QoreSign SIWQ).
- M2. First-run flow: register the ML-DSA-87 key with proof of possession, and register the ML-KEM-1024 key (`MsgRegisterKEMKey`) with ML-DSA key binding. Show both on the profile with explorer links.
- M3. Open, inspect and close a scoped EVM window (targets = strongChar contracts, capped value, tx count and blocks) from the UI.

**Training jobs**
- J1. Post a job: choose dataset (MNIST preset or upload a tabular CSV), model (exact MLP), rounds, nodes, budget. Browser canonicalises and shards, then seals each shard client-side.
- J2. Fund the job in Beru (BERU) inside a scoped EVM window.
- J3. Round lifecycle on-chain: open → train → commit → reveal → replay → merge and gate → settle, with ciphertext-only blobs.
- J3a. Node selection is benchmark-ranked: each node reports a timed benchmark in its heartbeat; nodes below the speed floor are skipped; faster nodes are seated first, longest-idle breaks ties; one seat per owner. The Nodes page shows each node's benchmark and why it was or wasn't seated.
- J4. Nodes and verifiers decrypt locally, train or replay, and re-seal outputs to the next recipients.
- J5. Two verifiers ML-DSA-sign verdicts and the settlement. JobMarket verifies both with `pqcVerify` and checks `possessionProven`.
- J6. A deliberately cheating node is caught (`ReplayMismatch`) and slashed on-chain.
- J7. Honest nodes claim earnings.
- J8. The final model is sealed to the data owner only, and decrypted and evaluated in the browser (accuracy on the owner's held-out split).

**Token and AMM**
- T1. Beru (BERU, 6 decimals) ERC-20 for stakes, budgets and prizes, with a capped faucet.
- T2. A native AMM pool and a swap path between BERU and fUSD (`MsgCreatePool`, `MsgSwapExactIn`). ERC-20 tokens already trade in native pools as `erc20:0x…` coins (pool 2 is fUSD/QOR). If BERU can't become such a coin (Q3, spike S4), funding swaps QOR↔fUSD in pool 2 and BERU stays EVM-only.

**Competitions (Kaggle-style, verified)**
- C1. Host creates a competition: task, metric (accuracy, macro-F1, RMSE or ROC-AUC), public training data, hidden test features and labels sealed to the verifiers, label commitment `keccak256(keccak256(labels), salt)`, prize locked, deadline, submission cap per entrant.
- C2. Entrant submits a Python script (code only), sealed to the two verifiers, with its hash committed on-chain.
- C3. On submission both verifiers run the script in the pinned sandbox (no network, read-only root, CPU only, fixed seed, single thread, time and memory caps). The entry is **valid** only if both runs exit cleanly, the output matches the schema, and both prediction hashes are byte-identical. Validity is shown to the entrant straight away; no score is shown (single final ranking).
- C4. After the deadline both verifiers score every valid entry against the hidden labels, ML-DSA-sign the score table, and the contract checks both signatures with `pqcVerify`.
- C5. The host (or anyone holding them) reveals labels and salt on-chain. The contract checks them against the commitment. Predictions of valid entries are published so anyone can recompute the scores.
- C6. Settle pays the top entry. One final ranking, ties to the earlier submission.

**Web app**
- W1. Visual design decided in Phase 4 (DESIGN.md).
- W2. Pages: landing, sign-in and key setup, jobs list, new job, job detail with round timeline, round detail, nodes, competitions list, new competition, competition detail, submit entry, profile, "how it works", "what's sealed" (ciphertext vs commitment viewer).
- W3. Every on-chain action links to explore.qore.network.
- W4. When the API is unreachable, pages read state straight from the chain.

**Ops and submission**
- O1. Two AWS VMs in Sydney paid from credits: a public edge VM (coordinator, no decryption keys) and a private worker VM (2 verifiers, about 4 nodes with one cheating, sandbox runner). Web app on Vercel.
- O2. README with "How it's made" and credits for every library, kit and template, THREAT_MODEL.md, AI_USAGE.md (kept as a running log from day one), LICENSE (MIT, see RULES.md), cover image (16:9, at least 1200×675), video of 3 minutes or less.
- O3. Platform: project created in "My space", QoreChain Build GitHub App installed, testnet `qor1…` addresses listed, kits and features listed and showing **Verified**, AI-native ticked.

### 5.2 Side entry (separate project, Quantum Pass category)

- Q1. "Q-Day exposure checker": paste a `qor1…` or `0x…` address, see whether a PQ key is registered and possession-proven, whether an EVM window is open and what it admits, and whether a KEM key is registered. One-click hybrid-signed fix (register key, close window).
- Q2. Built with `create-qorechain-dapp`, QoreX, deployed on testnet, at least one hybrid-signed transaction. Budget 1.5 days. Separate repo `strongChar-qday`.

### 5.3 Stretch (only after MVP is green)

- S1. Node payouts to a smart account with daily spending rules.
- S2. `@qorechain/mcp` or `qore` CLI in ops scripts.
- S3. Installable node CLI so outsiders can join.
- S4. Dispute window on competition scores after labels are revealed.

### 5.4 Out of scope

GPU training, tolerance judges, CIFAR, RL competitions, a terminal UI, human-uniqueness checks, third-party storage networks, mainnet deployment, cross-VM calls, rollups.

### 5.5 Cut order if behind

Decided in MEMORY D23. In order: (1) competitions shrink to a scripted CLI demo with a read-only page and accuracy/RMSE only; (2) benchmark ranking becomes plain eligibility; (3) the BERU pool becomes a pool-2 swap for the badge; (4) in-UI window controls become auto-opened windows; (5) the side entry becomes a read-only checker. Never cut: sealed job end to end, browser seal and open, PQ-verified verdicts and settlement, slashing.

## 6. Success criteria

| # | Criterion | Measure |
|---|---|---|
| 1 | Category checklist fully met | ML-KEM-1024 ✓, registered recipient keys ✓, ML-DSA key binding ✓, client-side encryption and decryption ✓, each visible in the video |
| 2 | Platform verification | Every listed kit and feature reads **Verified** on the project page by 27 Nov clinic |
| 3 | End-to-end on testnet | One full job (≥2 rounds, 4 nodes, 1 cheater slashed) and one competition (≥3 entries, one rejected as invalid) completed on `qorechain-diana`, with tx hashes in the README |
| 4 | Ciphertext-only | Coordinator database and blob store contain no plaintext data, weights or scripts (checked by a test) |
| 5 | PQ checks on-chain | `pqcVerify` gas measured and shown; a forged or unproven key is rejected in a Foundry test and live |
| 6 | Live for judges | Web app public, backend up from 2 Dec to 16 Dec; web still shows chain state if the API is down |
| 8 | Honest claims | README states the trust model (who can read what) and that the demo's two verifiers share one worker VM |
| 7 | Prize stack | Encrypted Apps entry + AI-native flag + Quantum Campus eligibility + Quantum Pass side entry submitted |

## 7. Prize plan

| Prize | Amount | What it needs | Status |
|---|---|---|---|
| Encrypted Apps | $1,500 / $750 | Section 5.1 | Main goal |
| Best AI-Native Build | $500 | AI-native ticked, AI_USAGE.md | Planned |
| Quantum Campus | $500 | Every member enrolled; jury emails for proof of enrolment | Planned; keep a student card or college letter ready |
| Quantum Pass (side) | 10×$150 + 20×$50 raffle | Section 5.2 | Planned |
| Top-Quality | 7 × $250 | Jury score ≥70, all checks passed, no other prize | Safety net |
| Regional (Asia-Pacific) | $200 | Highest-scored in region with no other prize | Safety net (India selected) |
| People's Choice | $500/$300/$200 | Community vote | Not pursued (your choice) |

## 8. Constraints

- Solo, 8+ hours a day, about 13.5 working days.
- Testnet `qorechain-diana` only (EVM chain ID 9800). The features judged are off on mainnet.
- Built in public during the event, with small daily commits (event rule).
- Rules and prizes "may still change until the end of the event": re-read /rules and /prizes on 20 Nov and 27 Nov.

## 9. Open questions

Tracked in [MEMORY.md](MEMORY.md#3-open-questions). The ones that can still change scope: Q1 (`pqcVerify` message format), Q3 (BERU as a bank coin for the AMM), Q5 (KEM to ML-DSA binding), Q14 (sandbox determinism across architectures), Q16 (browser KEM key custody), Q17 (registration level).
