// AG2 — Supply-chain credit radar. Rule-based 0–4 early-warning score with explainable inputs.
// Deterministic: low-projected-cash comes from the forecast; the other three signals come from a
// fixed per-entity stress profile so the demo always renders the same explainable score.
import type { CreditRadarSignal } from '@reduit/shared';
import { lt } from '@reduit/shared';
import { getRepos } from '../db/repository.js';
import { now } from '../lib/clock.js';
import { nextId } from '../lib/ids.js';
import { forecastEntity } from './forecast.js';
import type { Entity } from '@reduit/shared';

// fixed stress profile (the 3 non-cash signals), each contributing 0 or 1
const STRESS: Record<string, { paymentDelayTrend: number; financingVsActivity: number; inventoryVsCollections: number }> = {
  ent_brz: { paymentDelayTrend: 1, financingVsActivity: 1, inventoryVsCollections: 0 },
  ent_sgp: { paymentDelayTrend: 1, financingVsActivity: 0, inventoryVsCollections: 0 },
  ent_deu: { paymentDelayTrend: 0, financingVsActivity: 0, inventoryVsCollections: 0 },
  ent_hq_ch: { paymentDelayTrend: 0, financingVsActivity: 0, inventoryVsCollections: 0 },
};

export function radarForEntity(entity: Entity): CreditRadarSignal {
  const fc = forecastEntity(entity);
  const lowCash = lt(fc.projectedMin, '0.00') ? 2 : fc.belowBuffer ? 1 : 0;
  const p = STRESS[entity.id] ?? { paymentDelayTrend: 0, financingVsActivity: 0, inventoryVsCollections: 0 };
  const score = Math.min(4, lowCash + p.paymentDelayTrend + p.financingVsActivity + p.inventoryVsCollections);

  return {
    id: nextId('radarSignals', 'crs_'),
    entity_id: entity.id,
    projected_cash_stress_score: score,
    inputs: {
      lowProjectedCash: `${lowCash} (projected min ${fc.projectedMin} vs buffer ${fc.buffer})`,
      paymentDelayTrend: String(p.paymentDelayTrend),
      financingVsActivity: String(p.financingVsActivity),
      inventoryVsCollections: String(p.inventoryVsCollections),
    },
    generated_at: now(),
  };
}

export function radarAll(): CreditRadarSignal[] {
  const repo = getRepos().repo<CreditRadarSignal>('radarSignals');
  repo.clear();
  return getRepos()
    .repo<Entity>('entities')
    .getAll()
    .map((e) => repo.insert(radarForEntity(e)));
}
