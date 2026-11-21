// The owner's job preparation in the browser, byte for byte the Python code it mirrors:
//   strongchar_datasets.canonical (from_csv, split, standardise), strongchar_datasets.shards (encode, cut),
//   strongchar_runtime.spec (make_spec, initial weights), strongchar_workloads.compute (price), strongchar_core.blob.
// vectors/web/prepare.json pins every output; apps/web/scripts/prepare-check.mjs compares against it.
import { encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";
import { HIDDEN, MAX_D_IN, MAX_OUT, NORMALS_B64 } from "./normals";

export const MAX_BYTES = 200 * 2 ** 20;
export const MIN_ROWS = 1000;
export const MAX_CLASSES = 100;

export class DatasetError extends Error {}

export type Task = "classification" | "regression";
export type Canonical = { x: Float32Array; y: BigInt64Array | Float32Array; rows: number; cols: number; task: Task; classes: number | null; hash: Hex };
export type Split = { train: [number, number]; val: [number, number]; holdout: [number, number]; shards: [number, number][] };

// ------------------------------------------------------------------ exact sums (CPython math.fsum)
export function fsum(values: ArrayLike<number>): number {
  const partials: number[] = [];
  for (let k = 0; k < values.length; k++) {
    let x = values[k];
    let i = 0;
    for (let j = 0; j < partials.length; j++) {
      let y = partials[j];
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }
  let n = partials.length;
  if (n === 0) return 0;
  let hi = partials[--n];
  let lo = 0;
  while (n > 0) {
    const x = hi;
    const y = partials[--n];
    hi = x + y;
    const yr = hi - x;
    lo = y - yr;
    if (lo !== 0) break;
  }
  // Round half to even, as CPython does when the remaining partials would tip the result.
  if (n > 0 && ((lo < 0 && partials[n - 1] < 0) || (lo > 0 && partials[n - 1] > 0))) {
    const y = lo * 2;
    const x = hi + y;
    if (y === x - hi) hi = x;
  }
  return hi;
}

// ------------------------------------------------------------------ hashing helpers
const k256 = (b: Uint8Array) => keccak256(b, "bytes");
const hex = (b: Uint8Array): Hex => `0x${Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("")}`;
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const bytesOf = (a: Float32Array | BigInt64Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength); // little-endian on every browser we support
const dtype = (a: Float32Array | BigInt64Array) => (a instanceof Float32Array ? "<f4" : "<i8");

/** Python's json.dumps(sort_keys=True) with its default separators: ", " and ": ". */
function pyJson(v: unknown, compact = false): string {
  const [comma, colon] = compact ? [",", ":"] : [", ", ": "];
  if (Array.isArray(v)) return `[${v.map((e) => pyJson(e, compact)).join(comma)}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}${colon}${pyJson((v as Record<string, unknown>)[k], compact)}`).join(comma)}}`;
  }
  if (typeof v === "number" && !Number.isInteger(v)) throw new Error("floats are not allowed in canonical JSON");
  return JSON.stringify(v);
}

function datasetHash(x: Float32Array, rows: number, cols: number, y: Float32Array | BigInt64Array): Hex {
  const head = pyJson({ x: [dtype(x), [rows, cols]], y: [dtype(y), [rows]] });
  return hex(k256(concat([toBytes("strongchar-dataset/1"), toBytes(head), bytesOf(x), bytesOf(y)])));
}

// ------------------------------------------------------------------ CSV → canonical arrays
const FLOAT = /^[+-]?(\d+(_\d+)*\.?(\d+(_\d+)*)?|\.\d+(_\d+)*)([eE][+-]?\d+(_\d+)*)?$/;
const SPECIAL = /^[+-]?(nan|inf|infinity)$/i;
const pyFloatOk = (s: string) => { const t = s.trim(); return FLOAT.test(t) || SPECIAL.test(t); };
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function parseField(s: string): number {
  const t = s.trim();
  if (NUMBER.test(t)) return Number(t);
  if (SPECIAL.test(t)) return t.toLowerCase().includes("nan") ? NaN : (t.startsWith("-") ? -Infinity : Infinity);
  throw new DatasetError(`non-numeric value: could not convert string '${t}' to float64`);
}

/** Numeric CSV, last column is the target, optional header row (np.loadtxt rules: '#' comments, blank lines skipped). */
export function fromCsv(text: string): Canonical {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new DatasetError(`CSV over ${MAX_BYTES} bytes`);
  const first = text.split("\n", 1)[0].split(",");
  const skip = first.every(pyFloatOk) ? 0 : 1;
  const lines = text.split("\n").slice(skip).map((l) => l.replace(/\r$/, "").split("#")[0]).filter((l) => l.trim() !== "");
  const width = lines.length ? lines[0].split(",").length : 0;
  if (width < 2) throw new DatasetError("need at least one feature column and a target");
  const rows = lines.length;
  const cols = width - 1;
  const xf = new Float64Array(rows * cols);
  const yf = new Float64Array(rows);
  lines.forEach((l, r) => {
    const f = l.split(",");
    if (f.length !== width) throw new DatasetError(`row ${r + 1 + skip} has ${f.length} columns, expected ${width}`);
    for (let c = 0; c < cols; c++) xf[r * cols + c] = parseField(f[c]);
    yf[r] = parseField(f[cols]);
  });
  return fromArrays(xf, yf, rows, cols);
}

function fromArrays(xf: Float64Array, yf: Float64Array, rows: number, cols: number): Canonical {
  if (rows < MIN_ROWS) throw new DatasetError(`need at least ${MIN_ROWS} rows with one target each`);
  const x32 = Float32Array.from(xf);
  if (!yf.every(Number.isFinite) || !x32.every(Number.isFinite)) throw new DatasetError("NaN or infinity in the data");
  const integral = yf.every((v) => v === Math.round(v) || v === roundHalfEven(v));
  const labels = Array.from(new Set(yf)).sort((a, b) => a - b);
  const task: Task = integral && labels.length <= MAX_CLASSES ? "classification" : "regression";
  if (task === "classification" && labels.length < 2) throw new DatasetError(`classification needs 2 to ${MAX_CLASSES} integer labels`);
  // Row order from keccak of the row index, so every party derives the same order from the same file.
  const keys = Array.from({ length: rows }, (_, i) => ({ i, k: keccak256(toBytes(BigInt(i), { size: 32 })) }));
  keys.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const x = new Float32Array(rows * cols);
  const index = new Map(labels.map((l, i) => [l, i]));
  const y = task === "classification" ? new BigInt64Array(rows) : new Float32Array(rows);
  keys.forEach(({ i }, r) => {
    x.set(x32.subarray(i * cols, (i + 1) * cols), r * cols);
    if (y instanceof BigInt64Array) y[r] = BigInt(index.get(yf[i])!);
    else y[r] = yf[i];
  });
  return { x, y, rows, cols, task, classes: task === "classification" ? labels.length : null, hash: datasetHash(x, rows, cols, y) };
}

function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f;
}

// ------------------------------------------------------------------ split and standardise
/** [train | val | holdout] in canonical order, 10% / 10% held back; train cut into contiguous shards, larger first. */
export function split(rows: number, nShards: number): Split {
  const val = Math.floor(rows / 10);
  const holdout = Math.floor(rows / 10);
  const train = rows - val - holdout;
  if (nShards < 1 || train < nShards) throw new DatasetError("not enough training rows for that many shards");
  const q = Math.floor(train / nShards);
  const r = train % nShards;
  const shards: [number, number][] = [];
  let start = 0;
  for (let i = 0; i < nShards; i++) { const n = q + (i < r ? 1 : 0); shards.push([start, n]); start += n; }
  return { train: [0, train], val: [train, val], holdout: [train + val, holdout], shards };
}

/** Zero mean, unit variance from the train rows only, with exactly rounded sums. */
export function standardise(c: Canonical, train: [number, number]): Canonical {
  const [a, n] = train;
  const mean = new Float64Array(c.cols);
  const std = new Float64Array(c.cols);
  const col = new Float64Array(n);
  for (let j = 0; j < c.cols; j++) {
    for (let r = 0; r < n; r++) col[r] = c.x[(a + r) * c.cols + j];
    const m = fsum(col) / n;
    const sq = col.map((v) => (v - m) * (v - m));
    const s = Math.sqrt(fsum(sq) / n);
    mean[j] = m;
    std[j] = s === 0 ? 1 : s;
  }
  const z = new Float32Array(c.x.length);
  for (let i = 0; i < c.x.length; i++) { const j = i % c.cols; z[i] = (c.x[i] - mean[j]) / std[j]; }
  return { ...c, x: z, hash: datasetHash(z, c.rows, c.cols, c.y) };
}

// ------------------------------------------------------------------ shard files
const MAGIC = toBytes("strongchar-shard/1\n");

export function encodeShard(c: Canonical, start: number, n: number): Uint8Array {
  const xs = c.x.subarray(start * c.cols, (start + n) * c.cols);
  const ys = c.y.subarray(start, start + n);
  const head = toBytes(pyJson({ datasetHash: c.hash, start, x: [dtype(xs), [n, c.cols]], y: [dtype(ys), [n]] }, true));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, head.length);
  return concat([MAGIC, len, head, bytesOf(xs), bytesOf(ys)]);
}

// ------------------------------------------------------------------ spec, initial weights, price
export type Spec = Record<string, unknown>;

/** `salt` makes each job's spec, and so its spec hash and draft, unique even for the same data and settings. */
export function makeSpec(c: Canonical, s: Split, rounds: number, o: { hidden?: number; lr?: string; steps?: number; batchSize?: number; salt?: string } = {}): Spec {
  return {
    version: 1, workload: "mlp-exact/1", datasetHash: c.hash, task: c.task,
    d_in: c.cols, n_out: c.classes ?? 1, hidden: o.hidden ?? HIDDEN, loss: c.task === "classification" ? "ce" : "mse", lr: o.lr ?? "0.1",
    steps: o.steps ?? 40, checkpoints: 4, batch_size: o.batchSize ?? 32, initSeed: 0,
    shards: s.shards, val: s.val, rounds, gate: { relTol: "0.1", absTol: "0.01" },
    ...(o.salt !== undefined ? { salt: o.salt } : {}),
  };
}

export const canonicalJson = (spec: Spec) => toBytes(pyJson(spec, true));
export const specHash = (spec: Spec): Hex => keccak256(canonicalJson(spec));

let normals: Float64Array | null = null;
function standardNormals(): Float64Array {
  if (!normals) {
    const raw = Uint8Array.from(atob(NORMALS_B64), (ch) => ch.charCodeAt(0));
    normals = new Float64Array(raw.buffer);
  }
  return normals;
}

/** The spec's seeded initial weights (initSeed 0): sqrt(2/fan_in) times numpy default_rng(0)'s standard normals. */
export function initialWeights(dIn: number, hidden: number, nOut: number): Float32Array {
  if (dIn > MAX_D_IN || nOut > MAX_OUT || hidden !== HIDDEN) throw new DatasetError(`the browser supports up to ${MAX_D_IN} features and ${MAX_OUT} classes`);
  const z = standardNormals();
  const w = new Float32Array(dIn * hidden + hidden + hidden * nOut + nOut);
  const s1 = Math.sqrt(2 / dIn);
  const s2 = Math.sqrt(2 / hidden);
  for (let i = 0; i < dIn * hidden; i++) w[i] = s1 * z[i];
  const o2 = dIn * hidden + hidden;
  for (let i = 0; i < hidden * nOut; i++) w[o2 + i] = s2 * z[dIn * hidden + i];
  return w;
}

/** specHash (32) | 0x01000000 | little-endian float32, with -0.0 turned into +0.0 so equal weights hash the same. */
export function weightsBlob(spec: Hex, w: Float32Array): Uint8Array {
  const clean = w.map((v) => v + 0);
  return concat([toBytes(spec), new Uint8Array([1, 0, 0, 0]), bytesOf(clean)]);
}
export const weightsHash = (spec: Hex, w: Float32Array): Hex => keccak256(weightsBlob(spec, w));

export function shardTableHash(shards: [number, number][]): Hex {
  return keccak256(encodeAbiParameters([{ type: "tuple[]", components: [{ type: "uint256" }, { type: "uint256" }] }],
    [shards.map(([a, n]) => [BigInt(a), BigInt(n)] as const)]));
}

export function roundOps(steps: number, b: number, dIn: number, hidden: number, nOut: number, loss: "ce" | "mse"): bigint {
  const params = dIn * hidden + hidden + hidden * nOut + nOut;
  const step = 4 * b * dIn * hidden + 6 * b * hidden * nOut + 2 * b * hidden + (loss === "ce" ? 37 : 4) * b * nOut + 2 * params;
  return BigInt(steps) * BigInt(step);
}

// ------------------------------------------------------------------ the whole plan
export type Plan = {
  data: Canonical; split: Split; spec: Spec; specHash: Hex; initialWeightsHash: Hex; shardTableHash: Hex;
  shards: Uint8Array[]; val: Uint8Array; holdout: { x: Float32Array; y: BigInt64Array | Float32Array };
  opsPerRound: bigint; budget: bigint; refWork: number; quorum: number; maxNodes: number;
};

export function plan(csv: string, o: { rounds: number; shards: number; quorum: number; priceUnitsPerGop?: bigint; salt?: string }): Plan {
  if (!(1 <= o.quorum && o.quorum <= o.shards)) throw new DatasetError("quorum must be between 1 and the number of shards");
  const raw = fromCsv(csv);
  const sp = split(raw.rows, o.shards);
  const data = standardise(raw, sp.train);
  const spec = makeSpec(data, sp, o.rounds, { salt: o.salt });
  const h = specHash(spec);
  const nOut = data.classes ?? 1;
  const ops = roundOps(40, 32, data.cols, HIDDEN, nOut, data.task === "classification" ? "ce" : "mse");
  const price = o.priceUnitsPerGop ?? 1_000_000n;
  const budget = BigInt(o.rounds) * BigInt(o.shards) * ops * price / 1_000_000_000n;
  const floor = BigInt(o.rounds * o.shards);
  const [ha, hn] = sp.holdout;
  return {
    data, split: sp, spec, specHash: h,
    initialWeightsHash: weightsHash(h, initialWeights(data.cols, HIDDEN, nOut)),
    shardTableHash: shardTableHash(sp.shards),
    shards: sp.shards.map(([a, n]) => encodeShard(data, a, n)),
    val: encodeShard(data, sp.val[0], sp.val[1]),
    holdout: { x: data.x.slice(ha * data.cols, (ha + hn) * data.cols), y: data.y.slice(ha, ha + hn) as BigInt64Array | Float32Array },
    opsPerRound: ops, budget: budget > floor ? budget : floor, refWork: Number((ops + 999_999_999n) / 1_000_000_000n),
    quorum: o.quorum, maxNodes: o.shards,
  };
}
