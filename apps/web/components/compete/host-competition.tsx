"use client";
// Host a competition from this browser: the CSV is split here, the training rows are published, and the test rows,
// labels and salt are sealed to the two verifiers before anything is uploaded.
import { useState } from "react";
import Link from "next/link";
import { FileUp, Trophy } from "lucide-react";
import { Banner, Button, ButtonLink, Card, SectionTitle, TileBusy } from "@/components/primitives";
import { status } from "@/lib/browser/account";
import { METRICS, hostCompetition, planCompetition, type HostPlan, type Metric, type Task } from "@/lib/browser/compete";
import { explorerTx } from "@/lib/browser/links";
import { useOwner } from "@/lib/browser/session";

const INPUT = "rounded-md border border-rule bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";

export function HostCompetition() {
  const owner = useOwner();
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [title, setTitle] = useState("");
  const [task, setTask] = useState<Task>("classification");
  const [metric, setMetric] = useState<Metric>("accuracy");
  const [testShare, setTestShare] = useState(20);
  const [prize, setPrize] = useState("0.01");
  const [minutes, setMinutes] = useState(60);
  const [perEntrant, setPerEntrant] = useState(3);
  const [p, setP] = useState<HostPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<{ step: string; detail?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: number; tx: string } | null>(null);

  if (!owner) {
    return (
      <Card className="flex max-w-flow flex-col gap-3 p-5">
        <SectionTitle title="Unlock your account first" sub="your keys seal the test set, so they have to be in this tab" />
        <div><ButtonLink href="/account" variant="primary">Go to your account</ButtonLink></div>
      </Card>
    );
  }

  const prepare = (text = csv?.text) => {
    setErr(null); setP(null);
    if (!text) return;
    try { setP(planCompetition(text, { title, task, metric, testShare: testShare / 100 })); } catch (e) { setErr((e as Error).message); }
  };
  const prizeUnits = BigInt(Math.round(Number(prize) * 1e6) || 0);

  const host = async () => {
    if (!p) return;
    setBusy(true); setErr(null); setLog([]);
    try {
      if (prizeUnits <= 0n) throw new Error("The prize must be more than zero.");
      const s = await status(owner);
      if (!(s.pqc === "proven" && s.kem === "ours" && s.card)) throw new Error("Finish setting up your keys on the account page first.");
      const r = await hostCompetition(owner, { ...p, title: title.trim() || p.title }, prizeUnits, minutes, perEntrant, (step, detail) => setLog((l) => [...l, { step, detail }]));
      setDone({ id: r.id, tx: r.tx });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-flow flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <SectionTitle title="Your data" sub="a CSV with a header row; the last column is what entrants predict" />
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-rule bg-band px-4 py-5 text-sm text-muted hover:text-ink">
          <FileUp className="size-5" strokeWidth={1.5} />
          {csv ? <span className="font-mono text-ink">{csv.name}</span> : "Choose a CSV file"}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const text = await file.text();
            setCsv({ name: file.name, text });
            prepare(text);
          }} />
        </label>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">Title<input className={INPUT} value={title} placeholder="Predict diabetes risk" onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="flex flex-col gap-1">Task
            <select className={INPUT} value={task} onChange={(e) => { const t = e.target.value as Task; setTask(t); setMetric(METRICS[t][0]); }}>
              <option value="classification">classification</option><option value="regression">regression</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">Scored by
            <select className={INPUT} value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
              {METRICS[task].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">Hidden test share (%)<input type="number" min={5} max={50} className={INPUT} value={testShare} onChange={(e) => setTestShare(+e.target.value)} /></label>
          <label className="flex flex-col gap-1">Prize (fUSD)<input className={INPUT} value={prize} onChange={(e) => setPrize(e.target.value)} /></label>
          <label className="flex flex-col gap-1">Open for (minutes)<input type="number" min={10} max={20160} className={INPUT} value={minutes} onChange={(e) => setMinutes(+e.target.value)} /></label>
          <label className="flex flex-col gap-1">Entries per entrant<input type="number" min={1} max={10} className={INPUT} value={perEntrant} onChange={(e) => setPerEntrant(+e.target.value)} /></label>
        </div>
        <div><Button disabled={!csv} onClick={() => prepare()}>Split again</Button></div>
      </Card>

      {p && (
        <Card className="flex flex-col gap-3 p-5">
          <SectionTitle title="What happens to your rows" sub="split in this browser; nothing has left it yet" />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-3">
            <Stat k="public training rows" v={p.trainRows.toLocaleString()} />
            <Stat k="sealed test rows" v={p.testRows.toLocaleString()} />
            <Stat k="target" v={p.target} />
            <Stat k="task" v={p.classes ? `${p.classes} classes` : "regression"} />
            <Stat k="scored by" v={p.metric} />
            <Stat k="closes" v={`in ${minutes} min`} />
          </dl>
          <p className="text-sm text-muted">
            The training rows are published for everyone. The test rows and their labels are sealed to the two verifiers;
            only a hash of the labels goes on chain now, and the labels are revealed after the deadline so anyone can
            recompute every score. Entrants&apos; scripts run in the verifiers&apos; sandbox with no network.
          </p>
          <div><Button variant="primary" icon={Trophy} disabled={busy || !!done} onClick={host}>{busy ? <TileBusy /> : "Seal, fund and open"}</Button></div>
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
        <Banner tone="pending" title={`Competition ${done.id} is open`} action={<Link className="text-sm underline" href={`/compete/${done.id}`}>Go to it</Link>}>
          Created in <a className="font-mono underline" href={explorerTx(done.tx)} target="_blank" rel="noreferrer">{done.tx.slice(0, 12)}…</a>. This browser keeps the labels so you can reveal them early; if it doesn&apos;t, the verifiers reveal them after the reveal deadline.
        </Banner>
      )}
      {err && <Banner tone="danger" title={err} />}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="flex flex-col"><dt className="text-xs text-muted">{k}</dt><dd className="text-ink">{v}</dd></div>;
}
