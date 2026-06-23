// AI Treasury Advisor — asks the treasurer a few questions, then uses a real LLM (provider-agnostic,
// default Groq) to reason over the live treasury state and propose ranked, EXECUTABLE, ADJUSTABLE options.
// Each option carries source + target + amount + tenor the user can tweak before executing.
// Gracefully falls back to a deterministic rule-based engine when no AI key is set.
import type { Entity, VaultPosition } from '@reduit/shared';
import { add, sub, gte } from '@reduit/shared';
import { getRepos } from '../db/repository.js';
import { emit } from '../services/audit.js';
import { submit } from '../xrpl/submit.js';
import { complete, extractJson, aiEnabled } from '../ai/llm.js';
import { forecastAll } from './forecast.js';
import { watchlist } from './sweep.js';
import { recommend as allocatorRecommend, create as allocatorCreate } from './allocator.js';

const HQ_ID = 'ent_hq_ch';
const repos = getRepos();
const entities = () => repos.repo<Entity>('entities');
const vaultRepo = () => repos.repo<VaultPosition>('vaultPositions');

// ── questions shown to the treasurer ─────────────────────────────
export interface AdvisorQuestion {
  id: string;
  question: string;
  options: string[];
}

export function getQuestions(): AdvisorQuestion[] {
  return [
    { id: 'priority', question: 'What matters most over the next 7 days?', options: ['Protect liquidity for payments', 'Maximise yield on idle cash', 'Balance both'] },
    { id: 'risk', question: 'How aggressive should the agent be?', options: ['Conservative — keep large buffers', 'Moderate', 'Lean — deploy most surplus'] },
    { id: 'autonomy', question: 'Which actions may the agent take unattended?', options: ['Small sweeps only', 'Sweeps + auto-invest below threshold', 'Recommend only — I approve everything'] },
    { id: 'horizon', question: 'Investment horizon preference?', options: ['Short (≤7d, stay flexible)', 'Laddered (7–30d)', 'No investing right now'] },
  ];
}

// ── option model (now with an explicit source so funds can come from ANY entity, not just HQ) ──
export type OptionKind = 'fund' | 'sweep' | 'invest' | 'credit_line' | 'hold';
export interface AdvisorOption {
  id: string;
  title: string;
  kind: OptionKind;
  /** source of funds for fund/sweep — null ⇒ HQ. The user can change this in the UI. */
  source_entity_id: string | null;
  /** destination (subsidiary) for fund/sweep/credit_line. */
  entity_id: string | null;
  amount: string | null;
  tenorDays: number | null;
  rationale: string;
  recommended: boolean;
}
export interface AdvisorResult {
  summary: string;
  options: AdvisorOption[];
  source: 'ai' | 'rule-based';
}

function snapshot() {
  const ents = entities().getAll().map((e) => ({ id: e.id, country: e.country, role: e.role, balance: e.balance, buffer: e.operating_buffer }));
  const fc = forecastAll().map((f) => ({ entity: f.entity_id, projectedMin: f.projectedMin, buffer: f.buffer, belowBuffer: f.belowBuffer, shortfall: f.shortfall, surplus: f.surplus }));
  const v = vaultRepo().getById('vp_hq_001')!;
  const alloc = allocatorRecommend();
  return { entities: ents, forecast: fc, vault: { available: v.available, locked: v.locked }, allocator: { investableSurplus: alloc.investableSurplus, liquidityFloor: alloc.liquidityFloor, apr: alloc.apr } };
}

const SHAPE = `{
  "summary": string,
  "options": [
    { "id": string, "title": string,
      "kind": "fund" | "sweep" | "invest" | "credit_line" | "hold",
      "source_entity_id": string | null, "entity_id": string | null,
      "amount": string | null, "tenorDays": number | null,
      "rationale": string, "recommended": boolean }
  ]
}`;

const SYSTEM = `You are the treasury advisor for ReduitTreasuries, a governed corporate-treasury layer on XRPL.
The group is HQ Switzerland (ent_hq_ch) plus subsidiaries Brazil (ent_brz), Germany (ent_deu), Singapore (ent_sgp).
Funds can move between ANY two entities (inter-company), not only from HQ. Prefer funding a deficit from an
entity that has genuine surplus (e.g. Germany) before drawing down HQ, when that is more efficient.
You may ONLY propose actions the platform can execute:
- "fund": instant RLUSD transfer from source_entity_id (default HQ if null) to entity_id (the entity that needs cash).
- "sweep": agent tops up a subsidiary below its buffer (entity_id + amount), small/unattended; source is HQ.
- "invest": place vault surplus into the yield sleeve (amount + tenorDays); NEVER below the liquidity floor.
- "credit_line": open a 7-day internal liquidity line for a subsidiary (entity_id + amount) — requires human approval.
- "hold": do nothing now.
Reason explicitly about WHERE the money should come from and WHY. Amounts are decimal strings in RLUSD.
Propose 2–4 ranked options; mark exactly one recommended:true. Be concise and concrete. Never invest below the floor.
Reply with ONLY a JSON object (no prose, no code fences) of exactly this shape:
${SHAPE}`;

export async function advise(answers: Record<string, string>): Promise<AdvisorResult> {
  const state = snapshot();
  if (aiEnabled()) {
    try {
      const text = await complete({
        system: SYSTEM,
        json: true,
        user: `Treasurer's answers:\n${JSON.stringify(answers, null, 2)}\n\nCurrent treasury state:\n${JSON.stringify(state, null, 2)}\n\nReturn the JSON now.`,
      });
      const parsed = extractJson<{ summary: string; options: AdvisorOption[] }>(text);
      // normalise: ensure source_entity_id exists on every option
      parsed.options = (parsed.options ?? []).map((o) => ({ ...o, source_entity_id: o.source_entity_id ?? null }));
      return { ...parsed, source: 'ai' };
    } catch (e) {
      console.warn('[advisor] AI call failed, using rule-based fallback:', (e as Error).message);
    }
  }
  return { ...ruleBased(answers, state), source: 'rule-based' };
}

// deterministic fallback so the feature works without an API key
function ruleBased(answers: Record<string, string>, state: ReturnType<typeof snapshot>): { summary: string; options: AdvisorOption[] } {
  const options: AdvisorOption[] = [];
  let n = 0;
  const id = () => `opt_${++n}`;
  // pick the entity with the largest forecast surplus as a smarter funding source than HQ
  const surplusSource = [...state.forecast]
    .filter((f) => Number(f.surplus) > 0)
    .sort((a, b) => Number(b.surplus) - Number(a.surplus))[0]?.entity;
  for (const w of watchlist()) {
    if (w.status === 'deficit' && w.autoSweepEligible) options.push({ id: id(), title: `Auto-sweep ${w.shortfall} to ${w.entity_id}`, kind: 'sweep', source_entity_id: HQ_ID, entity_id: w.entity_id, amount: w.shortfall, tenorDays: null, rationale: `${w.entity_id} dips ${w.shortfall} below buffer within the horizon; top-up is below the auto threshold.`, recommended: true });
    else if (w.status === 'deficit') options.push({ id: id(), title: `Fund ${w.entity_id} (${w.shortfall})${surplusSource ? ` from ${surplusSource}` : ''}`, kind: 'fund', source_entity_id: surplusSource ?? HQ_ID, entity_id: w.entity_id, amount: w.shortfall, tenorDays: null, rationale: `${w.entity_id} needs ${w.shortfall}.${surplusSource ? ` ${surplusSource} holds surplus — fund from there before drawing HQ.` : ''}`, recommended: false });
  }
  const surplus = Number(state.allocator.investableSurplus);
  if (surplus > 0 && answers.horizon !== 'No investing right now')
    options.push({ id: id(), title: `Invest 20,000 surplus @ 7d`, kind: 'invest', source_entity_id: null, entity_id: null, amount: '20000.00', tenorDays: 7, rationale: `Investable surplus ${state.allocator.investableSurplus} above the liquidity floor; a short 7-day tranche stays flexible.`, recommended: options.length === 0 });
  options.push({ id: id(), title: 'Hold — no action', kind: 'hold', source_entity_id: null, entity_id: null, amount: null, tenorDays: null, rationale: 'Positions are within buffers; no action strictly required.', recommended: false });
  return { summary: `Rule-based plan (no AI key set). ${options.length - 1} action(s) identified from the current forecast and surplus.`, options };
}

// ── execution ────────────────────────────────────────────────────
export interface ExecuteResult {
  ok: boolean;
  message: string;
  settlement?: { fromCode: string; toCode: string; amount: string; txHash: string | null; source: string; network: string | null };
}

function codeOf(id: string): string {
  return { ent_hq_ch: 'HQ', ent_brz: 'BR', ent_deu: 'DE', ent_sgp: 'SG' }[id] ?? id;
}

export async function executeOption(opt: AdvisorOption): Promise<ExecuteResult> {
  if (opt.kind === 'hold') return { ok: true, message: 'No action taken.' };
  if (opt.kind === 'credit_line') return { ok: false, message: 'Credit lines require human approval — open the Vault & Credit tab to originate this line.' };

  if (opt.kind === 'invest') {
    if (!opt.amount) return { ok: false, message: 'No amount provided.' };
    const r = allocatorCreate(opt.amount, opt.tenorDays ?? 7, 'advisor');
    return r.ok ? { ok: true, message: `Invested ${opt.amount} for ${opt.tenorDays ?? 7}d.` } : { ok: false, message: `Blocked by policy: ${r.decision.rationale}` };
  }

  // fund or sweep → RLUSD Payment from source (any entity; default HQ) → destination
  if (!opt.entity_id || !opt.amount) return { ok: false, message: 'Missing entity or amount.' };
  const src = entities().getById(opt.source_entity_id ?? HQ_ID);
  const dest = entities().getById(opt.entity_id);
  if (!src) return { ok: false, message: 'Unknown source entity.' };
  if (!dest) return { ok: false, message: 'Unknown destination entity.' };
  if (src.id === dest.id) return { ok: false, message: 'Source and destination are the same.' };
  if (!gte(src.balance, opt.amount)) return { ok: false, message: `${codeOf(src.id)} has insufficient balance for ${opt.amount}.` };

  const tx = await submit({
    method: 'Payment', network: 'testnet',
    signer: opt.kind === 'sweep' ? 'agent' : undefined,
    sourceEntityId: src.id,
    fields: { from: src.wallet_address, to: dest.wallet_address, amount: opt.amount, currency: 'RLUSD' },
  });
  entities().update(src.id, { balance: sub(src.balance, opt.amount) });
  entities().update(dest.id, { balance: add(dest.balance, opt.amount) });
  emit({ entity_id: dest.id, action_type: opt.kind === 'sweep' ? 'AdvisorSweep' : 'AdvisorTransfer', actor: 'AdvisorAgent', detail: { amount: opt.amount, optionId: opt.id, from: src.id, to: dest.id, explorerUrl: tx.explorerUrl }, policy_decision: null, tx_hash: tx.txHash, source: tx.source, network: tx.network });
  return { ok: true, message: `Settled ${opt.amount} ${codeOf(src.id)} → ${codeOf(dest.id)}.`, settlement: { fromCode: codeOf(src.id), toCode: codeOf(dest.id), amount: opt.amount, txHash: tx.txHash, source: tx.source, network: tx.network } };
}
