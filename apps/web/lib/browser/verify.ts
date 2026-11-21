// Re-check a settlement from this browser, without trusting strongChar's servers: read the finalizeRound transaction,
// rebuild the exact bytes the verifiers signed, look up each verifier's ML-DSA-87 key in the chain's key registry and
// ask the pqcVerify precompile, the same one JobMarket called. Then flip one byte and ask again: it must say no.
import { pqcKeyStatus, pqcVerify } from "@qorechain/evm";
import { createPublicClient, decodeFunctionData, http, type Address, type Hex } from "viem";
import { deployment, jobMarketAbi } from "@/lib/deployment";
import { diana } from "@/lib/evm-chain";

const evm = createPublicClient({ chain: diana, transport: http() });
const MARKET = deployment.job_market as Address;

export type SignatureCheck = { verifier: Address; keyBytes: number; sigBytes: number; valid: boolean; tamperedRejected: boolean };
export type SettlementCheck = { round: number; messageBytes: number; checks: SignatureCheck[] };

const size = (h: Hex) => (h.length - 2) / 2;
const flipLastByte = (h: Hex) => `${h.slice(0, -2)}${(parseInt(h.slice(-2), 16) ^ 0x01).toString(16).padStart(2, "0")}` as Hex;

export async function checkSettlement(tx: Hex): Promise<SettlementCheck> {
  const { input } = await evm.getTransaction({ hash: tx });
  const call = decodeFunctionData({ abi: jobMarketAbi, data: input });
  if (call.functionName !== "finalizeRound") throw new Error(`${tx} is not a finalizeRound call`);
  const [jobId, roundId, st, expiry, sigA, sigB] = call.args;
  const message = await evm.readContract({ address: MARKET, abi: jobMarketAbi, functionName: "settlementMessage", args: [jobId, roundId, st, expiry] });
  const [a, b] = await Promise.all([
    evm.readContract({ address: MARKET, abi: jobMarketAbi, functionName: "verifierA" }),
    evm.readContract({ address: MARKET, abi: jobMarketAbi, functionName: "verifierB" }),
  ]);
  const checks = await Promise.all(([[a, sigA], [b, sigB]] as [Address, Hex][]).map(async ([verifier, signature]) => {
    const key = await pqcKeyStatus(evm, verifier);
    if (!key.registered) throw new Error(`${verifier} has no ML-DSA-87 key in the registry`);
    const [valid, tampered] = await Promise.all([
      pqcVerify(evm, { pubkey: key.pubkey, signature, message }),
      pqcVerify(evm, { pubkey: key.pubkey, signature, message: flipLastByte(message) }),
    ]);
    return { verifier, keyBytes: size(key.pubkey), sigBytes: size(signature), valid, tamperedRejected: !tampered };
  }));
  return { round: Number(roundId), messageBytes: size(message), checks };
}
