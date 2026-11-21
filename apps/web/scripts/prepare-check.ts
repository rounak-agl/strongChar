// Recompute every value in vectors/web/prepare.json with the browser code and fail on any difference.
// Run: pnpm --filter @strongchar/web check:prepare
import { readFileSync } from "node:fs";
import { keccak256, type Hex } from "viem";
import { fsum, plan } from "../lib/browser/prepare";

type Case = {
  name: string; salt?: string; rounds: number; shards: number; quorum: number; csv: string; datasetHash: Hex; task: string; classes: number | null;
  dIn: number; spec: unknown; specHash: Hex; initialWeightsHash: Hex; shardTableHash: Hex; shardHashes: Hex[]; valHash: Hex;
  holdoutHash: Hex; opsPerRound: number; budget: number; refWork: number; maxNodes: number;
};

const cases = JSON.parse(readFileSync(new URL("../../../vectors/web/prepare.json", import.meta.url), "utf8")) as Case[];
let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got, (_, v) => (typeof v === "bigint" ? Number(v) : v));
  const w = JSON.stringify(want);
  if (g !== w) { failed++; console.error(`  ✗ ${name}\n      got  ${g.slice(0, 160)}\n      want ${w.slice(0, 160)}`); }
};

// fsum's correction step against values plain summation gets wrong.
eq("fsum([0.1]*10)", fsum(Array(10).fill(0.1)), 1);
eq("fsum([1e100, 1.0, -1e100, 1e-100, 1e50, -1.0, -1e50])", fsum([1e100, 1.0, -1e100, 1e-100, 1e50, -1.0, -1e50]), 1e-100);
eq("fsum half-even", fsum([2 ** 53, 1, 2 ** -60]), 2 ** 53 + 2);

for (const c of cases) {
  console.log(c.name);
  const p = plan(c.csv, { rounds: c.rounds, shards: c.shards, quorum: c.quorum, salt: c.salt });
  eq("datasetHash", p.data.hash, c.datasetHash);
  eq("task", p.data.task, c.task);
  eq("classes", p.data.classes, c.classes);
  eq("spec", p.spec, c.spec);
  eq("specHash", p.specHash, c.specHash);
  eq("initialWeightsHash", p.initialWeightsHash, c.initialWeightsHash);
  eq("shardTableHash", p.shardTableHash, c.shardTableHash);
  eq("shardHashes", p.shards.map((s) => keccak256(s)), c.shardHashes);
  eq("valHash", keccak256(p.val), c.valHash);
  const hb = new Uint8Array([...new Uint8Array(p.holdout.x.buffer), ...new Uint8Array(p.holdout.y.buffer)]);
  eq("holdoutHash", keccak256(hb), c.holdoutHash);
  eq("opsPerRound", p.opsPerRound, c.opsPerRound);
  eq("budget", p.budget, c.budget);
  eq("refWork", p.refWork, c.refWork);
  eq("maxNodes", p.maxNodes, c.maxNodes);
}
if (failed) { console.error(`${failed} mismatches`); process.exit(1); }
console.log(`all ${cases.length} cases match the Python code byte for byte`);
