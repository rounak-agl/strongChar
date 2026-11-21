// QoreX funds the browser account. A page can't make QoreX sign arbitrary messages or EVM transactions yet, but it can
// ask it to send a QoreChain transaction: here, one MsgSend of QOR from the wallet to the browser account.
import { getQorexNative, hasCapability, qorexSignAndBroadcast } from "@qorechain/qorex-types";
import { qorechainRegistry } from "@qorechain/sdk";
import { CHAIN_ID } from "./chain";

const registry = qorechainRegistry();

export const qorexReady = () => hasCapability(getQorexNative(), "signAndBroadcast");

export async function qorexAddress(): Promise<string> {
  const native = getQorexNative();
  if (!native) throw new Error("QoreX isn't installed in this browser.");
  const key = await native.getKey(CHAIN_ID);
  return key.bech32Address;
}

/** Ask QoreX to send `uqor` to the browser account. The user approves it in QoreX. */
export async function fundFromQorex(to: string, uqor: bigint): Promise<string> {
  const from = await qorexAddress();
  const value = registry.encode({
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: { fromAddress: from, toAddress: to, amount: [{ denom: "uqor", amount: uqor.toString() }] },
  });
  const r = await qorexSignAndBroadcast({
    chainId: CHAIN_ID, memo: "fund strongChar browser account",
    messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value }],
  });
  if (r.code !== 0) throw new Error(`QoreX transfer failed with code ${r.code}`);
  return r.txHash;
}
