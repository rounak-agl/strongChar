// One round in full: who trained which shard, each replay verdict, the gate, both verifier signatures and the pay.
import Link from "next/link";
import { notFound } from "next/navigation";
import { signatures } from "@/lib/api";
import { fmt6, getJob, getRound, jobEvents, payments, shardsOf, short } from "@/lib/chain";
import { Badge, Card, Empty, Hash, ProofStamp } from "@/components/ui";

export const revalidate = 15;

type Evidence = {
  failed?: { node: string; verdict: string }[];
  gate?: { result: string; dropped: string | null; lossBefore: string; lossAfter: string };
};

const f64 = (h?: string) => {
  if (!h) return "—";
  const b = new DataView(new ArrayBuffer(8));
  b.setBigUint64(0, BigInt(h.startsWith("0x") ? h : `0x${h}`));
  return b.getFloat64(0).toFixed(4);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold"><Link className="underline" href={`/jobs/${id}`}>Job {id}</Link> · round {rid}</h1>
        <Badge tone={round.status === "Settled" ? "ok" : round.status === "Open" ? "pending" : "warn"}>{round.status}</Badge>
      </div>
      <Card title="Seats">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-subtle"><th className="py-1 font-normal">Node</th><th className="font-normal">Shard</th><th className="font-normal">Reveal</th><th className="font-normal">Replay</th><th className="font-normal">Pay</th></tr></thead>
          <tbody>
            {round.seats.map((seat) => {
              const p = paid.find((x) => x.node.toLowerCase() === seat.node.toLowerCase());
              const v = verdict[seat.node.toLowerCase()];
              return (
                <tr key={seat.node} className="border-t border-rule">
                  <td className="py-2"><Link className="font-mono text-xs underline" href={`/nodes/${seat.node}`}>{short(seat.node)}</Link></td>
                  <td className="tabular-nums">{shards[seat.node.toLowerCase()] ?? "—"}</td>
                  <td>{seat.revealed ? <Badge tone="ok">revealed</Badge> : <Badge tone={round.status === "Open" ? "pending" : "warn"}>{round.status === "Open" ? "waiting" : "missed"}</Badge>}</td>
                  <td>{round.status === "Open" ? <Badge tone="pending">pending</Badge> : v ? <Badge tone="bad">{v}{seat.slashed ? " · slashed" : ""}</Badge> : seat.revealed ? <Badge tone="ok">bit-exact</Badge> : "—"}</td>
                  <td>{p ? (p.forfeited ? <span className="text-muted">{fmt6(p.amount)} fUSD to the pool (probation)</span> : `${fmt6(p.amount)} fUSD`) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-subtle">
          Round budget {fmt6(round.budget)} fUSD{round.drip > 0n ? `, plus ${fmt6(round.drip)} fUSD set aside from the community pool for graduated nodes` : ""}.
          Start weights <Hash value={round.startHash} />
        </p>
      </Card>
      <Card title="Merge and gate">
        {agg.gate ? (
          <p className="text-sm text-muted">
            Validation loss {f64(agg.gate.lossBefore)} → {f64(agg.gate.lossAfter)}: {agg.gate.result === "pass" ? "merge kept" : agg.gate.result === "dropped" ? `merge kept without ${short(agg.gate.dropped ?? "")}, the node that made it worse` : "merge reverted, weights unchanged"}.
          </p>
        ) : <Empty>The verifiers post their merge after the reveal window.</Empty>}
      </Card>
      <Card title="Verifier signatures" aside={settled && <ProofStamp tx={settled.tx} />}>
        {s.length === 0 ? <Empty>No signatures yet.</Empty> : (
          <ul className="space-y-1 text-sm">
            {s.map((x) => <li key={x.verifier} className="text-muted"><span className="font-mono text-xs">{short(x.verifier)}</span> signed payload <Hash value={x.payloadHash} /> with ML-DSA-87</li>)}
          </ul>
        )}
        {s.length === 2 && <p className="mt-2 text-xs text-subtle">{agree ? "Both verifiers signed the same settlement; the contract checked both signatures with pqcVerify." : "The verifiers disagree, so nothing was submitted."}</p>}
      </Card>
    </div>
  );
}
