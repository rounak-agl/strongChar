"use client";
// Your browser account: create or import a recovery phrase, keep it encrypted with a passphrase, fund it from QoreX,
// register its keys, then seal and open data entirely in this tab.
import { useEffect, useState, type ReactNode } from "react";
import { Check, Download, KeyRound, Lock, LockOpen, ShieldCheck, Wallet } from "lucide-react";
import { PqcStatusBadge, QoreChainProvider, useBalance, type QoreChainProviderConfig } from "@qorechain/react";
import { Banner, Button, Card, SectionTitle, TileBusy } from "@/components/primitives";
import { fromPhrase, newPhrase, publishCard, registerKem, registerPqc, status, type Owner, type Setup } from "@/lib/browser/account";
import { explorerTx } from "@/lib/browser/links";
import { fundFromQorex, qorexReady } from "@/lib/browser/qorex";
import { setOwner, useOwner } from "@/lib/browser/session";
import { forget, load, lock, save, unlock, type Sealed } from "@/lib/browser/vault";
import { SealPlayground } from "./seal-playground";

const QOR = 1_000_000n;

export function OwnerPanel() {
  const owner = useOwner();
  const [stored, setStored] = useState<Sealed | null | undefined>(undefined);
  useEffect(() => { load().then((s) => setStored(s ?? null)).catch(() => setStored(null)); }, []);

  if (stored === undefined) return <Card className="p-5"><TileBusy /></Card>;
  if (owner) return <Unlocked owner={owner} onForget={async () => { await forget(); setOwner(null); setStored(null); }} />;
  if (stored) return <Unlock stored={stored} />;
  return <Create onSaved={setStored} />;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}
const INPUT = "rounded-md border border-rule bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent";

function Create({ onSaved }: { onSaved: (s: Sealed) => void }) {
  const [mode, setMode] = useState<"new" | "import">("new");
  const [phrase, setPhrase] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (mode === "new") setPhrase(newPhrase()); else setPhrase(""); setSaved(false); }, [mode]);

  const backup = () => {
    const blob = new Blob([`strongChar recovery phrase (keep it offline; anyone with it controls the account and reads what is sealed to it)\n\n${phrase}\n`], { type: "text/plain" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "strongchar-recovery-phrase.txt" });
    a.click();
    URL.revokeObjectURL(a.href);
    setSaved(true);
  };

  const go = async () => {
    setErr(null);
    if (pass !== pass2) return setErr("The passphrases don't match.");
    setBusy(true);
    try {
      const o = await fromPhrase(phrase);
      const s = await lock(phrase.trim(), pass, o.account.cosmos);
      await save(s);
      setOwner(o);
      onSaved(s);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex max-w-flow flex-col gap-5 p-5">
      <SectionTitle title="Set up this browser" sub="your keys are made and kept here; strongChar never sees them" />
      <div className="flex gap-2">
        <Button variant={mode === "new" ? "primary" : "secondary"} onClick={() => setMode("new")}>New account</Button>
        <Button variant={mode === "import" ? "primary" : "secondary"} onClick={() => setMode("import")}>I have a recovery phrase</Button>
      </div>
      {mode === "new" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">These 24 words make your account key, your ML-DSA-87 signing key and your QoreSeal (ML-KEM-1024) encryption keys. Lose them and you lose everything sealed to you; nobody can recover it.</p>
          <ol className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-rule bg-band p-3 font-mono text-sm text-ink sm:grid-cols-4">
            {phrase.split(" ").map((w, i) => <li key={i}><span className="mr-2 text-muted">{i + 1}</span>{w}</li>)}
          </ol>
          <div><Button icon={saved ? Check : Download} onClick={backup}>{saved ? "Backup downloaded" : "Download a backup"}</Button></div>
        </div>
      ) : (
        <Field label="Recovery phrase" hint="The same phrase the strongChar command-line tools use works here.">
          <textarea className={INPUT} rows={3} value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Passphrase" hint="Encrypts the phrase in this browser. At least 10 characters.">
          <input type="password" className={INPUT} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Passphrase again">
          <input type="password" className={INPUT} value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      {err && <Banner tone="danger" title={err} />}
      <div>
        <Button variant="primary" icon={KeyRound} disabled={busy || !pass || (mode === "new" && !saved) || !phrase} onClick={go}>
          {busy ? <TileBusy /> : "Save and unlock"}
        </Button>
      </div>
    </Card>
  );
}

function Unlock({ stored }: { stored: Sealed }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr(null);
    try { setOwner(await fromPhrase(await unlock(stored, pass))); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card className="flex max-w-flow flex-col gap-4 p-5">
      <SectionTitle title="Unlock" sub={stored.address} />
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <Field label="Passphrase"><input type="password" className={INPUT} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" autoFocus /></Field>
        <Button variant="primary" icon={LockOpen} disabled={busy || !pass} onClick={go}>{busy ? <TileBusy /> : "Unlock"}</Button>
      </form>
      {err && <Banner tone="danger" title={err} />}
    </Card>
  );
}

type Step = "fund" | "pqc" | "kem" | "card";

// The QoreChain React kit reads the chain for the live parts of this panel, through the same-origin relay
// (the chain's REST API sends no CORS headers).
const QORE: QoreChainProviderConfig = { network: "testnet", endpoints: { rest: "/api/chain" } };

function Unlocked(props: { owner: Owner; onForget: () => void }) {
  return <QoreChainProvider config={QORE}><UnlockedBody {...props} /></QoreChainProvider>;
}

function UnlockedBody({ owner, onForget }: { owner: Owner; onForget: () => void }) {
  const [s, setS] = useState<Setup | null>(null);
  const [busy, setBusy] = useState<Step | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [txs, setTxs] = useState<Partial<Record<Step, string>>>({});
  const refresh = () => status(owner).then(setS).catch((e) => setErr((e as Error).message));
  useEffect(() => { refresh(); }, [owner]);
  // Poll the balance, so QOR sent from QoreX, the faucet or any wallet ticks the first step without a reload.
  const live = useBalance(owner.account.cosmos, { denom: "uqor", refreshInterval: 8_000 });
  const uqor = live.data ? BigInt(live.data.amount) : s?.uqor;
  useEffect(() => { if (s && !s.funded && uqor && uqor > 0n) refresh(); }, [uqor]);

  const run = async (step: Step, f: () => Promise<string | void>) => {
    setBusy(step); setErr(null);
    try { const tx = await f(); if (tx) setTxs((t) => ({ ...t, [step]: tx })); await refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  const a = owner.account;
  const ready = s?.funded && s.pqc === "proven" && s.kem === "ours" && s.card;
  return (
    <div className="flex max-w-flow flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <SectionTitle title="This browser's account" sub="one key, two addresses: the native lane and the EVM lane" />
            <PqcStatusBadge key={s?.pqc} address={a.cosmos} safeLabel="ML-DSA-87 key on chain" unsafeLabel="No ML-DSA-87 key on chain yet"
              className="w-fit font-mono text-xs data-[pqc-status=true]:text-chain text-muted" />
          </div>
          <div className="flex gap-2">
            <Button icon={Lock} onClick={() => setOwner(null)}>Lock</Button>
            <Button variant="ghost" onClick={() => { if (confirm("Remove the encrypted phrase from this browser? Make sure you have the backup.")) onForget(); }}>Forget</Button>
          </div>
        </div>
        <dl className="grid gap-1 font-mono text-sm">
          <div className="flex gap-3"><dt className="w-16 text-muted">native</dt><dd className="break-all text-ink">{a.cosmos}</dd></div>
          <div className="flex gap-3"><dt className="w-16 text-muted">EVM</dt><dd className="break-all text-ink">{a.evm}</dd></div>
          <div className="flex gap-3"><dt className="w-16 text-muted">QOR</dt><dd className="text-ink">{uqor !== undefined ? (Number(uqor) / 1e6).toFixed(4) : "…"}</dd></div>
        </dl>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <SectionTitle title="Set up your keys" sub="four steps, once; each one is a transaction you can check on the explorer" />
        <Row done={!!s?.funded} title="Fund it with testnet QOR" sub="Covers the fees for the next three steps. QoreX sends it; you approve in the wallet." tx={txs.fund}
             action={<Button icon={Wallet} disabled={!!busy || !qorexReadySafe()} onClick={() => run("fund", () => fundFromQorex(a.cosmos, 2n * QOR))}>{busy === "fund" ? <TileBusy /> : "Send 2 QOR from QoreX"}</Button>}
             note={!qorexReadySafe() ? <>No QoreX here? Send about 2 QOR to <code className="font-mono">{a.cosmos}</code> from the faucet or any wallet.</> : undefined} />
        <Row done={s?.pqc === "proven"} title="Register the ML-DSA-87 signing key" sub="With a proof of possession, so the chain knows this browser holds the post-quantum key." tx={txs.pqc}
             action={<Button icon={ShieldCheck} disabled={!!busy || !s?.funded || s.pqc !== "none"} onClick={() => run("pqc", async () => (await registerPqc(owner)).txhash)}>{busy === "pqc" ? <TileBusy /> : "Register"}</Button>}
             note={s?.pqc === "other" ? "A different ML-DSA-87 key is registered for this address." : undefined} />
        <Row done={s?.kem === "ours"} title="Register the ML-KEM-1024 encryption key" sub="Anyone can now seal data to this address; only this browser (or your phrase) can open it." tx={txs.kem}
             action={<Button icon={KeyRound} disabled={!!busy || s?.pqc !== "proven" || s?.kem === "ours"} onClick={() => run("kem", async () => (await registerKem(owner)).txhash)}>{busy === "kem" ? <TileBusy /> : "Register"}</Button>} />
        <Row done={!!s?.card} title="Publish your recipient card" sub="Your X25519 key for hybrid sealing, signed with both your keys. Senders check it against the chain before sealing." tx={undefined}
             action={<Button disabled={!!busy || s?.kem !== "ours" || s?.card} onClick={() => run("card", () => publishCard(owner))}>{busy === "card" ? <TileBusy /> : "Sign and publish"}</Button>} />
        {err && <Banner tone="danger" title={err} />}
        {ready && <Banner tone="pending" title="Ready">Everything you seal or open on strongChar now happens in this browser.</Banner>}
      </Card>

      <SealPlayground owner={owner} ready={!!ready} />
    </div>
  );
}

function qorexReadySafe() {
  try { return qorexReady(); } catch { return false; }
}

function Row({ done, title, sub, action, tx, note }: { done: boolean; title: string; sub: string; action: ReactNode; tx?: string; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3 border-t border-rule pt-3 first-of-type:border-t-0 first-of-type:pt-0">
      <span className={`mt-0.5 inline-flex size-5 items-center justify-center rounded-full border ${done ? "border-accent bg-accent text-accent-ink" : "border-rule text-muted"}`}>{done && <Check className="size-3" />}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{title}</p>
        <p className="text-sm text-muted">{sub}</p>
        {note && !done && <p className="mt-1 text-sm text-warn">{note}</p>}
        {tx && <a className="mt-1 block font-mono text-xs text-muted underline" href={explorerTx(tx)} target="_blank" rel="noreferrer">{tx.slice(0, 12)}…</a>}
      </div>
      {!done && action}
    </div>
  );
}
