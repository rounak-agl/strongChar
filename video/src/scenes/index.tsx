// The ten scenes. Each takes its length in frames and lays out its own time, mapping the real event times of the run
import type React from "react";
// onto that length so every line, hash and transaction shown is the one that happened.
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Sequence, OffthreadVideo, Easing, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Mosaic, type Field } from "../components/Mosaic";
import { Terminal, type Line } from "../components/Terminal";
import { RUN, machine, short, type LogLine } from "../data";
import { C, FPS, mono, sans } from "../theme";
import { SCENES } from "../script";
import vo from "../../public/vo/durations.json";

type SceneProps = { frames: number };
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.4, 0, 0.2, 1);

// ---------------------------------------------------------------- building blocks

function Kicker({ n, children }: { n: string; children: ReactNode }) {
  const f = useCurrentFrame();
  const o = interpolate(f, [4, 16], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", left: 80, top: 64, display: "flex", alignItems: "center", gap: 16, opacity: o, fontFamily: mono, fontSize: 22, letterSpacing: "0.18em", textTransform: "uppercase", color: C.muted }}>
      <span style={{ color: C.red5 }}>{n}</span><span style={{ width: 40, height: 1, background: C.rule }} />{children}
    </div>
  );
}

function Headline({ children, at = 6, size = 64, style }: { children: ReactNode; at?: number; size?: number; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const o = interpolate(f, [at, at + 14], [0, 1], clamp);
  const y = interpolate(f, [at, at + 14], [18, 0], { ...clamp, easing: ease });
  return <div style={{ fontFamily: sans, fontWeight: 600, fontSize: size, letterSpacing: "-0.03em", lineHeight: 1.05, color: C.ink, opacity: o, transform: `translateY(${y}px)`, ...style }}>{children}</div>;
}

function Chip({ tone, children, style }: { tone: "ok" | "bad" | "seal" | "warn" | "sky" | "dim"; children: ReactNode; style?: CSSProperties }) {
  const map = { ok: [C.ok, C.okBg], bad: [C.danger, C.dangerBg], seal: [C.teal, C.tealBg], warn: [C.warn, "rgba(58,42,8,0.7)"], sky: [C.sky, C.skyBg], dim: [C.muted, C.band] } as const;
  const [fg, bg] = map[tone];
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 3, background: bg, color: fg, fontFamily: mono, fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap", ...style }}>{children}</span>;
}

/** Map real seconds in [t0, t1] onto frames [f0, f1] of this scene. */
const timeMap = (t0: number, t1: number, f0: number, f1: number) => (t: number) => Math.round(f0 + ((t - t0) / Math.max(1, t1 - t0)) * (f1 - f0));

const toLines = (logs: LogLine[], map: (t: number) => number, tone?: (s: string) => Line["tone"]): Line[] =>
  logs.map((l) => ({ at: map(l.t), text: l.text, tone: tone?.(l.text) }));

const nodeTone = (s: string): Line["tone"] =>
  /cheating/.test(s) ? "bad" : /slash/i.test(s) ? "bad" : /committed|revealed/.test(s) ? "ok" : /fed|shard/.test(s) ? "seal" : undefined;

function Ground({ children, field, mosaicOpacity = 0.55 }: { children: ReactNode; field?: Field; mosaicOpacity?: number }) {
  return (
    <AbsoluteFill style={{ background: C.ground }}>
      {field && <Mosaic field={field} opacity={mosaicOpacity} />}
      {children}
    </AbsoluteFill>
  );
}

// Soft red glow drifting from the right edge; used as a quiet background on text-heavy scenes.
const drift: Field = (u, v, t, r) => {
  const d = Math.hypot((u - 0.92) * 1.6, v - 0.5 + 0.08 * Math.sin(t / 40));
  return d < 0.18 ? 3 : d < 0.32 ? (r < 0.5 ? 2 : 1) : r < 0.04 ? 1 : 0;
};


// ---------------------------------------------------------------- effects

/** A sound effect on an exact frame of the scene. */
function Sfx({ at, name, vol = 0.6 }: { at: number; name: string; vol?: number }) {
  return <Sequence from={Math.max(0, Math.round(at))} durationInFrames={90}><Audio src={staticFile(`sfx/${name}.mp3`)} volume={vol} /></Sequence>;
}

/** Decaying camera shake that starts at `at`. */
function Shake({ at, amp = 22, children }: { at: number; amp?: number; children: ReactNode }) {
  const f = useCurrentFrame() - at;
  const k = f < 0 ? 0 : Math.exp(-f / 7) * amp;
  return <AbsoluteFill style={{ transform: `translate(${Math.sin(f * 2.7) * k}px, ${Math.cos(f * 3.3) * k * 0.7}px)` }}>{children}</AbsoluteFill>;
}

/** Full-frame red flash at `at`. */
function Flash({ at, color = "rgba(255,60,40,0.55)" }: { at: number; color?: string }) {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: color, opacity: interpolate(f, [at, at + 2, at + 14], [0, 1, 0], clamp), pointerEvents: "none", mixBlendMode: "screen" }} />;
}

// ---------------------------------------------------------------- 0. hook: the catch, shown first

function S00({ frames }: SceneProps) {
  const f = useCurrentFrame();
  const r1 = RUN.rounds[0];
  const cheat = RUN.logs[RUN.cheater.name].find((l) => /round 1 trained/.test(l.text))!;
  const va = RUN.logs["verifier-a"].filter((l) => /round 1 node .*ReplayMismatch/.test(l.text))[0];
  const vb = RUN.logs["verifier-b"].filter((l) => /round 1 node .*ReplayMismatch/.test(l.text))[0];
  const SLAM = 92, CRASH = 118, REW = frames - 34;
  const lines: Line[] = [
    { at: 10, text: `${RUN.cheater.name} · job ${RUN.job} · round 1 · shard ${r1.shards[RUN.cheater.name]}`, tone: "dim" },
    { at: 18, text: cheat.text.replace(/^node-\d /, ""), tone: "bad" },
    { at: 50, text: va.text, tone: "warn" },
    { at: 66, text: vb.text, tone: "warn" },
  ];
  const stake = interpolate(f, [CRASH, CRASH + 34], [RUN.cheater.stakeBefore, RUN.cheater.stakeAfter], { ...clamp, easing: Easing.bezier(0.7, 0, 0.3, 1) });
  const slam = spring({ frame: f - SLAM, fps: FPS, config: { damping: 11, stiffness: 220 } });
  const rew = interpolate(f, [REW, frames], [0, 1], clamp);
  return (
    <Ground>
      <Shake at={SLAM}>
        <AbsoluteFill style={{ filter: rew > 0 ? `hue-rotate(${rew * 90}deg) blur(${rew * 6}px)` : undefined, transform: `skewX(${rew * 18}deg) scale(${1 + rew * 0.2})` }}>
          <div style={{ position: "absolute", left: 140, top: 150 }}>
            <Terminal title={`${RUN.cheater.name} · AWS Sydney`} host={machine(RUN.cheater.name).ip} width={1640} height={420} fontSize={26} lines={lines}
              glow={f > SLAM ? "rgba(255,111,102,0.6)" : undefined} highlight />
          </div>
          {f >= SLAM && (
            <div style={{ position: "absolute", left: 0, right: 0, top: 380, display: "flex", justifyContent: "center" }}>
              <div style={{ transform: `rotate(-6deg) scale(${2.4 - 1.4 * slam})`, opacity: Math.min(1, slam * 1.4), border: `8px solid ${C.danger}`, color: C.danger, padding: "10px 40px",
                fontFamily: mono, fontWeight: 700, fontSize: 110, letterSpacing: "0.06em", background: "rgba(40,8,6,0.82)" }}>✗ REPLAY MISMATCH</div>
            </div>
          )}
          <div style={{ position: "absolute", left: 140, top: 760, display: "flex", alignItems: "baseline", gap: 26, opacity: interpolate(f, [CRASH - 10, CRASH], [0, 1], clamp) }}>
            <span style={{ fontFamily: sans, fontSize: 40, color: C.muted }}>stake</span>
            <span style={{ fontFamily: mono, fontSize: 150, fontWeight: 700, color: f > CRASH ? C.danger : C.ink, letterSpacing: "-0.04em" }}>{stake.toFixed(0)}</span>
            <span style={{ fontFamily: mono, fontSize: 44, color: C.subtle }}>BERU</span>
            <span style={{ fontFamily: mono, fontSize: 30, color: C.danger, marginLeft: 30, opacity: interpolate(f, [CRASH + 34, CRASH + 40], [0, 1], clamp) }}>slashed on-chain · {short(r1.tx, 8)}</span>
          </div>
        </AbsoluteFill>
      </Shake>
      <Flash at={SLAM} />
      <Flash at={CRASH + 30} color="rgba(255,60,40,0.3)" />
      <Sfx at={2} name="glitch" vol={0.5} />
      <Sfx at={16} name="typing" vol={0.35} />
      <Sfx at={48} name="alarm" vol={0.45} />
      <Sfx at={SLAM - 2} name="stamp" vol={0.9} />
      <Sfx at={SLAM} name="impact" vol={0.8} />
      <Sfx at={CRASH + 28} name="impact" vol={0.5} />
      <Sfx at={REW} name="rewind" vol={0.6} />
    </Ground>
  );
}

// ---------------------------------------------------------------- word beats

/** Frame (within the scene) at which the narrator starts the first word matching `re`, using the same length-weighted
 * timing as the captions. Lets visuals land on the spoken word. */
function beats(id: string, line: string) {
  const secs = (vo as Record<string, { seconds: number }>)[id]?.seconds ?? line.split(/\s+/).length / 2.55;
  const frames = secs * FPS;
  const words = line.split(/\s+/);
  const w = words.map((x) => x.replace(/[^\w]/g, "").length + 2 + (/[.,:;]$/.test(x) ? 4 : 0));
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  const t = w.map((x) => { const v = Math.round(0.25 * FPS + (acc / total) * frames); acc += x; return v; });
  return (re: RegExp, nth = 0) => { const hits = words.map((x, i) => (re.test(x) ? i : -1)).filter((i) => i >= 0); return t[hits[nth] ?? 0]; };
}
const lineOf = (id: string) => SCENES.find((s) => s.id === id)!.line;

// ---------------------------------------------------------------- 1. why it matters

const GLYPH: Record<string, string[]> = {
  hospital: ["..###..", "..###..", "#######", "#######", "#######", "..###..", "..###.."],
  bank: ["...#...", "..###..", ".#####.", "#######", ".#.#.#.", ".#.#.#.", "#######"],
  school: ["...##..", "...#...", "..###..", ".#####.", "#######", "#.#.#.#", "#######"],
  laptop: [".#####.", ".#...#.", ".#...#.", ".#####.", "#######", ".......", "......."],
};

function Glyph({ name, x, y, s, color, appear }: { name: string; x: number; y: number; s: number; color: string; appear: number }) {
  const f = useCurrentFrame();
  const cell = 22 * s, gap = 4 * s;
  return (
    <div style={{ position: "absolute", left: x - (7 * cell + 6 * gap) / 2, top: y, display: "grid", gridTemplateColumns: `repeat(7, ${cell}px)`, gap }}>
      {GLYPH[name].flatMap((row, r) => row.split("").map((c, k) => {
        const d = appear + ((r * 7 + k) * 7) % 13;
        const p = spring({ frame: f - d, fps: FPS, config: { damping: 12, stiffness: 200 } });
        return <i key={`${r}-${k}`} style={{ width: cell, height: cell, background: c === "#" ? color : "transparent", transform: `scale(${p})`, boxShadow: c === "#" ? `0 0 ${10 * s}px ${color}55` : undefined }} />;
      }))}
    </div>
  );
}

function S01({ frames }: SceneProps) {
  const f = useCurrentFrame();
  const b = beats("s01-open", lineOf("s01-open"));
  const H = b(/hospital/i), B = b(/bank/i), S = b(/school/i), TRAIN = b(/train/i), NONE = b(/^None/), STRANGER = b(/stranger/i);
  const cols = [["hospital", "HOSPITAL", 420, H], ["bank", "BANK", 960, B], ["school", "SCHOOL", 1500, S]] as const;
  const slide = interpolate(f, [NONE, NONE + 18], [0, 1], { ...clamp, easing: ease });
  const WALL = 1290, LAP = 1640;
  const blocked = f >= STRANGER + 10;
  return (
    <Ground field={drift} mosaicOpacity={0.18}>
      <div style={{ position: "absolute", left: 80, top: 64, fontFamily: mono, fontSize: 24, letterSpacing: "0.2em", color: C.muted, opacity: interpolate(f, [2, 12, NONE, NONE + 10], [0, 1, 1, 0], clamp) }}>WHY IT MATTERS</div>
      {cols.map(([g, label, x0, at], i) => {
        const x = x0 + slide * ([250, 600, 950][i] - x0);
        const sc = 1 - slide * 0.4;
        const lab = spring({ frame: f - at, fps: FPS, config: { damping: 10, stiffness: 180 } });
        return (
          <div key={g}>
            <Glyph name={g} x={x} y={200 + slide * 60} s={sc} color={C.red5} appear={at - 4} />
            <div style={{ position: "absolute", left: x - 300, width: 600, top: 430 - slide * 40, textAlign: "center", fontFamily: sans, fontWeight: 700, fontSize: 84 * sc, letterSpacing: "-0.03em", color: C.ink,
              opacity: Math.min(1, lab), transform: `scale(${1.6 - 0.6 * lab})` }}>{label}</div>
            {/* the data it is sitting on */}
            {Array.from({ length: 6 }, (_, k) => {
              const p = spring({ frame: f - at - 6 - k * 3, fps: FPS, config: { damping: 200 } });
              return <div key={k} style={{ position: "absolute", left: x - 110 * sc, top: (560 + k * 26) - slide * 40, width: 220 * sc, height: 16, background: C.red2, border: `1px solid ${C.red4}`, opacity: p * (1 - k * 0.08), transform: `translateY(${(1 - p) * 30}px)` }} />;
            })}
          </div>
        );
      })}
      {/* "could train a useful model": tiles stream down into a model */}
      {f >= TRAIN && f < NONE + 20 && cols.map(([g, , x0], i) => Array.from({ length: 8 }, (_, k) => {
        const p = ((f - TRAIN) / 26 + k / 8) % 1;
        const tx = x0 + (960 - x0) * p, ty = 740 + (900 - 740) * p;
        return <div key={`${g}${k}`} style={{ position: "absolute", left: tx - 7, top: ty, width: 14, height: 14, background: C.bone, opacity: interpolate(f, [NONE, NONE + 20], [0.9, 0], clamp) }} />;
      }))}
      <div style={{ position: "absolute", left: 960 - 55, top: 900, opacity: interpolate(f, [TRAIN, TRAIN + 10, NONE, NONE + 16], [0, 1, 1, 0], clamp), transform: `scale(${1 + 0.06 * Math.sin(f / 4)})` }}><LatticeMark size={110} /></div>
      {/* "None of them can hand it to a stranger's computer" */}
      {f >= STRANGER - 6 && (
        <>
          <Glyph name="laptop" x={LAP} y={300} s={1} color={C.muted} appear={STRANGER - 6} />
          <div style={{ position: "absolute", left: LAP - 40, top: 300, fontFamily: sans, fontWeight: 700, fontSize: 120, color: C.ink, opacity: interpolate(f, [STRANGER, STRANGER + 8], [0, 1], clamp) }}>?</div>
          <div style={{ position: "absolute", left: LAP - 200, width: 400, top: 520, textAlign: "center", fontFamily: sans, fontWeight: 600, fontSize: 40, color: C.muted, opacity: interpolate(f, [STRANGER + 4, STRANGER + 12], [0, 1], clamp) }}>a stranger&apos;s computer</div>
          {/* streams fired at it stop dead at a lattice wall */}
          {[0, 1, 2].map((i) => Array.from({ length: 6 }, (_, k) => {
            const p = ((f - STRANGER) / 18 + k / 6) % 1;
            const x0 = [250, 600, 950][i] + 70, y0 = 520 + i * 26;
            const tx = x0 + (WALL - x0) * p;
            return <div key={`r${i}${k}`} style={{ position: "absolute", left: tx, top: y0, width: 18, height: 18, background: C.danger, opacity: blocked ? 0.9 : 0 }} />;
          }))}
          <div style={{ position: "absolute", left: WALL, top: 220, width: 36, height: 460, opacity: interpolate(f, [STRANGER + 6, STRANGER + 12], [0, 1], clamp),
            backgroundImage: `linear-gradient(${C.danger} 2px, transparent 2px), linear-gradient(90deg, ${C.danger} 2px, transparent 2px)`, backgroundSize: "12px 12px", boxShadow: "0 0 30px rgba(255,111,102,0.6)" }} />
          <div style={{ position: "absolute", left: WALL - 70, top: 380, fontFamily: mono, fontWeight: 700, fontSize: 150, color: C.danger,
            transform: `scale(${spring({ frame: f - STRANGER - 14, fps: FPS, config: { damping: 9 } })})` }}>✗</div>
        </>
      )}
      <Flash at={STRANGER + 14} color="rgba(255,60,40,0.25)" />
      <Sfx at={H - 2} name="stamp" vol={0.45} />
      <Sfx at={B - 2} name="stamp" vol={0.45} />
      <Sfx at={S - 2} name="stamp" vol={0.45} />
      <Sfx at={TRAIN} name="riser" vol={0.3} />
      <Sfx at={STRANGER + 12} name="impact" vol={0.6} />
      <Sfx at={STRANGER + 14} name="glitch" vol={0.4} />
    </Ground>
  );
}

// ---------------------------------------------------------------- 2. title

const titleField = (frames: number): Field => (u, v, t, r) => {
  const p = interpolate(t, [0, frames * 0.6], [0, 1], { ...clamp, easing: ease });
  if (u < 0.5 || u > 0.5 + p * 0.5) return r < 0.03 ? 1 : 0;
  const x = (u - 0.5) / 0.5;
  // Holdout accuracy rising from the run's start to its end, drawn as a lit ridge in the mosaic.
  const acc = RUN.holdout.before + (RUN.holdout.after - RUN.holdout.before) * (1 - Math.pow(1 - x, 2.2));
  const y = 0.88 - acc * 0.85;
  const d = v - y;
  return Math.abs(d) < 0.015 ? 7 : Math.abs(d) < 0.035 ? 5 : d > 0 && d < 0.07 ? 4 : d > 0 && d < 0.14 ? (r < 0.55 ? 3 : 2) : d > 0 && r < 0.2 ? 1 : 0;
};

function S02({ frames }: SceneProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - 4, fps, config: { damping: 200 } });
  return (
    <Ground field={titleField(frames)} mosaicOpacity={1}>
      <AbsoluteFill style={{ background: "linear-gradient(90deg, #0b0908 0%, #0b0908 42%, rgba(11,9,8,0.7) 52%, rgba(11,9,8,0) 66%)" }} />
      <div style={{ position: "absolute", left: 120, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 38 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 26, transform: `scale(${0.92 + 0.08 * s})`, transformOrigin: "left center", opacity: s }}>
          <LatticeMark size={104} />
          <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 118, letterSpacing: "-0.04em", color: C.ink }}>strongChar</span>
        </div>
        <Headline at={14} size={50} style={{ fontWeight: 500 }}>Train on data nobody can read.<br /><span style={{ color: C.red5 }}>Pay only for proven work.</span></Headline>
        <div style={{ display: "flex", gap: 14, opacity: interpolate(f, [30, 44], [0, 1], clamp) }}>
          <Chip tone="seal">ML-KEM-1024</Chip><Chip tone="sky">ML-DSA-87 · pqcVerify</Chip><Chip tone="dim">qorechain-diana</Chip>
        </div>
      </div>
      <Sfx at={2} name="impact" vol={0.55} />
    </Ground>
  );
}

function LatticeMark({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, background: "#000", padding: size * 0.13, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: size * 0.065 }}>
      {Array.from({ length: 9 }, (_, i) => <i key={i} style={{ background: i === 4 ? C.red5 : (Math.floor(i / 3) + (i % 3)) % 2 === 0 ? C.ink : "rgba(242,240,237,0.22)" }} />)}
    </div>
  );
}

// ---------------------------------------------------------------- 3. the owner posts a job

const COLS = ["age", "bmi", "glucose", "bp", "insulin", "label"];
const ROWS = 12;
const cellVal = (r: number, c: number) => (c === 5 ? (hash01(r, 9) > 0.6 ? "1" : "0") : String(Math.round([22, 18, 70, 60, 15][c] + hash01(r, c) * [50, 25, 120, 40, 200][c])));
const SHARD_COL = [C.red4, C.bone, C.violet, C.sky];
const HEX = "0123456789abcdef";

function Field({ label, value, at }: { label: string; value: string; at: number }) {
  const f = useCurrentFrame();
  const n = Math.max(0, Math.min(value.length, Math.floor((f - at) * 0.9)));
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: C.sunken, border: `1px solid ${f >= at ? C.rule : "transparent"}`, borderRadius: 6 }}>
      <span style={{ fontFamily: sans, fontSize: 22, color: C.muted }}>{label}</span>
      <span style={{ fontFamily: mono, fontSize: 24, color: C.ink }}>{value.slice(0, n)}{f >= at && n < value.length ? "▍" : ""}</span>
    </div>
  );
}

function S03({ frames }: SceneProps) {
  const f = useCurrentFrame();
  const b = beats("s03-owner", lineOf("s03-owner"));
  const POST = b(/posts/), SPLIT = b(/split/), SEAL = b(/sealed/), VER = b(/verifiers/), SERVER = b(/server/);
  const price = RUN.owner.find((l) => /priced at/.test(l.text))?.text.match(/([\d.]+) fUSD/)?.[1] ?? String(RUN.budget);
  const drop = spring({ frame: f - (POST - 14), fps: FPS, config: { damping: 13 } });
  const press = interpolate(f, [SPLIT - 12, SPLIT - 8, SPLIT - 4], [1, 0.93, 1], clamp);
  const split = interpolate(f, [SPLIT, SPLIT + 16], [0, 1], { ...clamp, easing: ease });
  const fly = interpolate(f, [VER - 6, VER + 22], [0, 1], { ...clamp, easing: ease });
  const tx = frames - 70;
  const cellW = 92, cellH = 30;
  return (
    <Ground field={drift} mosaicOpacity={0.15}>
      <Kicker n="01">The owner posts a job</Kicker>
      {/* the form on the owner's own machine */}
      <div style={{ position: "absolute", left: 80, top: 140, width: 560, padding: 26, background: C.card, border: `1px solid ${C.rule}`, borderRadius: 10, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 30, color: C.ink }}>Post a training job</div>
        <div style={{ fontFamily: mono, fontSize: 15, color: C.subtle, marginBottom: 6 }}>runs on the owner&apos;s laptop · nothing leaves unencrypted</div>
        <div style={{ height: 96, border: `2px dashed ${f >= POST ? C.teal : C.rule}`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 16, position: "relative", overflow: "hidden" }}>
          {f < POST - 14 ? <span style={{ fontFamily: sans, fontSize: 20, color: C.subtle }}>drop a CSV</span> : (
            <div style={{ display: "flex", alignItems: "center", gap: 14, transform: `translateY(${(1 - drop) * -80}px)`, opacity: Math.min(1, drop * 1.5) }}>
              <div style={{ width: 44, height: 54, background: C.bone, clipPath: "polygon(0 0, 70% 0, 100% 28%, 100% 100%, 0 100%)" }} />
              <div><div style={{ fontFamily: mono, fontSize: 22, color: C.ink }}>health.csv</div><div style={{ fontFamily: mono, fontSize: 14, color: C.subtle }}>private · stays on this machine</div></div>
            </div>
          )}
        </div>
        <Field label="Rounds" value={String(RUN.rounds.length)} at={POST + 2} />
        <Field label="Shards" value="4" at={POST + 8} />
        <Field label="Verifier quorum" value="2 of 2" at={POST + 14} />
        <Field label="Budget" value={`${price} fUSD`} at={POST + 20} />
        <Field label="Stake per seat" value={`${RUN.stake} BERU`} at={POST + 32} />
        <div style={{ marginTop: 8, padding: "16px 0", textAlign: "center", borderRadius: 8, background: f >= SPLIT - 10 ? C.ok : C.band, color: f >= SPLIT - 10 ? "#0b1a0e" : C.muted, fontFamily: sans, fontWeight: 700, fontSize: 24, transform: `scale(${press})` }}>
          {f >= tx ? "✓ Posted" : f >= SPLIT - 10 ? "Posting…" : "Post job"}
        </div>
      </div>

      {/* the data, split into shards, each sealed in place */}
      <div style={{ position: "absolute", left: 700, top: 150, opacity: interpolate(f, [POST, POST + 10, VER, VER + 20], [0, 1, 1, 0.25], clamp) }}>
        <div style={{ display: "flex", marginBottom: 6 }}>{COLS.map((c) => <div key={c} style={{ width: cellW, fontFamily: mono, fontSize: 15, color: C.subtle }}>{c}</div>)}</div>
        {Array.from({ length: ROWS }, (_, r) => {
          const sh = Math.floor(r / 3);
          const sealAt = SEAL + sh * 7;
          const sealing = interpolate(f, [sealAt, sealAt + 16], [0, 1], clamp);
          return (
            <div key={r} style={{ display: "flex", marginTop: r % 3 === 0 && r ? 6 + split * 16 : 0, transform: `translateX(${split * (sh % 2 ? 16 : 0)}px)` }}>
              {COLS.map((c, k) => {
                const plain = cellVal(r, k);
                const txt = sealing <= 0 ? plain : sealing >= 1 ? Array.from({ length: 6 }, (_, j) => HEX[Math.floor(hash01(r * 13 + k, j) * 16)]).join("")
                  : Array.from({ length: 6 }, (_, j) => HEX[Math.floor(hash01(r * 13 + k + f, j) * 16)]).join("");
                return <div key={c} style={{ width: cellW - 4, height: cellH - 4, margin: 2, display: "flex", alignItems: "center", paddingLeft: 8, fontFamily: mono, fontSize: 16,
                  color: sealing > 0 ? C.teal : C.ink, background: sealing >= 1 ? C.tealBg : split > 0 ? `${SHARD_COL[sh]}22` : C.card, borderLeft: k === 0 && split > 0 ? `3px solid ${SHARD_COL[sh]}` : undefined }}>{txt}</div>;
              })}
              {r % 3 === 1 && split > 0 && (
                <div style={{ marginLeft: 14, display: "flex", alignItems: "center", gap: 8, fontFamily: mono, fontSize: 16, color: f >= sealAt + 16 ? C.teal : SHARD_COL[sh], opacity: split }}>
                  {f >= sealAt + 16 ? "🔒 ML-KEM-1024" : `shard ${sh}`}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* sealed shards fly to both verifiers */}
      {[0, 1, 2, 3].flatMap((sh) => [0, 1].map((v) => {
        const sx = 1120, sy = 200 + sh * 112;
        const vx = 1500 + 0, vy = v ? 690 : 230;
        const p = Math.max(0, Math.min(1, fly * 1.2 - sh * 0.06 - v * 0.04));
        if (p <= 0) return null;
        return <div key={`${sh}${v}`} style={{ position: "absolute", left: sx + (vx - sx) * p, top: sy + (vy - sy) * p, width: 64, height: 40, borderRadius: 4, background: C.tealBg, border: `2px solid ${C.teal}`,
          display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 18, color: C.teal, opacity: p < 1 ? 1 : 0.0 }}>🔒{sh}</div>;
      }))}
      {["verifier-a", "verifier-b"].map((v, i) => {
        const got = fly >= 1;
        return (
          <div key={v} style={{ position: "absolute", left: 1470, top: i ? 640 : 180, width: 370, padding: 20, background: C.card, border: `2px solid ${got ? C.sky : C.rule}`, borderRadius: 10, opacity: interpolate(f, [SEAL, SEAL + 12], [0, 1], clamp) }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontFamily: sans, fontWeight: 600, fontSize: 26, color: C.ink }}>Verifier {i ? "B" : "A"}</span>{got && <Chip tone="sky" style={{ fontSize: 14 }}>4 shards</Chip>}</div>
            <div style={{ fontFamily: mono, fontSize: 14, color: C.subtle, marginTop: 6 }}>{machine(v).ip} · AWS Sydney · holds its own ML-KEM key</div>
          </div>
        );
      })}
      {/* the server in the middle */}
      <div style={{ position: "absolute", left: 1470, top: 410, width: 370, padding: 18, background: C.sunken, border: `1px dashed ${C.rule}`, borderRadius: 10, opacity: interpolate(f, [SERVER - 4, SERVER + 8], [0, 1], clamp) }}>
        <div style={{ fontFamily: sans, fontSize: 22, color: C.ink }}>Coordinator (the server)</div>
        <div style={{ fontFamily: mono, fontSize: 15, color: C.teal, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden" }}>{Array.from({ length: 34 }, (_, j) => HEX[Math.floor(hash01(j, Math.floor(f / 3)) * 16)]).join("")}</div>
        <div style={{ fontFamily: mono, fontSize: 15, color: C.muted, marginTop: 4 }}>sees ciphertext only · has no key</div>
      </div>
      {/* the job lands on-chain */}
      <div style={{ position: "absolute", left: 700, bottom: 200, display: "flex", alignItems: "center", gap: 16, opacity: interpolate(f, [tx, tx + 10], [0, 1], clamp), transform: `translateY(${interpolate(f, [tx, tx + 12], [20, 0], clamp)}px)` }}>
        <Chip tone="ok">✓ job {RUN.job} created on qorechain-diana</Chip>
        <span style={{ fontFamily: mono, fontSize: 20, color: C.muted }}>createJob {short(RUN.createTx, 10)}</span>
      </div>
      <Sfx at={POST - 14} name="whoosh" vol={0.4} />
      <Sfx at={POST} name="typing" vol={0.3} />
      <Sfx at={SPLIT - 12} name="tick" vol={0.6} />
      <Sfx at={SPLIT} name="whoosh" vol={0.3} />
      {[0, 1, 2, 3].map((sh) => <Sfx key={sh} at={SEAL + sh * 7 + 16} name="lock" vol={0.35} />)}
      <Sfx at={VER - 6} name="whoosh" vol={0.4} />
      <Sfx at={tx} name="coin" vol={0.4} />
    </Ground>
  );
}

// ---------------------------------------------------------------- 4. the network

const POS: Record<string, [number, number]> = {
  coordinator: [960, 470], "verifier-a": [520, 250], "verifier-b": [1400, 250],
  "node-1": [330, 760], "node-2": [740, 860], "node-3": [1180, 860], "node-4": [1590, 760],
};

function S04({ frames }: SceneProps) {
  const f = useCurrentFrame();
  const r1 = RUN.rounds[0];
  const seated = new Set(r1?.seated ?? []);
  const nodes = RUN.machines.filter((m) => m.role === "node");
  return (
    <Ground field={drift} mosaicOpacity={0.25}>
      <Kicker n="02">The network seats the fastest nodes</Kicker>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {nodes.map((n, i) => {
          const [x, y] = POS[n.name] ?? [0, 0];
          const [cx, cy] = POS.coordinator;
          const on = seated.has(n.name);
          const p = interpolate(f, [frames * 0.35 + i * 8, frames * 0.6 + i * 8], [0, 1], clamp);
          return (
            <g key={n.name}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={on ? C.teal : C.rule} strokeWidth={on ? 2 : 1} strokeDasharray={on ? "0" : "6 8"} opacity={interpolate(f, [frames * 0.2 + i * 5, frames * 0.3 + i * 5], [0, 1], clamp)} />
              {on && p > 0 && p < 1 && <rect x={cx + (x - cx) * p - 14} y={cy + (y - cy) * p - 10} width={28} height={20} fill={C.teal} rx={2} />}
            </g>
          );
        })}
        {["verifier-a", "verifier-b"].map((v) => <line key={v} x1={POS[v][0]} y1={POS[v][1]} x2={POS.coordinator[0]} y2={POS.coordinator[1]} stroke={C.sky} strokeOpacity={0.5} strokeWidth={1.5} />)}
      </svg>
      {RUN.machines.filter((m) => POS[m.name]).map((m, i) => {
        const [x, y] = POS[m.name];
        const s = spring({ frame: f - 6 - i * 4, fps: FPS, config: { damping: 200 } });
        const on = m.role === "node" && seated.has(m.name);
        return (
          <div key={m.name} style={{ position: "absolute", left: x - 150, top: y - 54, width: 300, padding: "14px 18px", background: C.card, border: `1px solid ${on ? C.teal : m.role === "coordinator" ? C.ink : C.rule}`, borderRadius: 6, opacity: s, transform: `scale(${0.9 + 0.1 * s})` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: sans, fontSize: 24, fontWeight: 600, color: C.ink }}>{m.name}</span>
              {m.role === "node" && interpolate(f, [frames * 0.3, frames * 0.32], [0, 1], clamp) > 0 && (on ? <Chip tone="seal" style={{ fontSize: 14 }}>seated</Chip> : <Chip tone="dim" style={{ fontSize: 14 }}>waiting</Chip>)}
            </div>
            <div style={{ marginTop: 6, fontFamily: mono, fontSize: 15, color: C.subtle }}>{m.role} · {m.ip} · {m.place}</div>
          </div>
        );
      })}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => <Sfx key={i} at={6 + i * 4} name="tick" vol={0.35} />)}
      <Sfx at={frames * 0.35} name="riser" vol={0.35} />
    </Ground>
  );
}

// ---------------------------------------------------------------- 5. training, switching between nodes

// Training, drawn as four live panels in a 1920x1080 "world" that a virtual camera glides across. Each honest panel
// streams sealed rows into a weight grid that settles as it learns, while its loss curve draws downward; the
// cheater's grid is frozen noise with a flat line. Progress and curves are illustrative (the nodes don't log them);
// the commit hashes, shards, order of finishing and the cheater are from the real run.
const CARD_W = 860, CARD_H = 420;
const CARD_POS = [[80, 150], [982, 150], [80, 592], [982, 592]] as const;
const WG_COLS = 18, WG_ROWS = 9;
const hash01 = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
const WCOL = [C.red1, C.red2, C.red3, C.red4, C.red5, C.bone];

function WeightGrid({ seed, progress, frozen, f }: { seed: number; progress: number; frozen: boolean; f: number }) {
  const cell = 19, gap = 3;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${WG_COLS}, ${cell}px)`, gap }}>
      {Array.from({ length: WG_COLS * WG_ROWS }, (_, i) => {
        const target = 0.5 + 0.5 * Math.sin((i % WG_COLS) / 2.6 + seed) * Math.cos(Math.floor(i / WG_COLS) / 1.9 - seed / 2);
        const noise = hash01(i + seed * 97, frozen ? 1 : Math.floor(f / 2));
        const v = frozen ? noise : noise + (target - noise) * Math.min(1, progress * 1.15);
        const c = frozen ? `rgba(149,142,135,${0.15 + noise * 0.5})` : WCOL[Math.min(5, Math.floor(v * 6))];
        return <i key={i} style={{ width: cell, height: cell, background: c }} />;
      })}
    </div>
  );
}

function LossCurve({ seed, progress, flat, w, h }: { seed: number; progress: number; flat: boolean; w: number; h: number }) {
  const n = 60;
  const pts: string[] = [];
  for (let k = 0; k <= n * progress; k++) {
    const x = k / n;
    const loss = flat ? 0.82 + hash01(k, seed) * 0.03 : 0.1 + 0.78 * Math.exp(-3.1 * x) + (hash01(k, seed) - 0.5) * 0.06 * (1 - x);
    const y = 1 - loss; // high loss at the top, falling as the node learns
    pts.push(`${(x * w).toFixed(1)},${(y * h).toFixed(1)}`);
  }
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={0} x2={w} y1={g * h} y2={g * h} stroke="rgba(255,255,255,0.06)" />)}
      <polyline points={pts.join(" ")} fill="none" stroke={flat ? C.subtle : C.ok} strokeWidth={3} strokeLinejoin="round" />
      {pts.length > 0 && <circle cx={Number(pts.at(-1)!.split(",")[0])} cy={Number(pts.at(-1)!.split(",")[1])} r={5} fill={flat ? C.subtle : C.ok} />}
    </svg>
  );
}

function TrainCard({ name, idx, start, done, f, caught }: { name: string; idx: number; start: number; done: number; f: number; caught: boolean }) {
  const r1 = RUN.rounds[0];
  const bad = name === RUN.cheater.name;
  const progress = interpolate(f, [start, done], [0, 1], clamp);
  const commit = (RUN.logs[name] ?? []).find((l) => /round 1 trained/.test(l.text));
  const hashStr = commit?.text.match(/\((0x[0-9a-f…]+)\)/)?.[1] ?? "";
  const committed = f >= done;
  const pop = spring({ frame: f - done, fps: FPS, config: { damping: 14 } });
  const [x, y] = CARD_POS[idx];
  const border = caught ? C.danger : committed && !bad ? C.ok : C.rule;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: CARD_W, height: CARD_H, background: C.card, border: `2px solid ${border}`, borderRadius: 10,
      boxShadow: caught ? "0 0 60px rgba(255,111,102,0.45)" : committed && !bad ? "0 0 40px rgba(123,216,138,0.18)" : "0 20px 50px rgba(0,0,0,0.5)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: `1px solid ${C.rule}`, background: C.band }}>
        <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 28, color: C.ink }}>{name}</span>
        <Chip tone="seal" style={{ fontSize: 14 }}>🔒 shard {r1.shards[name]}</Chip>
        <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 15, color: C.subtle }}>{machine(name).ip} · AWS Sydney</span>
      </div>
      <div style={{ display: "flex", gap: 22, padding: "18px 20px" }}>
        {/* sealed rows streaming in */}
        <div style={{ width: 70, height: 205, position: "relative", overflow: "hidden" }}>
          {Array.from({ length: 7 }, (_, k) => {
            const yy = ((f * (bad ? 0 : 3.2) + k * 32) % 224) - 20;
            return <div key={k} style={{ position: "absolute", left: 8, top: yy, width: 54, height: 18, borderRadius: 2, background: bad ? "rgba(149,142,135,0.2)" : C.tealBg, border: `1px solid ${bad ? C.rule : C.teal}`, opacity: progress > 0 && progress < 1 ? 1 : 0.25 }} />;
          })}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, textAlign: "center", fontFamily: mono, fontSize: 12, color: C.subtle }}>rows</div>
        </div>
        <div>
          <div style={{ fontFamily: mono, fontSize: 13, color: C.subtle, marginBottom: 6, letterSpacing: "0.1em" }}>WEIGHTS</div>
          <WeightGrid seed={idx * 1.7 + 0.4} progress={progress} frozen={bad} f={f} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: mono, fontSize: 13, color: C.subtle, marginBottom: 6, letterSpacing: "0.1em" }}>LOSS</div>
          <LossCurve seed={idx + 3} progress={bad ? Math.min(1, progress) : progress} flat={bad} w={250} h={190} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 20, right: 20, bottom: 18, display: "flex", alignItems: "center", gap: 16 }}>
        {!committed ? (
          bad ? <Chip tone="bad">no gradient · making up weights</Chip>
            : <><div style={{ flex: 1, height: 10, background: C.band, borderRadius: 5, overflow: "hidden" }}><div style={{ width: `${progress * 100}%`, height: "100%", background: C.ok }} /></div>
              <span style={{ fontFamily: mono, fontSize: 18, color: C.ink, width: 60, textAlign: "right" }}>{Math.round(progress * 100)}%</span></>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 12, transform: `scale(${0.85 + 0.15 * pop})`, transformOrigin: "left center" }}>
            <Chip tone={bad ? "bad" : "ok"}>{bad ? "✗ committed" : "✓ committed"}</Chip>
            <span style={{ fontFamily: mono, fontSize: 17, color: bad ? C.danger : C.ink }}>{short(hashStr, 10)}</span>
            {caught && <Chip tone="bad" style={{ marginLeft: 12 }}>claims weights it never trained</Chip>}
          </div>
        )}
      </div>
    </div>
  );
}

function S05({ frames }: SceneProps) {
  const f = useCurrentFrame();
  const r1 = RUN.rounds[0];
  const names = (r1?.seated ?? []).slice(0, 4);
  const cheater = RUN.cheater.name;
  const ci = names.indexOf(cheater);
  const honest = names.map((_, i) => i).filter((i) => i !== ci);
  // Real finishing order, mapped into the middle of the scene; the cheater "finishes" right before the camera lands on it.
  const commits = names.map((n) => r1.committed[n]);
  const map = timeMap(Math.min(...commits), Math.max(...commits), frames * 0.42, frames * 0.58);
  const CATCH = Math.round(frames * 0.72);
  const doneAt = (i: number) => (i === ci ? CATCH - 10 : map(commits[i]));
  // Camera keyframes: [frame, centre x, centre y, zoom]. Holds on each honest node, a pull-back, then a push onto the cheater.
  const ctr = (i: number) => [CARD_POS[i][0] + CARD_W / 2, CARD_POS[i][1] + CARD_H / 2] as const;
  const K: [number, number, number, number][] = [
    [0, 960, 590, 1],
    [frames * 0.08, 960, 590, 1],
    ...honest.flatMap((i, k) => { const t = frames * (0.14 + k * 0.14); const [cx, cy] = ctr(i); return [[t, cx, cy, 1.75], [t + frames * 0.07, cx, cy, 1.8]] as [number, number, number, number][]; }),
    [frames * 0.6, 960, 590, 1],
    [frames * 0.64, 960, 590, 1],
    [CATCH - 4, ...ctr(ci), 1.7],
    [frames, ...ctr(ci), 1.85],
  ];
  const seg = Math.max(0, K.findIndex((k, i) => i + 1 < K.length && f >= k[0] && f < K[i + 1][0]));
  const [a, b] = [K[seg], K[Math.min(seg + 1, K.length - 1)]];
  const t = b[0] === a[0] ? 1 : Easing.bezier(0.65, 0, 0.35, 1)(Math.min(1, Math.max(0, (f - a[0]) / (b[0] - a[0]))));
  const cx = a[1] + (b[1] - a[1]) * t, cy = a[2] + (b[2] - a[2]) * t, z = a[3] + (b[3] - a[3]) * t;
  return (
    <Ground field={drift} mosaicOpacity={0.15}>
      <AbsoluteFill style={{ transformOrigin: "0 0", transform: `translate(${960 - cx * z}px, ${560 - cy * z}px) scale(${z})` }}>
        {names.map((n, i) => <TrainCard key={n} name={n} idx={i} start={20 + i * 5} done={doneAt(i)} f={f} caught={i === ci && f >= CATCH} />)}
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 125, background: "linear-gradient(180deg, #0b0908 70%, rgba(11,9,8,0))" }} />
      <Kicker n="03">Each node trains its shard, then commits</Kicker>
      {honest.map((i, k) => <Sfx key={i} at={frames * (0.14 + k * 0.14) - 12} name="whoosh" vol={0.25} />)}
      {honest.map((i) => <Sfx key={`c${i}`} at={doneAt(i)} name="tick" vol={0.45} />)}
      <Sfx at={CATCH} name="alarm" vol={0.45} />
      <Flash at={CATCH} color="rgba(255,60,40,0.25)" />
    </Ground>
  );
}

// ---------------------------------------------------------------- 6. the replay catches the cheater

function S06({ frames }: SceneProps) {
  const f = useCurrentFrame();
  const r1 = RUN.rounds[0];
  const rows = Object.entries(r1?.hashes ?? {});
  const cheater = RUN.cheater.name;
  const stake = interpolate(f, [frames * 0.62, frames * 0.8], [RUN.cheater.stakeBefore, RUN.cheater.stakeAfter], clamp);
  return (
    <Ground field={drift} mosaicOpacity={0.2}>
      <Shake at={Math.round(frames * 0.62)} amp={26}>
      <Kicker n="04">Two verifiers replay every node, bit for bit</Kicker>
      <div style={{ position: "absolute", left: 80, top: 150, width: 1120 }}>
        {rows.map(([n, h], i) => {
          const at = frames * 0.12 + i * frames * 0.1;
          const o = interpolate(f, [at, at + 10], [0, 1], clamp);
          const verdict = f > at + 18;
          return (
            <div key={n} style={{ display: "grid", gridTemplateColumns: "140px 1fr 170px 170px", alignItems: "center", gap: 18, padding: "18px 22px", marginBottom: 14, background: C.card, border: `1px solid ${verdict && !h.ok ? C.danger : C.rule}`, borderRadius: 6, opacity: o }}>
              <span style={{ fontFamily: sans, fontSize: 26, fontWeight: 600, color: C.ink }}>{n}</span>
              <div style={{ fontFamily: mono, fontSize: 16, color: C.subtle }}>committed weights hash<br /><span style={{ color: verdict && !h.ok ? C.danger : C.ink, fontSize: 19, textDecoration: verdict && !h.ok ? "line-through" : "none" }}>{short(h.claimed, 12)}</span></div>
              {["verifier A", "verifier B"].map((v, k) => (
                <div key={v} style={{ fontFamily: mono, fontSize: 15, color: C.subtle }}>{v}<br />
                  {f > at + 12 + k * 6 ? (h.ok ? <Chip tone="ok" style={{ fontSize: 15, marginTop: 4 }}>✓ bit-exact</Chip> : <Chip tone="bad" style={{ fontSize: 15, marginTop: 4 }}>✗ mismatch</Chip>) : <Chip tone="sky" style={{ fontSize: 15, marginTop: 4 }}>replaying…</Chip>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", right: 80, top: 160, width: 520, padding: 30, background: C.card, border: `1px solid ${f > frames * 0.6 ? C.danger : C.rule}`, borderRadius: 6, opacity: interpolate(f, [frames * 0.55, frames * 0.62], [0, 1], clamp) }}>
        <div style={{ fontFamily: sans, fontSize: 26, color: C.ink }}>{cheater} stake</div>
        <div style={{ fontFamily: mono, fontSize: 96, color: f > frames * 0.62 ? C.danger : C.ink, letterSpacing: "-0.03em", marginTop: 8 }}>{stake.toFixed(0)}<span style={{ fontSize: 30, color: C.subtle }}> BERU</span></div>
        <div style={{ marginTop: 14, fontFamily: mono, fontSize: 18, color: C.subtle }}>slashed {RUN.cheater.stakeBefore - RUN.cheater.stakeAfter} BERU · burned · earns 0 fUSD</div>
      </div>
      </Shake>
      <Flash at={Math.round(frames * 0.62)} />
      <Sfx at={frames * 0.12 + 10} name="alarm" vol={0.5} />
      <Sfx at={frames * 0.12 + 12} name="stamp" vol={0.7} />
      <Sfx at={frames * 0.62 - 1} name="impact" vol={0.85} />
    </Ground>
  );
}

// ---------------------------------------------------------------- 7. proof on-chain (screen recordings)

function S07({ frames }: SceneProps) {
  const f = useCurrentFrame();
  const r1 = RUN.rounds[0];
  return (
    <Ground>
      <Kicker n="05">Settled only with two ML-DSA-87 signatures</Kicker>
      <div style={{ position: "absolute", left: 80, top: 140, width: 1180, height: 760, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.rule}` }}>
        {CLIPS.receipt ? <OffthreadVideo src={staticFile("clips/receipt.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top left" }} /> : null}
      </div>
      <div style={{ position: "absolute", right: 80, top: 180, width: 520, display: "flex", flexDirection: "column", gap: 18 }}>
        {[["verifier A", "ML-DSA-87 signature", 0.15], ["verifier B", "ML-DSA-87 signature", 0.3], ["pqcVerify precompile", "both checked on-chain", 0.45]].map(([a, b, at]) => (
          <div key={String(a)} style={{ padding: "18px 22px", background: C.card, border: `1px solid ${C.rule}`, borderRadius: 6, opacity: interpolate(f, [frames * Number(at), frames * Number(at) + 10], [0, 1], clamp) }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontFamily: sans, fontSize: 24, color: C.ink }}>{a}</span><Chip tone="ok">✓</Chip></div>
            <div style={{ fontFamily: mono, fontSize: 16, color: C.subtle, marginTop: 6 }}>{b}</div>
          </div>
        ))}
        <div style={{ fontFamily: mono, fontSize: 17, color: C.sky, opacity: interpolate(f, [frames * 0.6, frames * 0.7], [0, 1], clamp) }}>finalizeRound {short(r1?.tx ?? "", 12)}</div>
      </div>
    </Ground>
  );
}

// ---------------------------------------------------------------- 8. payout

function S08({ frames }: SceneProps) {
  const f = useCurrentFrame();
  const pays = Object.entries(RUN.payouts).filter(([n]) => n !== RUN.cheater.name);
  const max = Math.max(...pays.map(([, v]) => v), RUN.pool);
  return (
    <Ground field={drift} mosaicOpacity={0.25}>
      <Kicker n="06">Honest work is paid in fUSD</Kicker>
      <div style={{ position: "absolute", left: 160, top: 220, right: 160 }}>
        {[...pays, [RUN.cheater.name, 0] as [string, number], ["community pool", RUN.pool] as [string, number]].map(([n, v], i) => {
          const p = interpolate(f, [frames * 0.1 + i * 6, frames * 0.5 + i * 6], [0, 1], { ...clamp, easing: ease });
          const bad = n === RUN.cheater.name;
          const pool = n === "community pool";
          return (
            <div key={n} style={{ display: "grid", gridTemplateColumns: "260px 1fr 260px", alignItems: "center", gap: 24, marginBottom: 30 }}>
              <span style={{ fontFamily: sans, fontSize: 30, color: pool ? C.muted : C.ink }}>{n}</span>
              <div style={{ height: 34, background: C.band, borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${(v / max) * 100 * p}%`, height: "100%", background: bad ? C.danger : pool ? C.violet : C.ok }} /></div>
              <span style={{ fontFamily: mono, fontSize: 30, color: bad ? C.danger : C.ink, textAlign: "right" }}>{bad ? `0 · −${RUN.cheater.stakeBefore - RUN.cheater.stakeAfter} BERU` : `${(v * p).toFixed(4)} fUSD`}</span>
            </div>
          );
        })}
      </div>
      {[0, 1, 2].map((i) => <Sfx key={i} at={frames * 0.1 + i * 6 + 12} name="coin" vol={0.5} />)}
    </Ground>
  );
}

// ---------------------------------------------------------------- 9. competitions and the result

function S09({ frames }: SceneProps) {
  const f = useCurrentFrame();
  const half = frames * 0.5;
  return (
    <Ground>
      <Kicker n="07">{f < half ? "Competitions where the labels never leak" : "The model goes back to its owner"}</Kicker>
      {f < half ? (
        <div style={{ position: "absolute", left: 80, top: 140, right: 80, bottom: 70, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.rule}` }}>
          {CLIPS.compete ? <OffthreadVideo src={staticFile("clips/compete.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
        </div>
      ) : (
        <div style={{ position: "absolute", left: 160, top: 240, right: 160, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
          {[["Holdout accuracy", `${RUN.holdout.before.toFixed(3)} → ${RUN.holdout.after.toFixed(3)}`, "scored on rows that never left the owner"],
            ["Settled on-chain", `${RUN.rounds.length} / ${RUN.rounds.length} rounds`, RUN.rounds.map((r) => short(r.tx, 6)).join("  ·  ")],
            ["x86 laptop", short(RUN.x86Hash, 10), "same round, same bytes"], ["arm64 server", short(RUN.armHash, 10), "same round, same bytes"]].map(([a, b, c], i) => (
            <div key={a} style={{ padding: 32, background: C.card, border: `1px solid ${C.rule}`, borderRadius: 6, opacity: interpolate(f, [half + i * 8, half + i * 8 + 12], [0, 1], clamp) }}>
              <div style={{ fontFamily: sans, fontSize: 24, color: C.muted }}>{a}</div>
              <div style={{ fontFamily: mono, fontSize: 52, color: C.ink, marginTop: 10 }}>{b}</div>
              <div style={{ fontFamily: mono, fontSize: 16, color: C.subtle, marginTop: 10 }}>{c}</div>
            </div>
          ))}
        </div>
      )}
    </Ground>
  );
}

// ---------------------------------------------------------------- 10. close

function S10({ frames }: SceneProps) {
  const f = useCurrentFrame();
  return (
    <Ground field={titleField(frames)} mosaicOpacity={0.9}>
      <AbsoluteFill style={{ background: "radial-gradient(circle at 35% 50%, rgba(11,9,8,0.96) 30%, rgba(11,9,8,0.4) 70%)" }} />
      <div style={{ position: "absolute", left: 120, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 34 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}><LatticeMark size={88} /><span style={{ fontFamily: sans, fontWeight: 600, fontSize: 100, letterSpacing: "-0.04em", color: C.ink }}>strongChar</span></div>
        <Headline at={8} size={46} style={{ fontWeight: 500 }}>Your data, sealed to only the machines that need it.<br /><span style={{ color: C.red5 }}>Every step proven.</span></Headline>
        <div style={{ fontFamily: mono, fontSize: 26, color: C.muted, opacity: interpolate(f, [26, 40], [0, 1], clamp) }}>strongchar.vercel.app · github.com/rounak-agl/strongChar</div>
      </div>
      <Sfx at={2} name="impact" vol={0.6} />
    </Ground>
  );
}

// Which optional footage exists (set by scripts/build_run.py after recording).
import clips from "../../public/data/clips.json";
const CLIPS = clips as Record<string, boolean>;

export const SCENE_COMPONENTS: Record<string, (p: SceneProps) => React.JSX.Element> = {
  "s00-hook": S00, "s01-open": S01, "s02-title": S02, "s03-owner": S03, "s04-network": S04, "s05-training": S05,
  "s06-replay": S06, "s07-proof": S07, "s08-pay": S08, "s09-more": S09, "s10-close": S10,
};
