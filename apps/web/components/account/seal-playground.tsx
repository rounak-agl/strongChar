"use client";
// Seal something in this tab to you and both verifiers, see exactly what a server would store, then open it here.
import { useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { parseEnvelope, envelopeFromText, recipientOf } from "@qorechain/qoreseal";
import { Banner, Button, Card, SectionTitle, TileBusy } from "@/components/primitives";
import type { Owner } from "@/lib/browser/account";
import { deployment } from "@/lib/deployment";
import { aad, openWith, recipient, sealTo } from "@/lib/browser/seal";

const AAD_SLOT = (kems: Uint8Array[]) => aad(deployment.job_market, 0, 0, 0, "script", kems);

export function SealPlayground({ owner, ready }: { owner: Owner; ready: boolean }) {
  const [text, setText] = useState("Rows from my private dataset, 4,120 patients…");
  const [env, setEnv] = useState<{ text: string; kems: Uint8Array[]; recipients: number } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doSeal = async () => {
    setBusy(true); setErr(null); setOpened(null);
    try {
      const vs = await Promise.all([deployment.verifier_a, deployment.verifier_b].map(recipient));
      const me = { recipient: recipientOf(owner.seal), kem: owner.seal.mlkemPublicKey };
      const all = [me, ...vs];
      const kems = all.map((r) => r.kem);
      setEnv({ text: sealTo(all.map((r) => r.recipient), new TextEncoder().encode(text), "script", AAD_SLOT(kems)), kems, recipients: all.length });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doOpen = () => {
    setErr(null);
    try { setOpened(new TextDecoder().decode(openWith(env!.text, owner.seal, "script", AAD_SLOT(env!.kems)))); }
    catch (e) { setErr(`Couldn't open it: ${(e as Error).message}`); }
  };

  const parsed = env ? parseEnvelope(envelopeFromText(env.text)) : null;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle title="Seal and open, right here" sub="ML-KEM-1024 + X25519 hybrid, AES-256-GCM, in this tab; nothing is sent" />
      <textarea className="rounded-md border border-rule bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={Lock} disabled={busy || !text} onClick={doSeal}>{busy ? <TileBusy /> : "Seal to me and both verifiers"}</Button>
        <Button icon={LockOpen} disabled={!env} onClick={doOpen}>Open with my key</Button>
      </div>
      {!ready && <p className="text-sm text-muted">Works before setup too: the verifiers' keys are checked against the chain, and your own keys come from your phrase.</p>}
      {env && parsed && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">This is all a server would ever hold: {env.text.length.toLocaleString()} characters, {parsed.entries.length} recipient entries (an ML-KEM-1024 ciphertext and an X25519 key each), and the AES-256-GCM payload.</p>
          <pre className="max-h-32 overflow-hidden whitespace-pre-wrap break-all rounded-md border border-rule bg-band p-3 font-mono text-xs text-muted">{env.text.slice(0, 600)}…</pre>
        </div>
      )}
      {opened !== null && <Banner tone="pending" title="Opened in this tab">{opened}</Banner>}
      {err && <Banner tone="danger" title={err} />}
    </Card>
  );
}
