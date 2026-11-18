// Root layout: fonts, the app frame with navigation, and a skip link.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "strongChar", template: "%s · strongChar" },
  description: "Your data, sealed to only the machines that need it. Every step proven.",
};

const NAV = [["/jobs", "Jobs"], ["/compete", "Competitions"], ["/nodes", "Nodes"], ["/sealed", "What the server sees"], ["/how", "How it works"]];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:bg-raised focus:px-2">Skip to content</a>
        <header className="border-b border-rule">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4" aria-label="Main">
            <Link href="/" className="font-semibold tracking-tight">strong<span className="text-seal">Char</span></Link>
            {NAV.map(([href, label]) => <Link key={href} href={href} className="text-sm text-muted hover:text-ink">{label}</Link>)}
            <span className="ml-auto rounded-sm border border-rule px-2 py-0.5 text-xs text-subtle">qorechain-diana testnet</span>
          </nav>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
