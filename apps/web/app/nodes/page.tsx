// Nodes: on-chain stake and seat state next to the coordinator's latest heartbeat and self-test.
import { liveNodes } from "@/lib/api";
import { explorerAddr, fmt6, nodes, short } from "@/lib/chain";
import { Badge, Empty } from "@/components/ui";

export const revalidate = 15;
export const metadata = { title: "Nodes" };
const SELFTEST = "389ba66fd29475c50d58de428233954f328c27f0b5959e3ee0c182fc4cfc79d4";

export default async function Nodes() {
  const [ns, live] = await Promise.all([nodes(), liveNodes()]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Nodes</h1>
      <p className="max-w-2xl text-sm text-muted">Every node joined with a possession-proven ML-DSA-87 key and staked BERU. The self-test is a fixed training run whose weight hash must match on every CPU; a node that drifts can't be seated.</p>
      {ns.length === 0 ? <Empty>No nodes have joined yet.</Empty> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-subtle"><th className="py-2 font-normal">Node</th><th className="font-normal">Stake</th><th className="font-normal">Seat</th><th className="font-normal">Heartbeat</th><th className="font-normal">Self-test</th></tr></thead>
          <tbody>
            {ns.map((n) => {
              const hb = live?.nodes[n.address.toLowerCase()];
              return (
                <tr key={n.address} className="border-t border-rule">
                  <td className="py-3"><a className="font-mono text-xs underline" href={explorerAddr(n.address)} target="_blank" rel="noreferrer">{short(n.address)}</a></td>
                  <td>{n.stake === 0n ? <Badge tone="bad">0 BERU (slashed)</Badge> : `${fmt6(n.stake)} BERU`}</td>
                  <td>{n.busyJob ? <Badge tone="pending">job {n.busyJob}</Badge> : <Badge tone="ok">idle</Badge>}</td>
                  <td>{hb ? <Badge tone="ok">{hb.arch}, {hb.benchmark_s.toFixed(3)}s</Badge> : <Badge tone="warn">offline</Badge>}</td>
                  <td>{hb ? (hb.selftest === SELFTEST ? <Badge tone="ok">bit-exact</Badge> : <Badge tone="bad">mismatch</Badge>) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
