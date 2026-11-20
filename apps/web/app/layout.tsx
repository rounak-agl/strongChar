// Root layout: fonts, the app frame with its rail, and a skip link.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import { AppFrame } from "@/components/shell";
import { client } from "@/lib/chain";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "strongChar", template: "%s · strongChar" },
  description: "Your data, sealed to only the machines that need it. Every step proven.",
};

export const revalidate = 15;

async function latestBlock(): Promise<number | null> {
  try {
    return Number(await client.getBlockNumber());
  } catch {
    return null; // the status line shows the chain as unreachable
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const block = await latestBlock();
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:bg-raised focus:px-2">Skip to content</a>
        <AppFrame chain={{ name: "qorechain-diana", block }}>{children}</AppFrame>
      </body>
    </html>
  );
}
