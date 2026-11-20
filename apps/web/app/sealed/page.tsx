// What the server sees: everything the coordinator stores, which is ciphertext ids, kinds and sizes only.
import { Lock } from "lucide-react";
import { sealed } from "@/lib/api";
import { Page } from "@/components/page";
import { Card } from "@/components/primitives";
import { Empty } from "@/components/client";
import { SealChip } from "@/components/ui";

export const revalidate = 10;
export const metadata = { title: "What the server sees" };

export default async function Sealed() {
  const s = await sealed();
  const total = s?.blobs.reduce((a, b) => a + b.size, 0) ?? 0;
  const kinds = Object.entries((s?.blobs ?? []).reduce<Record<string, number>>((a, b) => ({ ...a, [b.kind]: (a[b.kind] ?? 0) + 1 }), {}));
  return (
    <Page crumbs={[{ label: "what the server sees" }]} icon={Lock} title="What the server sees"
          meta={<>The coordinator&apos;s whole store. Every item is a QoreSeal envelope (ML-KEM-1024 with X25519) addressed to named recipients. The server holds no key that opens any of them, and hands an envelope only to an account whose registered ML-KEM key is one of its recipients.</>}>
      {!s ? <Empty icon="sealed" poster="OFFLINE" title="Coordinator unreachable">The chain pages still work; this list comes from the coordinator.</Empty>
        : s.blobs.length === 0 ? <Empty icon="sealed" poster="EMPTY" title="Nothing stored yet" /> : (
        <>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card className="flex flex-col gap-1 p-4"><dt className="text-xs text-muted">Envelopes</dt><dd className="font-mono text-xl tabular">{s.blobs.length}</dd></Card>
            <Card className="flex flex-col gap-1 p-4"><dt className="text-xs text-muted">Ciphertext</dt><dd className="font-mono text-xl tabular">{(total / 2 ** 20).toFixed(2)} MB</dd></Card>
            {kinds.slice(0, 2).map(([k, n]) => <Card key={k} className="flex flex-col gap-1 p-4"><dt className="text-xs text-muted">{k}</dt><dd className="font-mono text-xl tabular">{n}</dd></Card>)}
          </dl>
          <Card className="p-4"><div className="flex flex-wrap gap-2">{s.blobs.map((b) => <SealChip key={b.id} kind={b.kind} size={b.size} id={b.id} />)}</div></Card>
        </>
      )}
    </Page>
  );
}
