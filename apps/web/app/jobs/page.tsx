// Jobs list, straight from the JobMarket contract.
import Link from "next/link";
import { fmt6, getJob, jobCount, short } from "@/lib/chain";
import { Badge, Empty } from "@/components/ui";

export const revalidate = 15;
export const metadata = { title: "Jobs" };

export default async function Jobs() {
  const n = await jobCount();
  const jobs = (await Promise.all(Array.from({ length: n }, (_, i) => getJob(i + 1)))).reverse();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Training jobs</h1>
      {jobs.length === 0 ? <Empty>No jobs yet. Post one to see its rounds here.</Empty> : (
        <ul className="divide-y divide-rule rounded-sm border border-rule">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link href={`/jobs/${j.id}`} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-hover">
                <span className="font-semibold">Job {j.id}</span>
                <Badge tone={j.status === "Completed" ? "ok" : j.status === "Active" ? "pending" : "warn"}>{j.status}</Badge>
                <span className="text-sm text-muted">{j.roundsOpened}/{j.rounds} rounds · {fmt6(j.budget)} fUSD</span>
                <code className="ml-auto font-mono text-xs text-subtle">owner {short(j.owner)}</code>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
