// One job: every round with its seats, replay verdicts, the PQ-verified settlement and what was sealed.
import { notFound } from "next/navigation";
import Link from "next/link";
import { draft, matcher } from "@/lib/api";
import { explorerTx, fmt6, getJob, getRound, jobCount, jobEvents, short } from "@/lib/chain";
import { RoundTimeline } from "@/components/round-timeline";
import { Badge, Card, Hash, ProofStamp, SealChip } from "@/components/ui";

export const revalidate = 15;

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1 || id > (await jobCount())) notFound();
  const job = await getJob(id);
  const [rounds, ev, d, seating] = await Promise.all([
    Promise.all(Array.from({ length: job.roundsOpened }, (_, i) => getRound(id, i + 1))),
    jobEvents(id),
    draft(job.specHash),
    matcher(id),
  ]);
  const blocked = Object.entries(seating?.blocked ?? {});
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
          {shards.map((s, i) => <SealChip key={s} kind={`shard ${i}`} id={s} recipients={2} />)}
          {typeof d?.manifest?.val === "string" && <SealChip kind="validation split" id={d.manifest.val as string} recipients={2} />}
          {!d && <p className="text-sm text-muted">The coordinator is unreachable; chain data below is still live.</p>}
        </div>
        <p className="mt-3 text-xs text-subtle">
          The owner sealed every shard to the two verifiers only. Each round, a verifier re-seals a seated node&apos;s
          shard to that node alone, and the node checks it against the hash the owner committed to.
        </p>
        <p className="mt-2 text-xs text-subtle">Spec <Hash value={job.specHash} /> · current weights <Hash value={job.weights} /></p>
      </Card>
      {seating && (
        <Card title="Who gets seated" aside={<span className="text-xs text-subtle">last decision {new Date(seating.at * 1000).toUTCString()}</span>}>
          <p className="text-sm text-muted">
            Each round seats the fastest eligible nodes from everyone online, then whoever has waited longest.
            {" "}{seating.eligible} eligible against a quorum of {seating.quorum}; {seating.seated.length} seated.
          </p>
          {blocked.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {blocked.map(([n, why]) => (
                <li key={n} className="text-muted"><Link className="font-mono text-xs underline" href={`/nodes/${n}`}>{short(n)}</Link> not seated: {why}</li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {rounds.map((r) => {
        const settled = ev.settled.find((e) => e.round === r.id);
        return (
          <Card key={r.id} title={<Link className="underline" href={`/jobs/${id}/rounds/${r.id}`}>Round {r.id}</Link>} aside={<Badge tone={r.status === "Settled" ? "ok" : r.status === "Open" ? "pending" : "warn"}>{r.status}</Badge>}>
            <RoundTimeline round={r} />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {settled && <ProofStamp tx={settled.tx} />}
              <span className="text-xs text-subtle">
                round budget {fmt6(r.budget)} fUSD{r.drip > 0n ? ` + ${fmt6(r.drip)} fUSD from the community pool` : ""} · aggregate <Hash value={r.aggregateHash} />
              </span>
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
