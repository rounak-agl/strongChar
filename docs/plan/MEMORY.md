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
- EVM windows (S1, 18 Nov): no window → EVM tx refused with "has no open EVM authorisation window"; inside a window deploys and calls work; closing takes effect at once; scoped targets refuse other recipients ("the window does not list 0x…"). Each admitted tx consumes value + gas limit × max fee from `max_value` (deploy with 600k limit at 200 gwei = 120,000 uqor). Opening a window advances the account sequence (= EVM nonce). Block time ≈ 1.43 s, so 17,280 blocks ≈ 6.8 h. Base fee 100 gwei.
- Native AMM (S4, 18 Nov): params `pool_creation_fee` 100 QOR, swap fee 30 bps + protocol 10 bps, max price impact 500 bps. ERC-20 module: `permissionless_registration: false`, so a new ERC-20 can't become a bank coin without governance. Pool 2 (fUSD/QOR) trades at about 14.6 QOR per fUSD.
- QoreSeal (S3, 18 Nov): REST route for KEM keys is `/qorechain/pqc/v1/kem/{address}`. A 100 KB plaintext sealed to 3 hybrid recipients grows by about 5 KB. Failures: `NOT_A_RECIPIENT`, `DECRYPTION_FAILED` (wrong AAD or purpose), `CARD_INVALID`.
- PQProbe contract (spike, testnet): `0x50C3540e93D4D14FCCe90518C3D49B132E6cF43B`, deploy tx `0x7d26e4d873e73d72a552809f492c817cbaf939f13cfdb3d6a33f8f6c988e241c`.
- `pqcVerify` (S2, 18 Nov): verifies plain ML-DSA-87 over the exact `msg` bytes (no hashing, empty context). A direct call with a 160-byte message estimates 313,660 gas including calldata (≈0.035 QOR at 112.5 gwei).
- PQ key status: a key registered through QoreX shows `registered = true` but `possessionProven = false`. Proof of possession needs `MsgRegisterPQCKeyV2` with a proof (SDK `sign_proof_of_possession`). Our contracts require it only of nodes and verifiers.
- `qorechain-pqc` depends on `liboqs-python`, which downloads and compiles liboqs from GitHub on first import unless liboqs is already installed. Docker images must build liboqs at image build time.
- The EVM RPC returns 403 to Python's default User-Agent; clients send a generic one.
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
| D9 | 18 Nov | Own ERC-20 token + native AMM swap | Your choice; refined by D37 |
| D10 | 18 Nov | Python for node, verifier and coordinator with the official Python SDKs; TS SDKs in the web app | All needed QoreChain packages exist on PyPI and are byte-compatible with TS |
| D11 | 18 Nov | Competitions: code-only submissions; pinned CPU seeded sandbox, byte-identical predictions across two verifiers; single final ranking; verifiers score and ML-DSA-sign, labels revealed after | Your choices |
| D12 | 18 Nov | Demo data: MNIST + synthetic sensitive tabular CSV | Your choice |
| D13 | 18 Nov | Lean coordinator: never decrypts, never merges. Keeps indexing, node health, scheduling, openRound, timeouts, ciphertext-only blob store, signature relay, read API, admin pause/resume. Verifiers merge and gate | Server stays ciphertext-only; something still has to act on a clock |
| D14 | 18 Nov | Token **Beru**, symbol **BERU**, 6 decimals, capped, faucet drip; role narrowed by D37 | Your choice; matches fUSD decimals |
| D15 | 18 Nov | Hosting on AWS (project on the free plan, $100 credits to May 2027), Region ap-southeast-2 only. Machine split in D21 | Your choice; replaced the Oracle free-tier plan |
| D16 | 18 Nov | Side entry (Q-Day exposure checker) in its own repo `strongChar-qday` | Your choice |
| D17 | 18 Nov | Naming in RULES.md section 2 | Your choice |
| D18 | 18 Nov | Visual style decided in Phase 4 (palette, type, mark); light restyle of a standard component system | Your choice |
| D19 | 18 Nov | Node selection is benchmark-ranked: timed benchmark in heartbeats, too-slow nodes skipped, faster preferred, longest-idle as tiebreak | Your choice; a pass/fail self-test alone can't prefer faster machines |
| D20 | 18 Nov | Public docs describe strongChar's own design only; working notes stay in gitignored files | Keeps the public plan focused and accurate |
| D21 | 18 Nov | Three `t4g.small` VMs (arm64, 2 GB + 2 GB swap) in ap-southeast-2: edge (coordinator + Caddy, no decryption keys, ports 80/443, Elastic IP 32.237.26.58), verifiers (both verifiers + gVisor sandbox runner, no inbound) and nodes (4 nodes, no inbound). About $59 to 16 Dec | Red-team split of keys from the public box; the AWS Free plan refuses `t4g.medium`, so the worker became two smalls, which also separates verifiers from nodes |
| D22 | 18 Nov | Tagline: "Your data, sealed to only the machines that need it. Every step proven." | Red-team: "no one can read" was false (nodes and verifiers read what they work on) |
| D23 | 18 Nov | Cut order if behind: (1) competitions shrink to a scripted CLI demo with a read-only page and accuracy/RMSE only; (2) benchmark ranking → plain eligibility; (3) BERU AMM pool → pool-2 swap for the badge; (4) in-UI window controls → auto-opened windows; (5) side entry → read-only checker. Never cut: sealed job end to end, browser seal/open, PQ-verified verdicts and settlement, slashing | Your choice: protect sealed training and web polish |
| D24 | 18 Nov | EVM windows are mandatory; every sender checks and renews its window before each EVM tx. A window's `max_value` (in `uqor`) is consumed by each admitted tx's value **plus gas limit × max fee**, so caps are sized per role from measured gas, never 0. Scoped `allowed_targets` work as expected | Event FAQ + spike S1 (corrected 18 Nov: an earlier draft said caps of 0) |
| D25 | 18 Nov | Never use `prevrandao`; round seed = blockhash of the first block after the commit deadline | `prevrandao` is always 0 on diana |
| D26 | 18 Nov | Verifier pair immutable at deploy; `finalizeRound` and score posting callable by anyone with both valid signatures | Removes the coordinator as a trust point; no admin backdoor |
| D27 | 18 Nov | No stuck money: stalled-job refund, no-valid-entry refund, verifiers may reveal labels after the reveal deadline, honest stake always withdrawable | Red-team: several paths could lock funds |
| D28 | 18 Nov | Blob store: envelope parsed, content-addressed, size caps per kind, auth + quotas, recipient-only fetch, unreferenced uploads expire in 1 h | Red-team: prefix check alone allowed junk uploads and scraping |
| D29 | 18 Nov | Sandbox runner is the only holder of the Docker socket; gVisor, no caps, non-root, tmpfs and output caps; per-service secrets from SSM | Red-team: socket in verifiers meant root on the host |
| D30 | 18 Nov | API hostname `<elastic-ip>.sslip.io` with Caddy TLS; no SSH (Session Manager only); CloudWatch auto-recovery; budget alerts $70 / $85 | No domain owned; smaller attack surface |
| D31 | 18 Nov | Signed payloads carry job/round/entry and an expiry; commitments include the node address; AAD includes chain, contract and recipient-set hash | Red-team: replay and copy gaps |
| D32 | 18 Nov | Project page lists 5 addresses: deployer, verifier-a, coordinator, demo data owner, node-1; each declared feature is exercised by at least one of them | Features only verify from listed addresses |
| D33 | 18 Nov | `AI_USAGE.md` kept as a running log from day one; README credits every library, kit and template | Event rules and AI-Native criteria |
| D34 | 18 Nov | Verifiers pinned to arm64; competition records state image digest and architecture | Floating-point results likely differ across architectures (Q14) |
| D35 | 18 Nov | Contracts pass `pqcVerify` the exact `abi.encode(...)` message bytes; verifiers sign those same bytes with `qorsdk.pqc.pqc_sign` (deterministic) | Spike S2 |
| D36 | 18 Nov | Actor keys are unified eth-native accounts (`qorsdk.unified`, coin type 60): one key gives the `qor1…` and `0x…` forms plus a seeded ML-DSA-87 key, matching QoreX. Stored in `~/.config/strongchar/accounts.json` (mode 600), outside the repo | Same derivation as the wallet adapter |
| D38 | 18 Nov | Seal keys (ML-KEM-1024 + X25519) are derived from each actor's mnemonic (`qoreseal.derive_seal_keys`, index 0) and registered on-chain; every sender verifies a recipient card before sealing; envelopes use hybrid mode with AAD `chain\|contract\|job\|round\|shard\|kind` and a purpose string per object kind | Spike S3 |
| D39 | 18 Nov | Contracts keep precompile addresses as `immutable` values so the full 20-byte addresses appear in deployed code | The optimizer otherwise shrinks them to 2 bytes; the Ship Weeks check looks for the address in code |
| D40 | 18 Nov | Verifiers canonicalise every prediction file before hashing, validity and scoring: classification → integer labels (probabilities, where a metric needs them, rounded to 6 decimals), regression → values rounded to 6 decimals, fixed CSV formatting. Validity compares canonical hashes; scores are computed from canonical predictions, so anyone can rerun on any architecture | Spike S5: raw floats differ across arm64/x86, canonical forms match |
| D37 | 18 Nov | Job budgets and competition prizes are paid in fUSD; owners and hosts swap QOR → fUSD in native AMM pool 2 when needed, so the native AMM is a real funding step. BERU is the staking and slashing token for nodes and verifiers | Your choice after spike S4 (BERU can't join a native pool) |
| D41 | 18 Nov | One PQ-signed settlement per round carries the verdicts (slashed bitmap), merge result and payouts; no separate verdict signatures. Kinds: SETTLEMENT, VALIDITY, SCORES | Halves the pqcVerify calls per round |
| D42 | 18 Nov | No on-chain round seeds: verifiers replay every step, so nothing needs sampling; batches come from the deterministic epoch shuffle | Removes blockhash timing and a bias surface |
| D43 | 18 Nov | JobMarket rules: coordinator-only openRound; node address bound in commitments; checkpoints must start at the round's weights; settlement needs quorum reveals, both verifier signatures within an expiry block, payouts in ascending address order to revealed, unslashed nodes summing exactly to the round budget; cheaters lose the job's full stake (burned), missed reveals 10%; void below quorum and expire after finalizeBy return the budget; owner can cancel between rounds | Contract tests cover each rule |

## 3. Open questions

| # | Question | How it gets answered | Status |
|---|---|---|---|
| Q1 | Does `pqcVerify` take raw bytes, a digest, or apply a context string? | Spike S2: plain FIPS-204 over the exact `msg` bytes, empty context, no hashing. Tampered or over-long signatures rejected | Closed (D35) |
| Q2 | Can an account with a registered PQ key send EVM txs without a window? | Event FAQ: no | Closed (D24) |
| Q3 | Does our own ERC-20 (BERU) become an `erc20:0x…` bank coin that a native AMM pool can hold? | Spike S4: no. `permissionless_registration` is false (needs governance), and creating a pool costs 100 QOR | Closed (D37) |
| Q4 | Cancun opcodes and randomness on chain 9800? | Chain config: Prague active; `prevrandao` = 0 | Closed (D25) |
| Q5 | How exactly is a KEM key bound to the ML-DSA identity (recipient cards)? | Spike S3: the account registers its ML-KEM key with a hybrid-signed `MsgRegisterKEMKey` and signs a recipient card (chain, address, ML-KEM + X25519 keys) with both its secp256k1 and ML-DSA-87 keys; senders run `verify_recipient_card` against the on-chain keys | Closed (D38) |
| Q6 | How is student status verified for Quantum Campus? | Rules: jury emails each member for proof of enrolment | Closed |
| Q7 | Which VM for the backend? | D15, D21 | Closed |
| Q8 | Side entry in a separate repo? | D16 | Closed |
| Q9 | Token name and symbol | D14 | Closed |
| Q10 | Can one person be on two projects? | Rules: yes | Closed |
| Q11 | Visual direction | D18 | Closed |
| Q12 | Second-half challenges and any rule or prize changes | Workshop 20 Nov; re-read /rules on 20 and 27 Nov | Open |
| Q13 | Backend VM available? | D15 | Closed |
| Q14 | Do sandbox predictions match across arm64 and x86? | Spike S5: same arch always identical; across arch raw float bits differ for BLAS-based models (logreg, MLP, ridge) but canonicalised outputs (labels; values rounded to 6 decimals) match for all four models tried | Closed (D40) |
| Q15 | Benchmark threshold: how slow is too slow? | Measure in Phase 2 on the worker VM and the laptop | Open |
| Q16 | Does QoreX hold QoreSeal (ML-KEM) keys and open envelopes for a dApp? | Spike S3, `@qorechain/qoreseal` docs, workshop 20 Nov | Open (fallback in ARCHITECTURE section 4) |
| Q17 | Does the registration "level" (set to Quantum Pass) limit the categories a person can win in? | Ask in Discord #builders | Open, Rounak |

## 4. Log

### 2026-11-18 (Phase 0)
- Phase 0 started on branch `phase0-foundations`: uv workspace with `strongchar-qore` (QoreChain SDKs pinned exactly), pnpm workspace, Foundry with forge-std v1.17.0 and OpenZeppelin v5.7.0 as submodules, CI workflow.
- Key store created for 11 actors (deployer, coordinator, verifier-a/b, node-1..4, data-owner, host, entrant); tests green.
- `PQ` library for both precompiles with 5 Foundry tests (mocked precompiles).
- Spike S2 done: Q1 closed (D35). Rounak's QoreX key is registered but not possession-proven.
- AI_USAGE.md started; README credits started.
- Deployer funded (40 QOR from Rounak's QoreX). PoP-registered the deployer's ML-DSA key (tx D746BD18…, 0.063 QOR), sent 2.5 QOR to each of the other 10 actors with hybrid-signed txs, PoP-registered all 10. All 11 show `possession_proven: true`. Chain wrapper `strongchar_qore.chain` (simulate → sign → broadcast → confirm).
- AWS: the Free plan refuses `t4g.medium`; D21 changed to three `t4g.small` VMs. Launched and bootstrapped (Docker, swap, log rotation, gVisor on verifiers, verified). Edge IP 32.237.26.58 → API host 32-237-26-58.sslip.io.
- S1 done: windows behave as documented; D24 corrected (caps must cover fees, in uqor). PQProbe deployed with full precompile addresses in its code (D39).
- S3 done (Python): KEM keys registered for all 11 actors, recipient cards verified against the chain, forged card rejected, 3-recipient seal/open with AAD; Q5 closed (D38). TS round trip and Q16 still open.
- S4 done: Q3 closed, BERU can't join a native pool (no permissionless registration; pools cost 100 QOR). Swapped 2 QOR → 0.136 fUSD in pool 2 from the deployer (tx 1E6730B2…). BERU's role awaits Rounak's choice (D37).
- Project page now lists the 5 addresses (D32). Platform verifies 6 features on-chain (AMM pools, EVM window incl. scoped, hybrid ML-DSA-87 txs, PQC key registration with PoP, QoreSeal key registry, test tokens), 4 of 10 SDKs, 3 of 3 commits. All four Ship Weeks badges earned.
- S5 done: pinned sandbox image (python:3.12-slim by index digest; numpy 2.5.5, scipy 1.18.1, pandas 3.1.1, scikit-learn 1.9.1) run twice on x86 (laptop, runc) and twice on arm64 (verifiers VM, gVisor). Within each arch identical; across arch only canonicalised outputs match (D40).
- D37 decided: budgets and prizes in fUSD, funded via a QOR → fUSD swap in native pool 2 when needed; BERU for stakes and slashing. AWS budget `strongchar-credits` created ($100, usage before credits, email alerts at 70% and 85%). PR #3 merged.
- Phase 1 started. P1.1 done: `strongchar_core` (keccak, weight blobs, exact judge, median-clip trimmed-mean merge and gate, equal fUSD payout, canonical evidence, finalize with slashing, PQ message encoding, cross-language vectors), `strongchar_workloads` (fixed-order kernel, exact MLP, round runner, op counts), `strongchar_datasets` (canonicaliser, split with an owner holdout, shard files). Merge, gate, shuffle, kernel and MLP steps match the earlier deterministic maths bit for bit on random inputs. The MLP self-test hash is identical on x86 and on arm64 under gVisor (389ba66f…). P1.2 done: seeded synthetic health table, 20,000 rows, 20% positives. 33 tests green (+1 live MNIST test).
- Note: the health table has raw-scale features; the job flow must standardise them (fixed-order stats from the train split) before training.
- P1.3 done (#6). P1.4 done on branch p1-contracts: BeruToken (fixed supply, no admin), BeruFaucet, Encodings (checked against the Python vectors), NodeRegistry, JobMarket (D41–D43), `checkSignature` view for a free live pqcVerify check. 25 Foundry tests incl. a payout fuzz. Real verifier-a/b ML-DSA signatures over the vector message in vectors/pq_signatures.json.
- Finding: Foundry fork tests can't exercise QoreChain's precompiles (forks run in Foundry's own EVM, where 0x…0a01/0a02 have no code), so the real pqcVerify check runs against diana with eth_call after deploy.
- Next: P1.5 deploy (needs Rounak's go-ahead), P1.6 CI.

### 2026-11-19
- Rule: no Claude attribution in any commit or PR (local commit-msg hook + saved rule); past history left as is by Rounak's choice. PR #7 merged with a clean squash message.
- P1.5 deployed to diana (deploy block 10,338,199): JobMarket 0xa5FA…2EaDa, NodeRegistry 0x0811…73f1, BeruToken 0x6Cd5…6D34, BeruFaucet 0xCF74…3b67; wiring verified on-chain; real verifier-a/b ML-DSA-87 signatures verify through the deployed JobMarket (211,870 gas per check), a tampered one is rejected. Cost 1.28 QOR.
- Finding: diana bills at least 50% of an EVM tx's gas limit (every deploy with a 6M limit used exactly 3M). Always size gas limits from eth_estimateGas × ~1.2.
- P1.6 covered by existing CI. Phase 2 started on branch p2-market-client: `strongchar_qore.deployment` + `market` (contract client, WindowManager that renews scoped windows), coordinator service (SQLite + content-addressed envelope store, ML-DSA challenge login, recipient-only blob reads via envelope hints, drafts, verifier-only signature relay, heartbeats, rate limits, security headers) with offline tests.
- Phase 2 design: chain is the source of truth; services idempotent; nodes only commit/reveal hashes (verifiers replay fully, so no weight uploads); both verifiers sign expiry = round-open block + 10,000.
- Phase 2 exit check met (19 Nov): job 1 on diana, 2 rounds, 4 nodes; node-4 caught by replay (ReplayMismatch) and slashed both rounds; settlements with both ML-DSA-87 signatures verified on-chain (590–650k gas each); honest nodes claimed; owner opened the final model locally (holdout accuracy 0.310 → 0.777); coordinator data audited ciphertext-only. Tx hashes in the README.
- Findings: (1) fUSD from the native AMM arrives as a bank coin (`erc20:0x…`) that ERC-20 `balanceOf` doesn't see; it needs `/cosmos.evm.erc20.v1.MsgConvertCoin` (hand-encoded in `strongchar_qore.erc20`; the SDK has no composer). (2) Service logins share an IP (all nodes on one server), so login rate limits key on IP + account. (3) The second verifier's submit races the first (WrongState); verifiers re-check status and treat it as done.
- J3a (benchmark ranking): with shards fixed to nodes at sealing time, scheduling reduces to eligibility (joined, staked, idle, live heartbeat, benchmark under the floor); reasons are stored per job for the Nodes page. Full ranking stays cut (D23 item 2).
- Next: Phase 3 (competitions); move the Phase 2 services onto the three VMs in Phase 6.

### 2026-11-18
- Researched the event, past winners and similar projects. Category and scope decided (D1–D13).
- Checked QoreChain packages: Python SDK, QoreSign and QoreSeal all on PyPI; npm packages all published.
- Wrote PRD, ARCHITECTURE, DESIGN, PHASES, RULES, MEMORY. Decided D14–D19 (lean coordinator, Beru, side repo, naming, benchmark-ranked nodes).
- Hosting moved to AWS (D15): free plan, $100 credits, Region ap-southeast-2; AWS CLI and agent toolkit set up locally (nothing committed).
- Public repo and project page created (Encrypted Apps, AI-Native, Quantum Campus, Regional India; 10 kits and 9 features declared, unverified until code and txs exist). QoreChain Build GitHub App installed on the repo only. Registration 4/4.
- Rounak's QoreX wallet holds about 99 QOR, 1,000 fUSD, 0.5 fETH, 0.02 fBTC. It funds the deployer; the deployer funds the service accounts.
- Red-team review of the plan against the live rules, FAQ and chain params (read-only). Closed Q2, Q4, Q6, Q10; narrowed Q3; added Q16, Q17. Decided D20–D34: public docs scope, two VMs, honest tagline, cut order, mandatory windows, no `prevrandao`, permissionless finalize with immutable verifiers, refund paths, hardened blob store and sandbox, sslip.io hostname, replay-proof signed payloads, 5 listed addresses, AI_USAGE log, arm64-pinned verifiers.
- Next: Phase 0 (19–20 Nov).
