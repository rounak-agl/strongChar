"use client";
// The finished model is sealed by both verifiers to the job owner alone. If that is this browser's account, open it
// here and score it on the holdout rows that never left this device.
import { useEffect, useState } from "react";
import { LockOpen } from "lucide-react";
import { Banner, Button, Card, SectionTitle, TileBusy } from "@/components/primitives";
import { signatures } from "@/lib/browser/coordinator";
import { getJob, type LocalJob } from "@/lib/browser/jobs-store";
import { fromBlob, score, type Model } from "@/lib/browser/model";
import { initialWeights } from "@/lib/browser/prepare";
import { aad, openWith } from "@/lib/browser/seal";
import { useOwner } from "@/lib/browser/session";
import { deployment } from "@/lib/deployment";

export function OpenModel({ jobId, owner: jobOwner, rounds, finished }: { jobId: number; owner: string; rounds: number; finished: boolean }) {
  const owner = useOwner();
  const [local, setLocal] = useState<LocalJob | null | undefined>(undefined);
  const [res, setRes] = useState<{ before: number; after: number; metric: string; params: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getJob(jobId).then((j) => setLocal(j ?? null)).catch(() => setLocal(null)); }, [jobId]);

  if (!owner || owner.account.evm.toLowerCase() !== jobOwner.toLowerCase()) return null;

  const open = async () => {
    setBusy(true); setErr(null);
    try {
      const sigs = await signatures(jobId, rounds);
      const blobId = sigs.map((s) => s.settlement.modelBlob as string | undefined).find(Boolean);
      if (!blobId) throw new Error("The verifiers haven't sealed the final model yet.");
      const text = await owner.coordinator.getBlob(blobId);
      const bytes = openWith(text, owner.seal, "model", aad(deployment.job_market, jobId, rounds, 0, "model", [owner.seal.mlkemPublicKey]));
      if (!local) { setRes({ before: NaN, after: NaN, metric: "", params: (bytes.length - 36) / 4 }); return; }
      const sp = local.spec as { d_in: number; hidden: number; n_out: number; loss: "ce" | "mse" };
      const m: Model = { dIn: sp.d_in, hidden: sp.hidden, nOut: sp.n_out, loss: sp.loss };
      const n = m.dIn * m.hidden + m.hidden + m.hidden * m.nOut + m.nOut;
      const w = fromBlob(local.specHash, bytes, n);
      setRes({
        before: score(m, initialWeights(m.dIn, m.hidden, m.nOut), local.holdoutX, local.holdoutY),
        after: score(m, w, local.holdoutX, local.holdoutY), metric: m.loss === "ce" ? "accuracy" : "mean squared error", params: n,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3 p-5">
      <SectionTitle title="Your model" sub="sealed to you alone by both verifiers; opened in this browser" />
      {!finished && <p className="text-sm text-muted">It can be opened once the last round settles.</p>}
      {local === null && <p className="text-sm text-muted">This job wasn't posted from this browser, so the holdout rows aren't here. You can still open the model.</p>}
      <div><Button variant="primary" icon={LockOpen} disabled={busy || !finished} onClick={open}>{busy ? <TileBusy /> : "Open and score it here"}</Button></div>
      {res && (Number.isNaN(res.after)
        ? <Banner tone="pending" title="Opened">{res.params.toLocaleString()} weights, decrypted in this tab.</Banner>
        : <Banner tone="pending" title={`Holdout ${res.metric}: ${res.before.toFixed(3)} → ${res.after.toFixed(3)}`}>
            Measured on rows that never left this device: the untrained model, then the one the network trained. {res.params.toLocaleString()} weights, decrypted in this tab.
          </Banner>)}
      {err && <Banner tone="danger" title={err} />}
    </Card>
  );
}
