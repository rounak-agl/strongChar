// Explorer links for transactions the browser account sends (the native lane uses the same explorer).
export const explorerTx = (h: string) => `https://explore.qore.network/tx/${h.startsWith("0x") ? h : `0x${h}`}`;
