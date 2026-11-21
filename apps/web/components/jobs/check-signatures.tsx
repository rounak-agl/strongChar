"use client";
// "Don't take our word for it": re-run every settlement's ML-DSA-87 checks from this browser against the chain.
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Banner, Button, Card, SectionTitle, TileBusy } from "@/components/primitives";
import { checkSettlement, type SettlementCheck } from "@/lib/browser/verify";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function CheckSignatures({ settled }: { settled: { round: number; tx: `0x${string}` }[] }) {
  const [res, setRes] = useState<SettlementCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!settled.length) return null;

  const run = async () => {
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await Promise.all(settled.map((s) => checkSettlement(s.tx)))); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const allGood = res?.every((r) => r.checks.every((c) => c.valid && c.tamperedRejected));

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle title="Check the signatures yourself"
          sub="Your browser rebuilds what both verifiers signed for each round, fetches their ML-DSA-87 keys from the chain and asks the pqcVerify precompile. Then it changes one byte and asks again." />
        <Button icon={ShieldCheck} disabled={busy} onClick={run}>{busy ? <TileBusy /> : res ? "Check again" : `Check ${settled.length} settlement${settled.length > 1 ? "s" : ""}`}</Button>
      </div>
      {err && <Banner tone="danger" title={err} />}
      {res && (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">Round</th><th className="font-medium">Verifier</th><th className="font-medium">Signed bytes</th><th className="font-medium">Signature</th><th className="font-medium">One byte changed</th></tr></thead>
          <tbody>
            {res.flatMap((r) => r.checks.map((c, i) => (
              <tr key={`${r.round}-${c.verifier}`} className="border-t border-rule-row">
                <td className="py-1.5 font-mono">{i === 0 ? `R${String(r.round).padStart(2, "0")}` : ""}</td>
                <td className="font-mono text-xs" title={c.verifier}>{short(c.verifier)}</td>
                <td className="tabular text-muted">{i === 0 ? r.messageBytes.toLocaleString() : ""}</td>
                <td className={c.valid ? "text-chain" : "text-danger"}>{c.valid ? "valid" : "INVALID"} <span className="text-xs text-subtle">({c.sigBytes.toLocaleString()} B, key {c.keyBytes.toLocaleString()} B)</span></td>
                <td className={c.tamperedRejected ? "text-chain" : "text-danger"}>{c.tamperedRejected ? "rejected" : "ACCEPTED"}</td>
              </tr>
            )))}
          </tbody>
        </table>
      )}
      {res && <Banner tone={allGood ? "pending" : "danger"} title={allGood ? "Every settlement checks out" : "A check failed"}>
        {allGood ? "Checked from this browser against the chain alone; strongChar's servers were not asked." : "Compare with the transaction on the explorer."}
      </Banner>}
    </Card>
  );
}
