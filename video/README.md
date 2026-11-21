# strongChar showcase film

A 2:17 film of one live job on the AWS stack (job 4 on `qorechain-diana`): the owner posts it, four nodes train, node-4
fakes its work, both verifiers catch it by replay, it is slashed and the honest nodes are paid. Every hash, transaction,
payout and timing on screen comes from that run; the training progress bars and the opening animation are illustrative.

Built with [Remotion](https://www.remotion.dev): every scene is React, every frame is deterministic, and the music is
composed in code to the same timeline, so cuts, hits and the drop land on exact frames.

## Build

```bash
cd video
npm install
python3 scripts/score.py           # composes public/music/score.wav to the scene timeline (about 3 s)
npm run render                     # out/strongchar.mp4
```

Then normalise the loudness for upload (-14 LUFS, two passes with the ffmpeg bundled in Remotion):

```bash
npx remotion ffmpeg -i out/strongchar.mp4 -vn -af loudnorm=I=-14:TP=-2.5:LRA=11:print_format=json -f null -
# feed the measured_* values from that output into the second pass:
npx remotion ffmpeg -i out/strongchar.mp4 -c:v copy -c:a aac -b:a 192k \
  -af "loudnorm=I=-14:TP=-2.5:LRA=11:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true" \
  out/strongchar-final.mp4
```

## How it fits together

| Path | What it is |
|---|---|
| `src/script.ts` | The narration, one line per scene. Scene lengths follow the voice, so editing a line re-times the film. |
| `src/Film.tsx` | Timeline: scenes, cross-fades, voice, word-by-word captions, whooshes on cuts, and the score ducked under the voice. |
| `src/scenes/index.tsx` | The eleven scenes, from the hook (the catch, shown first) to the close. |
| `src/components/` | Word mosaic background and the terminal. |
| `public/data/run.json` | The live run: built from the servers' container logs and the owner's terminal by `scripts/build_run.py`. |
| `public/vo/`, `public/sfx/` | Narration and sound effects (ElevenLabs), made by `npm run voice` and `npm run sound`. |
| `public/clips/` | Screen recordings of the live web app, made by `scripts/record.mjs`. |
| `scripts/score.py` | The score: a synthesized 120 bpm track whose sections, drop and hits are placed from the scene timeline. |

Narration and sound effects use an ElevenLabs key in `video/.env.local` (git-ignored, written by
`npx @elevenlabs/cli onboard init`). Voice and sound effects by [ElevenLabs](https://elevenlabs.io).
