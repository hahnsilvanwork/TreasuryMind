'use client';

import type { Subsidiary } from '@/lib/types';

interface Props {
  subsidiaries: Record<string, Subsidiary>;
  vaultCapacity?: number;
  executingFrom?: string | null;
  executingTo?: string | null;
  isExecuting?: boolean;
}

/* Fixed node centres — match reference layout */
const CENTRES: Record<string, [number, number]> = {
  brazil:    [320,  95],
  zurich:    [100, 305],
  singapore: [540, 305],
};
const VAULT_C: [number, number] = [320, 405];
const NW = 170, NH = 84, HW = 85, HH = 42, VH = 56;

function getC(id: string, idx = 0): [number, number] {
  return CENTRES[id.toLowerCase()] ?? [100 + idx * 220, 305];
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (abs >= 1e6) return `${s}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${s}$${(abs / 1e3).toFixed(0)}K`;
  return `${s}$${abs.toLocaleString()}`;
}

export function NetworkGraph({ subsidiaries, vaultCapacity = 10, executingFrom, executingTo, isExecuting }: Props) {
  const entries = Object.entries(subsidiaries);
  const fp = executingFrom ? getC(executingFrom) : null;
  const tp = executingTo   ? getC(executingTo)   : null;

  type Edge = { x1:number; y1:number; x2:number; y2:number; active?:boolean; dash?:boolean };
  const edges: Edge[] = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA] = entries[i];
      const [idB] = entries[j];
      const [ax, ay] = getC(idA, i);
      const [bx, by] = getC(idB, j);
      const active = !!(executingFrom && executingTo && (
        (idA.toLowerCase() === executingFrom.toLowerCase() && idB.toLowerCase() === executingTo.toLowerCase()) ||
        (idB.toLowerCase() === executingFrom.toLowerCase() && idA.toLowerCase() === executingTo.toLowerCase())
      ));
      edges.push({ x1: ax, y1: ay, x2: bx, y2: by, active });
    }
  }
  entries.forEach(([id], i) => {
    const [x, y] = getC(id, i);
    edges.push({ x1: x, y1: y, x2: VAULT_C[0], y2: VAULT_C[1], dash: true });
  });

  return (
    <svg viewBox="0 0 640 465" style={{ width: '100%', maxWidth: 700, display: 'block', overflow: 'visible', margin: '0 auto' }}>
      <defs>
        <marker id="arrowG" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#15803D" opacity="0.8" />
        </marker>
      </defs>

      {edges.map((e, i) => (
        <line key={i}
          x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          stroke={e.active ? '#15803D' : '#BFB6A4'}
          strokeWidth={e.active ? 2 : 1.25}
          strokeDasharray={e.dash ? '5,4' : e.active ? '10,6' : undefined}
          strokeOpacity={e.active ? 1 : 0.7}
          style={e.active ? { animation: 'dashFlow 1.4s linear infinite', strokeDashoffset: 0 } as React.CSSProperties : {}}
          markerEnd={e.active ? 'url(#arrowG)' : undefined}
        />
      ))}

      {isExecuting && fp && tp && (
        <circle r="5" fill="#15803D" opacity="0.9">
          <animate attributeName="cx" from={fp[0]} to={tp[0]} dur="2s" repeatCount="indefinite"
            calcMode="spline" keySplines="0.42 0 0.58 1" keyTimes="0;1" />
          <animate attributeName="cy" from={fp[1]} to={tp[1]} dur="2s" repeatCount="indefinite"
            calcMode="spline" keySplines="0.42 0 0.58 1" keyTimes="0;1" />
        </circle>
      )}

      {entries.map(([id, sub], i) => {
        const [cx, cy] = getC(id, i);
        const rx = cx - HW, ry = cy - HH;
        const isDeficit = sub.status === 'deficit';
        return (
          <g key={id}>
            <rect x={rx} y={ry} width={NW} height={NH} rx={3}
              fill="white" stroke={isDeficit ? 'transparent' : '#C8BFA8'} strokeWidth={1} />
            {isDeficit && (
              <rect x={rx} y={ry} width={NW} height={NH} rx={3}
                fill="none" stroke="#B91C1C" strokeWidth={2}
                style={{ animation: 'deficitPulse 2s ease-in-out infinite' } as React.CSSProperties} />
            )}
            <text x={cx} y={ry + 18} textAnchor="middle" fontSize={11} fontWeight={600}
              fill="#62665C" letterSpacing="0.08em" fontFamily="'Space Grotesk', sans-serif">
              {sub.name.toUpperCase()}
            </text>
            <text x={cx} y={ry + 31} textAnchor="middle" fontSize={10} fill="#62665C"
              fontFamily="'Space Grotesk', sans-serif">
              {id.charAt(0).toUpperCase() + id.slice(1)} · RLUSD
            </text>
            <text x={cx} y={ry + 55} textAnchor="middle" fontSize={18} fontWeight={600}
              fill={isDeficit ? '#B91C1C' : '#111010'} fontFamily="'JetBrains Mono', monospace">
              {fmt(sub.rlusd_balance)}
            </text>
            <rect x={cx - 34} y={ry + 63} width={68} height={17} rx={2}
              fill={isDeficit ? '#FEF2F2' : '#F5F2EC'} />
            <text x={cx} y={ry + 74} textAnchor="middle" fontSize={10} fontWeight={600}
              fill={isDeficit ? '#B91C1C' : '#62665C'} letterSpacing="0.06em"
              fontFamily="'Space Grotesk', sans-serif">
              {sub.status.toUpperCase()}
            </text>
          </g>
        );
      })}

      <g>
        <rect x={VAULT_C[0] - HW} y={VAULT_C[1] - VH / 2} width={NW} height={VH} rx={3}
          fill="white" stroke="#C8BFA8" strokeWidth={1} strokeDasharray="5,3" />
        <text x={VAULT_C[0]} y={VAULT_C[1] - 8} textAnchor="middle" fontSize={11} fontWeight={600}
          fill="#62665C" letterSpacing="0.08em" fontFamily="'Space Grotesk', sans-serif">
          CORP. VAULT
        </text>
        <text x={VAULT_C[0]} y={VAULT_C[1] + 10} textAnchor="middle" fontSize={11} fontWeight={500}
          fill="#92400E" letterSpacing="0.04em" fontFamily="'Space Grotesk', sans-serif">
          VAULT · {vaultCapacity}% filled · 4.2% APY
        </text>
      </g>
    </svg>
  );
}
