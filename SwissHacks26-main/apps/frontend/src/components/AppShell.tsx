import { type ReactNode } from 'react';
import { LayoutDashboard, ArrowLeftRight, Landmark, Bot, TrendingUp, ScrollText, Network } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { ModeBadge, StatusDot } from './ui.js';
import { Logo } from './Logo.js';
import { SettlementHost } from './SettlementToast.js';

export type TabId = 'dashboard' | 'funding' | 'analyzer' | 'vault' | 'agent' | 'allocator' | 'audit' | 'country';

const NAV: { id: TabId; label: string; icon: typeof LayoutDashboard; group?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'funding', label: 'Funding', icon: ArrowLeftRight },
  { id: 'analyzer', label: 'Treasury AI', icon: Network },
  { id: 'vault', label: 'Vault & Credit', icon: Landmark },
  { id: 'agent', label: 'Agent Monitor', icon: Bot },
  { id: 'allocator', label: 'Investment Allocator', icon: TrendingUp },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
];

const TITLES: Record<TabId, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Group liquidity & settlement overview' },
  funding: { title: 'Funding', subtitle: 'Intercompany funding requests & RLUSD settlement' },
  analyzer: { title: 'Treasury AI', subtitle: 'Liquidity overview · full analysis · actionable recommendations' },
  vault: { title: 'Vault & Credit', subtitle: 'Pooled liquidity (XLS-65) & internal credit lines (XLS-66)' },
  agent: { title: 'Agent Monitor', subtitle: 'Autonomous sweeps · cash forecast · credit radar' },
  allocator: { title: 'Investment Allocator', subtitle: 'Yield on idle cash — never below the payment floor' },
  audit: { title: 'Audit Log', subtitle: 'Every action, identical shape live or simulated' },
  country: { title: 'Country', subtitle: 'Entity detail — request, send & on-chain activity' },
};

export function AppShell({ active, onTab, onHome, refreshKey, children }: { active: TabId; onTab: (t: TabId) => void; onHome: () => void; refreshKey: number; children: ReactNode }) {
  const { data: cfg } = useAsync(() => api.config(), [refreshKey]);
  const t = TITLES[active];
  const live = cfg?.paymentTestnet === 'live';

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-hairline bg-white px-3 py-4 md:flex">
        <button onClick={onHome} className="mb-6 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50">
          <Logo size={30} />
          <span>
            <span className="block text-sm font-semibold leading-tight text-slate-900">TreasuryMind</span>
            <span className="block text-[11px] leading-tight text-slate-400">XRPL treasury layer</span>
          </span>
        </button>

        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => {
            const on = active === n.id;
            return (
              <button
                key={n.id}
                onClick={() => onTab(n.id)}
                className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
                  on ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <n.icon size={17} className={on ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'} />
                {n.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto rounded-xl border border-hairline bg-slate-50/60 p-3 text-xs text-slate-500">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-slate-600">
            <StatusDot tone={live ? 'green' : 'amber'} pulse={live} /> {live ? 'Testnet armed' : 'Simulated demo'}
          </div>
          RLUSD on Testnet · XLS-65/66 on Devnet
        </div>
      </aside>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-hairline bg-white/80 px-6 py-3.5 backdrop-blur">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">{t.title}</h1>
            <p className="text-xs text-slate-500">{t.subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <ModeBadge source={live ? 'LIVE' : 'SIMULATED'} network={live ? 'testnet' : null} />
            <div className="hidden text-right sm:block">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Demo clock</div>
              <div className="text-xs font-medium text-slate-700 tnum">{cfg?.now?.slice(0, 10) ?? '—'}</div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </div>
      <SettlementHost />
    </div>
  );
}
