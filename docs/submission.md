# Submission material

Paste-ready text for the project page on build.qorechain.io, and the video script. Numbers and links are from the
live testnet stack; check them again before the freeze.

## Tagline

Your data, sealed to only the machines that need it. Every step proven.

## Links

- Demo: https://strongchar.vercel.app
- GitHub: https://github.com/rounak-agl/strongChar
- Coordinator (AWS, TLS): https://32-237-26-58.sslip.io/v1/health
- Featured image: `docs/cover/cover.png` (1600×900)

## About

Hospitals, banks and schools sit on data that could train useful models, and they can't send it to a stranger's
GPU. Federated learning keeps the data home but makes you trust whoever runs the training. Kaggle-style
competitions ask you to trust the host with the hidden labels and every submitted script. And anything encrypted
today with classical keys can be stored now and opened once quantum computers arrive.

strongChar lets anyone train a model on private data using other people's computers, and run competitions where
the hidden test set never leaks, with nothing taken on trust that the chain can check.

How a job runs:

- Sealed, never shown. The owner splits the data into shards and seals each one with QoreSeal (ML-KEM-1024 with
  X25519) to the two verifiers' registered keys. The coordinator stores ciphertext only and serves it only to a
  listed recipient. Each round, a verifier re-seals a seated node's shard to that node alone, and the node checks it
  against the hash the owner committed to on-chain.
- Best nodes, every round. A laptop joins with four commands (init, setup, doctor, run): it registers its keys, stakes BERU and starts training. Each
  round seats the fastest nodes online; a node that cheats or goes quiet is skipped.
- Bit-exact replay. Training runs on a CPU kernel that gives the same bytes on every machine (x86 laptops and the
  arm64 servers produce identical hashes). Two verifiers rerun every node's work; a different hash is a cheat, with
  no tolerance to argue about.
- Post-quantum settlement. Both verifiers sign one settlement with ML-DSA-87. The JobMarket contract checks both
  signatures with the pqcVerify precompile against possession-proven keys before anyone is paid; cheaters lose their
  stake, honest nodes are paid in fUSD. New nodes are on probation: their share goes to a community pool that tops
  up proven nodes, so throwaway nodes earn nothing.
- Model for the owner only. The final model is sealed to the owner, who opens it and scores it on rows that never
  left their machine.

Competitions work the same way: hosts seal test rows and labels to the verifiers and commit the labels on-chain;
entrants seal their scripts; both verifiers run each script in a network-less gVisor sandbox and sign the same
verdict and score table; the labels are revealed on-chain so anyone can recompute the ranking.

Live now on qorechain-diana:

- Job 3 trained on the AWS stack: validation loss 1.416 → 0.449, holdout accuracy 0.310 → 0.777. A cheating node was
  caught by replay and slashed in both rounds.
- Competition 2 ran three sealed scripts under gVisor: logistic regression won (0.832), always-zero scored 0.815, and
  a script that tried to reach the network was rejected.
- Five node machines on separate IPs (containers on one host) were seated per round, including one onboarded from
  scratch with the CLI.

Threat model, limits and every transaction hash: see the README and THREAT_MODEL.md.

## How it's made

- Python 3.12 (uv workspace): a bit-exact MLP kernel, canonical datasets, the merge and gate, settlement, the
  coordinator (FastAPI), the node and verifier services and the `strongchar-node` and `strongchar-job` CLIs.
- QoreChain kits: qorechain-sdk (hybrid ML-DSA-87 transactions, scoped EVM windows, PQC and KEM key registration),
  QoreSeal (multi-recipient ML-KEM-1024 envelopes with AAD bound to chain, contract, job, round, shard and
  recipients), QoreSign recipient cards, native AMM pool 2 for QOR → fUSD.
- Solidity (Foundry, 55 tests): JobMarket, NodeRegistry, Competitions and the BERU token; settlements and score
  tables are accepted only with two ML-DSA-87 signatures checked by the pqcVerify precompile, and keys are checked
  with pqcKeyStatus. Forged, replayed and expired signatures are tested with a mocked precompile and a diana fork.
- Infrastructure: three arm64 AWS servers (coordinator behind Caddy TLS, four nodes, two verifiers with gVisor),
  one hardened Docker image, per-service key files; the web app is Next.js on Vercel reading the chain and the
  coordinator.
- AI: built with an AI coding assistant under my direction; every change went through a reviewed pull request with
  CI. Details in AI_USAGE.md.

## Video script (under 3:00)

1. 0:00–0:20 Problem. Private data can't go to a stranger's GPU; competitions leak test labels; classical
   encryption has an expiry date.
2. 0:20–0:45 Home page live: the network strip, the hero drawing job 3's signed loss curve, nodes online.
3. 0:45–1:20 A job: `strongchar-job post data.csv`; the job page shows shards sealed to the verifiers, who got
   seated and why, then a round receipt: four replays, one ReplayMismatch, slashed.
4. 1:20–1:45 The proof: click the settlement transaction on explore.qore.network; two ML-DSA-87 signatures checked
   by pqcVerify.
5. 1:45–2:10 A laptop joining: `strongchar-node init`, `setup`, `doctor`, `run`; the node page shows probation,
   then graduation and pay.
6. 2:10–2:40 Competition 2: sealed scripts, the gVisor sandbox rejecting the network script, the label check.
7. 2:40–3:00 The kernel demo on x86 and the arm64 server giving the same hash; close on the tagline.
