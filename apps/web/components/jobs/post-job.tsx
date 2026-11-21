"use client";
// Post a training job from this browser: the CSV is read, prepared and sealed here; only ciphertext is uploaded.
import { useState } from "react";
import Link from "next/link";
import { FileUp, Send } from "lucide-react";
import { Banner, Button, ButtonLink, Card, SectionTitle, TileBusy } from "@/components/primitives";
import { status } from "@/lib/browser/account";
import { saveJob } from "@/lib/browser/jobs-store";
import { explorerTx } from "@/lib/browser/links";
import { postJob } from "@/lib/browser/post";
import { plan, type Plan } from "@/lib/browser/prepare";
import { useOwner } from "@/lib/browser/session";

const INPUT = "w-20 rounded-md border border-rule bg-surface px-2 py-1.5 font-mono text-sm text-ink outline-none focus:border-accent";

// A fresh salt per quote: two jobs on the same data and settings still get different spec hashes and drafts.
const newSalt = () => `0x${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

export function PostJob() {
  const owner = useOwner();
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [rounds, setRounds] = useState(2);
  const [shards, setShards] = useState(4);
  const [quorum, setQuorum] = useState(2);
  const [p, setP] = useState<Plan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<{ step: string; detail?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ jobId: number; createTx: string } | null>(null);

  if (!owner) {
    return (
      <Card className="flex max-w-flow flex-col gap-3 p-5">
        <SectionTitle title="Unlock your account first" sub="your keys seal the data, so they have to be in this tab" />
        <div><ButtonLink href="/account" variant="primary">Go to your account</ButtonLink></div>
      </Card>
    );
  }

  const quote = (text = csv?.text) => {
    setErr(null); setP(null);
    if (!text) return;
    try { setP(plan(text, { rounds, shards, quorum, salt: newSalt() })); } catch (e) { setErr((e as Error).message); }
  };

  const post = async () => {
    if (!p) return;
    setBusy(true); setErr(null); setLog([]);
    try {
      const s = await status(owner);
      if (!(s.pqc === "proven" && s.kem === "ours" && s.card)) throw new Error("Finish setting up your keys on the account page first.");
      const r = await postJob(owner, p, (step, detail) => setLog((l) => [...l, { step, detail }]));
      await saveJob({ jobId: r.jobId, owner: owner.account.evm, specHash: p.specHash, spec: p.spec, createTx: r.createTx,
        created: new Date().toISOString(), holdoutX: p.holdout.x, holdoutY: p.holdout.y });
      setDone({ jobId: r.jobId, createTx: r.createTx });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-flow flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <SectionTitle title="Your data" sub="a numeric CSV, last column is the target; it is read here and never uploaded" />
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-rule bg-band px-4 py-5 text-sm text-muted hover:text-ink">
          <FileUp className="size-5" strokeWidth={1.5} />
          {csv ? <span className="font-mono text-ink">{csv.name}</span> : "Choose a CSV file"}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const text = await file.text();
            setCsv({ name: file.name, text });
            quote(text);
          }} />
        </label>
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <label className="flex flex-col gap-1">Rounds<input type="number" min={1} max={10} className={INPUT} value={rounds} onChange={(e) => setRounds(+e.target.value)} /></label>
          <label className="flex flex-col gap-1">Shards (nodes)<input type="number" min={1} max={8} className={INPUT} value={shards} onChange={(e) => setShards(+e.target.value)} /></label>
          <label className="flex flex-col gap-1">Quorum<input type="number" min={1} max={shards} className={INPUT} value={quorum} onChange={(e) => setQuorum(+e.target.value)} /></label>
          <Button disabled={!csv} onClick={() => quote()}>Update the quote</Button>
        </div>
      </Card>

      {p && (
        <Card className="flex flex-col gap-3 p-5">
          <SectionTitle title="Quote" sub="computed in this browser from your file; nothing has left it yet" />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-3">
            <Stat k="rows" v={p.data.rows.toLocaleString()} />
            <Stat k="features" v={String(p.data.cols)} />
            <Stat k="task" v={p.data.task === "classification" ? `${p.data.classes} classes` : "regression"} />
            <Stat k="shards" v={p.split.shards.map(([, n]) => n).join(" / ")} />
            <Stat k="validation" v={`${p.split.val[1]} rows, sealed to verifiers`} />
            <Stat k="holdout" v={`${p.split.holdout[1]} rows, stay here`} />
            <Stat k="budget" v={`${(Number(p.budget) / 1e6).toFixed(6)} fUSD`} />
            <Stat k="spec" v={`${p.specHash.slice(0, 10)}…`} />
          </dl>
          {p.data.task !== "classification" && <Banner tone="warn" title="Regression is untested on the live network">Classification jobs are what the network has run so far.</Banner>}
          <div><Button variant="primary" icon={Send} disabled={busy || !!done} onClick={post}>{busy ? <TileBusy /> : "Seal, pay and post"}</Button></div>
        </Card>
      )}

      {log.length > 0 && (
        <Card className="flex flex-col gap-2 p-5">
          <SectionTitle title="Progress" />
          <ol className="flex flex-col gap-1 text-sm">
            {log.map((l, i) => <li key={i} className="flex gap-2"><span className="text-muted">{i + 1}.</span><span className="text-ink">{l.step}</span>{l.detail && <span className="text-muted">· {l.detail}</span>}</li>)}
          </ol>
        </Card>
      )}
      {done && (
        <Banner tone="pending" title={`Job ${done.jobId} is live`} action={<Link className="text-sm underline" href={`/jobs/${done.jobId}`}>Watch it</Link>}>
          Created in <a className="font-mono underline" href={explorerTx(done.createTx)} target="_blank" rel="noreferrer">{done.createTx.slice(0, 12)}…</a>. Your holdout rows are kept in this browser for scoring the model.
        </Banner>
      )}
      {err && <Banner tone="danger" title={err} />}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="flex flex-col"><dt className="text-xs text-muted">{k}</dt><dd className="text-ink">{v}</dd></div>;
}
