// Post a job from the browser, the same steps as strongchar_runtime.owner.post: seal every shard and the validation
// split to the two verifiers, store the draft, get fUSD, open a scoped EVM window, approve and createJob.
import { evmWindowCost, evmWindowStatus } from "@qorechain/evm";
import { diana } from "@/lib/evm-chain";
import { closeEvmWindowMsg, msg, openEvmWindowMsg } from "@qorechain/sdk";
import {
  createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, keccak256, concat as concatHex, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deployment, jobMarketAbi } from "@/lib/deployment";
import type { Owner } from "./account";
import { REST, balance, submit } from "./chain";
import type { Plan } from "./prepare";
import { aad, recipient, sealTo } from "./seal";

const MARKET = deployment.job_market as Hex;
const FUSD = deployment.fusd as Hex;
const FUSD_DENOM = `erc20:${deployment.fusd}`;
const POOL_FUSD_QOR = "2";
const WINDOWS = { commit: 240, reveal: 180, finalize: 1200 } as const;
const evm = createPublicClient({ chain: diana, transport: http() });
/** Twice the current base fee: read once per job, then both the window size and every transaction use it. */
const maxFee = async () => (await evm.getBlock()).baseFeePerGas! * 2n;

export type Progress = (step: string, detail?: string) => void;

// MsgConvertCoin{coin{denom, amount}, receiver 0x, sender qor1}: the SDK has no composer, so encode it as Python does.
function varint(n: number): number[] { const o: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; }
const field = (num: number, payload: Uint8Array) => new Uint8Array([...varint((num << 3) | 2), ...varint(payload.length), ...payload]);
const utf8 = (s: string) => new TextEncoder().encode(s);
function convertCoin(amount: bigint, receiverEvm: string, senderQor: string) {
  const coin = new Uint8Array([...field(1, utf8(FUSD_DENOM)), ...field(2, utf8(amount.toString()))]);
  return { typeUrl: "/cosmos.evm.erc20.v1.MsgConvertCoin", value: new Uint8Array([...field(1, coin), ...field(2, utf8(receiverEvm)), ...field(3, utf8(senderQor))]) };
}

async function bankBalance(qor: string, denom: string) { return balance(qor, denom); }

/** fUSD where a contract can pull it: swap QOR in native AMM pool 2 if short, then convert the bank coin to the ERC-20. */
export async function ensureFusd(o: Owner, need: bigint, log: Progress): Promise<void> {
  const a = o.account;
  const erc = await evm.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [a.evm as Hex] });
  const have = erc + (await bankBalance(a.cosmos, FUSD_DENOM));
  if (have < need) {
    const { pools } = await (await fetch(`${REST}/qorechain/amm/v1/pools`)).json() as { pools: { id: string; reserve_a: string; reserve_b: string }[] };
    const pool = pools.find((p) => p.id === POOL_FUSD_QOR)!;
    const ra = BigInt(pool.reserve_a), rb = BigInt(pool.reserve_b); // a = fUSD, b = uqor
    const want = (need - have) * 12n / 10n;
    const amountIn = rb * want / (ra - want) * 10_000n / 9_960n + 1n;
    log("Swapping QOR for fUSD", `${(Number(amountIn) / 1e6).toFixed(4)} QOR in AMM pool ${POOL_FUSD_QOR}`);
    await submit(a, [msg.amm.swapExactIn({ sender: a.cosmos, poolId: POOL_FUSD_QOR, tokenIn: { denom: "uqor", amount: amountIn.toString() }, denomOut: FUSD_DENOM, minOut: (need - have).toString() }) as any]);
  }
  const bank = await bankBalance(a.cosmos, FUSD_DENOM);
  if (bank > 0n) {
    log("Converting fUSD to the ERC-20 the contract uses");
    await submit(a, [convertCoin(bank, a.evm, a.cosmos) as any]);
  }
}

/** Opens a window scoped to fUSD and the JobMarket, sized for `txs` transactions of `gas` each. */
async function ensureWindow(o: Owner, txs: number, gas: bigint, fee: bigint, log: Progress): Promise<void> {
  const a = o.account;
  const need = BigInt(txs) * evmWindowCost({ gas, maxFeePerGas: fee });
  const w = await evmWindowStatus({ rest: `${location.origin}${REST}`, address: a.cosmos });
  const targets = [FUSD, MARKET].map((t) => t.toLowerCase());
  const have = new Set((w.allowedTargets ?? []).map((t) => t.toLowerCase()));
  if (w.live && targets.every((t) => have.has(t)) && w.remainingTxs >= BigInt(txs) && w.remainingValue >= need && w.remainingBlocks >= 120n) return;
  if (w.live) await submit(a, [closeEvmWindowMsg(a.cosmos) as any]);
  log("Opening an EVM window", "scoped to fUSD and the JobMarket, for these two transactions only");
  await submit(a, [openEvmWindowMsg({ sender: a.cosmos, blocks: 3_000, maxTxs: txs, maxValue: (need > 2_000_000n ? need : 2_000_000n).toString(), allowedTargets: [FUSD, MARKET] }) as any]);
}

async function estimate(o: Owner, to: Hex, data: Hex): Promise<bigint> {
  const gas = await evm.estimateGas({ account: o.account.evm as Hex, to, data });
  return gas * 125n / 100n + 20_000n;
}

async function sendEvm(o: Owner, to: Hex, data: Hex, gas: bigint, fee: bigint): Promise<Hex> {
  const account = privateKeyToAccount(o.account.privateKey as Hex);
  const wallet = createWalletClient({ account, chain: diana, transport: http() });
  const nonce = await evm.getTransactionCount({ address: account.address, blockTag: "pending" }); // read after the window opened
  const hash = await wallet.sendTransaction({ to, data, gas, nonce, maxFeePerGas: fee, maxPriorityFeePerGas: 0n });
  const r = await evm.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  return hash;
}

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
  await ensureWindow(o, 2, 1_500_000n, fee, log);
  log("Approving the budget", `${(Number(p.budget) / 1e6).toFixed(6)} fUSD`);
  await sendEvm(o, FUSD, approve, gasA, fee);
  log("Creating the job on chain");
  const createTx = await sendEvm(o, MARKET, create, await estimate(o, MARKET, create), fee);
  await submit(a, [closeEvmWindowMsg(a.cosmos) as any]);
  const count = Number(await evm.readContract({ address: MARKET, abi: jobMarketAbi, functionName: "jobCount" }));
  if (count !== jobId) throw new Error(`another job took id ${jobId} at the same moment; post again`);
  return { jobId, createTx, specHash: sh, blobs: shardIds.length + 1 };
}
