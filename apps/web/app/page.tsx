// Home: the hero drawn from the latest job's signed loss curve, the network strip, live rounds and the round ledger.
import Link from "next/link";
import { Home as HomeIcon } from "lucide-react";
import { HeroBanner } from "@/components/hero";
import { Page } from "@/components/page";
import { RoundTrack } from "@/components/pixel";
import { RoundProgress } from "@/components/round-progress";
import { Card, Eyebrow, Money, SectionTitle } from "@/components/primitives";
import { cx } from "@/lib/cx";
import { Empty } from "@/components/client";
import { pool, shardsOf } from "@/lib/chain";
import { jobRows, lossCurve, network, progress, type JobRow } from "@/lib/view";

export const revalidate = 15;

export default async function Home() {
  const rows = await jobRows();
  const [net, p] = await Promise.all([network(rows), pool()]);
  const featured = rows.find((r) => r.status === "running") ?? rows.find((r) => r.status === "completed") ?? null;
  const curve = featured ? (await lossCurve(featured.job.id, featured.job.roundsOpened)).map((x) => x.y) : [];
  const live = rows.filter((r) => r.status === "running" && r.current);
  return (
    <Page crumbs={[{ label: "home" }]} icon={HomeIcon} title="Home">
      <HeroBanner dismissible={false} job={featured?.job.id ?? null} round={featured?.job.roundsOpened ?? null}
                  total={featured?.job.rounds ?? null} status={featured?.rounds.at(-1)?.status ?? null} nodes={net.online} curve={curve} />

      <section aria-label="Network" className="flex flex-col gap-5 rounded-xl border border-rule p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="live-dot size-1.5 rounded-full bg-mosaic" aria-hidden />
            <Eyebrow>the network, live</Eyebrow>
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 whitespace-nowrap text-xs text-muted">
            {featured && <Link href={`/jobs/${featured.job.id}`} className="hover:text-ink">watch job {featured.job.id}</Link>}
            <Link href="/nodes" className="hover:text-ink">all nodes</Link>
            <Link href="/jobs" className="hover:text-ink">all jobs</Link>
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-stats md:items-end md:divide-x md:divide-rule-row">
          <div className="col-span-2 flex flex-col gap-2 md:col-span-1">
            <dt className="text-sm text-muted">Nodes online</dt>
            <dd className="flex items-baseline gap-2 font-mono text-2xl tabular text-ink">
              {net.online}
              <span className="text-sm text-subtle">{net.training} training · {net.joined} joined</span>
            </dd>
            <NodeTiles online={net.online} training={net.training} joined={net.joined} />
          </div>
          <Stat label="Paid to nodes" value={<Money units={Number(net.paid)} />} big />
          <Stat label="Community pool" value={<Money units={Number(p.balance)} />} sub={`${p.dripBps / 100}% drips to graduated nodes each round`} />
          <Stat label="Rounds settled" value={net.settled} big sub={`${net.running} of ${net.jobs} jobs training now`} />
        </dl>
      </section>

      <Card className="flex flex-col gap-5 p-5">
        <SectionTitle title="Live rounds" sub={`${live.length} ${live.length === 1 ? "job" : "jobs"} training now`}>
          <Link href="/jobs" className="text-sm text-muted hover:text-ink">all jobs</Link>
        </SectionTitle>
        {live.length === 0 ? (
          <Empty icon="jobs" poster="IDLE" title="No rounds running">When the coordinator seats nodes for a job, its round shows up here.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-rule">
            {await Promise.all(live.map(async (r) => <LiveRow key={r.job.id} row={r} shards={await shardsOf(r.job.id, r.current!.id)} />))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <SectionTitle title="Every round" sub="one tile per round: green paid, red reverted, amber voided or expired" />
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.job.id} className="flex items-center gap-4">
              <Link href={`/jobs/${r.job.id}`} className="w-16 shrink-0 font-mono text-xs text-muted hover:text-ink">job {String(r.job.id).padStart(2, "0")}</Link>
              <RoundTrack total={r.job.rounds} rounds={r.rounds} size="lg" className="flex-1" />
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}

function Stat({ label, value, sub, big }: { label: string; value: React.ReactNode; sub?: string; big?: boolean }) {
  return (
    <div className="flex flex-col gap-1 md:pl-6">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={cx("font-mono tabular text-ink", big ? "text-2xl" : "text-xl")}>{value}</dd>
      {sub && <dd className="text-xs text-subtle">{sub}</dd>}
    </div>
  );
}

function NodeTiles({ online, training, joined }: { online: number; training: number; joined: number }) {
  return (
    <ol className="flex flex-wrap gap-1" aria-label={`${online} of ${joined} nodes online, ${training} training`}>
      {Array.from({ length: Math.max(joined, online) }, (_, i) => (
        <li key={i} className={cx("size-2.5 rounded-xs", i < training ? "bg-mosaic" : i < online ? "border border-mosaic" : "border border-rule-strong")} />
      ))}
    </ol>
  );
}

function LiveRow({ row, shards }: { row: JobRow; shards: Record<string, number> }) {
  const r = row.current!;
  return (
    <li className="relative flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/jobs/${row.job.id}/rounds/${r.id}`} className="flex min-w-0 items-baseline gap-2 after:absolute after:inset-0">
          <span className="truncate text-sm text-ink">mlp-exact</span>
          <span className="font-mono text-xs text-subtle">#{row.job.id} · R{r.id} / {row.job.rounds}</span>
        </Link>
      </div>
      <RoundProgress round={progress(r, shards)} variant="segments" />
    </li>
  );
}
