"use client";
// What this browser's account can do on one competition: enter a script (sealed here to the two verifiers), reveal the
// labels early if it hosted from this browser, and claim a prize.
import { useEffect, useState } from "react";
import { Code2, Eye, Wallet } from "lucide-react";
import { Banner, Button, ButtonLink, Card, SectionTitle, TileBusy } from "@/components/primitives";
import { status } from "@/lib/browser/account";
import { claimPrize, claimable, loadSecret, revealEarly, submitEntry } from "@/lib/browser/compete";
import { explorerTx } from "@/lib/browser/links";
import { useOwner } from "@/lib/browser/session";

type Props = { id: number; host: string; deadline: number; revealDeadline: number; labelsRevealed: boolean; target?: string; open: boolean };

const STARTER = (target = "target") => `import pandas as pd
from sklearn.ensemble import RandomForestClassifier

tr = pd.read_csv('/data/train.csv')
te = pd.read_csv('/data/test_features.csv')
X = tr.drop(columns=['${target}'])
m = RandomForestClassifier(n_estimators=200, random_state=0).fit(X, tr['${target}'])
pd.Series(m.predict(te[X.columns]), name='prediction').to_csv('/out/predictions.csv', index=False)
`;

export function CompeteActions(p: Props) {
  const owner = useOwner();
  const [script, setScript] = useState(() => STARTER(p.target));
  const [log, setLog] = useState<{ step: string; detail?: string }[]>([]);
  const [busy, setBusy] = useState<null | "enter" | "reveal" | "claim">(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ what: string; tx: string } | null>(null);
  const [owed, setOwed] = useState<bigint>(0n);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 15_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (owner) claimable(owner.account.evm).then(setOwed).catch(() => setOwed(0n)); }, [owner, done]);

  if (!owner) {
    return (
      <Card className="flex flex-col gap-3 p-5">
        <SectionTitle title={p.open ? "Enter from this browser" : "Your account"} sub="your keys seal the script, so they have to be in this tab" />
        <div><ButtonLink href="/account" variant="primary">Unlock your account</ButtonLink></div>
      </Card>
    );
  }

  const isHost = owner.account.evm.toLowerCase() === p.host.toLowerCase();
  const canReveal = isHost && !p.labelsRevealed && now > p.deadline && now <= p.revealDeadline && !!loadSecret(p.id);
  const run = async (what: "enter" | "reveal" | "claim") => {
    setBusy(what); setErr(null); setLog([]); setDone(null);
    const progress = (step: string, detail?: string) => setLog((l) => [...l, { step, detail }]);
    try {
      if (what === "enter") {
        const s = await status(owner);
        if (!(s.pqc === "proven" && s.kem === "ours" && s.card)) throw new Error("Finish setting up your keys on the account page first.");
        const r = await submitEntry(owner, p.id, script, progress);
        setDone({ what: `Entry #${r.entry} submitted. The verifiers run it in the sandbox; its verdict appears below.`, tx: r.tx });
      } else if (what === "reveal") {
        setDone({ what: "Labels revealed. Anyone can now recompute every score.", tx: await revealEarly(owner, p.id, progress) });
      } else {
        setDone({ what: "Prize claimed.", tx: await claimPrize(owner, progress) });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      {p.open && (
        <>
          <SectionTitle title="Enter from this browser"
            sub="Your script is sealed here to the two verifiers; only its hash goes on chain. It reads /data/train.csv and /data/test_features.csv and writes one prediction per test row to /out/predictions.csv, with no network." />
          <textarea className="min-h-56 rounded-md border border-rule bg-surface p-3 font-mono text-xs text-ink outline-none focus:border-accent"
                    value={script} onChange={(e) => setScript(e.target.value)} spellCheck={false} aria-label="Your script" />
          <div><Button variant="primary" icon={Code2} disabled={!!busy} onClick={() => run("enter")}>{busy === "enter" ? <TileBusy /> : "Seal and submit"}</Button></div>
        </>
      )}
      {canReveal && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted">You hosted this from this browser and still hold the labels. Reveal them now, or the verifiers will after the reveal deadline.</p>
          <Button icon={Eye} disabled={!!busy} onClick={() => run("reveal")}>{busy === "reveal" ? <TileBusy /> : "Reveal the labels"}</Button>
        </div>
      )}
      {owed > 0n && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-ink">You have {(Number(owed) / 1e6).toFixed(6)} fUSD to claim from competitions.</p>
          <Button icon={Wallet} disabled={!!busy} onClick={() => run("claim")}>{busy === "claim" ? <TileBusy /> : "Claim"}</Button>
        </div>
      )}
      {!p.open && !canReveal && owed === 0n && <p className="text-sm text-muted">This competition is closed to new entries.</p>}
      {log.length > 0 && (
        <ol className="flex flex-col gap-1 text-sm">
          {log.map((l, i) => <li key={i} className="flex gap-2"><span className="text-muted">{i + 1}.</span><span className="text-ink">{l.step}</span>{l.detail && <span className="text-muted">· {l.detail}</span>}</li>)}
        </ol>
      )}
      {done && <Banner tone="pending" title={done.what}>Transaction <a className="font-mono underline" href={explorerTx(done.tx)} target="_blank" rel="noreferrer">{done.tx.slice(0, 12)}…</a></Banner>}
      {err && <Banner tone="danger" title={err} />}
    </Card>
  );
}
