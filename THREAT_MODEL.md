# strongChar threat model

What strongChar protects, from whom, and where the protection stops. It covers the code in this repository as
deployed on QoreChain testnet `diana` (chain ID 9800).

## What we protect

| Asset | Who may read it |
|---|---|
| A data owner's training shards | The two verifiers, and each node seated on that shard for the rounds it trains it |
| The validation split | The two verifiers |
| The trained model | The data owner |
| A competition's test features and hidden labels | The two verifiers until the deadline; labels are public after the reveal |
| An entrant's script | The two verifiers; its hash is public from submission |
| Payments (fUSD) and stakes (BERU) | Moved only by the contracts' own rules |

Everything else is public by design: the job spec, round results, per-node replay verdicts, signatures, score tables, a
competition's training set and the predictions of valid entries.

## Trust assumptions

- **QoreChain is honest and live.** Contract state, `pqcVerify` (`0x…0a01`) and `pqcKeyStatus` (`0x…0a02`) behave as
  documented.
- **At least one of the two verifiers is honest for correctness, and both are honest for confidentiality.** Both
  verifiers must sign every settlement, validity verdict and score table, so one honest verifier blocks a false result.
  Each verifier can read everything sealed to it.
- **A node reads its own shard.** It can't train on data it can't read. Sealing limits who reads a shard; it doesn't
  hide the shard from the machine doing the work. Nodes are seated per round, so over a long job more than one node
  may train, and read, the same shard. Owners seal shards to the verifiers, which re-seal each round's shard to the
  seated node only; the node checks the bytes against the owner's committed hash, so a verifier can't swap the data.
- **The coordinator is untrusted for secrecy and correctness.** It stores ciphertext, relays signatures and serves
  metadata. It holds no decryption key and can't produce a signature the contracts accept. It can refuse service.

## Threats and mitigations (STRIDE)

### Spoofing

| Threat | Mitigation |
|---|---|
| Forged settlement, validity or score signature | Each payload is signed with ML-DSA-87 by both verifiers. The contract checks both with `pqcVerify` against keys that `pqcKeyStatus` reports as possession-proven. The verifier pair is fixed at deploy, with no admin to change it. |
| Fake recipient card, so a sealer encrypts to an attacker's key | Cards are signed with both of the account's keys and checked against the on-chain QoreSeal key registry before sealing. A forged card is rejected (tested). |
| Impersonating a node or verifier to the coordinator | Login is an ML-DSA challenge signed by the account's registered key. Uploads, attestations and signature relay check the caller's role on-chain. |

### Tampering

| Threat | Mitigation |
|---|---|
| A node submits a wrong model update | Nodes commit to the hash of their update, then reveal it. Both verifiers replay every node's round exactly (bit-identical kernel on x86 and arm64). A mismatch is a `ReplayMismatch` verdict that slashes the node's BERU stake. Demonstrated by node-4 in job 1. |
| Altered ciphertext or a sealed blob moved to another job | QoreSeal envelopes are authenticated. The AAD binds the chain, contract, job/competition, round, index, kind and the hash of the recipient set, so a moved or edited envelope doesn't open. |
| An entrant's script tampers with the scoring data | The script runs with read-only data mounts, a read-only root filesystem, no network, no capabilities and a non-root user, under gVisor on the verifiers server. |
| The host changes the labels after seeing entries | The labels are committed (`keccak(abi.encode(keccak(labels), salt))`) when the competition opens and must match at reveal. The web page recomputes the check from the reveal transaction. |

### Repudiation

Every verdict, score table, slash and payout is an on-chain transaction carrying both verifiers' signatures. The web
app links each one to the explorer. Run results that lead to a verdict are kept on the coordinator per entry.

### Information disclosure

| Threat | Mitigation |
|---|---|
| Harvest now, decrypt after Q-Day | Data is sealed with ML-KEM-1024 (QoreSeal); verdicts are signed with ML-DSA-87. No classical-only key protects data at rest or in transit through the coordinator. |
| Server compromise of the public edge | The edge holds ciphertext only. The `/sealed` page and an audit script show what it stores; the audit found no plaintext after job 1. |
| Scraping other people's envelopes | A blob is served only to an authenticated caller listed in its recipient hints. |
| A competition script exfiltrates test features | No network. Published run results contain only a fixed reason code, a fixed description and the runtime in whole seconds; the script's own output is never published (regression test). |
| Probing the hidden labels through the leaderboard | There is no live leaderboard. Before the deadline, the only signal is valid or invalid, which doesn't depend on the labels. Scores are posted once, after the deadline. |
| Keys leaking from services | Each container receives only its own mnemonic, as a mode-600 file owned by the service user. The start script refuses looser files. The key store's repr hides secrets (tested). |

### Denial of service

| Threat | Mitigation |
|---|---|
| Coordinator down | Chain state stays authoritative, and the web app falls back to chain data. Stalled jobs refund the owner; honest stake stays withdrawable. If scores or labels never arrive, the prize returns to the host after a grace period. A verifier may reveal the labels if the host doesn't. |
| Junk uploads | Envelopes are parsed and size-capped per kind. Uploads need authentication and are rate-limited per account. Unreferenced uploads expire. |
| Hostile scripts | CPU, memory, process-count, file-handle and wall-clock limits; a fork bomb, a timeout and oversized output are tested. |
| A competition flooded with entries | At most 256 entries per competition, and a per-entrant cap the host sets. |

### Elevation of privilege

| Threat | Mitigation |
|---|---|
| Container escape from a competition script | gVisor (`runsc`) puts a user-space kernel between the script and the host, and the verifiers server runs nothing else. The Docker socket on that server is the main residual risk and is accepted for the demo. |
| Admin keys on contracts | None. No owner, no upgrade path, no pause. |

## Known limits

- **Two colluding verifiers** can sign any result and read every sealed input. Raising the threshold (k of n
  verifiers) is the natural next step.
- **Nodes see plaintext shards.** Hiding data from the machine that trains on it needs secure enclaves or FHE, which
  are out of scope.
- **Run time is a narrow side channel.** A script can vary its run time. Whole-second rounding, the timeout and the
  per-entrant cap keep it to a few bits per entry.
- **Model output leaks something about training data.** Membership inference against the final model is outside this
  design. The model goes only to the data owner.
- **Testnet only.** Funds are testnet fUSD and BERU. The services run on three small VMs with no redundancy.
