// What the server sees: everything the coordinator stores, which is ciphertext ids, kinds and sizes only.
import { sealed } from "@/lib/api";
import { Empty, SealChip } from "@/components/ui";

export const revalidate = 10;
export const metadata = { title: "What the server sees" };

export default async function Sealed() {
  const s = await sealed();
  const total = s?.blobs.reduce((a, b) => a + b.size, 0) ?? 0;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">What the server sees</h1>
      <p className="max-w-2xl text-sm text-muted">
        This is the coordinator&apos;s whole store. Every item is a QoreSeal envelope (ML-KEM-1024 + X25519) addressed to named recipients; the server holds no key that opens any of them,
        and it only hands an envelope to an account whose registered ML-KEM key is one of its recipients.
      </p>
      {!s ? <Empty>The coordinator is unreachable right now.</Empty> : s.blobs.length === 0 ? <Empty>Nothing stored yet.</Empty> : (
        <>
          <p className="text-sm text-subtle">{s.blobs.length} envelopes · {(total / 2 ** 20).toFixed(2)} MB of ciphertext</p>
          <div className="flex flex-wrap gap-2">{s.blobs.map((b) => <SealChip key={b.id} kind={b.kind} size={b.size} id={b.id} />)}</div>
        </>
      )}
    </div>
  );
}
