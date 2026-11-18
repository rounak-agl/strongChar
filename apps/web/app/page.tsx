// Landing: the problem, the three steps, and live counters read from the chain and the coordinator.
import Link from "next/link";
import { getJob, jobCount, nodes } from "@/lib/chain";
import { sealed } from "@/lib/api";
import { Stat } from "@/components/ui";

export const revalidate = 15;

export default async function Home() {
  const [n, ns, s] = await Promise.all([jobCount(), nodes(), sealed()]);
  const jobs = await Promise.all(Array.from({ length: n }, (_, i) => getJob(i + 1)));
  const rounds = jobs.reduce((a, j) => a + j.roundsOpened, 0);
  return (
    <div className="space-y-12">
      <section className="max-w-3xl space-y-5">
        <h1 className="text-4xl font-semibold tracking-tight">Your data, sealed to only the machines that need it. Every step proven.</h1>
        <p className="text-lg text-muted">
          Train a model on private data using other people&apos;s computers, or run a Kaggle-style competition where the hidden test set never leaks.
          Every shard is sealed with post-quantum encryption (ML-KEM-1024) to exactly the node and two verifiers that work on it.
          Verifiers replay every step bit for bit and sign the result with ML-DSA-87, which the chain checks before anyone is paid.
        </p>
        <div className="flex gap-3">
          <Link href="/jobs" className="rounded-sm bg-ink px-4 py-2 text-sm font-medium text-surface">See jobs</Link>
          <Link href="/how" className="rounded-sm border border-rule-strong px-4 py-2 text-sm">How it works</Link>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Live counters">
        <Stat label="Jobs" value={n} />
        <Stat label="Rounds run" value={rounds} />
        <Stat label="Nodes joined" value={ns.length} />
        <Stat label="Sealed blobs held" value={s ? s.blobs.length : "—"} />
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        {[["Seal", "The owner's browser shards the data and seals each shard to its node and both verifiers. The server only stores ciphertext."],
          ["Train", "Each node opens only its shard, trains on a bit-exact CPU kernel and commits to its checkpoints before revealing them."],
          ["Prove", "Two verifiers replay every node. A mismatch is a cheat and gets slashed; the settlement only counts with both post-quantum signatures."]].map(([t, d], i) => (
          <div key={t} className="rounded-sm border border-rule p-5">
            <div className="text-xs text-seal">0{i + 1}</div>
            <h2 className="mt-1 font-semibold">{t}</h2>
            <p className="mt-2 text-sm text-muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
