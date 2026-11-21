// The film: each scene runs for its voiceover plus a pause, with short cross-fades between scenes. On top: the voice,
// a score built from looping sections that change at the scene boundaries, a whoosh on every cut, and word-by-word
// captions so it still works with the sound off.
import { Audio, Sequence, staticFile, interpolate, useCurrentFrame, useVideoConfig, AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { SCENES } from "./script";
import { SCENE_COMPONENTS } from "./scenes";
import { C, FPS, sans } from "./theme";

export type FilmProps = { voice: Record<string, number> };
const XF = 12; // cross-fade frames
const VO_DELAY = Math.round(0.25 * FPS);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function sceneFrames(id: string, voice: Record<string, number>): number {
  const s = SCENES.find((x) => x.id === id)!;
  const est = s.line.split(/\s+/).length / 2.55; // ~153 words a minute until the voice exists
  return Math.round(((voice[id] ?? est) + s.pad) * FPS);
}

export function filmFrames(voice: Record<string, number>): number {
  return SCENES.reduce((a, s) => a + sceneFrames(s.id, voice), 0) - XF * (SCENES.length - 1);
}

// The score (scripts/score.py) is composed to this same timeline. It sits at MUSIC_LEVEL and ducks under the narration,
// with 8-frame ramps so the dips are not audible as steps.
const MUSIC_LEVEL = 0.42;
const DUCK = 0.5;
function scoreVolume(f: number, windows: (readonly [number, number])[], total: number): number {
  let d = Infinity; // frames from the nearest voice window (0 inside one)
  for (const [a, b] of windows) d = Math.min(d, f < a ? a - f : f > b ? f - b : 0);
  const duck = 1 - (1 - DUCK) * Math.max(0, 1 - d / 8);
  const fade = interpolate(f, [0, 6, total - 75, total], [0, 1, 1, 0], clamp);
  return MUSIC_LEVEL * duck * fade;
}

export function Film({ voice }: FilmProps) {
  const { durationInFrames } = useVideoConfig();
  let at = 0;
  const starts = SCENES.map((s) => { const st = at; at += sceneFrames(s.id, voice) - XF; return st; });
  const voiceWindows = SCENES.map((s, i) => [starts[i] + VO_DELAY, starts[i] + VO_DELAY + Math.round((voice[s.id] ?? 0) * FPS)] as const);
  return (
    <>
      <TransitionSeries>
        {SCENES.flatMap((s, i) => {
          const Comp = SCENE_COMPONENTS[s.id];
          const items = [
            <TransitionSeries.Sequence key={s.id} durationInFrames={sceneFrames(s.id, voice)}>
              <Comp frames={sceneFrames(s.id, voice)} />
            </TransitionSeries.Sequence>,
          ];
          if (i < SCENES.length - 1) items.push(<TransitionSeries.Transition key={`${s.id}-x`} presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />);
          return items;
        })}
      </TransitionSeries>

      {SCENES.map((s, i) => voice[s.id] ? (
        <Sequence key={`vo-${s.id}`} from={starts[i] + VO_DELAY} durationInFrames={Math.round(voice[s.id] * FPS) + 6}>
          <Audio src={staticFile(`vo/${s.id}.mp3`)} />
          <Captions text={SCENES[i].line} frames={Math.round(voice[s.id] * FPS)} />
        </Sequence>
      ) : null)}

      {SCENES.slice(1).map((s, i) => (
        <Sequence key={`wh-${s.id}`} from={Math.max(0, starts[i + 1] - 6)} durationInFrames={30}>
          <Audio src={staticFile("sfx/whoosh.mp3")} volume={0.35} />
        </Sequence>
      ))}

      <Audio src={staticFile("music/score.wav")} volume={(f) => scoreVolume(f, voiceWindows, durationInFrames)} />
    </>
  );
}

/** Word-by-word captions, timed by word length across the voice clip (close enough for a narrated read). */
function Captions({ text, frames }: { text: string; frames: number }) {
  const f = useCurrentFrame();
  const words = text.split(/\s+/);
  const weights = words.map((w) => w.replace(/[^\w]/g, "").length + 2 + (/[.,:;]$/.test(w) ? 4 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const times = weights.map((w) => { const t = (acc / total) * frames; acc += w; return t; });
  const cur = Math.max(0, times.reduce((k, t, i) => (t <= f ? i : k), 0));
  // Pages of up to 6 words, breaking after sentence punctuation.
  const pages: number[][] = [];
  let page: number[] = [];
  words.forEach((w, i) => { page.push(i); if (page.length >= 6 || /[.!?]$/.test(w)) { pages.push(page); page = []; } });
  if (page.length) pages.push(page);
  const shown = pages.find((p) => p.includes(cur)) ?? [];
  const pageStart = times[shown[0] ?? 0];
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 46, pointerEvents: "none" }}>
      <div style={{ display: "flex", gap: 14, padding: "12px 24px", background: "rgba(6,5,4,0.78)", borderRadius: 8, fontFamily: sans, fontWeight: 600, fontSize: 44, letterSpacing: "-0.01em",
        opacity: interpolate(f - pageStart, [0, 4], [0.4, 1], clamp) }}>
        {shown.map((i) => (
          <span key={i} style={{ color: i === cur ? C.red5 : i < cur ? C.ink : "rgba(242,240,237,0.45)", transform: `scale(${i === cur ? 1.06 : 1})`, display: "inline-block" }}>{words[i]}</span>
        ))}
      </div>
    </AbsoluteFill>
  );
}
