# strongChar: memory

The project's running log. Update at the end of every working session. Newest log entries at the top of section 4.

## 1. Fixed facts

- Event: Build Before Q-Day: The QoreChain Developer Fest, build.qorechain.io. Building 4 Nov–2 Dec 2026 23:59 UTC; checks 3–5 Dec; judging 6–15 Dec; live show 16 Dec; payouts 17–22 Dec; QOR grants from Jan 2027. Rules "may still change": re-read /rules and /prizes on 20 and 27 Nov.
- Rules that bind us: projects must be built during the event; copied projects are disqualified; libraries, kits and templates must be credited in the README; MIT or Apache-2.0 licence file; deliverables are a public repo, README, featured image, video ≤3 min and the testnet addresses used. One person may build several projects, each in one category.
- Entry: solo. Category **Encrypted Apps** ($1,500 / $750, team 1–4). Requirements: ML-KEM-1024 encryption, registered recipient keys, ML-DSA key binding, client-side encryption and decryption. The rubric is not published.
- Special awards: Best AI-Native ($500: tick AI-native, `AI_USAGE.md` documenting workflow, generated work and human contribution). Quantum Campus ($500: every member enrolled; the jury emails for proof of enrolment). Regional ($200 per region, Asia-Pacific for India; only to projects with no other prize). Top-Quality (7 × $250, jury score ≥70 and all checks passed; only to projects with no other prize). Q-Day Drill closed on 17 Nov (missed).
- Submission checks: Kits are Verified when the package is in a dependency file; features when transactions from listed addresses exercise them. Up to 5 `qor1…` addresses per project, plus the linked QoreX address for Ship Weeks. Solidity PQC features and the scaffolder are checked by hand by jurors. The explorer has no source verification.
- Network: testnet `qorechain-diana`, EVM chain ID 9800. REST `api-testnet.qore.host`, RPC `rpc-testnet.qore.host`, EVM RPC `evm-testnet.qore.host`. Faucet dashboard.qorechain.io/faucet (one claim per account per 24 h; QOR plus fUSD/fETH/fBTC). Explorer explore.qore.network.
- Chain params (read 18 Nov): PQC `hybrid_signature_mode = required`, `allow_classical_fallback = false`, default algorithm Dilithium5 (ML-DSA-87). EVM: Shanghai, Cancun and Prague active from genesis; `prevrandao`/mixHash is always 0; block-hash history window 8,192; EVM denom `uqor` (6 decimals) extended to `aqor` (18 decimals) inside the EVM; gas price about 112.5 gwei; block gas limit 2^32−1. Active precompiles: `0x…0901`, `0x…0a01`, `0x…0a02`, `0x…0c01`.
- An EVM transaction from an account with a registered ML-DSA key needs an open EVM window (event FAQ). Agent keys with spending rules (`MsgExecuteEVM`) need no window.
- Precompiles: `pqcVerify(bytes pubkey, bytes sig, bytes msg) returns (bool)` at `0x…0a01`, 25,000 + 8 gas/byte (≈85–90k typical). `pqcKeyStatus(address) returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)` at `0x…0a02`, 2,500 gas, algorithmId 1 = ML-DSA-87. Write addresses in lowercase in Solidity. Inactive precompiles return empty data, so typed calls revert.
- Sizes: ML-DSA-87 public key 2,592 bytes, signature 4,627 bytes.
- Test tokens are bank coins named `erc20:0x…`: FestUSD (6 decimals) `erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA`, FestETH (18) `…0x02292293…1c28`, FestBTC (8) `…0x4604e7E4…451A`. Native AMM pool 2 is fUSD/QOR.
- QoreX `signArbitrary` signs a prefixed message (1–4096 bytes); `verifyMessageWithChain` checks both halves.
- Packages: PyPI `qorechain-sdk` 0.14 (import `qorsdk`), `qorechain-qoresign` 0.2 (`qoresign`), `qorechain-qoreseal` 0.1 (`qoreseal`), `qorechain-pqc` 0.2.3 (`qorpqc`). npm `@qorechain/sdk` 0.14, `@qorechain/evm`, `@qorechain/react`, `@qorechain/qoreseal` 0.1, `@qorechain/qoresign` 0.2, `@qorechain/pqc`, `@qorechain/qorex-rainbowkit`, `@qorechain/qorex-wallet-mock`, `@qorechain/wallet-adapter`, `create-qorechain-dapp` 0.14, `@qorechain/mcp`.
- Native AMM messages: `MsgCreatePool(creator, pool_type, initial_deposit_a, initial_deposit_b, amplification_coefficient)`, `MsgAddLiquidity`, `MsgSwapExactIn(sender, pool_id, token_in, denom_out, min_out)`, `MsgSwapExactOut`.
- Workshops: 20 Nov 16:30 UTC (QoreSeal, cross-VM, second-half challenges), 27 Nov (rollups + submission clinic).
- Project page: build.qorechain.io/p/strongchar. Repo: github.com/rounak-agl/strongChar.

## 2. Decisions

| # | Date | Decision | Why |
|---|---|---|---|
| D1 | 18 Nov | Build in public with small daily commits; private working notes stay in gitignored files | Event rules: built during the event, visible history |
| D2 | 18 Nov | Category Encrypted Apps | Fewest strong rivals among solo-eligible categories; fits the sealed-data story. Protocol Builders needs 2–4 members |
| D3 | 18 Nov | Scope: core sealed training + Kaggle-style competitions | Your choice |
| D4 | 18 Nov | MIT licence; LICENSE keeps every copyright line it carries | Licence terms |
| D5 | 18 Nov | Team runs coordinator, 2 verifiers, ~4 nodes (1 cheat); web on Vercel | Reliable demo, live for judges. Hosting split in D21 |
| D6 | 18 Nov | Superseded by D18 | |
| D7 | 18 Nov | Planning docs committed under docs/plan/ | Visible planning helps the AI-native award |
| D8 | 18 Nov | Repo root = this folder | Your choice |
| D9 | 18 Nov | Own ERC-20 token + native AMM swap | Your choice; BERU pool depends on Q3 |
| D10 | 18 Nov | Python for node, verifier and coordinator with the official Python SDKs; TS SDKs in the web app | All needed QoreChain packages exist on PyPI and are byte-compatible with TS |
| D11 | 18 Nov | Competitions: code-only submissions; pinned CPU seeded sandbox, byte-identical predictions across two verifiers; single final ranking; verifiers score and ML-DSA-sign, labels revealed after | Your choices |
| D12 | 18 Nov | Demo data: MNIST + synthetic sensitive tabular CSV | Your choice |
| D13 | 18 Nov | Lean coordinator: never decrypts, never merges. Keeps indexing, node health, scheduling, openRound, timeouts, ciphertext-only blob store, signature relay, read API, admin pause/resume. Verifiers merge and gate | Server stays ciphertext-only; something still has to act on a clock |
| D14 | 18 Nov | Token **Beru**, symbol **BERU**, 6 decimals, capped, faucet drip | Your choice; matches fUSD decimals |
| D15 | 18 Nov | Hosting on AWS (project on the free plan, $100 credits to May 2027), Region ap-southeast-2 only. Machine split in D21 | Your choice; replaced the Oracle free-tier plan |
| D16 | 18 Nov | Side entry (Q-Day exposure checker) in its own repo `strongChar-qday` | Your choice |
| D17 | 18 Nov | Naming in RULES.md section 2 | Your choice |
| D18 | 18 Nov | Visual style decided in Phase 4 (palette, type, mark); light restyle of a standard component system | Your choice |
| D19 | 18 Nov | Node selection is benchmark-ranked: timed benchmark in heartbeats, too-slow nodes skipped, faster preferred, longest-idle as tiebreak | Your choice; a pass/fail self-test alone can't prefer faster machines |
| D20 | 18 Nov | Public docs describe strongChar's own design only; working notes stay in gitignored files | Keeps the public plan focused and accurate |
| D21 | 18 Nov | Two VMs in ap-southeast-2: edge `t4g.small` (coordinator + Caddy, no decryption keys, ports 80/443) and worker `t4g.medium` (verifiers, nodes, sandbox runner, no inbound ports). About $54 to 16 Dec | Red-team: one box holding verifier keys made "the server only holds ciphertext" misleading |
| D22 | 18 Nov | Tagline: "Your data, sealed to only the machines that need it. Every step proven." | Red-team: "no one can read" was false (nodes and verifiers read what they work on) |
| D23 | 18 Nov | Cut order if behind: (1) competitions shrink to a scripted CLI demo with a read-only page and accuracy/RMSE only; (2) benchmark ranking → plain eligibility; (3) BERU AMM pool → pool-2 swap for the badge; (4) in-UI window controls → auto-opened windows; (5) side entry → read-only checker. Never cut: sealed job end to end, browser seal/open, PQ-verified verdicts and settlement, slashing | Your choice: protect sealed training and web polish |
| D24 | 18 Nov | EVM windows are mandatory; every sender checks and renews its window before each EVM tx; native value caps 0 (`aqor` units) | FAQ confirms windows are required once an ML-DSA key is registered |
| D25 | 18 Nov | Never use `prevrandao`; round seed = blockhash of the first block after the commit deadline | `prevrandao` is always 0 on diana |
| D26 | 18 Nov | Verifier pair immutable at deploy; `finalizeRound` and score posting callable by anyone with both valid signatures | Removes the coordinator as a trust point; no admin backdoor |
| D27 | 18 Nov | No stuck money: stalled-job refund, no-valid-entry refund, verifiers may reveal labels after the reveal deadline, honest stake always withdrawable | Red-team: several paths could lock funds |
| D28 | 18 Nov | Blob store: envelope parsed, content-addressed, size caps per kind, auth + quotas, recipient-only fetch, unreferenced uploads expire in 1 h | Red-team: prefix check alone allowed junk uploads and scraping |
| D29 | 18 Nov | Sandbox runner is the only holder of the Docker socket; gVisor, no caps, non-root, tmpfs and output caps; per-service secrets from SSM | Red-team: socket in verifiers meant root on the host |
| D30 | 18 Nov | API hostname `<elastic-ip>.sslip.io` with Caddy TLS; no SSH (Session Manager only); CloudWatch auto-recovery; budget alerts $60 / $85 | No domain owned; smaller attack surface |
| D31 | 18 Nov | Signed payloads carry job/round/entry and an expiry; commitments include the node address; AAD includes chain, contract and recipient-set hash | Red-team: replay and copy gaps |
| D32 | 18 Nov | Project page lists 5 addresses: deployer, verifier-a, coordinator, demo data owner, node-1; each declared feature is exercised by at least one of them | Features only verify from listed addresses |
| D33 | 18 Nov | `AI_USAGE.md` kept as a running log from day one; README credits every library, kit and template | Event rules and AI-Native criteria |
| D34 | 18 Nov | Verifiers pinned to arm64; competition records state image digest and architecture | Floating-point results likely differ across architectures (Q14) |

## 3. Open questions

| # | Question | How it gets answered | Status |
|---|---|---|---|
| Q1 | Does `pqcVerify` take raw bytes, a digest, or apply a context string? | Spike S2 with free `eth_call` against diana | Open |
| Q2 | Can an account with a registered PQ key send EVM txs without a window? | Event FAQ: no | Closed (D24) |
| Q3 | Does our own ERC-20 (BERU) become an `erc20:0x…` bank coin that a native AMM pool can hold? (Pools with `erc20:` coins already exist) | Spike S4 | Open, narrowed |
| Q4 | Cancun opcodes and randomness on chain 9800? | Chain config: Prague active; `prevrandao` = 0 | Closed (D25) |
| Q5 | How exactly is a KEM key bound to the ML-DSA identity (recipient cards)? | Spike S3, workshop 20 Nov | Open |
| Q6 | How is student status verified for Quantum Campus? | Rules: jury emails each member for proof of enrolment | Closed |
| Q7 | Which VM for the backend? | D15, D21 | Closed |
| Q8 | Side entry in a separate repo? | D16 | Closed |
| Q9 | Token name and symbol | D14 | Closed |
| Q10 | Can one person be on two projects? | Rules: yes | Closed |
| Q11 | Visual direction | D18 | Closed |
| Q12 | Second-half challenges and any rule or prize changes | Workshop 20 Nov; re-read /rules on 20 and 27 Nov | Open |
| Q13 | Backend VM available? | D15 | Closed |
| Q14 | Do sandbox predictions match across arm64 and x86? | Spike S5 | Open (verifiers pinned to arm64 either way, D34) |
| Q15 | Benchmark threshold: how slow is too slow? | Measure in Phase 2 on the worker VM and the laptop | Open |
| Q16 | Does QoreX hold QoreSeal (ML-KEM) keys and open envelopes for a dApp? | Spike S3, `@qorechain/qoreseal` docs, workshop 20 Nov | Open (fallback in ARCHITECTURE section 4) |
| Q17 | Does the registration "level" (set to Quantum Pass) limit the categories a person can win in? | Ask in Discord #builders | Open, Rounak |

## 4. Log

### 2026-11-18
- Researched the event, past winners and similar projects. Category and scope decided (D1–D13).
- Checked QoreChain packages: Python SDK, QoreSign and QoreSeal all on PyPI; npm packages all published.
- Wrote PRD, ARCHITECTURE, DESIGN, PHASES, RULES, MEMORY. Decided D14–D19 (lean coordinator, Beru, side repo, naming, benchmark-ranked nodes).
- Hosting moved to AWS (D15): free plan, $100 credits, Region ap-southeast-2; AWS CLI and agent toolkit set up locally (nothing committed).
- Public repo and project page created (Encrypted Apps, AI-Native, Quantum Campus, Regional India; 10 kits and 9 features declared, unverified until code and txs exist). QoreChain Build GitHub App installed on the repo only. Registration 4/4.
- Rounak's QoreX wallet holds about 99 QOR, 1,000 fUSD, 0.5 fETH, 0.02 fBTC. It funds the deployer; the deployer funds the service accounts.
- Red-team review of the plan against the live rules, FAQ and chain params (read-only). Closed Q2, Q4, Q6, Q10; narrowed Q3; added Q16, Q17. Decided D20–D34: public docs scope, two VMs, honest tagline, cut order, mandatory windows, no `prevrandao`, permissionless finalize with immutable verifiers, refund paths, hardened blob store and sandbox, sslip.io hostname, replay-proof signed payloads, 5 listed addresses, AI_USAGE log, arm64-pinned verifiers.
- Next: Phase 0 (19–20 Nov).
