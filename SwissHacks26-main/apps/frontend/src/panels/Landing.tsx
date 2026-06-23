import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { CountUp } from '../components/ui.js';
import { Logo } from '../components/Logo.js';
import { LedgerNetwork } from '../components/LedgerNetwork.js';

const ease = [0.16, 1, 0.3, 1] as const;

export function Landing({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="noise relative min-h-screen overflow-hidden bg-canvas">
      {/* single restrained accent glow */}
      <div className="pointer-events-none absolute right-[-10%] top-[-15%] h-[40rem] w-[40rem] rounded-full bg-gradient-to-br from-brand-200/40 to-cyan-200/20 blur-[120px]" />

      {/* top bar */}
      <div className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <Logo size={30} />
          <span className="text-sm font-semibold tracking-tight text-ink">TreasuryMind</span>
        </div>
        <span className="hidden text-xs font-medium text-muted sm:block">Built on XRPL · SwissHacks Zurich 2026</span>
      </div>

      {/* hero */}
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
        {/* left: copy */}
        <div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}
            className="inline-flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1 text-xs font-medium text-muted shadow-card">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> Live RLUSD settlement on Testnet
          </motion.div>

          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.06, ease }}
            className="mt-6 text-5xl font-semibold leading-[1.04] tracking-[-0.02em] text-ink sm:text-[3.5rem]">
            Move money between entities in{' '}
            <span className="relative whitespace-nowrap">
              seconds
              <span className="absolute -bottom-1 left-0 h-[3px] w-full rounded-full bg-gradient-to-r from-brand-500 to-cyan-400" />
            </span>
            <br />— not banking days.
          </motion.h1>

          <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.14, ease }}
            className="mt-6 max-w-md text-lg leading-relaxed text-muted">
            A governed corporate-treasury layer on XRPL. HQ funds subsidiaries instantly in RLUSD, pools idle
            liquidity, extends internal credit, and lets policy-bound agents act on-chain — every move audited.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.22, ease }}
            className="mt-8 flex items-center gap-4">
            <button onClick={onEnter} className="group inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-black">
              Enter dashboard <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </button>
            <div className="text-sm text-muted">
              <span className="font-medium text-ink">3</span> subsidiaries ·{' '}
              <span className="font-medium text-ink">2</span> ledgers
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.34 }}
            className="mt-12 flex items-center gap-5 text-xs font-medium text-muted">
            <span>Payments &amp; FX</span><span className="h-1 w-1 rounded-full bg-hairline" />
            <span>Credit &amp; Lending</span><span className="h-1 w-1 rounded-full bg-hairline" />
            <span>Agent Infrastructure</span>
          </motion.div>
        </div>

        {/* right: live network */}
        <motion.div initial={{ opacity: 0, scale: 0.97, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1, ease }}
          className="relative rounded-3xl border border-hairline bg-white p-5 shadow-card">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-sm font-medium text-ink">
              <span className="relative flex h-2 w-2"><span className="absolute h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="h-2 w-2 rounded-full bg-emerald-500" /></span>
              Live settlement network
            </div>
            <span className="text-xs font-medium text-muted">RLUSD · Testnet</span>
          </div>
          <div className="aspect-[44/30] w-full">
            <LedgerNetwork investedAmount="190k" />
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-hairline pt-4">
            <div>
              <div className="text-2xl font-semibold tracking-tight text-ink"><CountUp value={247} /></div>
              <div className="text-xs text-muted">settled today</div>
            </div>
            <div>
              <div className="text-2xl font-semibold tracking-tight text-ink">&lt;<CountUp value={30} />s</div>
              <div className="text-xs text-muted">avg settlement</div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
