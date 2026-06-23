import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ExternalLink, X } from 'lucide-react';
import { onSettlement, type SettlementEvent } from '../lib/settlement.js';
import { explorerLink } from '../lib/format.js';
import { EntityTag } from './Logo.js';
import { CountUp, ModeBadge } from './ui.js';

function Toast({ e, onClose }: { e: SettlementEvent; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [onClose]);
  const link = explorerLink(e.network, e.txHash);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="w-[360px] overflow-hidden rounded-2xl border border-hairline bg-white shadow-glow"
    >
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><Check size={13} /></span>
          {e.kind === 'sweep' ? 'Agent sweep settled' : 'Settlement complete'}
        </div>
        <button onClick={onClose} className="text-muted hover:text-ink"><X size={15} /></button>
      </div>

      <div className="px-4 py-4">
        {/* flow track with traveling coin */}
        <div className="flex items-center gap-3">
          <EntityTag code={e.fromCode} />
          <div className="relative h-0.5 flex-1 rounded-full bg-hairline">
            <motion.div
              className="absolute -top-[5px] h-3 w-3 rounded-full bg-gradient-to-br from-brand-500 to-cyan-400 shadow-[0_0_10px_rgba(10,108,245,0.6)]"
              initial={{ left: '0%' }}
              animate={{ left: '100%' }}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
              style={{ x: '-50%' }}
            />
            <motion.div
              className="absolute top-0 h-0.5 rounded-full bg-gradient-to-r from-brand-500 to-cyan-400"
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <EntityTag code={e.toCode} />
        </div>

        <div className="mt-4 flex items-end justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-tight text-ink">
              <CountUp value={Number(e.amount)} /> <span className="text-sm font-normal text-muted">RLUSD</span>
            </div>
            <div className="mt-0.5 text-xs text-muted">{e.fromCode} → {e.toCode}</div>
          </div>
          <ModeBadge source={e.source} network={e.network} />
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2.5 text-xs">
          {e.txHash ? (
            link ? (
              <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-brand-600 hover:underline">{e.txHash.slice(0, 14)}… <ExternalLink size={11} /></a>
            ) : <span className="font-mono text-muted">{e.txHash.slice(0, 16)}…</span>
          ) : <span className="text-muted">recorded in audit trail</span>}
          <span className="text-muted">policy ✓</span>
        </div>
      </div>
    </motion.div>
  );
}

export function SettlementHost() {
  const [items, setItems] = useState<SettlementEvent[]>([]);
  useEffect(() => onSettlement((e) => setItems((prev) => [...prev, e].slice(-3))), []);
  const remove = (id: string) => setItems((prev) => prev.filter((x) => x.id !== id));

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {items.map((e) => (
          <div key={e.id} className="pointer-events-auto">
            <Toast e={e} onClose={() => remove(e.id)} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
