// The run being filmed: real log lines, machines, rounds and results from one live job on the AWS stack, built by
// scripts/build_run.py into public/data/run.json. Times are seconds since the job started.
import run from "../public/data/run.json";

export type LogLine = { t: number; text: string };
export type Machine = { name: string; role: "owner" | "coordinator" | "verifier" | "node"; ip: string; place: string; addr?: string; cheat?: boolean };
export type Round = {
  round: number; opened: number; committed: Record<string, number>; revealed: Record<string, number>; settled: number;
  seated: string[]; shards: Record<string, number>; tx: string; slashed: string[];
  hashes: Record<string, { claimed: string; ok: boolean }>;
};
export type Run = {
  job: number; start: string; machines: Machine[];
  owner: LogLine[]; coordinator: LogLine[]; logs: Record<string, LogLine[]>;
  rounds: Round[]; createTx: string; budget: number; stake: number; payouts: Record<string, number>; pool: number;
  holdout: { before: number; after: number }; cheater: { name: string; stakeBefore: number; stakeAfter: number };
  x86Hash: string; armHash: string;
};

export const RUN = run as unknown as Run;
export const machine = (name: string) => RUN.machines.find((m) => m.name === name)!;
export const short = (h: string, n = 6) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-4)}` : h);
