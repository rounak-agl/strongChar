// Relay to the chain's REST API, which sends no CORS headers. It forwards public reads and transactions the browser
// has already signed; it never sees a key. Only the paths the browser account needs are allowed.
import type { NextRequest } from "next/server";

const REST = "https://api-testnet.qore.host";
const HEADERS = { "user-agent": "strongchar-web/0.1", accept: "application/json" };

const GET_ALLOWED = [
  /^cosmos\/auth\/v1beta1\/accounts\/qor1[0-9a-z]{38}$/,
  /^cosmos\/bank\/v1beta1\/balances\/qor1[0-9a-z]{38}$/,
  /^cosmos\/tx\/v1beta1\/txs\/[0-9A-Fa-f]{64}$/,
  /^qorechain\/pqc\/v1\/(account|kem|evm_window)\/qor1[0-9a-z]{38}$/,
  /^qorechain\/[a-z0-9_]+\/v1\/(params|protocol_features|features)$/,
  /^cosmos\/upgrade\/v1beta1\/(applied_plan\/[a-z0-9._-]+|current_plan)$/,
  /^cosmos\/base\/tendermint\/v1beta1\/blocks\/latest$/,
  /^qorechain\/amm\/v1\/pools$/,
];
const POST_ALLOWED = new Set(["cosmos/tx/v1beta1/simulate", "cosmos/tx/v1beta1/txs"]);
const MAX_BODY = 256 * 1024;

async function relay(path: string, init: RequestInit): Promise<Response> {
  try {
    const r = await fetch(`${REST}/${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ message: "chain REST unreachable" }, { status: 502 });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  if (!GET_ALLOWED.some((re) => re.test(path))) return Response.json({ message: "path not relayed" }, { status: 404 });
  return relay(path + req.nextUrl.search, { headers: HEADERS });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  if (!POST_ALLOWED.has(path)) return Response.json({ message: "path not relayed" }, { status: 404 });
  const body = await req.text();
  if (body.length > MAX_BODY) return Response.json({ message: "transaction too large" }, { status: 413 });
  try {
    const parsed = JSON.parse(body) as { tx_bytes?: unknown; mode?: unknown };
    if (typeof parsed.tx_bytes !== "string") throw new Error();
  } catch {
    return Response.json({ message: "expected {tx_bytes, mode}" }, { status: 400 });
  }
  return relay(path, { method: "POST", body, headers: { ...HEADERS, "content-type": "application/json" } });
}
