// Server-side view models: chain and coordinator reads turned into the states and shapes the UI components take.
import type { Address } from "viem";
import { liveNodes, signatures } from "./api";
import { getJob, getRound, jobCount, nodes, payments, type Job, type Round } from "./chain";
import type { JobStatus, ProgressRound, RoundStatus } from "./types";

export function jobStatus(j: Job): JobStatus {
  if (j.status === "Completed") return "completed";
  if (j.status === "Cancelled") return "cancelled";
  return j.roundsOpened === 0 ? "open" : "running";
}

/** An open round is committing, revealing or being replayed depending on the clock; closed rounds keep their outcome. */
export function roundStatus(r: Round, now = Date.now() / 1000): RoundStatus {
  switch (r.status) {
    case "Settled": return "settled";
    case "Reverted": return "reverted";
    case "Void": return "voided";
    case "Expired": return "expired";
    default:
      return now <= r.commitDeadline ? "committing" : now <= r.revealDeadline ? "revealing" : "verifying";
  }
}

export function progress(r: Round, shards: Record<string, number> = {}): ProgressRound {
  return {
    status: roundStatus(r),
    committed: r.seats.filter((s) => s.committed).map((s) => s.node),
    revealed: r.seats.filter((s) => s.revealed).map((s) => s.node),
    roster: r.seats.map((s) => ({ op: s.node, shard: shards[s.node.toLowerCase()] ?? 0 })),
  };
}

/** A float64 the verifiers wrote as 16 hex digits in their signed evidence. */
export function f64(hex?: string | null): number | null {
  if (!hex) return null;
  const v = new DataView(new ArrayBuffer(8));
  v.setBigUint64(0, BigInt(hex.startsWith("0x") ? hex : `0x${hex}`));
  const n = v.getFloat64(0);
  return Number.isFinite(n) ? n : null;
}

/** Validation loss at the start and after each settled round, from the gate both verifiers signed. */
export async function lossCurve(job: number, roundsOpened: number): Promise<{ x: number; y: number | null }[]> {
  const sigs = await Promise.all(Array.from({ length: roundsOpened }, (_, i) => signatures(job, i + 1)));
  const pts: { x: number; y: number | null }[] = [];
  sigs.forEach((s, i) => {
    let gate: { lossBefore?: string; lossAfter?: string } | undefined;
    try { gate = JSON.parse(String(s?.signatures?.[0]?.settlement?.aggEvidence ?? "null"))?.gate; } catch { gate = undefined; }
    if (i === 0) pts.push({ x: 0, y: f64(gate?.lossBefore) });
    pts.push({ x: i + 1, y: f64(gate?.lossAfter) });
  });
  return pts;
}

export type JobRow = { job: Job; status: JobStatus; rounds: { round: number; status: RoundStatus }[]; current: Round | null };

/** Every job with its rounds' outcomes, newest first. */
export async function jobRows(): Promise<JobRow[]> {
  const n = await jobCount();
  const rows = await Promise.all(Array.from({ length: n }, async (_, i) => {
    const job = await getJob(i + 1);
    const rounds = await Promise.all(Array.from({ length: job.roundsOpened }, (_, k) => getRound(job.id, k + 1)));
    return { job, status: jobStatus(job), rounds: rounds.map((r) => ({ round: r.id, status: roundStatus(r) })), current: rounds.at(-1) ?? null };
  }));
  return rows.reverse();
}

export type Network = { online: number; training: number; joined: number; paid: bigint; forfeited: bigint; settled: number; running: number; jobs: number };

export async function network(rows: JobRow[]): Promise<Network> {
  const [ns, live, pays] = await Promise.all([nodes(), liveNodes(), payments({})]);
  const now = Date.now() / 1000;
  const online = Object.values(live?.nodes ?? {}).filter((b) => now - b.seen < 60).length;
  return {
    online,
    training: ns.filter((n) => n.busyJob !== 0).length,
    joined: ns.length,
    paid: pays.filter((p) => !p.forfeited).reduce((a, p) => a + p.amount, 0n),
    forfeited: pays.filter((p) => p.forfeited).reduce((a, p) => a + p.amount, 0n),
    settled: rows.reduce((a, r) => a + r.rounds.filter((x) => x.status === "settled").length, 0),
    running: rows.filter((r) => r.status === "running").length,
    jobs: rows.length,
  };
}

export const nodeName = (a: Address | string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
