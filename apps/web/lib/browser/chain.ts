// Native-lane transactions from the browser: read through the /api/chain relay, sign here with the account's
// eth_secp256k1 + ML-DSA-87 keys, simulate for gas, broadcast and wait. Mirrors strongchar_qore.chain.Chain.submit.
import {
  calculateFee, qorechainRegistry, resolveSignBytesVersion, signClassicalEth, signHybridEth,
  type UnifiedAccount,
} from "@qorechain/sdk";

export const CHAIN_ID = "qorechain-diana";
export const REST = "/api/chain";
const GAS_PRICE = "0.15uqor";
const registry = qorechainRegistry();

type EncodeObject = { typeUrl: string; value: unknown };
export type TxResult = { txhash: string; height: number; gasUsed: number };

export class TxFailed extends Error {
  constructor(public txhash: string | undefined, public code: number, public log: string) {
    super(`transaction failed (code ${code}): ${log}`);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${REST}${path}`, { cache: "no-store" });
  if (!r.ok) throw Object.assign(new Error(`${path}: HTTP ${r.status}`), { status: r.status });
  return (await r.json()) as T;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

export async function accountNumbers(qor: string): Promise<{ number: number; sequence: number } | null> {
  try {
    const { account } = await getJson<{ account: Record<string, any> }>(`/cosmos/auth/v1beta1/accounts/${qor}`);
    const base = account.base_account ?? account;
    return { number: Number(base.account_number), sequence: Number(base.sequence ?? 0) };
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null; // never funded
    throw e;
  }
}

export async function balance(qor: string, denom = "uqor"): Promise<bigint> {
  const { balances } = await getJson<{ balances: { denom: string; amount: string }[] }>(`/cosmos/bank/v1beta1/balances/${qor}`);
  return BigInt(balances.find((c) => c.denom === denom)?.amount ?? "0");
}

export type PqcStatus = { registered: boolean; possessionProven: boolean; publicKey: Uint8Array | null };
export async function pqcStatus(qor: string): Promise<PqcStatus> {
  try {
    const { account } = await getJson<{ account: Record<string, any> | null }>(`/qorechain/pqc/v1/account/${qor}`);
    if (!account?.public_key) return { registered: false, possessionProven: false, publicKey: null };
    const pk = Uint8Array.from(atob(account.public_key), (c) => c.charCodeAt(0));
    return { registered: true, possessionProven: Boolean(account.possession_proven), publicKey: pk };
  } catch (e) {
    if ((e as { status?: number }).status === 404) return { registered: false, possessionProven: false, publicKey: null };
    throw e;
  }
}

export async function kemKey(qor: string): Promise<Uint8Array | null> {
  try {
    const d = await getJson<{ key?: { public_key?: string } | null }>(`/qorechain/pqc/v1/kem/${qor}`);
    const pk = d.key?.public_key;
    return pk ? Uint8Array.from(atob(pk), (c) => c.charCodeAt(0)) : null;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

async function postTx(path: string, txBytes: Uint8Array, extra: Record<string, string> = {}): Promise<any> {
  const r = await fetch(`${REST}/${path}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx_bytes: b64(txBytes), ...extra }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new TxFailed(undefined, body.code ?? r.status, body.message ?? `HTTP ${r.status}`);
  return body;
}

/** Simulate for gas, sign, broadcast and wait for inclusion. Hybrid unless it is the bootstrap key registration. */
export async function submit(account: UnifiedAccount, messages: EncodeObject[], { hybrid = true } = {}): Promise<TxResult> {
  const nums = await accountNumbers(account.cosmos);
  if (!nums) throw new Error("This account has no QOR yet. Fund it first.");
  const signBytesVersion = hybrid ? await resolveSignBytesVersion({ chainId: CHAIN_ID, rest: `${location.origin}${REST}` }) : undefined;
  const sign = (gas: number) => {
    const p = {
      account: account as any, chainId: CHAIN_ID, accountNumber: nums.number, sequence: nums.sequence,
      messages: messages as any, fee: calculateFee(gas, GAS_PRICE),
      // Messages the SDK has no composer for (MsgConvertCoin) arrive already encoded.
      encodeMessage: (m: any) => (m.value instanceof Uint8Array ? { typeUrl: m.typeUrl, value: m.value } : registry.encodeAsAny(m)),
      signBytesVersion,
    };
    return (hybrid ? signHybridEth(p) : signClassicalEth(p)).txRawBytes;
  };
  const sim = await postTx("cosmos/tx/v1beta1/simulate", sign(400_000));
  const gas = Math.ceil(Number(sim.gas_info?.gas_used ?? 300_000) * 1.4);
  const res = (await postTx("cosmos/tx/v1beta1/txs", sign(gas), { mode: "BROADCAST_MODE_SYNC" })).tx_response;
  if (Number(res.code ?? 0) !== 0) throw new TxFailed(res.txhash, Number(res.code), res.raw_log ?? "");
  return waitFor(res.txhash);
}

export async function waitFor(txhash: string, timeoutMs = 60_000): Promise<TxResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${txhash}`, { cache: "no-store" });
    if (r.ok) {
      const tx = (await r.json()).tx_response;
      if (Number(tx.code ?? 0) !== 0) throw new TxFailed(txhash, Number(tx.code), tx.raw_log ?? "");
      return { txhash, height: Number(tx.height), gasUsed: Number(tx.gas_used) };
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error(`transaction ${txhash} not included after ${timeoutMs / 1000}s`);
}
