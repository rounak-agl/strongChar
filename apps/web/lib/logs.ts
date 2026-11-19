// Event history from the deploy block, in 10,000-block windows (diana's eth_getLogs cap). Results are cached per query
// in this server process, so after the first scan each refresh only reads the blocks since the last one.
import type { Abi, Address } from "viem";
import { client } from "./chain";
import { deployment } from "./deployment";

const SPAN = 10_000n;
const PARALLEL = 8;
const cache = new Map<string, { upTo: bigint; logs: any[] }>();

export function windows(lo: bigint, hi: bigint, span = SPAN): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let a = lo; a <= hi; a += span) out.push([a, a + span - 1n < hi ? a + span - 1n : hi]);
  return out;
}

export async function events(address: Address, abi: Abi, eventName: string, args?: Record<string, unknown>): Promise<any[]> {
  const key = JSON.stringify([address, eventName, args ?? {}], (_, v) => (typeof v === "bigint" ? v.toString() : v));
  const head = await client.getBlockNumber();
  const hit = cache.get(key) ?? { upTo: BigInt(deployment.deploy_block) - 1n, logs: [] };
  const ws = windows(hit.upTo + 1n, head);
  const found: any[][] = [];
  for (let i = 0; i < ws.length; i += PARALLEL) {
    found.push(...(await Promise.all(ws.slice(i, i + PARALLEL).map(([fromBlock, toBlock]) =>
      client.getContractEvents({ address, abi, eventName, args, fromBlock, toBlock } as any)))));
  }
  const next = { upTo: head, logs: [...hit.logs, ...found.flat()] };
  cache.set(key, next);
  return next.logs;
}
