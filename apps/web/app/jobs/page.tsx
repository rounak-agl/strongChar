// Jobs: every round's outcome as one ledger strip, then each job as an index card with its own mosaic poster.
import { Layers } from "lucide-react";
import { Page } from "@/components/page";
import { ButtonLink, Card, JobStatusPill } from "@/components/primitives";
import { Empty, PosterLink } from "@/components/client";
import { formatToken } from "@/lib/money";
import { cx } from "@/lib/cx";
import { jobRows } from "@/lib/view";
import type { RoundStatus } from "@/lib/types";

export const revalidate = 15;
export const metadata = { title: "Jobs" };

const TILE: Record<RoundStatus, string> = {
  settled: "bg-ok", reverted: "bg-danger", voided: "bg-warn", expired: "bg-warn",
  committing: "bg-ink live-dot", revealing: "bg-ink live-dot", verifying: "bg-ink live-dot",
};
const WORD: Record<string, string> = { open: "waiting for nodes", running: "training", completed: "finished", cancelled: "cancelled" };

export default async function Jobs() {
  const rows = await jobRows();
  const all = rows.flatMap((r) => r.rounds.map((x) => ({ ...x, job: r.job.id })));
  const toGo = rows.reduce((a, r) => a + (r.status === "running" || r.status === "open" ? r.job.rounds - r.job.roundsOpened : 0), 0);
  const settled = all.filter((x) => x.status === "settled").length;
  const live = all.filter((x) => ["committing", "revealing", "verifying"].includes(x.status)).length;
  return (
    <Page crumbs={[{ label: "jobs" }, { href: "/how", label: "How training works" }]} icon={Layers} title="Jobs"
          actions={<ButtonLink href="/jobs/new" variant="primary">Post a job</ButtonLink>}
          meta={<>Each job trains on data sealed to the two verifiers; every round is replayed bit for bit before anyone is paid.</>}>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-xs uppercase tracking-wide text-subtle">{settled} rounds settled · {live} live · {toGo} to go</span>
          <span className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <Legend cls="bg-ok" label="paid" /><Legend cls="bg-ink" label="live" /><Legend cls="bg-warn" label="voided or expired" /><Legend cls="bg-danger" label="reverted" />
          </span>
        </div>
        <ol className="flex flex-wrap gap-1" aria-label="Every round, oldest first">
          {[...all].reverse().map((x) => (
            <li key={`${x.job}-${x.round}`}>
              <a href={`/jobs/${x.job}/rounds/${x.round}`} title={`Job ${x.job} round ${x.round}: ${x.status}`} className={cx("block size-3.5 rounded-xs hover:opacity-70", TILE[x.status])}>
                <span className="sr-only">Job {x.job} round {x.round}: {x.status}</span>
              </a>
            </li>
          ))}
          {Array.from({ length: toGo }, (_, i) => <li key={`go${i}`} className="size-3.5 rounded-xs bg-band" />)}
        </ol>
      </Card>
      {rows.length === 0 ? (
        <Empty icon="jobs" poster="EMPTY" title="No jobs yet">Post one from the CLI with <code className="font-mono">strongchar-job post data.csv</code>.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <PosterLink key={r.job.id} href={`/jobs/${r.job.id}`} id={r.job.id} title="mlp-exact" live={r.status === "running"}
                        tag={<JobStatusPill status={r.status} />}
                        note={`${WORD[r.status]} · round ${r.job.roundsOpened} of ${r.job.rounds} · ${formatToken(r.job.remaining)} fUSD left`} />
          ))}
        </div>
      )}
    </Page>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={cx("size-2 rounded-xs", cls)} aria-hidden />{label}</span>;
}
