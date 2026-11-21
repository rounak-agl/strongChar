// Tokens shared with the web app: warm-black ground, one vermilion for the mosaic, colour spent only on state.
import { loadFont as loadSans } from "@remotion/google-fonts/InstrumentSans";
import { loadFont as loadMono } from "@remotion/google-fonts/GeistMono";

export const sans = loadSans().fontFamily;
export const mono = loadMono().fontFamily;

export const C = {
  ground: "#0b0908", sunken: "#060504", card: "#12100e", band: "#171412", rule: "rgba(255,255,255,0.13)",
  ink: "#f2f0ed", muted: "#bab4ad", subtle: "#958e87",
  red1: "#33100c", red2: "#5c130e", red3: "#8f150f", red4: "#c4170f", red5: "#e8361c", bone: "#d6b48c",
  ok: "#7bd88a", okBg: "rgba(31,74,39,0.6)", warn: "#f5c75e", danger: "#ff6f66", dangerBg: "rgba(74,28,25,0.7)",
  sky: "#6fb7ff", skyBg: "rgba(20,48,76,0.6)", teal: "#4fd1b8", tealBg: "rgba(28,74,66,0.6)", violet: "#b19bff",
};

export const FPS = 30;
export const W = 1920;
export const H = 1080;
