// One job: its poster band, the money and stake, the signed loss curve, who was seated, what was sealed, every round.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Layers } from "lucide-react";
import { draft, matcher } from "@/lib/api";
import { explorerTx, getJob, getRound, jobCount, jobEvents, payments } from "@/lib/chain";
import { LossChart } from "@/components/charts";
import { CheckSignatures } from "@/components/jobs/check-signatures";
import { OpenModel } from "@/components/jobs/open-model";
import { CoverHead, RoundLinks } from "@/components/client";
import { Page } from "@/components/page";
import { Card, JobStatusPill, Money, RoundStatusPill, SectionTitle, THead, TH, TD, HashChip } from "@/components/primitives";

const ROW = "relative border-t border-rule-row transition-colors duration-150 hover:bg-hover";
import { formatToken } from "@/lib/money";
import { jobStatus, lossCurve, nodeName, roundStatus } from "@/lib/view";

export const revalidate = 15;

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1 || id > (await jobCount())) notFound();
  const job = await getJob(id);
  const [rounds, ev, d, seating, curve, pays] = await Promise.all([
    Promise.all(Array.from({ length: job.roundsOpened }, (_, i) => getRound(id, i + 1))),
    jobEvents(id), draft(job.specHash), matcher(id), lossCurve(id, job.roundsOpened), payments({ job: id }),
  ]);
  const status = jobStatus(job);
  const paid = pays.filter((p) => !p.forfeited).reduce((a, p) => a + p.amount, 0n);
  const forfeited = pays.filter((p) => p.forfeited).reduce((a, p) => a + p.amount, 0n);
  const slashed = ev.slashed.filter((s) => s.amount > 0n);
  const shards = (d?.manifest?.shards as string[] | undefined) ?? [];
  const last = curve.filter((p) => p.y !== null).at(-1)?.y ?? null;
  const first = curve[0]?.y ?? null;
  const blocked = Object.entries(seating?.blocked ?? {});

  return (
    <Page crumbs={[{ href: "/jobs", label: "jobs" }, { label: `#${String(id).padStart(2, "0")}`, mono: true }]} icon={Layers}
          title={<span className="flex flex-wrap items-center gap-3">Job {id} <JobStatusPill status={status} /></span>}
          meta={<>Trains an exact MLP on data sealed to the two verifiers. Owner <span className="font-mono text-xs text-ink">{nodeName(job.owner)}</span></>}>
      <CoverHead id={id} title={`mlp-exact #${String(id).padStart(2, "0")}`} live={status === "running"}
                 meta={[`${status}`, `round ${job.roundsOpened} of ${job.rounds}`, `${formatToken(job.budget)} fUSD budget`, `quorum ${job.quorum}`]} />

      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Fact label="Budget" value={<Money units={Number(job.budget)} />} sub={`${formatToken(job.remaining)} fUSD still in escrow`} />
        <Fact label="Paid to nodes" value={<Money units={Number(paid)} />} sub={forfeited > 0n ? `${formatToken(forfeited)} fUSD went to the community pool (probation)` : "includes community-pool top-ups to graduated nodes"} />
        <Fact label="Stake per seat" value={<span className="font-mono tabular">{formatToken(job.stake)} <span className="text-xs text-subtle">BERU</span></span>} sub={slashed.length ? `${slashed.length} slash${slashed.length > 1 ? "es" : ""}, stake burned` : "nobody slashed"} />
        <Fact label="Validation loss" value={<span className="font-mono tabular">{last === null ? "—" : last.toFixed(4)}</span>} sub={first === null ? "no round settled yet" : `from ${first.toFixed(4)} before training`} />
      </dl>

      <Card className="flex flex-col gap-4 p-5">
        <SectionTitle title="Validation loss" sub="after each round, from the gate both verifiers signed" />
        <LossChart points={curve} total={job.rounds} from={0} height={220} />
        <RoundLinks base={`/jobs/${id}/rounds`} total={job.rounds} rounds={rounds.map((r) => ({ round: r.id, status: roundStatus(r) }))} />
      </Card>

      <OpenModel jobId={id} owner={job.owner} rounds={job.rounds} finished={status === "completed"} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <SectionTitle title="Who gets seated" sub={seating ? `last decision ${new Date(seating.at * 1000).toUTCString()}` : "the coordinator hasn't seated this job yet"} />
          {seating && (
            <>
              <p className="text-sm text-muted">The fastest eligible nodes from everyone online, then whoever has waited longest. {seating.eligible} eligible against a quorum of {seating.quorum}; {seating.seated.length} seated.</p>
              <ul className="flex flex-col divide-y divide-rule-row text-sm">
                {seating.seated.map((n) => <li key={n} className="flex items-center justify-between py-2"><Link className="font-mono text-xs text-ink hover:underline" href={`/nodes/${n}`}>{nodeName(n)}</Link><span className="text-ok">seated</span></li>)}
                {blocked.map(([n, why]) => <li key={n} className="flex items-center justify-between py-2"><Link className="font-mono text-xs text-muted hover:underline" href={`/nodes/${n}`}>{nodeName(n)}</Link><span className="text-subtle">{why}</span></li>)}
              </ul>
            </>
          )}
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <SectionTitle title="Sealed inputs" sub="ML-KEM-1024 envelopes; the server holds ciphertext only" />
          {shards.length === 0 ? <p className="text-sm text-subtle">The coordinator is unreachable; chain data is still live.</p> : (
            <ul className="flex flex-col divide-y divide-rule-row text-sm">
              {shards.map((s, i) => <li key={s} className="flex items-center justify-between gap-3 py-2"><span className="text-muted">shard {i} · to both verifiers</span><HashChip value={s} /></li>)}
              {typeof d?.manifest?.val === "string" && <li className="flex items-center justify-between gap-3 py-2"><span className="text-muted">validation split · to both verifiers</span><HashChip value={d.manifest.val as string} /></li>}
            </ul>
          )}
          <p className="text-xs text-subtle">Each round, a verifier re-seals a seated node&apos;s shard to that node alone; the node checks it against the hash the owner committed to.</p>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-table text-sm">
          <THead><TH>Round</TH><TH>Status</TH><TH>Seated</TH><TH>Revealed</TH><TH>Budget</TH><TH>Slashed</TH><TH>Settlement</TH></THead>
          <tbody>
            {rounds.map((r) => {
              const settled = ev.settled.find((e) => e.round === r.id);
              return (
                <tr key={r.id} className={ROW}>
                  <TD><Link href={`/jobs/${id}/rounds/${r.id}`} className="font-mono text-ink after:absolute after:inset-0">R{String(r.id).padStart(2, "0")}</Link></TD>
                  <TD><RoundStatusPill status={roundStatus(r)} /></TD>
                  <TD className="tabular">{r.seats.length}</TD>
                  <TD className="tabular">{r.seats.filter((s) => s.revealed).length}</TD>
                  <TD><Money units={Number(r.budget + r.drip)} /></TD>
                  <TD className="tabular">{r.seats.filter((s) => s.slashed).length || "—"}</TD>
                  <TD>{settled ? <a href={explorerTx(settled.tx)} target="_blank" rel="noreferrer" className="relative z-10 font-mono text-xs text-chain hover:underline">pqcVerify ✓ {settled.tx.slice(0, 10)}…</a> : <span className="text-subtle">—</span>}</TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <CheckSignatures settled={ev.settled.map((e) => ({ round: e.round, tx: e.tx }))} />
    </Page>
  );
}

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card className="flex min-h-28 flex-col justify-between gap-2 p-4">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="text-xl text-ink">{value}</dd>
      {sub && <dd className="text-xs text-subtle">{sub}</dd>}
    </Card>
  );
}
