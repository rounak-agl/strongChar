// Competitions: every one on diana with its prize, phase and entry count.
import Link from "next/link";
import { Badge, Card, Empty } from "@/components/ui";
import { fmt6 } from "@/lib/chain";
import { competitionCount, competitionsDeployed, getCompetition, getEntries, meta, phase } from "@/lib/compete";

export const metadata = { title: "Competitions" };
export const revalidate = 15;

export default async function Compete() {
  const n = await competitionCount();
  const rows = await Promise.all(Array.from({ length: n }, async (_, i) => {
    const c = await getCompetition(n - i);
    const [entries, m] = await Promise.all([getEntries(c.id), meta(c.metaHash)]);
    return { c, entries, m };
  }));
  return (
    <div className="space-y-6">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-2xl font-semibold">Competitions</h1>
        <p className="text-sm text-muted">
          Entrants seal their scripts to two verifiers. Both run each script in the same locked-down sandbox, and only
          verdicts and scores both of them signed with ML-DSA-87 reach the contract. The hidden labels are committed when
          the competition opens and revealed on-chain at the end, so anyone can recompute the ranking.
        </p>
      </div>
      {!competitionsDeployed && <Empty>The competitions contract isn&apos;t deployed on diana yet.</Empty>}
      {competitionsDeployed && n === 0 && <Empty>No competitions yet.</Empty>}
      {rows.map(({ c, entries, m }) => {
        const p = phase(c);
        return (
          <Link key={c.id} href={`/compete/${c.id}`} className="block focus-visible:outline-2 focus-visible:outline-seal">
            <Card title={`Competition ${c.id}`} aside={<Badge tone={p.tone}>{p.label}</Badge>}>
              <p className="text-lg font-medium">{m?.title ?? "Untitled"}</p>
              <p className="mt-1 text-sm text-muted">
                {fmt6(c.prize)} fUSD prize · {m?.metric ?? "metric unknown"} · {entries.length} entries ·
                closes {new Date(c.deadline * 1000).toUTCString()}
              </p>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
