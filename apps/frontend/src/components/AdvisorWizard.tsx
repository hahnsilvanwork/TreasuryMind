import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight, Check, RotateCcw, Star, Loader2, ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { api, type AdvisorResult, type AdvisorOption } from '../lib/api.js';
import type { Entity } from '@reduit/shared';
import { useAsync } from '../lib/useAsync.js';
import { money, codeOf } from '../lib/format.js';
import { emitSettlement } from '../lib/settlement.js';
import { Button, Pill, Field, TextInput, Select } from './ui.js';

const KIND_LABEL: Record<string, string> = {
  fund: 'Instant transfer', sweep: 'Agent sweep', invest: 'Invest surplus', credit_line: 'Credit line', hold: 'Hold',
};
const ease = [0.16, 1, 0.3, 1] as const;

function Bubble({ side, children }: { side: 'ai' | 'user'; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }}
      className={`flex ${side === 'user' ? 'justify-end' : 'gap-2.5'}`}>
      {side === 'ai' && <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600"><Sparkles size={14} /></span>}
      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${side === 'user' ? 'rounded-tr-sm bg-brand-500 text-white' : 'rounded-tl-sm bg-slate-50 text-slate-700'}`}>
        {children}
      </div>
    </motion.div>
  );
}

export function AdvisorWizard({ onChange }: { onChange: () => void }) {
  const { data: questions } = useAsync(() => api.advisorQuestions(), []);
  const { data: entities } = useAsync(() => api.entities(), []);
  const qs = questions ?? [];
  const subs = (entities ?? []).filter((e) => e.role !== 'HQ');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<'asking' | 'thinking' | 'done'>('asking');
  const [result, setResult] = useState<AdvisorResult | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adjust, setAdjust] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, Partial<AdvisorOption>>>({});
  const [declined, setDeclined] = useState<Record<string, boolean>>({});
  const [executed, setExecuted] = useState<Record<string, string>>({});

  const merged = (o: AdvisorOption): AdvisorOption => ({ ...o, ...edits[o.id] });
  const patch = (id: string, p: Partial<AdvisorOption>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...p } }));

  const choose = async (qid: string, opt: string) => {
    const na = { ...answers, [qid]: opt };
    setAnswers(na);
    const next = step + 1;
    setStep(next);
    if (next >= qs.length) {
      setPhase('thinking');
      try { setResult(await api.advisorRecommend(na)); } catch { /* keep null */ }
      setPhase('done');
    }
  };
  const restart = () => { setStep(0); setAnswers({}); setPhase('asking'); setResult(null); setOpen({}); setAdjust({}); setEdits({}); setDeclined({}); setExecuted({}); };
  const exec = async (o: AdvisorOption) => {
    const m = merged(o);
    setExecuted((p) => ({ ...p, [o.id]: 'running' }));
    try {
      const r = await api.advisorExecute(m);
      if (r.settlement) emitSettlement({ ...r.settlement, kind: m.kind === 'sweep' ? 'sweep' : 'transfer' });
      setExecuted((p) => ({ ...p, [o.id]: r.ok ? 'done' : `err:${r.message}` }));
      onChange();
    } catch (e) { setExecuted((p) => ({ ...p, [o.id]: `err:${(e as Error).message}` })); }
  };

  const entityOpts = (sel: string | null, onSel: (v: string) => void, includeHq: boolean) => (
    <Select value={sel ?? ''} onChange={(e) => onSel(e.target.value)}>
      {(includeHq ? (entities ?? []) : subs).map((e: Entity) => (
        <option key={e.id} value={e.id}>{codeOf(e.id)} · {e.country}</option>
      ))}
    </Select>
  );

  return (
    <div className="rounded-2xl border border-hairline bg-white shadow-card">
      <div className="flex items-center gap-2.5 border-b border-hairline bg-gradient-to-r from-brand-50/50 to-cyan-50/30 px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-brand-600 shadow-card"><Sparkles size={18} /></span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink">AI Treasury Advisor</div>
          <div className="text-[13px] text-muted">A short conversation, then concrete actions you can adjust & run.</div>
        </div>
        {phase === 'done' && <Button variant="ghost" size="sm" onClick={restart}><RotateCcw size={13} /> Restart</Button>}
      </div>

      <div className="space-y-4 p-5">
        {qs.slice(0, step).map((q) => (
          <div key={q.id} className="space-y-2">
            <Bubble side="ai">{q.question}</Bubble>
            <Bubble side="user">{answers[q.id]}</Bubble>
          </div>
        ))}

        <AnimatePresence mode="wait">
          {phase === 'asking' && step < qs.length && (
            <motion.div key={`q-${step}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2.5">
              <Bubble side="ai">{qs[step].question}</Bubble>
              <div className="flex flex-wrap gap-2 pl-9">
                {qs[step].options.map((opt) => (
                  <button key={opt} onClick={() => choose(qs[step].id, opt)}
                    className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
                    {opt}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {phase === 'thinking' && (
            <motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Bubble side="ai"><span className="inline-flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Reasoning over the live treasury state…</span></Bubble>
            </motion.div>
          )}

          {phase === 'done' && result && (
            <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              <Bubble side="ai">
                {result.summary}
                <div className="mt-1.5 text-[11px] text-muted">{result.source === 'ai' ? 'Real-AI advisor' : 'Rule-based (set AI_API_KEY for real-AI advice)'}</div>
              </Bubble>

              <div className="space-y-2.5 pl-9">
                {result.options.filter((o) => !declined[o.id]).map((raw) => {
                  const o = merged(raw);
                  const st = executed[raw.id];
                  const isOpen = open[raw.id];
                  const isAdjust = adjust[raw.id];
                  const actionable = o.kind !== 'hold';
                  const movesFunds = o.kind === 'fund' || o.kind === 'sweep';
                  return (
                    <div key={raw.id} className={`rounded-xl border p-3.5 ${raw.recommended ? 'border-brand-200 bg-brand-50/30' : 'border-hairline bg-white'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-ink">{o.title}</span>
                            {raw.recommended && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-600"><Star size={11} className="fill-brand-500 text-brand-500" /> recommended</span>}
                          </div>
                          <div className="mt-0.5 text-[13px] text-muted">
                            {KIND_LABEL[o.kind] ?? o.kind}
                            {movesFunds && <> · {codeOf(o.source_entity_id ?? 'ent_hq_ch')} → {o.entity_id ? codeOf(o.entity_id) : '—'}</>}
                            {o.amount ? ` · ${money(o.amount)}` : ''}{o.tenorDays ? ` · ${o.tenorDays}d` : ''}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {o.kind === 'hold' ? <Pill tone="slate">no action</Pill>
                            : st === 'done' ? <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-600"><Check size={14} /> done</span>
                            : st === 'running' ? <Button size="sm" disabled><Loader2 size={14} className="animate-spin" /></Button>
                            : <>
                                {actionable && <Button size="sm" variant="ghost" onClick={() => setAdjust((p) => ({ ...p, [raw.id]: !p[raw.id] }))}><SlidersHorizontal size={13} /></Button>}
                                <Button size="sm" variant="ghost" onClick={() => setDeclined((p) => ({ ...p, [raw.id]: true }))}><X size={13} /></Button>
                                <Button size="sm" variant={raw.recommended ? 'primary' : 'ghost'} onClick={() => exec(raw)}>Accept <ArrowRight size={13} /></Button>
                              </>}
                        </div>
                      </div>

                      {/* adjust panel */}
                      <AnimatePresence>
                        {isAdjust && actionable && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden">
                            <div className="mt-3 grid gap-3 rounded-lg border border-hairline bg-slate-50/60 p-3 sm:grid-cols-3">
                              {o.kind === 'fund' && <Field label="From">{entityOpts(o.source_entity_id ?? 'ent_hq_ch', (v) => patch(raw.id, { source_entity_id: v }), true)}</Field>}
                              {(movesFunds || o.kind === 'credit_line') && <Field label="To">{entityOpts(o.entity_id, (v) => patch(raw.id, { entity_id: v }), false)}</Field>}
                              <Field label="Amount (RLUSD)"><TextInput inputMode="decimal" value={o.amount ?? ''} onChange={(e) => patch(raw.id, { amount: e.target.value })} /></Field>
                              {o.kind === 'invest' && <Field label="Tenor (days)"><TextInput inputMode="numeric" value={String(o.tenorDays ?? 7)} onChange={(e) => patch(raw.id, { tenorDays: Number(e.target.value) || 0 })} /></Field>}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <button onClick={() => setOpen((p) => ({ ...p, [raw.id]: !p[raw.id] }))}
                        className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 hover:underline">
                        <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} /> {isOpen ? 'Hide reasoning' : 'Show reasoning'}
                      </button>
                      <AnimatePresence>
                        {isOpen && (
                          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden text-[13px] leading-relaxed text-slate-600">
                            <span className="mt-2 block border-l-2 border-brand-200 pl-3">{o.rationale}</span>
                          </motion.p>
                        )}
                      </AnimatePresence>
                      {st && st.startsWith('err:') && <p className="mt-2 text-[13px] text-amber-600">{st.slice(4)}</p>}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
