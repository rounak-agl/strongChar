// The browser owner account: one recovery phrase derives the same keys the strongChar CLI derives (checked by
// scripts/interop.mjs), so the phrase works in either. Setup mirrors `strongchar-node setup`'s key steps:
// register ML-DSA-87 with proof of possession, register ML-KEM-1024, publish a signed recipient card.
import {
  buildRegisterPqcKeyMsg, deriveUnifiedAccount, generateMnemonic, msg, signProofOfPossession, validateMnemonic,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { deriveSealKeys, signRecipientCard, type SealKeyPair } from "@qorechain/qoreseal";
import { CHAIN_ID, accountNumbers, balance, kemKey, pqcStatus, submit } from "./chain";
import { Coordinator, getCard } from "./coordinator";

export type Owner = { account: UnifiedAccount; seal: SealKeyPair; coordinator: Coordinator };

const hex = (s: string) => Uint8Array.from(s.replace(/^0x/, "").match(/../g)!.map((b) => parseInt(b, 16)));
const same = (a: Uint8Array | null, b: Uint8Array) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

export const newPhrase = () => generateMnemonic(256);

export async function fromPhrase(phrase: string): Promise<Owner> {
  const words = phrase.trim().toLowerCase().split(/\s+/).join(" ");
  if (!validateMnemonic(words)) throw new Error("That isn't a valid recovery phrase.");
  const account = await deriveUnifiedAccount(words);
  return { account, seal: deriveSealKeys({ mnemonic: words }), coordinator: new Coordinator(account) };
}

export type Setup = {
  funded: boolean; uqor: bigint;
  pqc: "none" | "registered" | "proven" | "other"; kem: "none" | "ours" | "other"; card: boolean;
};

export async function status(o: Owner): Promise<Setup> {
  const qor = o.account.cosmos;
  const [nums, uqor, pq, kem, card] = await Promise.all([
    accountNumbers(qor), balance(qor).catch(() => 0n), pqcStatus(qor), kemKey(qor), getCard(o.account.evm),
  ]);
  return {
    funded: !!nums && uqor > 0n, uqor,
    pqc: !pq.publicKey ? "none" : !same(pq.publicKey, o.account.pqc.publicKey) ? "other" : pq.possessionProven ? "proven" : "registered",
    kem: !kem ? "none" : same(kem, o.seal.mlkemPublicKey) ? "ours" : "other",
    card: !!card,
  };
}

/** One-time: the ML-DSA-87 key with proof of possession. The chain accepts this one transaction signed classically. */
export async function registerPqc(o: Owner) {
  const a = o.account;
  const proofOfPossession = signProofOfPossession({ chainId: CHAIN_ID, account: a.cosmos, keypair: a.pqc });
  const m = buildRegisterPqcKeyMsg(a.cosmos, { pqcKeypair: a.pqc as any, ecdsaPubkey: hex(a.publicKey), proofOfPossession });
  return submit(a, [m as any], { hybrid: false });
}

export async function registerKem(o: Owner) {
  return submit(o.account, [msg.pqc.registerKemKey({ sender: o.account.cosmos, algorithmId: 2, publicKey: o.seal.mlkemPublicKey }) as any]);
}

/** The card carries the X25519 key for hybrid sealing, signed with both account keys and bound to the chain's ML-KEM key. */
export async function publishCard(o: Owner) {
  const a = o.account;
  const card = signRecipientCard({
    chainId: CHAIN_ID, address: a.cosmos, keys: o.seal,
    classicalKey: { type: "eth_secp256k1", privateKey: hex(a.privateKey), publicKey: hex(a.publicKey) }, pqKey: a.pqc,
  });
  await o.coordinator.putCard(JSON.stringify(card));
}
