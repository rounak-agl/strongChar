// Competitions: each one as an index card with its own mosaic poster, its phase, prize and entry count.
import { Trophy } from "lucide-react";
import { Page } from "@/components/page";
import { Pill } from "@/components/primitives";
import { Empty, PosterLink } from "@/components/client";
import { formatToken } from "@/lib/money";
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
    <Page crumbs={[{ label: "competitions" }]} icon={Trophy} title="Competitions"
          meta={<>Entrants seal their scripts to two verifiers. Both run every script in the same locked-down sandbox, and only verdicts and scores both signed with ML-DSA-87 reach the contract. The hidden labels are committed when a competition opens and revealed on-chain at the end, so anyone can recompute the ranking.</>}>
      {!competitionsDeployed && <Empty icon="compete" poster="EMPTY" title="Not deployed">The Competitions contract isn&apos;t on diana yet.</Empty>}
      {competitionsDeployed && n === 0 && <Empty icon="compete" poster="EMPTY" title="No competitions yet">Host one with scripts/demo_compete.py.</Empty>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ c, entries, m }) => {
          const p = phase(c);
          return (
            <PosterLink key={c.id} href={`/compete/${c.id}`} id={c.id + 100} title={m?.title ?? "Untitled"} live={p.label === "Open for entries"}
                        tag={<Pill tone={p.tone === "ok" ? "ok" : p.tone === "warn" ? "warn" : "pending"}>{p.label}</Pill>}
                        note={`${formatToken(c.prize)} fUSD prize · ${m?.metric ?? "metric unknown"} · ${entries.length} entries`} />
          );
        })}
      </div>
    </Page>
  );
}
