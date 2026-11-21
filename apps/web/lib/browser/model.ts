// Score a model on the holdout rows that never left this browser. The forward pass is strongchar_workloads.mlp's:
// float32 matrix products accumulated column by column (kernel.mm), so each value is rounded exactly as numpy does.
const f = Math.fround;

export type Model = { dIn: number; hidden: number; nOut: number; loss: "ce" | "mse" };

function forward(m: Model, w: Float32Array, x: Float32Array, rows: number): Float32Array {
  const { dIn, hidden: h, nOut } = m;
  const w1 = 0, b1 = dIn * h, w2 = b1 + h, b2 = w2 + h * nOut;
  const hid = new Float32Array(rows * h);
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j < h; j++) {
      let acc = 0;
      for (let t = 0; t < dIn; t++) acc = f(acc + f(x[r * dIn + t] * w[w1 + t * h + j]));
      hid[r * h + j] = Math.max(f(acc + w[b1 + j]), 0);
    }
  }
  const z = new Float32Array(rows * nOut);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < nOut; k++) {
      let acc = 0;
      for (let t = 0; t < h; t++) acc = f(acc + f(hid[r * h + t] * w[w2 + t * nOut + k]));
      z[r * nOut + k] = f(acc + w[b2 + k]);
    }
  }
  return z;
}

/** Accuracy for classification, mean squared error for regression. */
export function score(m: Model, w: Float32Array, x: Float32Array, y: BigInt64Array | Float32Array): number {
  const rows = y.length;
  const z = forward(m, w, x, rows);
  if (m.loss === "ce") {
    let right = 0;
    for (let r = 0; r < rows; r++) {
      let best = 0;
      for (let k = 1; k < m.nOut; k++) if (z[r * m.nOut + k] > z[r * m.nOut + best]) best = k;
      if (BigInt(best) === (y as BigInt64Array)[r]) right++;
    }
    return right / rows;
  }
  let s = 0;
  for (let r = 0; r < rows; r++) { const d = z[r] - (y as Float32Array)[r]; s += d * d; }
  return s / rows;
}

/** The weights inside a model blob: specHash (32) | 0x01000000 | little-endian float32. */
export function fromBlob(specHash: string, blob: Uint8Array, nParams: number): Float32Array {
  const want = specHash.replace(/^0x/, "");
  const got = Array.from(blob.subarray(0, 32), (b) => b.toString(16).padStart(2, "0")).join("");
  if (got !== want) throw new Error("this model belongs to a different job spec");
  if (blob[32] !== 1 || blob[33] || blob[34] || blob[35] || blob.length !== 36 + 4 * nParams) throw new Error("model blob has the wrong layout");
  return new Float32Array(blob.slice(36).buffer);
}
