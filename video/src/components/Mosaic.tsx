// Word-mosaic background: rows of protocol words, each tile lit by a field function of (x, y, frame). Deterministic,
// so every render of a frame is identical.
import { useCurrentFrame } from "remotion";
import { C, mono } from "../theme";

const WORDS = ["SEAL", "SHARD", "REPLAY", "COMMIT", "REVEAL", "VERIFY", "ML-KEM", "ML-DSA", "STAKE", "SLASH", "EPOCH",
  "GRAD", "LOSS", "WEIGHTS", "PROOF", "ROUND", "NODE", "HASH", "QUORUM", "SETTLE", "FUSD", "BERU", "LATTICE", "CIPHER",
  "KEY", "MERGE", "GATE", "SIGN", "QOR", "DIANA"];
const LEVEL = [
  { bg: "transparent", fg: "#2a1a17" }, { bg: C.red1, fg: "#6b2318" }, { bg: C.red2, fg: "#b9442f" },
  { bg: C.red3, fg: "#2a0705" }, { bg: C.red4, fg: "#2a0705" }, { bg: C.red5, fg: "#2a0705" },
  { bg: C.bone, fg: "#2a0705" }, { bg: C.ink, fg: "#2a0705" },
];

function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export type Field = (u: number, v: number, t: number, r: number) => number; // returns level 0..7

type Tile = { word: string; x: number; row: number; r: number };
const cache = new Map<string, Tile[]>();
function layout(width: number, rows: number, seed: number): Tile[] {
  const key = `${width}x${rows}x${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const rand = rng(seed);
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row++) {
    let x = 0;
    while (x < width) {
      const word = WORDS[Math.floor(rand() * WORDS.length)];
      tiles.push({ word, x, row, r: rand() });
      x += word.length * 8.1 + 14;
    }
  }
  cache.set(key, tiles);
  return tiles;
}

export function Mosaic({ field, width = 1920, height = 1080, rows = 46, seed = 7, opacity = 1 }:
  { field: Field; width?: number; height?: number; rows?: number; seed?: number; opacity?: number }) {
  const frame = useCurrentFrame();
  const rowH = height / rows;
  const tiles = layout(width, rows, seed);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity, fontFamily: mono, fontSize: rowH * 0.5, letterSpacing: "0.04em" }}>
      {tiles.map((t, i) => {
        const l = Math.max(0, Math.min(7, Math.round(field(t.x / width, t.row / rows, frame, t.r))));
        const s = LEVEL[l];
        return (
          <span key={i} style={{ position: "absolute", left: t.x, top: t.row * rowH + 2, height: rowH - 4, padding: "0 4px",
            lineHeight: `${rowH - 4}px`, background: s.bg, color: s.fg, whiteSpace: "nowrap" }}>{t.word}</span>
        );
      })}
    </div>
  );
}
