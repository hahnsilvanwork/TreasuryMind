'use client';

import type { Tab } from '@/lib/types';

interface Props {
  active: Tab;
  onChange: (t: Tab) => void;
  totalRLUSD: number;
  isLive: boolean;
  deficitCount: number;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'liquidity',  label: 'Overview'  },
  { id: 'vault',      label: 'Vault'     },
  { id: 'xrpl',       label: 'XRPL'      },
  { id: 'risk',       label: 'Risk'      },
  { id: 'audit',      label: 'Audit'     },
  { id: 'suppliers',  label: 'Suppliers' },
];

function fmtTotal(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n > 0) return `$${n.toLocaleString()}`;
  return '—';
}

export function Header({ active, onChange, totalRLUSD, isLive, deficitCount }: Props) {
  return (
    <header style={{
      background: '#FFFFFF',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 20px',
      height: 46,
      flexShrink: 0,
      position: 'relative',
      zIndex: 10,
    }}>

      {/* Brand */}
      <div style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: 700,
        fontSize: 15,
        letterSpacing: '-0.01em',
        color: 'var(--text-1)',
        marginRight: 20,
        flexShrink: 0,
        userSelect: 'none',
      }}>
        Treasury<span style={{ color: 'var(--red)' }}>Mind</span>
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: 'var(--border)', marginRight: 20 }} />

      {/* Nav tabs */}
      <nav style={{ display: 'flex', gap: 0, height: '100%', alignItems: 'stretch' }}>
        {TABS.map(({ id, label }) => {
          const isActive = active === id;
          const hasAlert = id === 'liquidity' && deficitCount > 0;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={isActive ? 'nav-tab nav-tab-active' : 'nav-tab'}
              style={{
                position: 'relative',
                padding: '0 14px',
                height: '100%',
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                background: 'none',
                border: 'none',
                borderBottom: isActive
                  ? '2px solid var(--text-1)'
                  : '2px solid transparent',
                cursor: 'pointer',
                transition: 'color 0.15s, border-color 0.15s',
                fontFamily: "'Space Grotesk', sans-serif",
                whiteSpace: 'nowrap',
              }}
            >
              {label}
              {hasAlert && (
                <span style={{
                  position: 'absolute',
                  top: 9, right: 7,
                  width: 5, height: 5,
                  borderRadius: '50%',
                  background: 'var(--red)',
                }} />
              )}
            </button>
          );
        })}
      </nav>

      {/* Right */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
        {deficitCount > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '3px 8px',
            background: 'var(--red-dim)',
            border: '1px solid rgba(185,28,28,.2)',
            fontSize: 11, fontWeight: 600,
            color: 'var(--red)',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.05em',
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              background: 'var(--red)', display: 'inline-block',
            }} />
            {deficitCount} CRITICAL
          </div>
        )}

        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontWeight: 600,
          color: isLive ? 'var(--green)' : 'var(--text-3)',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'currentColor', display: 'inline-block',
          }} />
          {isLive ? 'Live · XRPL' : 'Offline'}
        </div>

        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12, fontWeight: 600,
          color: 'var(--text-1)',
        }}>
          {fmtTotal(totalRLUSD)} RLUSD
        </div>
      </div>
    </header>
  );
}
