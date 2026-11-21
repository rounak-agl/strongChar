// Sound effects for the film, generated with ElevenLabs' sound-effect model into public/sfx/<name>.mp3. The scenes
// place them on exact frames. The music is composed separately by scripts/score.py.
// Files that already exist are skipped; pass --force to regenerate, --only=<name> for one. Run with `npm run sound`.
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

const ROOT = new URL("..", import.meta.url).pathname;
const force = process.argv.includes("--force");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set; run with `npm run sound`");
const client = new ElevenLabsClient();
mkdirSync(join(ROOT, "public/sfx"), { recursive: true });

async function save(stream, path) {
  const body = typeof stream.getReader === "function" ? Readable.fromWeb(stream) : stream;
  await finished(body.pipe(createWriteStream(path)));
}

const SFX = {
  impact: ["Deep cinematic impact boom with a long sub-bass tail", 2.5],
  glitch: ["Short digital glitch stutter, data corruption burst", 1],
  alarm: ["Short tense digital security alarm, three rapid beeps", 1.5],
  whoosh: ["Fast airy whoosh transition", 0.8],
  lock: ["Heavy metallic vault lock clunk followed by a short digital confirmation beep", 1.4],
  typing: ["Fast mechanical keyboard typing", 3],
  coin: ["Bright digital coin payout chime", 1],
  riser: ["Rising synth tension riser that builds to a peak", 3],
  stamp: ["Heavy rubber stamp slamming onto a desk", 0.8],
  tick: ["Soft clean UI tick blip", 0.5],
  rewind: ["Tape rewind glitch, fast reverse whirr", 1.2],
};

for (const [name, [text, seconds]] of Object.entries(SFX)) {
  if (only && only !== name) continue;
  const out = join(ROOT, "public/sfx", `${name}.mp3`);
  if (!force && existsSync(out)) { console.log(`${name}: exists`); continue; }
  await save(await client.textToSoundEffects.convert({ text, modelId: "eleven_text_to_sound_v3", durationSeconds: seconds, promptInfluence: 0.6 }), out);
  console.log(`${name}: done`);
}
