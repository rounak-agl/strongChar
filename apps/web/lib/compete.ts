// Server-side reads for competitions: the contract is the record; the coordinator adds titles and verifier notes.
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { client } from "./chain";
import { competitionsAbi, deployment } from "./deployment";
import { events } from "./logs";

const addr = ((deployment as Record<string, unknown>).competitions as Address | undefined) || undefined;
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8700";

export const competitionsDeployed = Boolean(addr);
export const VALIDITY = ["Pending", "Valid", "Invalid"] as const;

export type Competition = {
  id: number; host: Address; metaHash: Hex; labelCommit: Hex; prize: bigint; deadline: number; revealDeadline: number;
  maxPerEntrant: number; scoresPosted: boolean; labelsRevealed: boolean; settled: boolean;
};
export type Entry = {
  index: number; entrant: Address; scriptHash: Hex; envelopeHash: Hex; validity: (typeof VALIDITY)[number];
  predHash: Hex; score: bigint;
};
export type Meta = { title?: string; task?: string; metric?: string; rows?: number; classes?: number; train?: string; timeoutS?: number };

async function read<T>(functionName: string, args: unknown[] = []): Promise<T> {
  return (await client.readContract({ address: addr!, abi: competitionsAbi, functionName, args } as any)) as T;
}

export async function competitionCount(): Promise<number> {
  return addr ? Number(await read<bigint>("count")) : 0;
}

export async function getCompetition(id: number): Promise<Competition> {
  const c = await read<any>("getCompetition", [BigInt(id)]);
  return {
    id, host: c.host, metaHash: c.metaHash, labelCommit: c.labelCommit, prize: c.prize, deadline: Number(c.deadline),
    revealDeadline: Number(c.revealDeadline), maxPerEntrant: Number(c.maxPerEntrant), scoresPosted: c.scoresPosted,
    labelsRevealed: c.labelsRevealed, settled: c.settled,
  };
}

export async function getEntries(id: number): Promise<Entry[]> {
  const es = await read<any[]>("getEntries", [BigInt(id)]);
  return es.map((e, index) => ({
    index, entrant: e.entrant, scriptHash: e.scriptHash, envelopeHash: e.envelopeHash, validity: VALIDITY[e.validity],
    predHash: e.predHash, score: e.score,
  }));
}

type Ev = { tx: Hex; args: any };

/** Transactions that carry the proof: creation, each PQ-signed verdict, the score table, the reveal, the payout. */
export async function competitionEvents(id: number) {
  const args = { id: BigInt(id) };
  const get = (eventName: string) =>
    events(addr!, competitionsAbi, eventName, args)
      .then((l: any[]) => l.map((e): Ev => ({ tx: e.transactionHash, args: e.args })));
  const [created, validity, scores, revealed, settled] = await Promise.all(
    ["Created", "ValidityPosted", "ScoresPosted", "LabelsRevealed", "Settled"].map(get));
  return { created: created[0], validity, scores: scores[0], revealed: revealed[0], settled: settled[0] };
}

/** Recompute keccak(abi.encode(keccak(labels), salt)) so a reader can see the revealed labels match the commitment. */
export function labelCommitOf(labels: Hex, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [keccak256(labels), salt]));
}

async function api<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function meta(metaHash: Hex): Promise<Meta | null> {
  return (await api<{ spec: Meta }>(`/v1/jobs/draft/${metaHash}`))?.spec ?? null;
}

export type RunNote = { author: string; ok: boolean; reason: string; detail?: string; runtimeS?: number };

/** Each verifier's raw sandbox run for one entry (before they agree and sign one verdict). */
export async function runNotes(id: number, entry: number): Promise<RunNote[]> {
  return (await api<{ attestations: RunNote[] }>(`/v1/attest/comp-${id}-run-${entry}`))?.attestations ?? [];
}

/** Score as the metric reads: accuracy and F1 as a fraction, RMSE stored negated so higher is better. */
export function showScore(score: bigint, metric?: string): string {
  const v = Number(score) / 1e6;
  return metric === "rmse" ? (-v).toFixed(4) : v.toFixed(4);
}

/** Where a competition stands, from chain state and the clock. */
export function phase(c: Competition, now = Date.now() / 1000): { label: string; tone: "ok" | "pending" | "warn" } {
  if (c.settled) return { label: "Settled", tone: "ok" };
  if (now <= c.deadline) return { label: "Open for entries", tone: "pending" };
  if (!c.scoresPosted) return { label: "Scoring", tone: "pending" };
  if (!c.labelsRevealed) return { label: "Waiting for labels", tone: "warn" };
  return { label: "Ready to settle", tone: "pending" };
}

/** Public-by-design files (training sets, published predictions) are served by the coordinator as plain CSV. */
export const publicUrl = (fileId: string) => `${API}/v1/public/${fileId}`;
