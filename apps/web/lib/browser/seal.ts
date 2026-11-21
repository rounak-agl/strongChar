// QoreSeal for strongChar in the browser: the same purposes and AAD as packages/qore/src/strongchar_qore/seal.py,
// so an envelope sealed here opens in the Python verifiers and one sealed there opens here (checked by
// apps/web/scripts/interop.mjs against the Python code).
import { evmToQor } from "@qorechain/sdk";
import {
  envelopeFromText, envelopeToText, open, seal, verifyRecipientCard,
  type RecipientCard, type SealKeyPair, type SealRecipient,
} from "@qorechain/qoreseal";
import { keccak256, toBytes } from "viem";
import { CHAIN_ID, kemKey, pqcStatus } from "./chain";
import { getCard } from "./coordinator";

export type Kind = "shard" | "val" | "weights" | "global" | "model" | "script" | "test-features" | "test-labels";
export const purpose = (k: Kind) => `strongchar/${k}/v1`;

const cmp = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};

/** Order-independent: keccak of the sorted ML-KEM public keys of everyone the envelope is sealed to. */
export function recipientSetHash(keys: Uint8Array[]): string {
  const all = [...keys].sort(cmp);
  const joined = new Uint8Array(all.reduce((n, k) => n + k.length, 0));
  let o = 0;
  for (const k of all) { joined.set(k, o); o += k.length; }
  return keccak256(joined).slice(2);
}

/** Binds an envelope to one slot: chain, contract, job, round, item, kind and the recipient set. */
export function aad(contract: string, job: number, round: number, index: number, kind: Kind, recipientKem: Uint8Array[]): Uint8Array {
  return toBytes([CHAIN_ID, contract.toLowerCase(), String(job), String(round), String(index), kind,
    recipientSetHash(recipientKem)].join("|"));
}

export function sealTo(recipients: SealRecipient[], plaintext: Uint8Array, kind: Kind, aadBytes: Uint8Array): string {
  return envelopeToText(seal({ chainId: CHAIN_ID, purpose: purpose(kind), recipients, plaintext, aad: aadBytes, mode: "hybrid" }));
}

export function openWith(text: string, keys: SealKeyPair, kind: Kind, aadBytes: Uint8Array): Uint8Array {
  return open({ chainId: CHAIN_ID, purpose: purpose(kind), envelope: envelopeFromText(text), keys, aad: aadBytes });
}

/** Never seal to anyone without this: their card must match the ML-DSA-87 and ML-KEM-1024 keys registered on chain. */
export async function recipient(evm: string): Promise<{ recipient: SealRecipient; kem: Uint8Array; qor: string }> {
  const qor = evmToQor(evm);
  const [pq, kem, card] = await Promise.all([pqcStatus(qor), kemKey(qor), getCard(evm)]);
  if (!pq.publicKey || !pq.possessionProven) throw new Error(`${evm} has no possession-proven ML-DSA-87 key`);
  if (!kem) throw new Error(`${evm} has no registered ML-KEM-1024 key`);
  if (!card) throw new Error(`${evm} has not published a recipient card`);
  const r = verifyRecipientCard({ card: JSON.parse(card) as RecipientCard, chainId: CHAIN_ID, address: qor, pqPublicKey: pq.publicKey, mlkemPublicKey: kem });
  return { recipient: r, kem, qor };
}
