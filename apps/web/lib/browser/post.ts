// Post a job from the browser, the same steps as strongchar_runtime.owner.post: seal every shard and the validation
// split to the two verifiers, store the draft, get fUSD, open a scoped EVM window, approve and createJob.
import { encodeFunctionData, erc20Abi, keccak256, concat as concatHex, type Hex } from "viem";
import { deployment, jobMarketAbi } from "@/lib/deployment";
import type { Owner } from "./account";
import { FUSD, closeWindow, ensureFusd, ensureWindow, estimate, evm, maxFee, sendEvm, type Progress } from "./evm";
import type { Plan } from "./prepare";
import { aad, recipient, sealTo } from "./seal";

export type { Progress } from "./evm";
const MARKET = deployment.job_market as Hex;
const WINDOWS = { commit: 240, reveal: 180, finalize: 1200 } as const;

export type Posted = { jobId: number; createTx: Hex; specHash: string; blobs: number };

export async function postJob(o: Owner, p: Plan, log: Progress): Promise<Posted> {
  const a = o.account;
  log("Checking the verifiers' keys against the chain");
  const vs = await Promise.all([deployment.verifier_a, deployment.verifier_b].map(recipient));
  const recips = vs.map((v) => v.recipient);
  const keys = vs.map((v) => v.kem);
  const jobId = Number(await evm.readContract({ address: MARKET, abi: jobMarketAbi, functionName: "jobCount" })) + 1; // bound into every AAD

  log("Sealing in this browser", `${p.shards.length} shards and the validation split, to both verifiers only`);
  const shardIds: string[] = [];
  const shardHashes: Hex[] = [];
  for (const [i, blob] of p.shards.entries()) {
    shardIds.push(await o.coordinator.putBlob(sealTo(recips, blob, "shard", aad(MARKET, jobId, 0, i, "shard", keys)), "shard"));
    shardHashes.push(keccak256(blob));
    log("Uploading ciphertext", `shard ${i + 1} of ${p.shards.length}`);
  }
  const valId = await o.coordinator.putBlob(sealTo(recips, p.val, "val", aad(MARKET, jobId, 0, 0, "val", keys)), "val");
  const valHash = keccak256(p.val);
  const sh = await o.coordinator.putDraft(p.spec, { shards: shardIds, shardHashes, val: valId, valHash });
  if (sh !== p.specHash) throw new Error("the coordinator computed a different spec hash; nothing was paid");

  const rounds = Number(p.spec.rounds);
  const stake = await evm.readContract({ address: MARKET, abi: jobMarketAbi, functionName: "minStake", args: [p.budget, rounds, p.quorum] });
  await ensureFusd(o, p.budget, log);

  const params = {
    specHash: p.specHash, initialWeightsHash: p.initialWeightsHash, shardTableHash: p.shardTableHash,
    dataCommit: keccak256(concatHex([...shardHashes, valHash])), budget: p.budget, stakePerNode: stake,
    rounds, quorum: p.quorum, maxNodes: p.maxNodes, windows: WINDOWS, refWorkSecondsPerRound: p.refWork,
  } as const;
  const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [MARKET, p.budget] });
  const create = encodeFunctionData({ abi: jobMarketAbi, functionName: "createJob", args: [params] });
  // Estimate first so a revert surfaces with its reason and costs nothing. createJob pulls the budget, so it can only
  // be estimated after approve; the window is sized for a generous createJob until then.
  const gasA = await estimate(o, FUSD, approve);
  const fee = await maxFee();
  await ensureWindow(o, [FUSD, MARKET], 2, 1_500_000n, fee, log, "scoped to fUSD and the JobMarket, for these two transactions only");
  log("Approving the budget", `${(Number(p.budget) / 1e6).toFixed(6)} fUSD`);
  await sendEvm(o, FUSD, approve, gasA, fee);
  log("Creating the job on chain");
  const createTx = await sendEvm(o, MARKET, create, await estimate(o, MARKET, create), fee);
  await closeWindow(o);
  const count = Number(await evm.readContract({ address: MARKET, abi: jobMarketAbi, functionName: "jobCount" }));
  if (count !== jobId) throw new Error(`another job took id ${jobId} at the same moment; post again`);
  return { jobId, createTx, specHash: sh, blobs: shardIds.length + 1 };
}
