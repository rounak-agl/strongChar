// Server-side reads from the coordinator. It only ever returns ciphertext ids, metadata and signatures.
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8700";

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null; // the pages fall back to chain data when the coordinator is unreachable
  }
}

export type SealedBlob = { id: string; kind: string; size: number; created: number; pinned: boolean };
export const sealed = () => get<{ blobs: SealedBlob[] }>("/v1/sealed");
export type Beat = { arch: string; cores: number; benchmark_s: number; selftest: string; seen: number; draining?: boolean };
export const liveNodes = () => get<{ nodes: Record<string, Beat> }>("/v1/nodes");
export type Matcher = { eligible: number; quorum: number; seated: string[]; blocked: Record<string, string>; at: number };
export const matcher = (job: number) => get<Matcher>(`/v1/jobs/${job}/matcher`);
export const draft = (specHash: string) => get<{ spec: Record<string, unknown>; manifest: Record<string, unknown> }>(`/v1/jobs/draft/${specHash}`);
export const signatures = (job: number, round: number) =>
  get<{ signatures: { verifier: string; payloadHash: string; expiry: number; settlement: Record<string, unknown> }[] }>(`/v1/rounds/${job}/${round}/signatures`);
