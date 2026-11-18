// A round's path: open → commit → reveal → replay → settle, with each node's seat and the cheater turning red.
import type { Round } from "@/lib/chain";
import { Badge, Hash } from "./ui";

const STEPS = ["Open", "Commit", "Reveal", "Replay", "Settle"];

export function RoundTimeline({ round }: { round: Round }) {
  const done = round.status === "Open" ? Math.max(1, round.seats.filter((s) => s.revealed).length ? 3 : round.seats.some((s) => s.committed) ? 2 : 1) : 5;
  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2" aria-label="Round progress">
        {STEPS.map((s, i) => (
          <li key={s} className={`rounded-sm border px-2.5 py-1 text-xs ${i < done ? "border-seal/50 text-seal" : "border-rule text-subtle"}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-subtle"><th className="py-1 font-normal">Node</th><th className="font-normal">Commit</th><th className="font-normal">Reveal</th><th className="font-normal">Replay verdict</th></tr></thead>
        <tbody>
          {round.seats.map((s) => (
            <tr key={s.node} className="border-t border-rule">
              <td className="py-2"><Hash value={s.node} label={`node ${s.node}`} /></td>
              <td>{s.committed ? <Badge tone="ok">committed</Badge> : <Badge tone="pending">waiting</Badge>}</td>
              <td>{s.revealed ? <Badge tone="ok">revealed</Badge> : <Badge tone={round.status === "Open" ? "pending" : "warn"}>{round.status === "Open" ? "waiting" : "missed"}</Badge>}</td>
              <td>{round.status === "Open" ? <Badge tone="pending">pending</Badge> : s.slashed ? <Badge tone="bad">ReplayMismatch · slashed</Badge> : s.revealed ? <Badge tone="ok">bit-exact match</Badge> : <Badge tone="warn">no reveal</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
