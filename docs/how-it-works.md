# How strongChar works

strongChar lets a group of computers train one model on data they are never shown in the clear. Each round, the
coordinator seats the best nodes that are online. Each node trains on its slice. Two verifiers rerun every node's
work and compare bytes. Honest work is paid in fUSD on QoreChain, and a node caught cheating loses its BERU stake.

The sections below cover the pieces this depends on, and each one names the code that does it.

## Training is bit-exact

A verifier can only check a node's training by rerunning it if both machines produce exactly the same bytes.
Ordinary numpy can't promise that: BLAS picks a summation order based on the CPU and thread count, and `exp` and
`log` come from the system's math library. [`kernel.py`](../packages/workloads/src/strongchar_workloads/kernel.py)
therefore does matrix multiplies, sums and the row max as plain loops in a fixed order. It computes `exp` and `log`
from fixed series using only IEEE adds, multiplies and divides, and
[`mlp.py`](../packages/workloads/src/strongchar_workloads/mlp.py) builds a one-hidden-layer MLP on top of that.

Run `uv run python -m strongchar_runtime.demo` on any machine. In about a second it trains one round with four
nodes, one of them cheating, replays each node, merges the results and settles. It then checks every hash against
[`vectors/kernel/demo_round.json`](../vectors/kernel/demo_round.json). Every node also runs a fixed self-test in
each heartbeat, and a node whose self-test hash differs is never seated.

## Canonical data, sealed to the verifiers

[`canonical.py`](../packages/datasets/src/strongchar_datasets/canonical.py) turns the owner's CSV into fixed arrays:
the last column is the target, rows are put in an order set by a hash of each row, and features are standardised
with statistics from the training rows only. The rows are then split into training shards, a validation split and
a holdout. The holdout never leaves the owner's machine, and the owner scores the final model on it.

The owner seals every shard and the validation split to the two verifiers with QoreSeal (ML-KEM-1024 plus X25519).
Each envelope's AAD binds the chain, contract, job, round, shard, kind and recipient set, so an envelope moved to
another slot fails to open. The coordinator stores only ciphertext. It serves a blob only to an address whose
registered ML-KEM key is one of the envelope's recipients.

## Who gets seated

The coordinator's matcher ([`keeper.py`](../services/coordinator/src/strongchar_coordinator/keeper.py)) chooses
each round's nodes from every node online, never from a list fixed when the job was created. A node is eligible if
it:

- has joined the registry and holds at least the job's stake;
- sent a heartbeat in the last minute;
- is idle;
- passes the self-test and is under the benchmark floor;
- hasn't missed two commits in a row;
- isn't stopping.

Eligible nodes are ranked by self-test benchmark, fastest first, then by how long they have waited. The job whose
next round pays most is seated first. Shards trained longest ago go first, so every shard keeps moving even when
fewer nodes than shards are online. The reasons a node wasn't seated are served at `/v1/jobs/{id}/matcher`.

When the round opens, both verifiers re-seal each seated node's shard to that node alone, plus the start weights
after round 1, and post the blob ids as the round's feed. The node checks the shard against the hash the owner
committed to, and the weights against the round's start hash, so a verifier can't swap in other data.

## A round

1. **Open.** The coordinator calls `openRound` with the seated nodes and their shards.
2. **Train.** Each node trains for a fixed number of steps from the round's start weights. Batches come from a
   shuffle seeded by the job, the shard and the epoch, so no node picks its own rows.
3. **Commit.** Each node posts a hash of its checkpoint hashes, a salt and its own address. No node can copy
   another's commitment.
4. **Reveal.** Each node publishes the checkpoint hashes and its salt. The first checkpoint must equal the round's
   start weights.
5. **Replay.** Both verifiers rerun every revealed node from the same start and shard
   ([`judge.py`](../packages/core/src/strongchar_core/judge.py)). The bytes either match or the node is a
   `ReplayMismatch`. There is no tolerance band to argue about.
6. **Merge and gate.** [`aggregate.py`](../packages/core/src/strongchar_core/aggregate.py) clips updates larger
   than the median size and averages each weight after dropping the extreme values. The gate keeps the merge only
   if validation loss is no worse than 10% plus 0.01. Otherwise it drops the one node that explains the bad merge,
   and if no single node does, the round reverts.
7. **Settle.** Both verifiers compute the same settlement
   ([`finalize.py`](../packages/core/src/strongchar_core/finalize.py)) and sign it with ML-DSA-87. `finalizeRound`
   checks both signatures through the `pqcVerify` precompile and accepts the round only if both verify. Anyone may
   submit it, so the coordinator is not a trust point. The merged weights are sealed to the verifiers, and after the
   last round to the owner alone.

## Money

- **Price.** A job costs a fixed amount of fUSD per Gop (10⁹ float operations) of training, for every seat and
  round ([`owner.py`](../packages/runtime/src/strongchar_runtime/owner.py)). Each round gets an equal slice of the
  remaining budget.
- **Stake floor.** Every seat must stake at least `max(15 BERU, 2 × budget ÷ rounds ÷ quorum)`, so cheating always
  costs more than it could earn. A node whose replay doesn't match loses the job's full stake, which is burned. A
  seated node that never reveals loses 10%.
- **Equal pay.** Every node that revealed, replayed bit-exactly and survived the gate gets an equal share of the
  round's budget. The contract rejects any payout list that doesn't add up exactly, or that pays a graduated node
  less than half an equal share.
- **Probation and the community pool.** A new node is on probation until it has enough verified work, credited
  only by rounds both verifiers signed. While on probation its share goes to the community pool. Each round, 10% of
  the pool is set aside and paid to the graduated nodes among its payees, so throwaway nodes fund the proven ones
  rather than earning straight away.
- **Claims and refunds.** Nodes claim their fUSD from the contract. A void, expired or reverted round returns its
  budget to the job, and a cancelled job refunds the owner.

## Competitions

A host publishes a training set, seals hidden test rows and labels to the two verifiers, and commits to the labels
on-chain. Entrants submit scripts sealed to the verifiers. Each verifier runs every script in a locked-down sandbox
([`sandbox.py`](../packages/compete/src/strongchar_compete/sandbox.py)): no network, read-only, capped, and under
gVisor on the server. The two verifiers sign one validity verdict and, after the deadline, one score table. The
host then reveals the labels, anyone can check them against the commitment, and the contract pays the winner.

## What it doesn't protect against

See [THREAT_MODEL.md](../THREAT_MODEL.md). In short:

- The two verifiers together can read every sealed input and sign anything.
- A node reads the plaintext of the shard it trains.
- Everything runs on the qorechain-diana testnet.
