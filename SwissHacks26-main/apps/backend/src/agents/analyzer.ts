// Liquidity Analyzer AI (AI #2) — maps WHERE the group's money sits, structures it, and proposes how it
// SHOULD be distributed (which entity needs cash, which has surplus, smart inter-company moves). Deterministic
// aggregation + greedy donor/deficit matching; an LLM adds a plain-language narrative when a key is set.
// The structured numbers are always deterministic; only the narrative uses the LLM (or a template fallback).
import type { Entity, VaultPosition } from '@reduit/shared';
import { getRepos } from '../db/repository.js';
import { forecastAll } from './forecast.js';
import { complete, aiEnabled } from '../ai/llm.js';

const repos = getRepos();
const entities = () => repos.repo<Entity>('entities');
const vaultRepo = () => repos.repo<VaultPosition>('vaultPositions');

export interface Position {
  entity_id: string;
  country: string;
  role: string;
  balance: string;
  buffer: string;
  projectedMin: string;
  status: 'deficit' | 'surplus' | 'ok';
  shortfall: string; // amount below buffer (0 if none)
  surplus: string; // amount above buffer that is genuinely spare (0 if none)
}

export interface Totals {
  groupBalance: string;
  vaultAvailable: string;
  vaultLocked: string;
  totalDeficit: string;
  totalSurplus: string;
}

export interface Overview {
  positions: Position[];
  totals: Totals;
  generatedAt: string;
}

export interface Suggestion {
  from_entity_id: string;
  to_entity_id: string;
  amount: string;
  urgency: 'low' | 'medium' | 'high';
  rationale: string;
}

export interface AnalyzerResult extends Overview {
  suggestions: Suggestion[];
  narrative: string;
  source: 'ai' | 'rule-based';
}

const f2 = (n: number) => (n < 0 ? 0 : n).toFixed(2);

export function overview(): Overview {
  const fc = new Map(forecastAll().map((f) => [f.entity_id, f]));
  const positions: Position[] = entities().getAll().map((e) => {
    const f = fc.get(e.id);
    const shortfall = f ? f.shortfall : '0.00';
    const surplus = f ? f.surplus : '0.00';
    const status: Position['status'] = f?.belowBuffer ? 'deficit' : Number(surplus) > 0 ? 'surplus' : 'ok';
    return {
      entity_id: e.id, country: e.country, role: e.role, balance: e.balance, buffer: e.operating_buffer,
      projectedMin: f ? f.projectedMin : e.balance, status, shortfall, surplus,
    };
  });
  const v = vaultRepo().getById('vp_hq_001');
  const groupBalance = positions.reduce((a, p) => a + Number(p.balance), 0);
  const totalDeficit = positions.reduce((a, p) => a + Number(p.shortfall), 0);
  const totalSurplus = positions.reduce((a, p) => a + Number(p.surplus), 0);
  return {
    positions,
    totals: {
      groupBalance: f2(groupBalance),
      vaultAvailable: v?.available ?? '0.00',
      vaultLocked: v?.locked ?? '0.00',
      totalDeficit: f2(totalDeficit),
      totalSurplus: f2(totalSurplus),
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Greedy: cover each deficit from genuine surplus first (largest donor first), HQ as fallback donor. */
function planRedistribution(positions: Position[]): Suggestion[] {
  const suggestions: Suggestion[] = [];
  // subsidiary surplus first (largest donor first) — HQ is the central reserve, used only as fallback
  const donors = positions
    .filter((p) => p.role !== 'HQ' && Number(p.surplus) > 0)
    .map((p) => ({ id: p.entity_id, cap: Number(p.surplus), isHq: false }))
    .sort((a, b) => b.cap - a.cap);
  const hq = positions.find((p) => p.role === 'HQ');
  if (hq) donors.push({ id: hq.entity_id, cap: Math.max(0, Number(hq.balance) - Number(hq.buffer)), isHq: true });

  const deficits = positions
    .filter((p) => p.status === 'deficit' && Number(p.shortfall) > 0)
    .sort((a, b) => Number(b.shortfall) - Number(a.shortfall));

  for (const d of deficits) {
    let need = Number(d.shortfall);
    const urgency: Suggestion['urgency'] = need > 100_000 ? 'high' : need > 25_000 ? 'medium' : 'low';
    for (const donor of donors) {
      if (need <= 0) break;
      if (donor.cap <= 0 || donor.id === d.entity_id) continue;
      const take = Math.min(need, donor.cap);
      suggestions.push({
        from_entity_id: donor.id, to_entity_id: d.entity_id, amount: f2(take), urgency,
        rationale: donor.isHq
          ? `${d.entity_id} is projected ${d.shortfall} below buffer; HQ funds the gap (no subsidiary surplus left).`
          : `${donor.id} holds spare surplus while ${d.entity_id} is ${d.shortfall} below buffer — fund inter-company before drawing HQ.`,
      });
      donor.cap -= take;
      need -= take;
    }
  }
  return suggestions;
}

async function narrate(o: Overview, suggestions: Suggestion[]): Promise<{ narrative: string; source: 'ai' | 'rule-based' }> {
  if (aiEnabled()) {
    try {
      const text = await complete({
        system:
          'You are a corporate treasury liquidity analyst. In 2–4 short sentences, summarise where the group cash sits, ' +
          'which entity is at risk, and whether the proposed inter-company moves are sensible. Plain language, no JSON, no lists.',
        user: `Overview:\n${JSON.stringify(o, null, 2)}\n\nProposed moves:\n${JSON.stringify(suggestions, null, 2)}`,
        maxTokens: 400,
      });
      return { narrative: text.trim(), source: 'ai' };
    } catch (e) {
      console.warn('[analyzer] AI narrative failed, using template:', (e as Error).message);
    }
  }
  const atRisk = o.positions.filter((p) => p.status === 'deficit').map((p) => p.entity_id);
  const template =
    atRisk.length === 0
      ? `All ${o.positions.length} entities are at or above their operating buffer. Group cash is ${o.totals.groupBalance} RLUSD; vault available ${o.totals.vaultAvailable}. No redistribution needed right now.`
      : `${atRisk.join(', ')} ${atRisk.length === 1 ? 'is' : 'are'} projected below buffer (total gap ${o.totals.totalDeficit}). ${suggestions.length} inter-company move(s) proposed, funding from surplus entities before drawing HQ. Group cash ${o.totals.groupBalance} RLUSD.`;
  return { narrative: template, source: 'rule-based' };
}

export function suggestions(): Suggestion[] {
  return planRedistribution(overview().positions);
}

export async function analyze(): Promise<AnalyzerResult> {
  const o = overview();
  const sugg = planRedistribution(o.positions);
  const { narrative, source } = await narrate(o, sugg);
  return { ...o, suggestions: sugg, narrative, source };
}
