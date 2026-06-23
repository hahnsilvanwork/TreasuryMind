// XLS-65 on-chain proof panel with animated vault flow diagram.
// Shows txHash, devnet explorer link, and animated XLS-65 deposit/withdraw flow.
import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, CheckCircle2, ArrowRight, Wallet, Vault, Coins } from 'lucide-react';

export interface OnChainProof {
  txHash: string | null;
  explorerUrl: string | null;
  source: 'LIVE' | 'SIMULATED' | string;
  network: string | null;
  action: 'VaultDeposit' | 'VaultWithdraw';
  asset?: string;
  amount?: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function truncateHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

// ── flow node ─────────────────────────────────────────────────────────────────

function FlowNode({
  icon: Icon,
  label,
  sub,
  active,
  highlight,
}: {
  icon: React.ElementType;
  label: string;
  sub: string;
  active: boolean;
  highlight?: boolean;
}) {
  return (
    <motion.div
      animate={active ? { scale: [1, 1.06, 1] } : {}}
      transition={{ duration: 0.6, repeat: active ? Infinity : 0, repeatDelay: 0.8 }}
      className={`flex flex-col items-center gap-1.5 rounded-xl border px-4 py-3 transition-colors ${
        highlight
          ? 'border-brand-300 bg-brand-50'
          : active
            ? 'border-emerald-300 bg-emerald-50'
            : 'border-hairline bg-white'
      }`}
    >
      <Icon size={18} className={highlight ? 'text-brand-500' : active ? 'text-emerald-600' : 'text-slate-400'} />
      <span className="text-[11px] font-semibold text-slate-700">{label}</span>
      <span className="text-[10px] text-slate-400">{sub}</span>
    </motion.div>
  );
}

// ── animated arrow with moving dots ──────────────────────────────────────────

function AnimatedArrow({ active, reverse }: { active: boolean; reverse?: boolean }) {
  const dots = [0, 1, 2];
  return (
    <div className="relative flex flex-1 items-center justify-center">
      <div className="h-px w-full bg-slate-200" />
      <ArrowRight
        size={14}
        className={`absolute right-0 transition-colors ${active ? 'text-emerald-500' : 'text-slate-300'}`}
        style={reverse ? { transform: 'scaleX(-1)', left: 0, right: 'auto' } : {}}
      />
      <AnimatePresence>
        {active &&
          dots.map((i) => (
            <motion.span
              key={i}
              className="absolute h-2 w-2 rounded-full bg-emerald-400"
              initial={{ left: reverse ? '90%' : '5%', opacity: 0 }}
              animate={{ left: reverse ? '5%' : '90%', opacity: [0, 1, 1, 0] }}
              transition={{
                duration: 1.1,
                delay: i * 0.35,
                repeat: Infinity,
                ease: 'linear',
              }}
            />
          ))}
      </AnimatePresence>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function XLS65OnChainProof({
  proof,
  animating,
}: {
  proof: OnChainProof | null;
  animating: boolean;
}) {
  const isDeposit = !proof || proof.action === 'VaultDeposit';
  const isLive = proof?.source === 'LIVE';

  return (
    <div className="mt-5 rounded-2xl border border-hairline bg-slate-50/60 p-4">
      {/* header */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          XLS-65 On-Chain Flow · Devnet
        </span>
        {proof && isLive && (
          <motion.span
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"
          >
            <CheckCircle2 size={12} /> tesSUCCESS · validated
          </motion.span>
        )}
      </div>

      {/* flow diagram */}
      <div className="flex items-center gap-2">
        <FlowNode
          icon={Wallet}
          label="Corporate Wallet"
          sub="VAULT_WALLET_SEED_DEVNET"
          active={animating && isDeposit}
          highlight={animating && !isDeposit}
        />
        <AnimatedArrow active={animating && isDeposit} />
        <FlowNode
          icon={Vault}
          label="XLS-65 Vault"
          sub="XRPL Devnet"
          active={animating}
          highlight
        />
        <AnimatedArrow active={animating && !isDeposit} reverse />
        <FlowNode
          icon={Coins}
          label="MPT Shares"
          sub="issued to depositor"
          active={animating && isDeposit}
          highlight={animating && !isDeposit}
        />
      </div>

      {/* tx proof */}
      <AnimatePresence>
        {proof && (
          <motion.div
            key={proof.txHash ?? 'sim'}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-white px-3 py-2"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                {proof.action} · {proof.asset ?? 'XRP'}
                {proof.amount ? ` · ${proof.amount}` : ''}
              </span>
              {proof.txHash ? (
                <span className="font-mono text-xs text-slate-700">{truncateHash(proof.txHash)}</span>
              ) : (
                <span className="font-mono text-xs text-slate-400">simulated — no on-chain hash</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isLive ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  LIVE · {proof.network}
                </span>
              ) : (
                <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  SIM
                </span>
              )}
              {proof.explorerUrl && (
                <a
                  href={proof.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-600 transition hover:bg-brand-100"
                >
                  View on-chain <ExternalLink size={10} />
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* idle state hint */}
      {!proof && !animating && (
        <p className="mt-3 text-center text-[11px] text-slate-400">
          Deposit or withdraw to see the on-chain proof
        </p>
      )}
    </div>
  );
}
