// Next.js config: strict headers on every page; the coordinator and chain RPCs are the only network origins.
import type { NextConfig } from "next";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8700";
const csp = [
  "default-src 'self'",
  // React's dev build needs eval for its debugging tools; production never does.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  // The chain's REST API sends no CORS headers, so the browser reaches it through /api/chain (same origin).
  `connect-src 'self' ${api} https://evm-testnet.qore.host`,
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    // Development only: the page runs on localhost, which the coordinator's CORS list doesn't include.
    return process.env.NODE_ENV === "development" ? [{ source: "/coord/:path*", destination: `${api}/:path*` }] : [];
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    }];
  },
};
export default config;
