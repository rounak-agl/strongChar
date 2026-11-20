// Nodes: every machine that joined, drawn as its own laptop, with its stake, seat, self-test, probation and earnings.
import Link from "next/link";
import { Cpu } from "lucide-react";
import { liveNodes } from "@/lib/api";
import { nodes, pool } from "@/lib/chain";
import { Page } from "@/components/page";
import { NodeArt, type ScreenState } from "@/components/pixel";
import { Card, Money, Pill, THead, TH, TD } from "@/components/primitives";
import { formatToken } from "@/lib/money";
import { nodeName } from "@/lib/view";

export const revalidate = 15;
export const metadata = { title: "Nodes" };
const SELFTEST = "389ba66fd29475c50d58de428233954f328c27f0b5959e3ee0c182fc4cfc79d4";
const ROW = "relative border-t border-rule-row transition-colors duration-150 hover:bg-hover";

export default async function Nodes() {
  const [ns, live, p] = await Promise.all([nodes(), liveNodes(), pool()]);
  const now = Date.now() / 1000;
  return (
    <Page crumbs={[{ label: "nodes" }]} icon={Cpu} title="Nodes"
          meta={<>Each node joined with a possession-proven ML-DSA-87 key and staked BERU. Its self-test is a fixed training run whose hash must match on every CPU. New nodes are on probation until they have {p.probationSeconds} s of verified work; until then their pay goes to the community pool, now <Money units={Number(p.balance)} />.</>}>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-table text-sm">
          <THead><TH>Node</TH><TH>Stake</TH><TH>Seat</TH><TH>Self-test</TH><TH>Probation</TH><TH>Claimable</TH></THead>
          <tbody>
            {ns.map((n) => {
              const hb = live?.nodes[n.address.toLowerCase()];
              const online = !!hb && now - hb.seen < 60;
              const state: ScreenState = n.stake === 0n ? "slashed" : !online ? "offline" : n.busyJob ? "training" : "idle";
              return (
                <tr key={n.address} className={ROW}>
                  <TD>
                    <Link href={`/nodes/${n.address}`} className="flex items-center gap-3 after:absolute after:inset-0">
                      <NodeArt op={n.address} state={state} className="w-12" />
                      <span className="flex flex-col">
                        <span className="font-mono text-xs text-ink">{nodeName(n.address)}</span>
                        <span className="text-xs text-subtle">{hb ? `${hb.arch}, ${hb.benchmark_s.toFixed(3)} s benchmark` : "never seen"}</span>
                      </span>
                    </Link>
                  </TD>
                  <TD>{n.stake === 0n ? <Pill tone="danger">0 BERU · slashed</Pill> : <span className="font-mono tabular">{formatToken(n.stake)} <span className="text-xs text-subtle">BERU</span></span>}</TD>
                  <TD>{n.busyJob ? <Pill tone="pending" live>job {n.busyJob}</Pill> : online ? <Pill tone="ok">idle</Pill> : <Pill tone="neutral">offline</Pill>}</TD>
                  <TD>{hb ? (hb.selftest === SELFTEST ? <Pill tone="ok">bit-exact</Pill> : <Pill tone="danger">mismatch</Pill>) : <span className="text-subtle">—</span>}</TD>
                  <TD>{n.graduated ? <Pill tone="ok">graduated</Pill> : <span className="font-mono text-xs text-muted">{n.verifiedWork} of {p.probationSeconds} s</span>}</TD>
                  <TD><Money units={Number(n.claimable)} /></TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
