// The only place token amounts are formatted. fUSD and BERU both use 6 decimals. Null stays null so callers render
// "not reported", never 0.
import { formatUnits } from "viem";

export const TOKEN_DECIMALS = 6;
export const TOKEN_SYMBOL = "fUSD";

export function formatToken(units: number | bigint | null | undefined, opts: { compact?: boolean; digits?: number } = {}): string | null {
  if (units === null || units === undefined) return null;
  const n = Number(formatUnits(BigInt(units), TOKEN_DECIMALS));
  if (opts.compact && Math.abs(n) >= 1000) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  }
  // Testnet amounts are small, so below 1 fUSD show enough digits to tell rounds apart.
  const d = opts.digits ?? (Math.abs(n) > 0 && Math.abs(n) < 1 ? 4 : 2);
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d }).format(n);
}
