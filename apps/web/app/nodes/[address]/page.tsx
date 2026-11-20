// One node: its laptop, stake, probation, earnings, heartbeat, and every round it was paid for or forfeited.
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAddress, type Address } from "viem";
import { Cpu } from "lucide-react";
import { liveNodes } from "@/lib/api";
import { explorerAddr, explorerTx, node, payments, pool } from "@/lib/chain";
import { Page } from "@/components/page";
import { NodeArt, type ScreenState } from "@/components/pixel";
import { Card, Money, Pill, Progress, SectionTitle, THead, TH, TD } from "@/components/primitives";
import { formatToken } from "@/lib/money";
import { nodeName } from "@/lib/view";

export const revalidate = 15;
const ROW = "relative border-t border-rule-row";

export default async function NodePage({ params }: { params: Promise<{ address: string }> }) {
  const raw = (await params).address;
  if (!isAddress(raw)) notFound();
  const address = raw as Address;
  const [n, live, pays, p] = await Promise.all([node(address), liveNodes(), payments({ node: address }), pool()]);
  if (!n.joined) notFound();
  const hb = live?.nodes[address.toLowerCase()];
  const online = !!hb && Date.now() / 1000 - hb.seen < 60;
  const state: ScreenState = n.stake === 0n ? "slashed" : !online ? "offline" : n.busyJob ? "training" : "idle";
  const earned = pays.filter((x) => !x.forfeited).reduce((a, x) => a + x.amount, 0n);
  const forfeited = pays.filter((x) => x.forfeited).reduce((a, x) => a + x.amount, 0n);
  return (
    <Page crumbs={[{ href: "/nodes", label: "nodes" }, { label: nodeName(address), mono: true }]} icon={Cpu}
          title={<span className="flex flex-wrap items-center gap-3 font-mono">{nodeName(address)} {n.graduated ? <Pill tone="ok">graduated</Pill> : <Pill tone="warn">on probation</Pill>} {online ? <Pill tone={hb?.draining ? "warn" : "ok"} live={!hb?.draining}>{hb?.draining ? "stopping" : "online"}</Pill> : <Pill tone="neutral">offline</Pill>}</span>}
          meta={<a className="font-mono text-xs underline" href={explorerAddr(address)} target="_blank" rel="noreferrer">{address}</a>}>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex items-center justify-center p-6 lg:row-span-2">
          <NodeArt op={address} state={state} size="lg" className="w-full max-w-72" />
        </Card>
        <dl className="grid grid-cols-2 gap-4 lg:col-span-2">
          <Fact label="Stake" value={`${formatToken(n.stake)} BERU`} sub={n.busyJob ? `seated in job ${n.busyJob}, round ${n.busyRound}` : "idle, can withdraw"} />
          <Fact label="Earned" value={<Money units={Number(earned)} />} sub={forfeited > 0n ? `${formatToken(forfeited)} fUSD forfeited on probation` : "every share paid directly"} />
          <Fact label="Claimable now" value={<Money units={Number(n.claimable)} />} sub="strongchar-node claim" />
          <Fact label="Self-test" value={hb ? `${hb.benchmark_s.toFixed(3)} s` : "—"} sub={hb ? `${hb.arch}, ${hb.cores} cores` : "no heartbeat yet"} />
        </dl>
        <Card className="flex flex-col gap-3 p-5 lg:col-span-2">
          <SectionTitle title="Probation" sub={`${n.verifiedWork} of ${p.probationSeconds} s of verified work`} />
          <Progress value={Math.min(1, n.verifiedWork / Math.max(1, p.probationSeconds))} kind="meter" tone={n.graduated ? "ink" : "warn"} label="Verified work toward graduation" />
          <p className="text-sm text-muted">
            {n.graduated ? `Graduated: paid directly each round, plus a share of the ${p.dripBps / 100}% the community pool drips to graduated payees.`
              : "Until then this node's share of each round goes to the community pool. Verified work is credited only by rounds both verifiers signed."}
          </p>
        </Card>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-table text-sm">
          <THead><TH>Round</TH><TH>Amount</TH><TH>Went to</TH><TH>Transaction</TH></THead>
          <tbody>
            {pays.length === 0 && <tr className={ROW}><TD className="text-subtle">Not paid for any round yet.</TD><TD /><TD /><TD /></tr>}
            {pays.map((x) => (
              <tr key={x.tx + x.round} className={ROW}>
                <TD><Link className="font-mono text-ink hover:underline" href={`/jobs/${x.job}/rounds/${x.round}`}>job {x.job} · R{String(x.round).padStart(2, "0")}</Link></TD>
                <TD><Money units={Number(x.amount)} /></TD>
                <TD>{x.forfeited ? <Pill tone="warn">community pool</Pill> : <Pill tone="ok">this node</Pill>}</TD>
                <TD><a className="font-mono text-xs text-chain hover:underline" href={explorerTx(x.tx)} target="_blank" rel="noreferrer">{x.tx.slice(0, 14)}…</a></TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card className="flex min-h-28 flex-col justify-between gap-2 p-4">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="font-mono text-xl tabular text-ink">{value}</dd>
      {sub && <dd className="text-xs text-subtle">{sub}</dd>}
    </Card>
  );
}
