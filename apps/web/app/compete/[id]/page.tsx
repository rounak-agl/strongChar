// One competition: the ranking, every entry's PQ-signed verdict with each verifier's sandbox run, and the label check.
import { notFound } from "next/navigation";
import { Trophy } from "lucide-react";
import { Page } from "@/components/page";
import { CoverHead } from "@/components/client";
import { Badge, Card, Empty, Hash, ProofStamp } from "@/components/ui";
import { explorerTx, fmt6, short } from "@/lib/chain";
import {
  competitionCount, competitionEvents, getCompetition, getEntries, labelCommitOf, meta, phase, publicUrl, runNotes, showScore,
} from "@/lib/compete";
import { deployment } from "@/lib/deployment";

export const revalidate = 15;

const VERIFIER = { [deployment.verifier_a.toLowerCase()]: "Verifier A", [deployment.verifier_b.toLowerCase()]: "Verifier B" };

export default async function CompetitionPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1 || id > (await competitionCount())) notFound();
  const c = await getCompetition(id);
  const [entries, m, ev] = await Promise.all([getEntries(id), meta(c.metaHash), competitionEvents(id)]);
  const notes = await Promise.all(entries.map((e) => runNotes(id, e.index)));
  const p = phase(c);
  const ranked = entries.filter((e) => e.validity === "Valid").sort((a, b) => (b.score > a.score ? 1 : b.score < a.score ? -1 : a.index - b.index));
  const winner = ev.settled && Number(ev.settled.args.winner) >= 0 ? Number(ev.settled.args.winner) : null;
  const revealed = ev.revealed?.args as { labels: `0x${string}`; salt: `0x${string}` } | undefined;
  const matches = revealed ? labelCommitOf(revealed.labels, revealed.salt) === c.labelCommit : null;

  return (
    <Page crumbs={[{ href: "/compete", label: "competitions" }, { label: `#${String(id).padStart(2, "0")}`, mono: true }]} icon={Trophy}
          title={<span className="flex flex-wrap items-center gap-3">{m?.title ?? `Competition ${id}`} <Badge tone={p.tone}>{p.label}</Badge></span>}
          meta={<>
            {fmt6(c.prize)} fUSD prize · {m?.task ?? "task unknown"}, scored by {m?.metric ?? "an unknown metric"}
            {m?.rows ? ` on ${m.rows.toLocaleString("en-US")} hidden rows` : ""} · up to {c.maxPerEntrant} entries each · closes {new Date(c.deadline * 1000).toUTCString()}
            {m?.train && <> · public training set <a className="underline" href={publicUrl(m.train)}>train.csv</a>; test rows and labels are sealed to the two verifiers</>}
          </>}>
      <CoverHead id={id + 100} title={m?.title ?? `Competition ${id}`} live={p.label === "Open for entries"}
                 meta={[p.label, `${fmt6(c.prize)} fUSD prize`, `${entries.length} entries`, m?.metric ?? ""].filter(Boolean)} />

      <Card title="Ranking" aside={ev.scores && <ProofStamp tx={ev.scores.tx} />}>
        {!c.scoresPosted ? (
          <Empty>Scores are posted after the deadline, once both verifiers sign the same table.</Empty>
        ) : ranked.length === 0 ? (
          <Empty>No entry passed validation, so the prize goes back to the host.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-subtle">
              <tr><th className="pb-2 font-medium">Place</th><th className="pb-2 font-medium">Entry</th><th className="pb-2 font-medium">Entrant</th><th className="pb-2 text-right font-medium">{m?.metric ?? "Score"}</th></tr>
            </thead>
            <tbody>
              {ranked.map((e, i) => (
                <tr key={e.index} className="border-t border-rule">
                  <td className="py-2 tabular-nums">{i + 1}</td>
                  <td className="py-2">#{e.index} {winner === e.index && <Badge tone="ok">Won {fmt6(c.prize)} fUSD</Badge>}</td>
                  <td className="py-2"><Hash value={e.entrant} /></td>
                  <td className="py-2 text-right font-mono tabular-nums">{showScore(e.score, m?.metric)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {ev.settled && (
          <p className="mt-3 text-xs text-subtle">
            Settled · <a className="underline" href={explorerTx(ev.settled.tx)} target="_blank" rel="noreferrer">{short(ev.settled.tx)}</a>
          </p>
        )}
      </Card>

      <Card title="Entries">
        {entries.length === 0 && <Empty>No entries yet.</Empty>}
        <ul className="space-y-4">
          {entries.map((e, i) => {
            const posted = ev.validity.find((v) => Number(v.args.entry) === e.index);
            return (
              <li key={e.index} className="border-t border-rule pt-4 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">Entry #{e.index}</span>
                  <Badge tone={e.validity === "Valid" ? "ok" : e.validity === "Invalid" ? "bad" : "pending"}>{e.validity}</Badge>
                  <span className="text-xs text-subtle">by <Hash value={e.entrant} /> · script <Hash value={e.scriptHash} /></span>
                  {posted && <ProofStamp tx={posted.tx} />}
                </div>
                {notes[i].length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {notes[i].map((n) => (
                      <li key={n.author} className="text-muted">
                        {VERIFIER[n.author] ?? short(n.author)} ran it in the sandbox: <span className={n.ok ? "text-ok" : "text-danger"}>{n.reason}</span>
                        {n.runtimeS !== undefined && ` in ${n.runtimeS}s`}
                        {!n.ok && n.detail ? <span className="text-subtle"> ({n.detail})</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {e.validity === "Valid" && <p className="mt-1 text-xs text-subtle">Both verifiers produced predictions hashing to <Hash value={e.predHash} /></p>}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Hidden labels">
        <p className="text-sm text-muted">Committed when the competition opened: <Hash value={c.labelCommit} /></p>
        {!revealed ? (
          <p className="mt-2 text-sm text-muted">
            Revealed on-chain after the deadline by the host, or by a verifier if the host misses{" "}
            {new Date(c.revealDeadline * 1000).toUTCString()}.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Badge tone={matches ? "ok" : "bad"}>{matches ? "Revealed labels match the commitment" : "Revealed labels don't match"}</Badge>
            <span className="text-xs text-subtle">
              {((revealed.labels.length - 2) / 2).toLocaleString()} bytes, recomputed here from the reveal tx ·{" "}
              <a className="underline" href={explorerTx(ev.revealed!.tx)} target="_blank" rel="noreferrer">{short(ev.revealed!.tx)}</a>
            </span>
          </div>
        )}
      </Card>
    </Page>
  );
}
