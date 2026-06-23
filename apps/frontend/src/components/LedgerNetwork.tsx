// Live ledger network — HQ hub + subsidiaries with slow ambient RLUSD pulses on each HQ edge, plus a
// React-driven flow layer that animates a settlement between ANY two nodes (incl. subsidiary↔subsidiary,
// e.g. Germany → Brazil). A real settlement fires a green token travelling along the from→to line.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { onSettlement } from '../lib/settlement.js';

const SANS = 'Geist Variable, ui-sans-serif, sans-serif';

const NODES: Record<string, { x: number; y: number }> = {
  HQ: { x: 220, y: 78 },
  BR: { x: 86, y: 248 },
  DE: { x: 220, y: 266 },
  SG: { x: 356, y: 248 },
};
const LEAVES = [
  { id: 'br', code: 'BR', edge: 'M220,78 Q150,158 86,248', delay: '0s' },
  { id: 'de', code: 'DE', edge: 'M220,78 Q236,170 220,266', delay: '1.6s' },
  { id: 'sg', code: 'SG', edge: 'M220,78 Q294,158 356,248', delay: '3.2s' },
];
const PEERS = ['M104,254 Q150,282 200,266', 'M240,266 Q292,282 338,254', 'M96,260 Q221,334 346,260'];
const INV = { x: 366, y: 70 };
const INV_EDGE = 'M242,74 L348,70';

interface Flow { id: number; x1: number; y1: number; x2: number; y2: number }

export function LedgerNetwork({ live = false, investedAmount }: { live?: boolean; investedAmount?: string }) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    return onSettlement((e) => {
      const a = NODES[e.fromCode];
      const b = NODES[e.toCode];
      if (!a || !b) return;
      const id = ++seq.current;
      setFlows((f) => [...f, { id, x1: a.x, y1: a.y, x2: b.x, y2: b.y }]);
      setTimeout(() => setFlows((f) => f.filter((x) => x.id !== id)), 1800);
    });
  }, []);

  return (
    <svg viewBox="0 0 440 300" className="h-full w-full" role="img" aria-label={live ? 'Live settlement network' : 'Settlement network'}>
      <defs>
        <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a6cf5" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.22" />
        </linearGradient>
        <radialGradient id="hub" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#138ae6" />
          <stop offset="100%" stopColor="#0a47a8" />
        </radialGradient>
        <radialGradient id="inv" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#059669" />
        </radialGradient>
        <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>

      {/* peer links */}
      {PEERS.map((d, i) => (
        <path key={`peer-${i}`} d={d} fill="none" stroke="#c7cdd6" strokeWidth="1" strokeDasharray="3 4" strokeLinecap="round" />
      ))}
      <path d={INV_EDGE} fill="none" stroke="#34d399" strokeWidth="1.2" strokeDasharray="2 4" strokeLinecap="round" strokeOpacity="0.7" />

      {/* HQ → subsidiary edges */}
      {LEAVES.map((e) => (
        <path key={e.id} d={e.edge} fill="none" stroke="url(#edge)" strokeWidth="1.6" strokeLinecap="round" />
      ))}

      {/* slow ambient pulses on HQ edges */}
      {LEAVES.map((e) => (
        <circle key={`p-${e.id}`} r="4" fill="#22d3ee">
          <animateMotion dur="4.8s" begin={e.delay} repeatCount="indefinite" path={e.edge} calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.4 0 0.2 1" />
          <animate attributeName="opacity" values="0;0.9;0.9;0" keyTimes="0;0.12;0.85;1" dur="4.8s" begin={e.delay} repeatCount="indefinite" />
        </circle>
      ))}

      {/* dynamic settlement flows between ANY two nodes (real transactions) */}
      <AnimatePresence>
        {flows.map((f) => (
          <g key={f.id}>
            <motion.line
              x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2}
              stroke="#10b981" strokeWidth="2" strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0.7 }} animate={{ pathLength: 1, opacity: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
            />
            <motion.circle
              r="6" fill="#10b981"
              initial={{ cx: f.x1, cy: f.y1, opacity: 0 }}
              animate={{ cx: f.x2, cy: f.y2, opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.6, ease: [0.3, 0, 0.2, 1] }}
            />
          </g>
        ))}
      </AnimatePresence>

      {/* leaf nodes */}
      {LEAVES.map((e) => {
        const n = NODES[e.code];
        return (
          <g key={`n-${e.id}`}>
            <circle cx={n.x} cy={n.y} r="16" fill="#fff" stroke="#ebe7e1" />
            <circle cx={n.x} cy={n.y} r="16" fill="none" stroke="#0a6cf5" strokeOpacity="0.18" />
            <text x={n.x} y={n.y + 3.5} textAnchor="middle" fontSize="10" fontWeight="600" fill="#0a47a8" fontFamily={SANS}>{e.code}</text>
          </g>
        );
      })}

      {/* Investments node */}
      <g>
        <rect x={INV.x - 15} y={INV.y - 15} width="30" height="30" rx="9" fill="url(#inv)" />
        <rect x={INV.x - 15} y={INV.y - 15} width="30" height="30" rx="9" fill="none" stroke="#34d399" strokeOpacity="0.5" strokeDasharray="2 3" />
        <text x={INV.x} y={INV.y + 3.5} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily={SANS}>%</text>
        <text x={INV.x} y={INV.y + 28} textAnchor="middle" fontSize="9" fill="#6b6961" fontFamily={SANS}>Invested {investedAmount ?? '—'}</text>
      </g>

      {/* HQ hub */}
      <circle cx={NODES.HQ.x} cy={NODES.HQ.y} r="30" fill="#22d3ee" opacity="0.16" filter="url(#soft)" />
      <circle cx={NODES.HQ.x} cy={NODES.HQ.y} r="22" fill="url(#hub)" />
      <circle cx={NODES.HQ.x} cy={NODES.HQ.y} r="22" fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeOpacity="0.5">
        <animate attributeName="r" values="22;31;22" dur="5s" repeatCount="indefinite" />
        <animate attributeName="stroke-opacity" values="0.45;0;0.45" dur="5s" repeatCount="indefinite" />
      </circle>
      <text x={NODES.HQ.x} y={NODES.HQ.y - 1} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily={SANS}>HQ</text>
      <text x={NODES.HQ.x} y={NODES.HQ.y + 11} textAnchor="middle" fontSize="8" fill="#cfe6ff" fontFamily={SANS}>CH</text>
    </svg>
  );
}
