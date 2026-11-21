"""Compose the film's score in code: a synthesized 120 bpm electronic track cut to the film's own timeline, so every
hit lands on a known frame (the hook's stamp, the title, the drop when the replay starts, the catch, the lift into the
payout, the finale). Scene starts are computed exactly as src/Film.tsx does, from public/vo/durations.json and the
pads in src/script.ts.

Usage: python3 -I video/scripts/score.py   ->  video/public/music/score.wav
"""

from __future__ import annotations

import json
import re
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

ROOT = Path(__file__).resolve().parents[1]
SR = 44100
FPS = 30
XF = 12
BPM = 120
BEAT = 60 / BPM
rng = np.random.default_rng(7)


# ---------------------------------------------------------------- timeline (mirrors Film.tsx)

def timeline() -> tuple[dict[str, float], float]:
    vo = json.loads((ROOT / "public/vo/durations.json").read_text())
    src = (ROOT / "src/script.ts").read_text()
    starts, at = {}, 0
    for sid, pad in re.findall(r'id: "([^"]+)",[\s\S]*?pad: ([\d.]+)', src):
        frames = round((vo[sid]["seconds"] + float(pad)) * FPS)
        starts[sid] = at / FPS
        at += frames - XF
    return starts, (at + XF) / FPS


# ---------------------------------------------------------------- instruments

def env(n: int, a: float, d: float, s: float = 0.0, r: float = 0.0) -> np.ndarray:
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    sus = max(0, n - a_n - d_n - r_n)
    e = np.concatenate([np.linspace(0, 1, max(1, a_n)), np.linspace(1, s, max(1, d_n)), np.full(sus, s), np.linspace(s, 0, max(1, r_n))])
    return np.pad(e, (0, max(0, n - len(e))))[:n]


def lp(x: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    return sosfilt(butter(order, min(hz, SR / 2 - 100), "low", fs=SR, output="sos"), x)


def hp(x: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    return sosfilt(butter(order, hz, "high", fs=SR, output="sos"), x)


def saw(f: float, n: int, phase: float = 0.0) -> np.ndarray:
    t = np.arange(n) / SR
    return 2 * ((t * f + phase) % 1) - 1


def kick(gain: float = 1.0) -> np.ndarray:
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return gain * np.sin(ph) * np.exp(-t * 7) + gain * 0.3 * np.tanh(4 * np.sin(ph)) * np.exp(-t * 30)


def hat(gain: float = 0.25, open_: bool = False) -> np.ndarray:
    n = int((0.25 if open_ else 0.06) * SR)
    return gain * hp(rng.standard_normal(n), 7000) * np.exp(-np.arange(n) / SR * (12 if open_ else 60))


def clap(gain: float = 0.5) -> np.ndarray:
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    burst = sum(np.exp(-np.maximum(t - k * 0.011, 0) * 90) * (t >= k * 0.011) for k in range(3)) + np.exp(-t * 14) * 0.6
    return gain * sosfilt(butter(2, [900, 4000], "band", fs=SR, output="sos"), rng.standard_normal(n)) * burst


def impact(gain: float = 1.0) -> np.ndarray:
    n = int(2.8 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(30 + 70 * np.exp(-t * 6)) / SR) * np.exp(-t * 1.6)
    crack = lp(rng.standard_normal(n), 2500) * np.exp(-t * 9) * 0.5
    return gain * np.tanh(1.6 * (boom + crack))


def riser(seconds: float, gain: float = 0.35) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    for i in range(0, n, 2048):  # sweep the cutoff upward in blocks
        cut = 300 + 7000 * (i / n) ** 2
        out[i:i + 2048] = lp(noise[max(0, i - 4096):i + 2048], cut)[-len(out[i:i + 2048]):]
    tone = saw(110 * 2 ** (2 * t / seconds), n) * 0.25
    return gain * (out + tone) * (t / seconds) ** 2


def pad(freqs: list[float], seconds: float, cutoff: float, gain: float = 0.22) -> np.ndarray:
    n = int(seconds * SR)
    x = sum(saw(f * d, n, rng.random()) for f in freqs for d in (0.996, 1.0, 1.004))
    return gain * lp(x / (3 * len(freqs)), cutoff) * env(n, 0.4, 0.2, 1.0, 0.5)


def pluck(f: float, seconds: float, cutoff: float, gain: float = 0.18) -> np.ndarray:
    n = int(seconds * SR)
    sq = np.sign(np.sin(2 * np.pi * f * np.arange(n) / SR))
    return gain * lp(sq, cutoff) * env(n, 0.003, seconds * 0.8, 0.0, 0.0)


def bass(f: float, seconds: float, drive: float = 1.0, gain: float = 0.35) -> np.ndarray:
    n = int(seconds * SR)
    x = lp(saw(f, n) + 0.5 * np.sin(2 * np.pi * f / 2 * np.arange(n) / SR), 600 + 400 * drive)
    return gain * np.tanh(drive * 1.5 * x) * env(n, 0.005, seconds * 0.6, 0.5, 0.03)


# ---------------------------------------------------------------- arrangement

NOTE = {"A": 55.0, "F": 43.65, "C": 65.41, "G": 49.0, "D": 73.42, "E": 41.2}
MINOR = [("A", [0, 3, 7]), ("F", [0, 4, 7]), ("C", [0, 4, 7]), ("G", [0, 4, 7])]  # Am F C G
MAJOR = [("C", [0, 4, 7]), ("G", [0, 4, 7]), ("A", [0, 3, 7]), ("F", [0, 4, 7])]  # C G Am F


def chord_at(prog, t: float):
    root, ivs = prog[int(t / (BEAT * 8)) % len(prog)]
    return NOTE[root], ivs


def main() -> None:
    starts, total = timeline()
    T = lambda sid: starts[sid]  # noqa: E731
    n = int((total + 1) * SR)
    mix = {k: np.zeros(n) for k in ("drums", "bass", "music", "fx")}

    def put(bus: str, x: np.ndarray, at: float, gain: float = 1.0) -> None:
        i = int(at * SR)
        if 0 <= i < n:
            seg = x[: n - i] * gain
            mix[bus][i:i + len(seg)] += seg

    hook_end, title, build, train, drop, proof, pay, close = (T("s01-open"), T("s02-title"), T("s03-owner"), T("s05-training"), T("s06-replay"), T("s07-proof"), T("s08-pay"), T("s10-close"))
    catch = drop + 0.62 * (proof - drop + XF / FPS)  # the slash frame in S06
    slam = 92 / FPS  # the stamp in S00

    # Pads, two bars per chord; darker filter before the drop, open and bright after.
    t = 0.0
    while t < total:
        prog, cut, g = (MINOR, 900, 0.2) if t < proof else (MAJOR, 2600, 0.2)
        if t < hook_end: cut, g = 600, 0.25
        if build <= t < train: cut = 1100
        if train <= t < drop: cut = 1100 + 1500 * (t - train) / (drop - train)
        root, ivs = chord_at(prog, t)
        put("music", pad([root * 4 * 2 ** (i / 12) for i in ivs], BEAT * 8 + 0.5, cut, g), t)
        t += BEAT * 8

    # Grid of 16ths from the hook to the end.
    steps = int(total / (BEAT / 4))
    for s in range(steps):
        t = s * BEAT / 4
        beat, sub = divmod(s, 4)
        bar_pos = beat % 4
        prog = MINOR if t < proof else MAJOR
        root, ivs = chord_at(prog, t)
        # hook: pulsing sub on 8ths
        if t < hook_end and sub % 2 == 0:
            put("bass", bass(root, BEAT / 2 * 0.9, drive=0.6), t, 0.8)
        # title: half-time kick
        if title <= t < build and sub == 0 and bar_pos in (0, 2):
            put("drums", kick(0.7), t)
        # build, training, drop, resolve: four-on-the-floor
        if build <= t < close and sub == 0 and not (drop - BEAT * 2 <= t < drop):
            put("drums", kick(1.0 if t >= drop else 0.8), t)
        if build <= t < close and sub == 2:
            put("drums", hat(0.16 if t < drop else 0.22, open_=(t >= drop and beat % 2 == 1)), t)
        if t >= train and t < close and sub in (1, 3):
            put("drums", hat(0.07), t)
        if (drop <= t < close) and sub == 0 and bar_pos in (1, 3):
            put("drums", clap(0.45 if t < proof else 0.35), t)
        # bass: 8ths from the build
        if build <= t < close and sub % 2 == 0:
            drive = 1.0 if t < drop else (2.6 if t < proof else 1.4)
            put("bass", bass(root * (2 if sub == 2 and t >= drop else 1), BEAT / 2 * 0.85, drive=drive), t, 0.75)
        # arp: 16ths over the chord, filter opening through training
        if build <= t < close:
            note = root * 4 * 2 ** ((ivs + [12])[s % 4] / 12)
            cut = 1400 if t < train else (1400 + 3500 * min(1, (t - train) / max(1, drop - train)) if t < drop else 4200)
            g = 0.06 if t < train else (0.1 if t < drop else 0.09)
            put("music", pluck(note * 2, BEAT / 4 * 0.95, cut, g), t)
    # snare roll into the drop
    for k in range(16):
        put("drums", clap(0.12 + 0.03 * k), drop - BEAT * 2 + k * BEAT / 8)

    # Hits on known frames.
    put("fx", riser(2.4, 0.3), slam - 2.4)
    put("fx", impact(0.9), slam)
    put("fx", impact(0.6), title)
    put("fx", riser(4.0, 0.35), drop - 4.0)
    put("fx", impact(1.0), drop)
    put("fx", impact(0.8), catch)
    put("fx", riser(2.0, 0.25), proof - 2.0)
    put("fx", impact(0.6), proof)
    put("fx", impact(0.8), close)

    # Mix: drums and bass sit under the voice; everything ducks a little in the busiest narrated stretch.
    out = mix["drums"] * 0.9 + mix["bass"] * 0.8 + mix["music"] * 1.0 + mix["fx"] * 0.8
    tt = np.arange(n) / SR
    level = np.interp(tt, [0, hook_end, build, build + 1, drop - 1, drop, proof, close, total - 2.5, total],
                      [1.0, 0.85, 0.85, 0.7, 0.7, 1.0, 0.8, 0.9, 0.9, 0.0])
    out = out * level
    out = np.tanh(out * 1.2) / np.tanh(1.2)  # gentle glue
    out = out / max(1e-9, np.max(np.abs(out))) * 0.89  # peak at about -1 dB
    # Slight stereo width: delay the right channel 9 ms on the music bus only.
    right = out.copy()
    d = int(0.009 * SR)
    right[d:] = out[d:] * 0.7 + out[:-d] * 0.3
    stereo = np.stack([out, right], axis=1)
    path = ROOT / "public/music/score.wav"
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((stereo * 32767).astype("<i2").tobytes())
    print(f"score: {total:.1f} s -> {path}  (drop {drop:.2f} s, catch {catch:.2f} s, slam {slam:.2f} s)")


if __name__ == "__main__":
    main()
