// Voiceover: one ElevenLabs text-to-speech request per scene in src/script.ts, written to public/vo/<id>.mp3, with each
// clip's duration in public/vo/durations.json. Neighbouring lines are passed as previous_text/next_text so the
// narration keeps one tone across cuts. Re-running skips scenes whose line hasn't changed.
//
// The SDK reads ELEVENLABS_API_KEY from the environment; run through `npm run voice`, which loads .env.local.
// Usage: npm run voice -- [--voice <voice id>] [--force]
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

const ROOT = new URL("..", import.meta.url).pathname;
const MODEL = "eleven_v4";
const args = process.argv.slice(2);
const voice = args.includes("--voice") ? args[args.indexOf("--voice") + 1] : "JBFqnCBsd6RMkjVDRZzb"; // George: narrative
const force = args.includes("--force");

if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set; run with `npm run voice` so .env.local is loaded");
const client = new ElevenLabsClient();

// Spell out what a voice model would otherwise misread.
const SAY = [
  [/ML-KEM-1024/g, "M L KEM ten twenty-four"], [/ML-DSA-87/g, "M L D S A eighty-seven"], [/pqcVerify/g, "P Q C verify"],
  [/fUSD/g, "F U S D"], [/strongChar/g, "strong char"], [/QoreChain's/g, "Qore Chain's"], [/QoreChain/g, "Qore Chain"],
];
const speakable = (s) => SAY.reduce((t, [re, to]) => t.replace(re, to), s);

const src = readFileSync(join(ROOT, "src/script.ts"), "utf8");
const scenes = [...src.matchAll(/id: "([^"]+)",[\s\S]*?line: "((?:[^"\\]|\\.)*)"/g)].map((m) => ({ id: m[1], text: speakable(m[2]) }));
const durFile = join(ROOT, "public/vo/durations.json");
const durations = existsSync(durFile) ? JSON.parse(readFileSync(durFile, "utf8")) : {};
let chars = 0;

for (const [i, s] of scenes.entries()) {
  const previousText = scenes[i - 1]?.text;
  const nextText = scenes[i + 1]?.text;
  const hash = createHash("sha256").update([MODEL, voice, previousText, s.text, nextText].join("\n")).digest("hex").slice(0, 16);
  const out = join(ROOT, "public/vo", `${s.id}.mp3`);
  if (!force && existsSync(out) && durations[s.id]?.hash === hash) { console.log(`${s.id}: unchanged`); continue; }
  const audio = await client.textToSpeech.convert(voice, {
    text: s.text, modelId: MODEL, outputFormat: "mp3_44100_128", applyTextNormalization: "on",
    voiceSettings: { stability: 0.55, similarityBoost: 0.75 }, previousText, nextText,
  });
  await finished(Readable.fromWeb(audio).pipe(createWriteStream(out)));
  const seconds = Number(execFileSync("npx", ["remotion", "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { cwd: ROOT }).toString().trim());
  durations[s.id] = { seconds, hash };
  chars += s.text.length;
  console.log(`${s.id}: ${seconds.toFixed(2)} s`);
}
writeFileSync(durFile, JSON.stringify(durations, null, 2) + "\n");
console.log(`total ${Object.values(durations).reduce((a, d) => a + d.seconds, 0).toFixed(1)} s of voice, ${chars} characters billed this run`);
