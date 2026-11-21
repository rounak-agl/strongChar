// Competitions from the browser, the same steps as scripts/demo_compete.py. A host publishes the training rows, seals
// the test rows, labels and a salt to the two verifiers, commits to the labels and funds the prize. An entrant seals a
// script to the two verifiers and submits its hash. Hosts may reveal early; winners claim. Everything is signed here.
import { encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, toBytes, toHex, type Hex } from "viem";
import { competitionsAbi, deployment } from "@/lib/deployment";
import type { Owner } from "./account";
import { FUSD, closeWindow, ensureFusd, ensureWindow, estimate, evm, maxFee, sendEvm, type Progress } from "./evm";
import { aad, recipient, sealTo } from "./seal";

export const COMP = (deployment as Record<string, unknown>).competitions as Hex;
export type Task = "classification" | "regression";
export type Metric = "accuracy" | "macro_f1" | "rmse";
export const METRICS: Record<Task, Metric[]> = { classification: ["accuracy", "macro_f1"], regression: ["rmse"] };

const read = <T>(functionName: string, args: unknown[] = []) =>
  evm.readContract({ address: COMP, abi: competitionsAbi, functionName, args } as any) as Promise<T>;

/** keccak(abi.encode(keccak(labels), salt)), as Encodings.labelCommit. */
export const labelCommit = (labels: Uint8Array, salt: Hex) =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [keccak256(labels), salt]));

export type HostPlan = {
  title: string; task: Task; metric: Metric; classes: number | null; target: string;
  train: string; features: string; labels: Uint8Array; trainRows: number; testRows: number;
};

/**
 * Split the host's CSV (header row, target in the last column) into the public training set and the sealed test set.
 * Rows are shuffled first so an ordered file doesn't put one kind of row in the test set.
 */
export function planCompetition(csv: string, o: { title: string; task: Task; metric: Metric; testShare: number }): HostPlan {
  const lines = csv.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 21) throw new Error("Need a header row and at least 20 data rows.");
  const header = lines[0].split(",");
  if (header.length < 2) throw new Error("Need at least one feature column and a target column, separated by commas.");
  const rows = lines.slice(1).map((l, i) => {
    const r = l.split(",");
    if (r.length !== header.length) throw new Error(`Row ${i + 2} has ${r.length} columns; the header has ${header.length}.`);
    return r;
  });
  const rand = crypto.getRandomValues(new Uint32Array(rows.length));
  for (let i = rows.length - 1; i > 0; i--) { const j = rand[i] % (i + 1); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  const nTest = Math.max(10, Math.round(rows.length * o.testShare));
  const train = rows.slice(0, rows.length - nTest), test = rows.slice(rows.length - nTest);
  const ys = test.map((r) => Number(r[r.length - 1]));
  if (ys.some((y) => !Number.isFinite(y))) throw new Error("Every target value in the last column must be a number.");
  let classes: number | null = null;
  let labelText: string;
  if (o.task === "classification") {
    const all = rows.map((r) => Number(r[r.length - 1]));
    if (all.some((y) => !Number.isInteger(y) || y < 0)) throw new Error("Classification targets must be whole numbers 0, 1, 2, …");
    classes = Math.max(...all) + 1;
    if (classes < 2 || classes > 100) throw new Error("Classification needs between 2 and 100 classes.");
    labelText = ys.map((y) => String(y)).join("\n") + "\n";
  } else {
    labelText = ys.map((y) => y.toFixed(6)).join("\n") + "\n";
  }
  if (!METRICS[o.task].includes(o.metric)) throw new Error(`${o.metric} doesn't fit ${o.task}.`);
  const join = (rs: string[][]) => rs.map((r) => r.join(",")).join("\n") + "\n";
  return {
    title: o.title.trim() || "Untitled competition", task: o.task, metric: o.metric, classes, target: header[header.length - 1],
    train: header.join(",") + "\n" + join(train),
    features: header.slice(0, -1).join(",") + "\n" + join(test.map((r) => r.slice(0, -1))),
    labels: toBytes(labelText), trainRows: train.length, testRows: test.length,
  };
}

export type Hosted = { id: number; tx: Hex; salt: Hex; labels: Hex };

export async function hostCompetition(o: Owner, p: HostPlan, prize: bigint, minutes: number, maxPerEntrant: number, log: Progress): Promise<Hosted> {
  log("Checking the verifiers' keys against the chain");
  const vs = await Promise.all([deployment.verifier_a, deployment.verifier_b].map(recipient));
  const recips = vs.map((v) => v.recipient), keys = vs.map((v) => v.kem);
  const id = Number(await read<bigint>("count")) + 1; // bound into the AAD

  log("Publishing the training rows", `${p.trainRows.toLocaleString()} rows, public by design`);
  const trainId = await o.coordinator.putPublic(p.train, "train.csv");
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const bundle = JSON.stringify({ features: p.features, labels: toHex(p.labels), salt });
  log("Sealing the test rows and labels in this browser", "to both verifiers only");
  const testId = await o.coordinator.putBlob(sealTo(recips, toBytes(bundle), "test-features", aad(COMP, id, 0, 0, "test-features", keys)), "test");
  const meta = {
    kind: "competition", title: p.title, task: p.task, metric: p.metric, ...(p.classes ? { classes: p.classes } : {}),
    rows: p.testRows, train: trainId, target: p.target, image: "strongchar-sandbox:1", timeoutS: 300,
    nonce: toHex(crypto.getRandomValues(new Uint8Array(16))),
  };
  const metaHash = (await o.coordinator.putDraft(meta, { test: testId })) as Hex;

  await ensureFusd(o, prize, log);
  const now = Math.floor(Date.now() / 1000);
  const deadline = BigInt(now + minutes * 60), reveal = deadline + 900n;
  const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [COMP, prize] });
  const create = encodeFunctionData({ abi: competitionsAbi, functionName: "create", args: [metaHash, labelCommit(p.labels, salt), prize, deadline, reveal, maxPerEntrant] } as any);
  const fee = await maxFee();
  const gasA = await estimate(o, FUSD, approve);
  await ensureWindow(o, [FUSD, COMP], 2, 600_000n, fee, log, "scoped to fUSD and Competitions, for these two transactions only");
  log("Approving the prize", `${(Number(prize) / 1e6).toFixed(6)} fUSD`);
  await sendEvm(o, FUSD, approve, gasA, fee);
  log("Creating the competition on chain", "the label commitment goes on chain now; the labels stay sealed");
  const tx = await sendEvm(o, COMP, create, await estimate(o, COMP, create), fee);
  await closeWindow(o);
  if (Number(await read<bigint>("count")) !== id) throw new Error(`another competition took id ${id} at the same moment; host again`);
  saveSecret({ id, labels: toHex(p.labels), salt });
  return { id, tx, salt, labels: toHex(p.labels) };
}

export async function submitEntry(o: Owner, id: number, script: string, log: Progress): Promise<{ entry: number; tx: Hex }> {
  if (!script.trim()) throw new Error("The script is empty.");
  const bytes = toBytes(script);
  if (bytes.length > 256 * 1024) throw new Error("Scripts are limited to 256 KB.");
  log("Checking the verifiers' keys against the chain");
  const vs = await Promise.all([deployment.verifier_a, deployment.verifier_b].map(recipient));
  log("Sealing the script in this browser", "to both verifiers only; nobody else ever sees it");
  const envId = (await o.coordinator.putBlob(sealTo(vs.map((v) => v.recipient), bytes, "script", aad(COMP, id, 0, 0, "script", vs.map((v) => v.kem))), "script")) as Hex;
  const data = encodeFunctionData({ abi: competitionsAbi, functionName: "submit", args: [BigInt(id), keccak256(bytes), envId] } as any);
  const fee = await maxFee();
  const gas = await estimate(o, COMP, data); // reverts here, for free, if the deadline passed or the entry limit is reached
  await ensureWindow(o, [COMP], 1, gas, fee, log, "scoped to Competitions, for this one transaction");
  log("Submitting the script's hash on chain");
  const tx = await sendEvm(o, COMP, data, gas, fee);
  await closeWindow(o);
  const entries = await read<unknown[]>("getEntries", [BigInt(id)]);
  return { entry: entries.length - 1, tx };
}

export async function revealEarly(o: Owner, id: number, log: Progress): Promise<Hex> {
  const s = loadSecret(id);
  if (!s) throw new Error("This browser doesn't hold this competition's labels.");
  const data = encodeFunctionData({ abi: competitionsAbi, functionName: "revealLabels", args: [BigInt(id), s.labels, s.salt] } as any);
  const fee = await maxFee();
  const gas = await estimate(o, COMP, data);
  await ensureWindow(o, [COMP], 1, gas, fee, log, "scoped to Competitions, for this one transaction");
  log("Revealing the labels");
  const tx = await sendEvm(o, COMP, data, gas, fee);
  await closeWindow(o);
  return tx;
}

export const claimable = (evmAddress: string) => read<bigint>("claimable", [evmAddress]);

export async function claimPrize(o: Owner, log: Progress): Promise<Hex> {
  const data = encodeFunctionData({ abi: competitionsAbi, functionName: "claim", args: [] } as any);
  const fee = await maxFee();
  const gas = await estimate(o, COMP, data);
  await ensureWindow(o, [COMP], 1, gas, fee, log, "scoped to Competitions, for this one transaction");
  log("Claiming");
  const tx = await sendEvm(o, COMP, data, gas, fee);
  await closeWindow(o);
  return tx;
}

// The labels and salt stay in this browser too, so the host can reveal before the deadline window closes. If they
// are lost, the verifiers reveal from their sealed copy after the reveal deadline.
type Secret = { id: number; labels: Hex; salt: Hex };
const KEY = (id: number) => `strongchar-competition-${COMP.toLowerCase()}-${id}`;
function saveSecret(s: Secret) { try { localStorage.setItem(KEY(s.id), JSON.stringify(s)); } catch { /* storage blocked: the verifiers still reveal */ } }
export function loadSecret(id: number): Secret | null {
  try { const v = localStorage.getItem(KEY(id)); return v ? (JSON.parse(v) as Secret) : null; } catch { return null; }
}
