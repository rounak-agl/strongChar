// Compositions: the full film, sized from the voiceover durations, plus a still of the title for thumbnails.
import { Composition, staticFile } from "remotion";
import { Film, filmFrames, type FilmProps } from "./Film";
import { FPS, H, W } from "./theme";

async function loadDurations(): Promise<Record<string, number>> {
  try {
    const d = (await (await fetch(staticFile("vo/durations.json"))).json()) as Record<string, { seconds: number }>;
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.seconds]));
  } catch {
    return {}; // no voice yet: scenes fall back to an estimate from their word count
  }
}

export function Root() {
  return (
    <Composition
      id="StrongChar"
      component={Film}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={FPS * 170}
      defaultProps={{ voice: {} } satisfies FilmProps}
      calculateMetadata={async () => {
        const voice = await loadDurations();
        return { durationInFrames: filmFrames(voice), props: { voice } };
      }}
    />
  );
}
