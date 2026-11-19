// One node: stake, probation, earnings, heartbeat, and every round it was paid (or forfeited) for.
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAddress, type Address } from "viem";
import { liveNodes } from "@/lib/api";
import { explorerAddr, explorerTx, fmt6, node, payments, pool, short } from "@/lib/chain";
import { Badge, Card, Empty, Stat } from "@/components/ui";

export const revalidate = 15;

export default async function NodePage({ params }: { params: Promise<{ address: string }> }) {
  const raw = (await params).address;
  if (!isAddress(raw)) notFound();
  const address = raw as Address;
  const [n, live, pays, p] = await Promise.all([node(address), liveNodes(), payments({ node: address }), pool()]);
  if (!n.joined) notFound();
  const hb = live?.nodes[address.toLowerCase()];
  const earned = pays.filter((x) => !x.forfeited).reduce((a, x) => a + x.amount, 0n);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl">{short(address, 10)}</h1>
        <a className="text-sm underline" href={explorerAddr(address)} target="_blank" rel="noreferrer">explorer</a>
        {n.graduated ? <Badge tone="ok">graduated</Badge> : <Badge tone="warn">on probation</Badge>}
        {hb ? <Badge tone={hb.draining ? "warn" : "ok"}>{hb.draining ? "stopping" : "online"}</Badge> : <Badge tone="warn">offline</Badge>}
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Stake" value={`${fmt6(n.stake)} BERU`} />
        <Stat label="Earned" value={`${fmt6(earned)} fUSD`} />
        <Stat label="Claimable now" value={`${fmt6(n.claimable)} fUSD`} />
        <Stat label="Verified work" value={`${n.verifiedWork} of ${p.probationSeconds} s`} />
      </div>
      {!n.graduated && (
        <p className="max-w-2xl text-sm text-muted">
          New nodes are on probation until they have {p.probationSeconds} s of verified work. Until then their share of
          each round goes to the community pool ({fmt6(p.balance)} fUSD now), which pays graduated nodes{" "}
          {p.dripBps / 100}% of itself each round on top of their share.
        </p>
      )}
      {hb && <p className="text-sm text-muted">{hb.arch}, {hb.cores} cores, self-test benchmark {hb.benchmark_s.toFixed(3)} s, last heartbeat {Math.round(Date.now() / 1000 - hb.seen)} s ago.</p>}
      <Card title="Rounds">
        {pays.length === 0 ? <Empty>Not paid for any round yet.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-subtle"><th className="py-1 font-normal">Round</th><th className="font-normal">Amount</th><th className="font-normal">Went to</th></tr></thead>
            <tbody>
              {pays.map((x) => (
                <tr key={x.tx + x.round} className="border-t border-rule">
                  <td className="py-2"><Link className="underline" href={`/jobs/${x.job}/rounds/${x.round}`}>job {x.job} · round {x.round}</Link></td>
                  <td className="tabular-nums">{fmt6(x.amount)} fUSD</td>
                  <td>{x.forfeited ? "community pool (probation)" : "this node"} · <a className="underline" href={explorerTx(x.tx)} target="_blank" rel="noreferrer">tx</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
