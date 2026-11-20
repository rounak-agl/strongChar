"use client";
// Client wrappers that take an icon by name, so server pages can use primitives whose icons are components.
import type { ReactNode } from "react";
import { Cpu, Layers, Lock, Trophy, type LucideIcon } from "lucide-react";
import { ButtonLink, EmptyState } from "./primitives";
import { PosterCard } from "./mosaic/PosterCard";
import { coverFor } from "./mosaic/figures";
import { CoverBand } from "./mosaic/CoverBand";
import { RoundTrack } from "./pixel";

const ICONS = { jobs: Layers, nodes: Cpu, sealed: Lock, compete: Trophy } satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof ICONS;

export function Empty({ icon, title, poster, action, children }: { icon: IconName; title: string; poster?: string; action?: ReactNode; children?: ReactNode }) {
  return <EmptyState icon={ICONS[icon]} title={title} poster={poster} action={action}>{children}</EmptyState>;
}

export function LinkButton({ href, icon, variant, children }: { href: string; icon?: IconName; variant?: "primary" | "secondary" | "ghost"; children: ReactNode }) {
  return <ButtonLink href={href} icon={icon ? ICONS[icon] : undefined} variant={variant}>{children}</ButtonLink>;
}

/** A job or competition as an index card: a word-mosaic poster picked from its id, then the number, title and note. */
export function PosterLink({ href, id, title, note, live, tag }: { href: string; id: number; title: string; note: string; live?: boolean; tag?: ReactNode }) {
  return <PosterCard href={href} n={`#${String(id).padStart(2, "0")}`} title={title} note={note} cover={coverFor(id)} live={live} tag={tag} />;
}

/** Page header art for a job or competition: its poster as a band, the title on it, a few mono facts at top right. */
export function CoverHead({ id, title, meta, live }: { id: number; title: string; meta: string[]; live?: boolean }) {
  return <CoverBand cover={coverFor(id)} live={live} title={title} meta={meta} label={`${title} cover`} />;
}

/** The round track with each tile linking to that round's receipt under `base` (functions can't cross from server). */
export function RoundLinks({ base, total, rounds }: { base: string; total: number; rounds: { round: number; status: string }[] }) {
  return <RoundTrack total={total} rounds={rounds} hrefFor={(r) => `${base}/${r}`} size="lg" />;
}
