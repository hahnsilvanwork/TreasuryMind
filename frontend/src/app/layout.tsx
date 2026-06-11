import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TreasuryMind — Autonomous AI Treasury Agent on XRPL",
  description:
    "Real-time liquidity optimization, internal settlement and AI-assisted treasury management on XRPL.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
