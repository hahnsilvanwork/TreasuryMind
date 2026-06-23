import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import { Card, Section, Pill, CountUp, Stagger, StaggerItem, StatusDot } from '../components/ui.js';
import { Sparkline } from '../components/charts.js';
import { LedgerNetwork } from '../components/LedgerNetwork.js';
import { COUNTRY } from '../components/Logo.js';
import { Zap, Coins } from 'lucide-react';

export function Dashboard({ refreshKey, openCountry }: { refreshKey: number; openCountry: (entityId: string) => void }) {
  const { data, error } = useAsync(() => api.dashboard(), [refreshKey]);
  const { data: forecast } = useAsync(() => api.forecast(), [refreshKey]);
  const { data: vault } = useAsync(() => api.vault(), [refreshKey]);
  const { data: investments } = useAsync(() => api.investments(), [refreshKey]);

  if (error) return <p className="text-red-500">Backend unreachable: {error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;

  const speedup = Math.round((data.kpi.bankBaselineHours * 3600) / data.kpi.xrplTargetSeconds);
  const invested = (investments ?? []).filter((p) => p.status !== 'Redeemed').reduce((a, p) => a + Number(p.principal), 0);
  const investedLabel = invested >= 1000 ? `${Math.round(invested / 1000)}k` : `${invested}`;
  const fc = (id: string) => forecast?.find((f) => f.entity_id === id);

  return (
    <>
      {/* bento overview */}
      <div className="mb-10 grid gap-4 lg:grid-cols-4 lg:grid-rows-2">
        <Card className="flex flex-col p-5 lg:col-span-2 lg:row-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-ink"><StatusDot tone="green" pulse /> Live settlement network</div>
            <span className="text-xs font-medium text-muted">RLUSD · Testnet</span>
          </div>
          <div className="my-2 min-h-[220px] flex-1"><LedgerNetwork live investedAmount={investedLabel} /></div>
          <div className="grid grid-cols-3 gap-3 border-t border-hairline pt-4">
            <div><div className="text-xl font-semibold tracking-tight text-ink"><CountUp value={247} /></div><div className="text-xs text-muted">settled today</div></div>
            <div><div className="text-xl font-semibold tracking-tight text-ink">&lt;<CountUp value={30} />s</div><div className="text-xs text-muted">avg settlement</div></div>
            <div><div className="text-xl font-semibold tracking-tight text-ink"><CountUp value={100} />%</div><div className="text-xs text-muted">policy-checked</div></div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-brand-600"><Zap size={17} /><span className="text-sm font-medium text-muted">Settlement speed</span></div>
          <div className="mt-3 text-3xl font-semibold tracking-tight text-ink">{data.kpi.bankBaselineHours}h→&lt;{data.kpi.xrplTargetSeconds}s</div>
          <div className="mt-1 text-xs text-muted">~<CountUp value={speedup} />× faster than bank rails</div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-brand-600"><Coins size={17} /><span className="text-sm font-medium text-muted">Pricing</span></div>
          <div className="mt-3 text-3xl font-semibold tracking-tight text-ink">CHF&nbsp;<CountUp value={data.business.saas_fee_chf_month} /></div>
          <div className="mt-1 text-xs text-muted">/mo + {data.business.tx_fee_bps} bps on volume</div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted">Pooled liquidity (XLS-65 vault)</span>
            <Pill tone="blue">available</Pill>
          </div>
          <div className="mt-3 text-3xl font-semibold tracking-tight text-ink"><CountUp value={vault ? Number(vault.available) : 0} /> <span className="text-base font-normal text-muted">RLUSD</span></div>
          <div className="mt-1 text-xs text-muted">shared by internal credit lines and the investment allocator</div>
        </Card>
      </div>

      {/* entities */}
      <Section title="Group entities" subtitle="Click a country to open its detail view — request, send & on-chain activity">
        <Stagger className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {data.entities.map((e) => {
            const f = fc(e.id);
            const below = f?.belowBuffer;
            const headroom = f && Number(f.surplus) > 0;
            const spark = f?.timeline.map((t) => Number(t.balance)) ?? [Number(e.balance)];
            const c = COUNTRY[e.country] ?? { name: e.country, bar: 'bg-slate-400', text: 'text-slate-600' };
            return (
              <StaggerItem key={e.id}>
                <Card hover className="cursor-pointer overflow-hidden p-0" onClick={() => openCountry(e.id)}>
                  <div className="flex">
                    <div className={`w-1 shrink-0 ${c.bar}`} />
                    <div className="flex-1 p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className={`fi fi-${e.country.toLowerCase()} rounded-[3px] shadow-sm`} style={{ fontSize: '20px' }} />
                          <div className="leading-tight">
                            <div className="font-medium text-ink">{c.name}</div>
                            <div className="text-[13px] text-muted">{e.role}</div>
                          </div>
                        </div>
                        <span className={`text-[13px] font-medium ${c.text}`}>{e.country}</span>
                      </div>
                      <div className="mt-3 text-2xl font-semibold tracking-tight text-ink"><CountUp value={Number(e.balance)} /> <span className="text-sm font-normal text-muted">RLUSD</span></div>
                      <div className="text-[13px] text-muted">buffer {money(e.operating_buffer)}</div>
                      <div className="mt-2 -mb-1"><Sparkline data={spark} tone={below ? 'red' : 'brand'} /></div>
                      <div className="mt-2">
                        {below ? <Pill tone="red">Funding gap {money(f!.shortfall)}</Pill> : headroom ? <Pill tone="green">Headroom {money(f!.surplus)}</Pill> : <Pill tone="slate">On buffer</Pill>}
                      </div>
                    </div>
                  </div>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      </Section>
    </>
  );
}
