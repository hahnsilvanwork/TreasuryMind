import { useState } from 'react';
import { Sparkles, ArrowRight, Network, ChevronRight, RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import type { CountryPrefill } from '../App.js';
import { useAsync } from '../lib/useAsync.js';
import { money, codeOf } from '../lib/format.js';
import { Card, Section, Button, Pill, CountUp, Stat } from '../components/ui.js';
import { COUNTRY } from '../components/Logo.js';
import { AdvisorWizard } from '../components/AdvisorWizard.js';

const URGENCY: Record<string, 'red' | 'amber' | 'slate'> = { high: 'red', medium: 'amber', low: 'slate' };

export function Analyzer({ refreshKey, openCountry }: { refreshKey: number; openCountry: (id: string, prefill?: CountryPrefill) => void }) {
  const [showAdvisor, setShowAdvisor] = useState(false);
  const [localKey, setLocalKey] = useState(0);
  const reload = () => setLocalKey((k) => k + 1);
  const { data, error } = useAsync(() => api.analyzer(), [refreshKey, localKey]);
  const { data: cfg } = useAsync(() => api.config(), [refreshKey]);

  if (error) return <p className="text-red-500">Backend unreachable: {error}</p>;
  if (!data) return <p className="text-muted">Analyzing group liquidity…</p>;

  const aiLabel = data.source === 'ai'
    ? `AI · ${cfg?.ai.provider ?? 'llm'}${cfg?.ai.model ? ` (${cfg.ai.model})` : ''}`
    : 'Rule-based (set AI_API_KEY for an AI narrative)';

  return (
    <>
      {/* narrative + totals + analysis CTA */}
      <Card className="mb-6 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Sparkles size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink">Treasury AI — Liquidity overview</div>
            <p className="mt-1 text-sm leading-relaxed text-slate-700">{data.narrative}</p>
            <div className="mt-1.5 text-[11px] text-muted">{aiLabel}</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-hairline pt-4 sm:grid-cols-4">
          <Stat label="Group cash" value={<><CountUp value={Number(data.totals.groupBalance)} /></>} sub="RLUSD across all entities" />
          <Stat label="Vault available" value={<><CountUp value={Number(data.totals.vaultAvailable)} /></>} sub="pooled liquidity" />
          <Stat label="Total gap" value={money(data.totals.totalDeficit)} sub="below buffers" />
          <Stat label="Total surplus" value={money(data.totals.totalSurplus)} sub="above buffers" />
        </div>
        <div className="mt-4 border-t border-hairline pt-4 flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted">Want a full analysis with actionable recommendations? I'll ask you 4 quick questions.</p>
          {!showAdvisor
            ? <Button onClick={() => setShowAdvisor(true)}><Sparkles size={14} /> Start full analysis <ChevronRight size={14} /></Button>
            : <Button variant="ghost" size="sm" onClick={() => { setShowAdvisor(false); reload(); }}><RotateCcw size={13} /> Close advisor</Button>
          }
        </div>
      </Card>

      {showAdvisor && (
        <div className="mb-8">
          <AdvisorWizard onChange={reload} />
        </div>
      )}

      {/* positions */}
      <Section title="Where the money sits" subtitle="Per-entity position vs operating buffer">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {data.positions.map((p) => {
            const c = COUNTRY[p.country] ?? { name: p.country, bar: 'bg-slate-400', text: 'text-slate-600' };
            return (
              <Card key={p.entity_id} hover className="cursor-pointer overflow-hidden p-0" onClick={() => openCountry(p.entity_id)}>
                <div className="flex">
                  <div className={`w-1 shrink-0 ${c.bar}`} />
                  <div className="flex-1 p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">{c.name}</span>
                      <span className={`text-[13px] font-medium ${c.text}`}>{p.country}</span>
                    </div>
                    <div className="mt-2 text-xl font-semibold tracking-tight text-ink"><CountUp value={Number(p.balance)} /> <span className="text-sm font-normal text-muted">RLUSD</span></div>
                    <div className="text-[12px] text-muted">buffer {money(p.buffer)} · min {money(p.projectedMin)}</div>
                    <div className="mt-2">
                      {p.status === 'deficit' ? <Pill tone="red">Gap {money(p.shortfall)}</Pill> : p.status === 'surplus' ? <Pill tone="green">Surplus {money(p.surplus)}</Pill> : <Pill tone="slate">On buffer</Pill>}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* suggestions */}
      <Section title="Proposed redistribution" subtitle="Smart inter-company moves — fund deficits from surplus before drawing HQ">
        <Card className="divide-y divide-hairline">
          {data.suggestions.length === 0 && <div className="p-5 text-[13px] text-muted">All entities are within buffer — no redistribution needed.</div>}
          {data.suggestions.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-ink">
                  <Network size={14} className="text-brand-600" />
                  {codeOf(s.from_entity_id)} <ArrowRight size={13} className="text-muted" /> {codeOf(s.to_entity_id)}
                  <span className="text-muted">· {money(s.amount)}</span>
                  <Pill tone={URGENCY[s.urgency]}>{s.urgency}</Pill>
                </div>
                <div className="mt-0.5 text-[13px] text-muted">{s.rationale}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => openCountry(s.from_entity_id, { toEntityId: s.to_entity_id, amount: s.amount })}>
                Open &amp; send <ArrowRight size={13} />
              </Button>
            </div>
          ))}
        </Card>
      </Section>
    </>
  );
}
