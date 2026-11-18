// Server-side chain reads over viem: jobs, rounds, seats, settlements (with their tx hashes) and nodes.
import { createPublicClient, defineChain, http, type Address, type Hex } from "viem";
import { deployment, jobMarketAbi, nodeRegistryAbi } from "./deployment";

export const diana = defineChain({
  id: 9800,
  name: "QoreChain diana",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: ["https://evm-testnet.qore.host"] } },
  blockExplorers: { default: { name: "QoreScan", url: "https://explore.qore.network" } },
});

export const client = createPublicClient({ chain: diana, transport: http(undefined, { fetchOptions: { headers: { "user-agent": "strongchar-web/0.1" } } }) });
export const explorerTx = (h: string) => `https://explore.qore.network/tx/${h}`;
export const explorerAddr = (a: string) => `https://explore.qore.network/address/${a}`;

const market = deployment.job_market as Address;
const registry = deployment.node_registry as Address;
const FROM = BigInt(deployment.deploy_block);

export const ROUND_STATUS = ["None", "Open", "Settled", "Reverted", "Void", "Expired"] as const;
export const JOB_STATUS = ["None", "Active", "Completed", "Cancelled"] as const;

export type Job = {
  id: number; owner: Address; status: (typeof JOB_STATUS)[number]; roundsOpened: number; rounds: number;
  budget: bigint; remaining: bigint; quorum: number; stake: bigint; specHash: Hex; weights: Hex;
};

export async function jobCount(): Promise<number> {
  return Number(await client.readContract({ address: market, abi: jobMarketAbi, functionName: "jobCount" }));
}

export async function getJob(id: number): Promise<Job> {
  const [p, j] = (await client.readContract({ address: market, abi: jobMarketAbi, functionName: "getJob", args: [BigInt(id)] })) as any;
  return {
    id, owner: j.owner, status: JOB_STATUS[j.status], roundsOpened: Number(j.roundsOpened), rounds: Number(p.rounds),
    budget: p.budget, remaining: j.remaining, quorum: Number(p.quorum), stake: p.stakePerNode, specHash: p.specHash, weights: j.weights,
  };
}

export type Seat = { node: Address; committed: boolean; revealed: boolean; finalHash: Hex; slashed: boolean };
export type Round = {
  id: number; status: (typeof ROUND_STATUS)[number]; budget: bigint; startHash: Hex; aggregateHash: Hex;
  aggEvidenceHash: Hex; payEvidenceHash: Hex; slashedBitmap: number; seats: Seat[];
  commitDeadline: number; revealDeadline: number; finalizeBy: number;
};

export async function getRound(job: number, id: number): Promise<Round> {
  const [r, roster] = (await client.readContract({ address: market, abi: jobMarketAbi, functionName: "getRound", args: [BigInt(job), BigInt(id)] })) as any;
  const seats = await Promise.all((roster as Address[]).map(async (node, i) => {
    const s = (await client.readContract({ address: market, abi: jobMarketAbi, functionName: "getSeat", args: [BigInt(job), BigInt(id), node] })) as any;
    return { node, committed: s.commitHash !== `0x${"0".repeat(64)}`, revealed: s.revealed, finalHash: s.finalHash,
             slashed: ((Number(r.slashedBitmap) >> i) & 1) === 1 };
  }));
  return {
    id, status: ROUND_STATUS[r.status], budget: r.budget, startHash: r.startWeightsHash, aggregateHash: r.aggregateHash,
    aggEvidenceHash: r.aggEvidenceHash, payEvidenceHash: r.payEvidenceHash, slashedBitmap: Number(r.slashedBitmap), seats,
    commitDeadline: Number(r.commitDeadline), revealDeadline: Number(r.revealDeadline), finalizeBy: Number(r.finalizeBy),
  };
}

export type TxRef = { round: number; tx: Hex; block: bigint };

/** The transactions where settlements passed pqcVerify, and where rounds opened, for explorer links. */
export async function jobEvents(job: number): Promise<{ settled: TxRef[]; opened: TxRef[]; slashed: { round: number; node: Address; amount: bigint; tx: Hex }[] }> {
  const args = { jobId: BigInt(job) };
  const [settled, opened, slashed] = await Promise.all([
    client.getContractEvents({ address: market, abi: jobMarketAbi, eventName: "RoundSettled", args, fromBlock: FROM }),
    client.getContractEvents({ address: market, abi: jobMarketAbi, eventName: "RoundOpened", args, fromBlock: FROM }),
    client.getContractEvents({ address: market, abi: jobMarketAbi, eventName: "Slashed", args, fromBlock: FROM }),
  ]);
  const ref = (e: any): TxRef => ({ round: Number(e.args.roundId), tx: e.transactionHash, block: e.blockNumber });
  return {
    settled: settled.map(ref), opened: opened.map(ref),
    slashed: slashed.map((e: any) => ({ round: Number(e.args.roundId), node: e.args.node, amount: e.args.amount, tx: e.transactionHash })),
  };
}

export type NodeInfo = { address: Address; stake: bigint; busyJob: number };

export async function nodes(): Promise<NodeInfo[]> {
  const joined = await client.getContractEvents({ address: registry, abi: nodeRegistryAbi, eventName: "NodeJoined", fromBlock: FROM });
  return Promise.all(joined.map(async (e: any) => {
    const n = (await client.readContract({ address: registry, abi: nodeRegistryAbi, functionName: "getNode", args: [e.args.node] })) as any;
    return { address: e.args.node, stake: n.stake, busyJob: Number(n.busyJob) };
  }));
}

export const fmt6 = (v: bigint) => (Number(v) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });
export const short = (h: string, n = 6) => `${h.slice(0, n + 2)}…${h.slice(-4)}`;
