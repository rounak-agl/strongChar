// The browser account on diana's EVM lane: fUSD where contracts can pull it, a scoped EVM window opened with the
// account's hybrid-signed native transaction, and EVM transactions sent inside that window.
import { evmWindowCost, evmWindowStatus } from "@qorechain/evm";
import { closeEvmWindowMsg, msg, openEvmWindowMsg } from "@qorechain/sdk";
import { createPublicClient, createWalletClient, erc20Abi, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deployment } from "@/lib/deployment";
import { diana } from "@/lib/evm-chain";
import type { Owner } from "./account";
import { REST, balance, submit } from "./chain";

export const FUSD = deployment.fusd as Hex;
const FUSD_DENOM = `erc20:${deployment.fusd}`;
const POOL_FUSD_QOR = "2";
export const evm = createPublicClient({ chain: diana, transport: http() });
/** Twice the current base fee: read once per job or entry, then both the window size and every transaction use it. */
export const maxFee = async () => (await evm.getBlock()).baseFeePerGas! * 2n;

export type Progress = (step: string, detail?: string) => void;

// MsgConvertCoin{coin{denom, amount}, receiver 0x, sender qor1}: the SDK has no composer, so encode it as Python does.
function varint(n: number): number[] { const o: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; }
const field = (num: number, payload: Uint8Array) => new Uint8Array([...varint((num << 3) | 2), ...varint(payload.length), ...payload]);
const utf8 = (s: string) => new TextEncoder().encode(s);
function convertCoin(amount: bigint, receiverEvm: string, senderQor: string) {
  const coin = new Uint8Array([...field(1, utf8(FUSD_DENOM)), ...field(2, utf8(amount.toString()))]);
  return { typeUrl: "/cosmos.evm.erc20.v1.MsgConvertCoin", value: new Uint8Array([...field(1, coin), ...field(2, utf8(receiverEvm)), ...field(3, utf8(senderQor))]) };
}

async function bankBalance(qor: string, denom: string) { return balance(qor, denom); }

/** fUSD where a contract can pull it: swap QOR in native AMM pool 2 if short, then convert the bank coin to the ERC-20. */
export async function ensureFusd(o: Owner, need: bigint, log: Progress): Promise<void> {
  const a = o.account;
  const erc = await evm.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [a.evm as Hex] });
  const have = erc + (await bankBalance(a.cosmos, FUSD_DENOM));
  if (have < need) {
    const { pools } = await (await fetch(`${REST}/qorechain/amm/v1/pools`)).json() as { pools: { id: string; reserve_a: string; reserve_b: string }[] };
    const pool = pools.find((p) => p.id === POOL_FUSD_QOR)!;
    const ra = BigInt(pool.reserve_a), rb = BigInt(pool.reserve_b); // a = fUSD, b = uqor
    const want = (need - have) * 12n / 10n;
    const amountIn = rb * want / (ra - want) * 10_000n / 9_960n + 1n;
    log("Swapping QOR for fUSD", `${(Number(amountIn) / 1e6).toFixed(4)} QOR in AMM pool ${POOL_FUSD_QOR}`);
    await submit(a, [msg.amm.swapExactIn({ sender: a.cosmos, poolId: POOL_FUSD_QOR, tokenIn: { denom: "uqor", amount: amountIn.toString() }, denomOut: FUSD_DENOM, minOut: (need - have).toString() }) as any]);
  }
  const bank = await bankBalance(a.cosmos, FUSD_DENOM);
  if (bank > 0n) {
    log("Converting fUSD to the ERC-20 the contract uses");
    await submit(a, [convertCoin(bank, a.evm, a.cosmos) as any]);
  }
}

/** Opens a window scoped to `targets` only, sized for `txs` transactions of `gas` each, unless a fitting one is open. */
export async function ensureWindow(o: Owner, targets: Hex[], txs: number, gas: bigint, fee: bigint, log: Progress, why: string): Promise<void> {
  const a = o.account;
  const need = BigInt(txs) * evmWindowCost({ gas, maxFeePerGas: fee });
  const w = await evmWindowStatus({ rest: `${location.origin}${REST}`, address: a.cosmos });
  const want = targets.map((t) => t.toLowerCase());
  const have = new Set((w.allowedTargets ?? []).map((t) => t.toLowerCase()));
  if (w.live && want.every((t) => have.has(t)) && w.remainingTxs >= BigInt(txs) && w.remainingValue >= need && w.remainingBlocks >= 120n) return;
  if (w.live) await submit(a, [closeEvmWindowMsg(a.cosmos) as any]);
  log("Opening an EVM window", why);
  await submit(a, [openEvmWindowMsg({ sender: a.cosmos, blocks: 3_000, maxTxs: txs, maxValue: (need > 2_000_000n ? need : 2_000_000n).toString(), allowedTargets: targets }) as any]);
}

export async function estimate(o: Owner, to: Hex, data: Hex): Promise<bigint> {
  const gas = await evm.estimateGas({ account: o.account.evm as Hex, to, data });
  return gas * 125n / 100n + 20_000n;
}

export async function sendEvm(o: Owner, to: Hex, data: Hex, gas: bigint, fee: bigint): Promise<Hex> {
  const account = privateKeyToAccount(o.account.privateKey as Hex);
  const wallet = createWalletClient({ account, chain: diana, transport: http() });
  const nonce = await evm.getTransactionCount({ address: account.address, blockTag: "pending" }); // read after the window opened
  const hash = await wallet.sendTransaction({ to, data, gas, nonce, maxFeePerGas: fee, maxPriorityFeePerGas: 0n });
  const r = await evm.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  return hash;
}

/** Close the window when done, so the secp256k1 key alone can't spend on the EVM lane. */
export const closeWindow = (o: Owner) => submit(o.account, [closeEvmWindowMsg(o.account.cosmos) as any]);
