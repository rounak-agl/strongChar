// One round as a receipt: the phase, who trained which shard, each replay verdict, the gate, both signatures, the pay.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Layers } from "lucide-react";
import { signatures } from "@/lib/api";
import { explorerTx, getJob, getRound, jobEvents, payments, shardsOf } from "@/lib/chain";
import { Page } from "@/components/page";
import { RoundProgress } from "@/components/round-progress";
import { Card, HashChip, Money, Pill, RoundStatusPill, SectionTitle, THead, TH, TD } from "@/components/primitives";
import { f64, nodeName, progress, roundStatus } from "@/lib/view";

export const revalidate = 15;
const ROW = "relative border-t border-rule-row";

type Evidence = {
  failed?: { node: string; verdict: string }[];
  gate?: { result: string; dropped: string | null; lossBefore: string; lossAfter: string };
};

export default async function RoundPage({ params }: { params: Promise<{ id: string; r: string }> }) {
  const { id: idS, r: rS } = await params;
  const id = Number(idS), rid = Number(rS);
  if (!Number.isInteger(id) || !Number.isInteger(rid) || id < 1 || rid < 1) notFound();
  const job = await getJob(id).catch(() => null);
  if (!job || rid > job.roundsOpened) notFound();
  const [round, shards, sigs, pays, ev] = await Promise.all([
    getRound(id, rid), shardsOf(id, rid), signatures(id, rid), payments({ job: id }), jobEvents(id),
  ]);
  const s = sigs?.signatures ?? [];
  let agg: Evidence = {};
  try { agg = JSON.parse(String(s[0]?.settlement?.aggEvidence ?? "{}")); } catch { agg = {}; }
  const verdict = Object.fromEntries((agg.failed ?? []).map((f) => [f.node.toLowerCase(), f.verdict]));
  const paid = pays.filter((p) => p.round === rid);
  const settled = ev.settled.find((e) => e.round === rid);
  const agree = s.length === 2 && s[0].payloadHash === s[1].payloadHash;
  const status = roundStatus(round);
  const before = f64(agg.gate?.lossBefore), after = f64(agg.gate?.lossAfter);

  return (
    <Page crumbs={[{ href: "/jobs", label: "jobs" }, { href: `/jobs/${id}`, label: `#${String(id).padStart(2, "0")}`, mono: true }, { label: `round ${rid}` }]}
          icon={Layers} title={<span className="flex flex-wrap items-center gap-3">Round {rid} of {job.rounds} <RoundStatusPill status={status} /></span>}
          meta={<>Budget <Money units={Number(round.budget)} />{round.drip > 0n && <> plus <Money units={Number(round.drip)} /> set aside from the community pool</>}</>}>
      <Card className="p-5"><RoundProgress round={progress(round, shards)} variant="segments" /></Card>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-table text-sm">
          <THead><TH>Node</TH><TH>Shard</TH><TH>Commit</TH><TH>Reveal</TH><TH>Replay</TH><TH>Pay</TH></THead>
          <tbody>
            {round.seats.map((seat) => {
              const p = paid.find((x) => x.node.toLowerCase() === seat.node.toLowerCase());
              const v = verdict[seat.node.toLowerCase()];
              return (
                <tr key={seat.node} className={ROW}>
                  <TD><Link className="font-mono text-xs text-ink hover:underline" href={`/nodes/${seat.node}`}>{nodeName(seat.node)}</Link></TD>
                  <TD className="font-mono tabular">{shards[seat.node.toLowerCase()] ?? "—"}</TD>
                  <TD>{seat.committed ? <Pill tone="ok">committed</Pill> : <Pill tone={status === "committing" ? "pending" : "warn"}>{status === "committing" ? "waiting" : "missed"}</Pill>}</TD>
                  <TD>{seat.revealed ? <Pill tone="ok">revealed</Pill> : <Pill tone={status === "revealing" || status === "committing" ? "pending" : "warn"}>{status === "revealing" || status === "committing" ? "waiting" : "missed"}</Pill>}</TD>
                  <TD>{status === "settled" || status === "reverted" ? (v ? <Pill tone="danger">{v}{seat.slashed ? " · slashed" : ""}</Pill> : seat.revealed ? <Pill tone="ok">bit-exact</Pill> : <span className="text-subtle">—</span>) : <Pill tone="pending">pending</Pill>}</TD>
                  <TD>{p ? (p.forfeited ? <span className="text-muted"><Money units={Number(p.amount)} /> to the pool</span> : <Money units={Number(p.amount)} />) : <span className="text-subtle">—</span>}</TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <SectionTitle title="Merge and gate" sub="updates clipped to the median size, extremes trimmed, then checked on the validation split" />
          {agg.gate ? (
            <>
              <p className="font-mono text-xl tabular text-ink">{before?.toFixed(4) ?? "—"} → {after?.toFixed(4) ?? "—"}</p>
              <p className="text-sm text-muted">
                {agg.gate.result === "pass" ? "Validation loss stayed in the band, so the merge was kept." : agg.gate.result === "dropped" ? `Kept without ${nodeName(agg.gate.dropped ?? "")}, the one node that made the merge worse.` : "No subset passed, so the round reverted and the weights didn't change."}
              </p>
            </>
          ) : <p className="text-sm text-subtle">The verifiers post the merge after the reveal window closes.</p>}
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <SectionTitle title="Verifier signatures" sub="ML-DSA-87, checked on-chain by the pqcVerify precompile" />
          {s.length === 0 ? <p className="text-sm text-subtle">No signatures yet.</p> : (
            <ul className="flex flex-col divide-y divide-rule-row text-sm">
              {s.map((x) => <li key={x.verifier} className="flex items-center justify-between gap-3 py-2"><span className="font-mono text-xs text-muted">{nodeName(x.verifier)}</span><HashChip value={x.payloadHash} label="payload" /></li>)}
            </ul>
          )}
          {s.length === 2 && <p className="text-xs text-subtle">{agree ? "Both verifiers signed the same settlement." : "The verifiers disagree, so nothing was submitted."}</p>}
          {settled && <a href={explorerTx(settled.tx)} target="_blank" rel="noreferrer" className="font-mono text-xs text-chain hover:underline">pqcVerify ✓ settled in {settled.tx.slice(0, 18)}…</a>}
        </Card>
      </div>
    </Page>
  );
}
