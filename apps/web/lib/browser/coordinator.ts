// The coordinator from the browser: sign in by signing a one-time challenge with the account's ML-DSA-87 key,
// then publish the recipient card and move ciphertext. Mirrors strongchar_runtime.client.Coordinator.
import { pqcSign, type UnifiedAccount } from "@qorechain/sdk";

// In development the page runs on localhost, which the live coordinator's CORS list doesn't include, so next.config
// proxies /coord there. Production talks to the coordinator directly.
export const API = process.env.NODE_ENV === "development" ? "/coord" : (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8700");

const challengeMessage = (address: string, nonce: string) =>
  new TextEncoder().encode(`strongchar-auth/v1|${address.toLowerCase()}|${nonce}`);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

async function ok<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw Object.assign(new Error(d.detail ?? `coordinator: HTTP ${r.status}`), { status: r.status });
  }
  return (await r.json()) as T;
}

export class Coordinator {
  private token: string | null = null;
  private at = 0;
  constructor(private account: UnifiedAccount) {}

  private async auth(): Promise<Record<string, string>> {
    if (!this.token || Date.now() - this.at > 20 * 60_000) {
      const addr = this.account.evm.toLowerCase();
      const { nonce } = await ok<{ nonce: string }>(await fetch(`${API}/v1/auth/challenge?address=${addr}`));
      const sig = await pqcSign(this.account.pqc.secretKey, challengeMessage(addr, nonce));
      const { token } = await ok<{ token: string }>(await fetch(`${API}/v1/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: addr, signature: b64(sig) }),
      }));
      this.token = token;
      this.at = Date.now();
    }
    return { authorization: `Bearer ${this.token}` };
  }

  async putCard(card: string): Promise<void> {
    await ok(await fetch(`${API}/v1/cards`, {
      method: "POST", headers: { ...(await this.auth()), "content-type": "application/json" }, body: JSON.stringify({ card }),
    }));
  }

  async putBlob(envelope: string, kind: string): Promise<string> {
    const r = await fetch(`${API}/v1/blobs`, {
      method: "POST", headers: { ...(await this.auth()), "x-kind": kind, "content-type": "text/plain" }, body: envelope,
    });
    return (await ok<{ id: string }>(r)).id;
  }

  async getBlob(id: string): Promise<string> {
    return (await ok<{ envelope: string }>(await fetch(`${API}/v1/blobs/${id}`, { headers: await this.auth() }))).envelope;
  }
}

export async function getCard(address: string): Promise<string | null> {
  const r = await fetch(`${API}/v1/cards/${address.toLowerCase()}`);
  return r.ok ? ((await r.json()) as { card: string }).card : null;
}

export async function signatures(job: number, round: number) {
  const r = await fetch(`${API}/v1/rounds/${job}/${round}/signatures`);
  return r.ok ? ((await r.json()) as { signatures: { verifier: string; settlement: Record<string, unknown> }[] }).signatures : [];
}
