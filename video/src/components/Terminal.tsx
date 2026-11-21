// A terminal window that replays real log lines: each line appears at its own frame, newest at the bottom.
import type { ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, mono, sans } from "../theme";

export type Line = { at: number; text: string; tone?: "ok" | "bad" | "warn" | "seal" | "dim" | "cmd" };

const TONE: Record<string, string> = { ok: C.ok, bad: C.danger, warn: C.warn, seal: C.teal, dim: C.subtle, cmd: C.ink };

export function Terminal({ title, host, lines, highlight, width, height, fontSize = 17, children, glow }: {
  title: string; host?: string; lines: Line[]; highlight?: boolean; width: number; height: number; fontSize?: number;
  children?: ReactNode; glow?: string;
}) {
  const frame = useCurrentFrame();
  const shown = lines.filter((l) => l.at <= frame);
  const maxLines = Math.floor((height - 54) / (fontSize * 1.45));
  const visible = shown.slice(-maxLines);
  return (
    <div style={{ width, height, background: C.sunken, border: `1px solid ${highlight ? C.ink : C.rule}`, borderRadius: 6,
      boxShadow: glow ? `0 0 0 1px ${glow}, 0 0 40px ${glow}` : "0 20px 50px rgba(0,0,0,0.5)", overflow: "hidden",
      position: "relative", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 36, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", background: C.band,
        borderBottom: `1px solid ${C.rule}`, fontFamily: sans, fontSize: 15, color: C.muted }}>
        <span style={{ display: "flex", gap: 6 }}>{["#ff5f57", "#febc2e", "#28c840"].map((c) => <i key={c} style={{ width: 11, height: 11, borderRadius: 6, background: c, opacity: 0.8 }} />)}</span>
        <span style={{ color: C.ink, fontWeight: 600 }}>{title}</span>
        {host && <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 13, color: C.subtle }}>{host}</span>}
      </div>
      <div style={{ padding: "10px 14px", fontFamily: mono, fontSize, lineHeight: 1.45, color: C.muted, flex: 1 }}>
        {visible.map((l, i) => {
          const age = frame - l.at;
          const typed = l.tone === "cmd" ? Math.min(l.text.length, Math.floor(age * 1.6)) : l.text.length;
          return (
            <div key={`${l.at}-${i}`} style={{ whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis",
              color: l.tone ? TONE[l.tone] : C.muted, opacity: interpolate(age, [0, 4], [0, 1], { extrapolateRight: "clamp" }) }}>
              {l.tone === "cmd" ? <><span style={{ color: C.teal }}>$ </span>{l.text.slice(0, typed)}</> : l.text}
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}
