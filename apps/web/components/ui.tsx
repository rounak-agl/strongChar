// Primitives: cards, status badges (always icon + word, never colour alone), hashes, proof stamps, sealed objects.
import { CheckCircle2, CircleDashed, Lock, ShieldCheck, ShieldX, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { explorerTx, short } from "@/lib/chain";

export function Card({ title, children, aside }: { title?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-sm border border-rule bg-card p-5 shadow-[var(--card-shadow)]">
      {(title || aside) && (
        <div className="mb-4 flex items-baseline justify-between gap-4">
          {title && <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES = {
  ok: ["text-ok bg-ok-bg", CheckCircle2],
  bad: ["text-danger bg-danger-bg", XCircle],
  warn: ["text-warn bg-warn-bg", CircleDashed],
  pending: ["text-pending bg-pending-bg", CircleDashed],
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  const [cls, Icon] = TONES[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium ${cls}`}>
      <Icon aria-hidden className="size-3.5" /> {children}
    </span>
  );
}

export function Hash({ value, label }: { value: string; label?: string }) {
  return <code title={value} aria-label={label ?? value} className="font-mono text-xs text-muted">{short(value)}</code>;
}

/** "PQ-verified": a settlement whose two ML-DSA-87 signatures passed pqcVerify on-chain. */
export function ProofStamp({ tx, ok = true, gas }: { tx?: string; ok?: boolean; gas?: string }) {
  const Icon = ok ? ShieldCheck : ShieldX;
  return (
    <div className={`inline-flex items-center gap-2 rounded-sm border px-3 py-2 ${ok ? "border-ok/40 text-ok" : "border-danger/40 text-danger"}`}>
      <Icon aria-hidden className="size-4" />
      <span className="text-sm font-medium">{ok ? "PQ-verified" : "Signature rejected"}</span>
      <span className="text-xs text-muted">ML-DSA-87 ×2 · pqcVerify ✓{gas ? ` · ${gas} gas` : ""}</span>
      {tx && <a className="font-mono text-xs underline" href={explorerTx(tx)} target="_blank" rel="noreferrer">{short(tx)}</a>}
    </div>
  );
}

/** A sealed object as the server sees it: only its kind, size and ciphertext id. */
export function SealChip({ kind, size, id, recipients }: { kind: string; size?: number; id: string; recipients?: number }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-sm border border-seal/40 bg-seal-bg px-2.5 py-1.5 text-xs">
      <Lock aria-hidden className="size-3.5 text-seal" />
      <span className="font-medium text-seal">{kind}</span>
      {recipients !== undefined && <span className="text-muted">sealed to {recipients}</span>}
      {size !== undefined && <span className="text-muted">{(size / 1024).toFixed(1)} KB</span>}
      <code className="font-mono text-subtle">qoreseal:{id.slice(2, 10)}…</code>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-sm border border-rule bg-card p-4">
      <div className="text-xs text-subtle uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-sm border border-dashed border-rule p-6 text-sm text-muted">{children}</p>;
}
