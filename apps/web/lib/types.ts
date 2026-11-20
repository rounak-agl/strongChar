// UI-level states, mapped from the JobMarket and Competitions contracts in lib/chain.ts and lib/compete.ts.
export type Trust = "chain" | "hash-checked" | "untrusted";
export type Source = "live" | "demo";
export type JobStatus = "open" | "running" | "completed" | "cancelled";
export type RoundStatus = "committing" | "revealing" | "verifying" | "settled" | "reverted" | "voided" | "expired";
export type Verdict = "pass" | "fail" | "pending" | "absent";
/** What the round progress components read: the phase and who has committed and revealed so far. */
export type ProgressRound = { status: RoundStatus; committed: string[]; revealed: string[]; roster: { op: string; shard: number }[] };
