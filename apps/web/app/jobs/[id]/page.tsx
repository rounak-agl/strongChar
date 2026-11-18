// One job: every round with its seats, replay verdicts, the PQ-verified settlement and what was sealed.
import { notFound } from "next/navigation";
import { draft } from "@/lib/api";
import { explorerTx, fmt6, getJob, getRound, jobCount, jobEvents, short } from "@/lib/chain";
import { RoundTimeline } from "@/components/round-timeline";
import { Badge, Card, Hash, ProofStamp, SealChip } from "@/components/ui";

export const revalidate = 15;

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1 || id > (await jobCount())) notFound();
  const job = await getJob(id);
  const [rounds, ev, d] = await Promise.all([
    Promise.all(Array.from({ length: job.roundsOpened }, (_, i) => getRound(id, i + 1))),
    jobEvents(id),
    draft(job.specHash),
  ]);
  const shards = (d?.manifest?.shards as string[] | undefined) ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Job {id}</h1>
        <Badge tone={job.status === "Completed" ? "ok" : "pending"}>{job.status}</Badge>
        <span className="text-sm text-muted">{fmt6(job.budget)} fUSD budget · stake {fmt6(job.stake)} BERU per node · quorum {job.quorum}</span>
      </div>
      <Card title="Sealed inputs">
        <div className="flex flex-wrap gap-2">
          {shards.map((s, i) => <SealChip key={s} kind={`shard ${i}`} id={s} recipients={3} />)}
          {typeof d?.manifest?.val === "string" && <SealChip kind="validation split" id={d.manifest.val as string} recipients={2} />}
          {!d && <p className="text-sm text-muted">The coordinator is unreachable; chain data below is still live.</p>}
        </div>
        <p className="mt-3 text-xs text-subtle">Spec <Hash value={job.specHash} /> · current weights <Hash value={job.weights} /></p>
      </Card>
      {rounds.map((r) => {
        const settled = ev.settled.find((e) => e.round === r.id);
        return (
          <Card key={r.id} title={`Round ${r.id}`} aside={<Badge tone={r.status === "Settled" ? "ok" : r.status === "Open" ? "pending" : "warn"}>{r.status}</Badge>}>
            <RoundTimeline round={r} />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {settled && <ProofStamp tx={settled.tx} />}
              <span className="text-xs text-subtle">round budget {fmt6(r.budget)} fUSD · aggregate <Hash value={r.aggregateHash} /></span>
            </div>
            {ev.slashed.filter((s) => s.round === r.id && s.amount > 0n).map((s) => (
              <p key={s.tx + s.node} className="mt-2 text-sm text-danger">
                Slashed {short(s.node)}: {fmt6(s.amount)} BERU burned · <a className="underline" href={explorerTx(s.tx)} target="_blank" rel="noreferrer">tx</a>
              </p>
            ))}
          </Card>
        );
      })}
    </div>
  );
}
