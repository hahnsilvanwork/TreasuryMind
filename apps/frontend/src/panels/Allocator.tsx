import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, type AdvisorOption, type AdvisorResult } from '../lib/api.js';
import { money, codeOf } from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import { Card, Section, Button, Pill, ExplainabilityCard, ModeBadge, FadeUp, CountUp } from '../components/ui.js';
import { ShieldCheck, TrendingUp, Check, Sparkles, ArrowRight, Star, Loader2, RotateCcw, ChevronRight } from 'lucide-react';
import { emitSettlement } from '../lib/settlement.js';

const INVEST_QS = [
  { id: 'horizon', q: 'Investment horizon preference?', opts: ['Short term (≤7 days)', 'Medium term (7–30 days)', 'Flexible — no preference'] },
  { id: 'risk', q: 'Risk appetite for yield?', opts: ['Conservative — preserve capital', 'Moderate — balanced yield', 'Aggressive — maximize yield'] },
  { id: 'autonomy', q: 'Which actions may run automatically?', opts: ['Auto-invest below threshold', 'Recommend only — I approve all', 'Sweeps + auto-invest'] },
  { id: 'priority', q: 'Main priority right now?', opts: ['Maximise yield on idle cash', 'Protect liquidity for payments', 'Balance both'] },
];

export function Allocator({ refreshKey, onChange }: { refreshKey: number; onChange: () => void }) {
  const [localKey, setLocalKey] = useState(0);
  const reload = () => { setLocalKey((k) => k + 1); onChange(); };
  const { data: rec } = useAsync(() => api.allocatorRecommend(), [refreshKey, localKey]);
  const { data: positions } = useAsync(() => api.investments(), [refreshKey, localKey]);
  const { data: entities } = useAsync(() => api.entities(), [refreshKey, localKey]);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  // Investment AI state
  const [aiPhase, setAiPhase] = useState<'idle' | 'questions' | 'thinking' | 'results'>('idle');
  const [aiStep, setAiStep] = useState(0);
  const [aiAnswers, setAiAnswers] = useState<Record<string, string>>({});
  const [aiResult, setAiResult] = useState<AdvisorResult | null>(null);
  const [aiExecuted, setAiExecuted] = useState<Record<string, string>>({});

  const aiChoose = async (qid: string, opt: string) => {
    const na = { ...aiAnswers, [qid]: opt };
    setAiAnswers(na);
    const next = aiStep + 1;
    setAiStep(next);
    if (next >= INVEST_QS.length) {
      setAiPhase('thinking');
      try {
        const res = await api.advisorRecommend(na);
        setAiResult({ ...res, options: res.options.filter((o) => o.kind === 'invest' || o.kind === 'hold') });
      } catch { setAiResult(null); }
      setAiPhase('results');
    }
  };
  const aiExec = async (o: AdvisorOption) => {
    setAiExecuted((p) => ({ ...p, [o.id]: 'running' }));
    try {
      const r = await api.advisorExecute(o);
      if (r.settlement) emitSettlement({ ...r.settlement, kind: 'transfer' });
      setAiExecuted((p) => ({ ...p, [o.id]: r.ok ? 'done' : `err:${r.message}` }));
      reload();
    } catch (e) { setAiExecuted((p) => ({ ...p, [o.id]: `err:${(e as Error).message}` })); }
  };
  const aiReset = () => { setAiPhase('idle'); setAiStep(0); setAiAnswers({}); setAiResult(null); setAiExecuted({}); };

  const invest = async (amount: string, tenorDays: number, needsApproval: boolean) => {
    setBusy(true);
    try { await api.invest(amount, tenorDays, needsApproval ? 'group_treasurer' : undefined); reload(); }
    catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };
  const tryBlocked = async () => {
    setBusy(true);
    try { await api.invest(rec!.blockedExample.amount, 7); setBlocked('Unexpected: not blocked.'); }
    catch (e) { setBlocked((e as { body?: { decision?: { rationale?: string } } }).body?.decision?.rationale ?? 'Blocked — would breach the payment floor.'); }
    finally { setBusy(false); }
  };

  const available = rec ? Number(rec.available) : 1;
  const floorN = rec ? Number(rec.liquidityFloor) : 0;
  const investN = rec ? Number(rec.investableSurplus) : 0;
  const floorPct = Math.round((floorN / available) * 100);
  const total = investN || 1;

  return (
    <>
      {/* ── AI Investment Advisor ─────────────────────────────────── */}
      <Section title="AI Investment Advisor" subtitle="Tell me your preferences — I'll suggest where and how long to invest">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-3 border-b border-hairline bg-gradient-to-r from-brand-50/50 to-cyan-50/30 px-5 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-brand-600 shadow-card"><Sparkles size={18} /></span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-ink">Investment AI</div>
              <div className="text-[13px] text-muted">
                {aiPhase === 'idle' && `${entities?.length ?? 0} entities · investable surplus ${rec ? money(rec.investableSurplus) : '…'} · ~${rec ? (rec.apr * 100).toFixed(1) : '—'}% APR`}
                {aiPhase === 'questions' && `Question ${aiStep + 1} of ${INVEST_QS.length}`}
                {aiPhase === 'thinking' && 'Analyzing treasury state…'}
                {aiPhase === 'results' && (aiResult ? `${aiResult.options.length} investment option(s) · ${aiResult.source === 'ai' ? 'AI-powered' : 'rule-based'}` : 'Analysis complete')}
              </div>
            </div>
            {aiPhase === 'idle' && <Button onClick={() => setAiPhase('questions')}><Sparkles size={14} /> Ask AI <ChevronRight size={14} /></Button>}
            {aiPhase !== 'idle' && <Button variant="ghost" size="sm" onClick={aiReset}><RotateCcw size={13} /> Reset</Button>}
          </div>

          <AnimatePresence mode="wait">
            {aiPhase === 'idle' && entities && (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-2 gap-px bg-hairline sm:grid-cols-4">
                {entities.map((e) => (
                  <div key={e.id} className="bg-white px-4 py-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{e.country}</div>
                    <div className="mt-0.5 text-sm font-semibold text-ink"><CountUp value={Number(e.balance)} /></div>
                    <div className="text-[11px] text-muted">buffer {money(e.operating_buffer)}</div>
                  </div>
                ))}
              </motion.div>
            )}

            {aiPhase === 'questions' && aiStep < INVEST_QS.length && (
              <motion.div key={`q${aiStep}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="p-5 space-y-4">
                <p className="text-sm font-medium text-ink">{INVEST_QS[aiStep].q}</p>
                <div className="flex flex-wrap gap-2">
                  {INVEST_QS[aiStep].opts.map((opt) => (
                    <button key={opt} onClick={() => aiChoose(INVEST_QS[aiStep].id, opt)}
                      className="rounded-lg border border-hairline bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
                      {opt}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {aiPhase === 'thinking' && (
              <motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-3 p-5 text-sm text-muted">
                <Loader2 size={16} className="animate-spin text-brand-600" /> Reasoning over live treasury state…
              </motion.div>
            )}

            {aiPhase === 'results' && aiResult && (
              <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="divide-y divide-hairline">
                {aiResult.options.length === 0 && <p className="p-5 text-sm text-muted">No investment actions recommended right now.</p>}
                {aiResult.options.map((o) => {
                  const st = aiExecuted[o.id];
                  return (
                    <div key={o.id} className={`px-5 py-4 ${o.recommended ? 'bg-brand-50/30' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                            {o.recommended && <Star size={13} className="fill-brand-500 text-brand-500 shrink-0" />}
                            {o.title}
                          </div>
                          <div className="mt-0.5 text-[13px] text-muted">
                            {o.kind === 'invest' && o.amount && <>{money(o.amount)}{o.tenorDays ? ` · ${o.tenorDays}d` : ''}</>}
                            {o.kind === 'hold' && 'No action'}
                          </div>
                          <p className="mt-1 text-[12px] text-slate-500 leading-relaxed">{o.rationale}</p>
                        </div>
                        <div className="shrink-0">
                          {o.kind === 'hold' ? <Pill tone="slate">Hold</Pill>
                            : st === 'done' ? <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-600"><Check size={14} /> Done</span>
                            : st === 'running' ? <Button size="sm" disabled><Loader2 size={14} className="animate-spin" /></Button>
                            : <Button size="sm" variant={o.recommended ? 'primary' : 'ghost'} onClick={() => aiExec(o)}>Invest <ArrowRight size={13} /></Button>}
                        </div>
                      </div>
                      {st?.startsWith('err:') && <p className="mt-2 text-[13px] text-amber-600">{st.slice(4)}</p>}
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </Section>

      {/* ── Manual Allocator ────────────────────────────────────────── */}
      <Section title="Investment Allocator" subtitle="Earn yield on idle cash — never below the payment-liquidity floor" action={<ModeBadge source="SIMULATED" />}>
        {rec && (
          <FadeUp>
            {/* liquidity composition */}
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-ink">Vault available · <CountUp value={available} /> RLUSD</span>
                <span className="text-[13px] text-muted">~{(rec.apr * 100).toFixed(1)}% APR on surplus</span>
              </div>
              <div className="flex h-9 w-full overflow-hidden rounded-lg">
                <div className="flex items-center justify-center bg-slate-200 text-[12px] font-medium text-slate-600" style={{ width: `${floorPct}%` }}>
                  {floorPct > 14 && 'Payment floor'}
                </div>
                <div className="flex items-center justify-center bg-gradient-to-r from-brand-500 to-cyan-400 text-[12px] font-medium text-white" style={{ width: `${100 - floorPct}%` }}>
                  Investable
                </div>
              </div>
              <div className="mt-2 flex justify-between text-[13px]">
                <span className="text-muted">Reserved for payments <span className="font-medium text-ink">{money(rec.liquidityFloor)}</span></span>
                <span className="text-muted">Investable surplus <span className="font-medium text-emerald-600">{money(rec.investableSurplus)}</span></span>
              </div>
            </Card>

            <div className="mt-4"><ExplainabilityCard text={rec.card} /></div>

            {/* maturity ladder */}
            <Card className="mt-4 p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink"><TrendingUp size={16} className="text-brand-600" /> Maturity ladder</div>
              <div className="space-y-3">
                {rec.tranches.map((t, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <div className="w-20 shrink-0 text-sm font-medium text-ink">{t.tenorDays}d <span className="text-[11px] font-normal text-muted">· {t.maturesAt.slice(5, 10)}</span></div>
                    <div className="relative h-9 flex-1 overflow-hidden rounded-lg bg-slate-100">
                      <div className="flex h-full items-center rounded-lg bg-gradient-to-r from-brand-500 to-cyan-400 px-3 text-[12px] font-medium text-white" style={{ width: `${Math.max(14, (Number(t.amount) / total) * 100)}%` }}>
                        {money(t.amount)}
                      </div>
                    </div>
                    <span className="w-24 text-right text-[13px] text-muted">+{money(t.expectedYield)}</span>
                    <Pill tone={t.tier === 'AUTO' ? 'green' : 'amber'}>{t.tier === 'AUTO' ? 'Auto' : 'Approval'}</Pill>
                    <Button size="sm" variant={t.tier === 'AUTO' ? 'primary' : 'ghost'} disabled={busy} onClick={() => invest(t.amount, t.tenorDays, t.tier !== 'AUTO')}>Invest</Button>
                  </div>
                ))}
              </div>
            </Card>

            {/* floor protection — subtle, not a red block */}
            <Card className="mt-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><ShieldCheck size={18} /></span>
                  <div>
                    <div className="text-sm font-medium text-ink">Liquidity-floor protection</div>
                    <div className="text-[13px] text-muted">The agent can never invest below the payment floor — not even with approval. Try it:</div>
                  </div>
                </div>
                <Button variant="ghost" disabled={busy} onClick={tryBlocked}>Attempt {money(rec.blockedExample.amount)}</Button>
              </div>
              {blocked && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 text-[13px] text-emerald-700">
                  <Check size={15} className="mt-0.5 shrink-0" /> <span><span className="font-medium">Protected.</span> {blocked}</span>
                </div>
              )}
            </Card>
          </FadeUp>
        )}
      </Section>

      <Section title="Open positions">
        <Card className="overflow-hidden">
          {(positions ?? []).length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">No investments yet — place a tranche above to start earning.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">ID</th><th className="font-medium">Principal</th><th className="font-medium">APR</th><th className="font-medium">Matures</th><th className="font-medium">Status</th><th className="font-medium">Exp. yield</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(positions ?? []).map((p) => (
                  <tr key={p.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50/50">
                    <td className="px-5 py-3 font-mono text-xs text-muted">{p.id}</td>
                    <td className="tnum font-medium text-ink">{money(p.principal)}</td>
                    <td className="text-slate-600">{(p.apr * 100).toFixed(1)}%</td>
                    <td className="text-xs text-muted">{p.maturesAt.slice(0, 10)}</td>
                    <td><Pill tone={p.status === 'Redeemed' ? 'slate' : 'green'}>{p.status}</Pill></td>
                    <td className="tnum text-slate-600">{money(p.expectedYield)}</td>
                    <td className="py-3 pr-5 text-right">{p.status !== 'Redeemed' && <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { await api.redeem(p.id); reload(); }}>Redeem</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </Section>
    </>
  );
}
