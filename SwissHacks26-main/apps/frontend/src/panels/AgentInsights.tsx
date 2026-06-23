import { useState } from 'react';
import { api, type SweepResult } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import { Card, Section, Button, Pill, ScoreDot, ExplainabilityCard, ModeBadge, FadeUp, Stagger, StaggerItem } from '../components/ui.js';
import { ForecastChart } from '../components/charts.js';
import { codeOf } from '../lib/format.js';
import { emitSettlement } from '../lib/settlement.js';
import { Play, Clock, Zap } from 'lucide-react';

export function AgentInsights({ refreshKey, onChange }: { refreshKey: number; onChange: () => void }) {
  const [localKey, setLocalKey] = useState(0);
  const reload = () => { setLocalKey((k) => k + 1); onChange(); };
  const { data: forecast } = useAsync(() => api.forecast(), [refreshKey, localKey]);
  const { data: radar } = useAsync(() => api.radar(), [refreshKey, localKey]);
  const { data: recs } = useAsync(() => api.recommendations(), [refreshKey, localKey]);
  const [sweeps, setSweeps] = useState<SweepResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState('ent_brz');

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); reload(); } catch (e) { alert((e as Error).message); } finally { setBusy(false); } };
  const runSweep = async () => {
    setBusy(true);
    try {
      const res = await api.runSweep();
      setSweeps(res);
      res.filter((s) => s.outcome === 'EXECUTED').forEach((s) =>
        emitSettlement({ fromCode: 'HQ', toCode: codeOf(s.entity_id), amount: s.amount, txHash: s.txHash, source: s.source, network: s.txHash ? 'testnet' : null, kind: 'sweep' }),
      );
      reload();
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };
  const selFc = forecast?.find((f) => f.entity_id === sel);

  return (
    <>
      <Section title="Autonomous agent sweep" subtitle="Observe → policy-check → act on-chain, with no human click">
        <FadeUp>
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-gradient-to-r from-brand-50/60 to-cyan-50/30 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-brand-600 shadow-card"><Zap size={18} /></span>
                <div className="text-sm text-slate-600">When a watched entity dips below its buffer and the top-up is ≤ the per-action cap, the agent fires a real RLUSD payment — signed by its own regular key.</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => run(() => api.advanceClock(86400))}><Clock size={15} /> Advance +1d</Button>
                <Button disabled={busy} onClick={runSweep}><Play size={15} /> Run autonomous sweep</Button>
              </div>
            </div>
            {sweeps && (
              <div className="space-y-2 px-5 py-4">
                {sweeps.length === 0 && <p className="text-sm text-slate-500">No breach below threshold — nothing fired.</p>}
                {sweeps.map((s) => (
                  <div key={s.entity_id} className="flex items-center gap-3 text-sm">
                    <Pill tone={s.outcome === 'EXECUTED' ? 'green' : 'amber'}>{s.outcome}</Pill>
                    <span className="font-medium text-slate-800">{s.entity_id}</span>
                    <span className="text-slate-600">{money(s.amount)}</span>
                    {s.txHash && <span className="font-mono text-xs text-slate-400">{s.txHash}</span>}
                    <ModeBadge source={s.source} network={s.txHash ? 'testnet' : null} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </FadeUp>
      </Section>

      <Section title="Cash forecast" subtitle="7-day projected balance vs operating buffer">
        <Card className="p-5">
          <div className="mb-3 flex gap-1.5">
            {(forecast ?? []).map((f) => (
              <button key={f.entity_id} onClick={() => setSel(f.entity_id)} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${sel === f.entity_id ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50'}`}>
                {f.entity_id.replace('ent_', '').toUpperCase()}
              </button>
            ))}
          </div>
          {selFc && <ForecastChart data={selFc.timeline} buffer={selFc.buffer} />}
          {selFc && (
            <div className="mt-2 flex gap-6 text-sm">
              <span className="text-slate-500">Projected min <span className="font-medium text-slate-900">{money(selFc.projectedMin)}</span></span>
              <span className="text-slate-500">Buffer <span className="font-medium text-slate-900">{money(selFc.buffer)}</span></span>
              {selFc.belowBuffer ? <Pill tone="red">Funding gap {money(selFc.shortfall)}</Pill> : Number(selFc.surplus) > 0 ? <Pill tone="green">Headroom {money(selFc.surplus)}</Pill> : <Pill tone="slate">On buffer</Pill>}
            </div>
          )}
        </Card>
      </Section>

      <Section title="Supply-chain credit radar" subtitle="Rule-based 0–4 early-warning score with explainable inputs">
        <Stagger className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {(radar ?? []).map((r) => (
            <StaggerItem key={r.entity_id}>
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{r.entity_id.replace('ent_', '').toUpperCase()}</span>
                  <ScoreDot score={r.projected_cash_stress_score} />
                </div>
                <ul className="mt-3 space-y-1 text-xs text-slate-500">
                  {Object.entries(r.inputs).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-2"><span className="text-slate-400">{k}</span><span className="text-right text-slate-600">{String(v).split(' ')[0]}</span></li>
                  ))}
                </ul>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      </Section>

      <Section title="Recommendations">
        <div className="space-y-3">
          {(recs ?? []).map((r) => (
            <FadeUp key={r.id}>
              <div>
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
                  <Pill tone={r.requires_approval ? 'amber' : 'green'}>{r.recommended_action}</Pill>
                  <span className="font-medium text-slate-800">{r.entity_id.replace('ent_', '').toUpperCase()}</span>
                  {Number(r.amount) > 0 && <span className="text-slate-600">{money(r.amount)}</span>}
                  <span className="text-xs text-slate-400">· {r.agent_module}</span>
                  {r.requires_approval ? <Pill tone="amber">approval required</Pill> : <Pill tone="green">auto</Pill>}
                </div>
                <ExplainabilityCard text={r.rationale} />
              </div>
            </FadeUp>
          ))}
          {(recs ?? []).length === 0 && <p className="text-sm text-slate-400">No recommendations.</p>}
        </div>
      </Section>
    </>
  );
}
