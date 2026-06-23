// AG1 — CashForecast. Deterministic projection of each entity's balance over a horizon from the
// seeded scheduled flows. Feeds the watchlist, radar, autonomous sweep, and the allocator floor.
import type { Entity, ForecastSnapshot, Money } from '@reduit/shared';
import { add, sub, lt, max } from '@reduit/shared';
import { getRepos } from '../db/repository.js';
import { now } from '../lib/clock.js';
import { nextId } from '../lib/ids.js';

export interface ScheduledFlow {
  id: string;
  entity_id: string;
  direction: 'Inflow' | 'Outflow';
  amount: Money;
  date: string; // YYYY-MM-DD
  type: string;
}

export interface ForecastResult {
  entity_id: string;
  horizonDays: number;
  opening: Money;
  projectedMin: Money;
  ending: Money;
  buffer: Money;
  belowBuffer: boolean;
  shortfall: Money; // max(0, buffer - projectedMin)
  surplus: Money; // max(0, projectedMin - buffer)
  timeline: { date: string; balance: Money }[];
}

const repos = getRepos();
const flowsRepo = () => repos.repo<ScheduledFlow>('scheduledFlows');

function horizonCutoff(fromISO: string, days: number): string {
  const d = new Date(fromISO);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function forecastEntity(entity: Entity, horizonDays = 7): ForecastResult {
  const today = now().slice(0, 10);
  const cutoff = horizonCutoff(now(), horizonDays);
  const flows = flowsRepo()
    .getAll()
    .filter((f) => f.entity_id === entity.id && f.date >= today && f.date <= cutoff)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  let balance = entity.balance;
  let projectedMin = balance;
  const timeline: { date: string; balance: Money }[] = [{ date: today, balance }];
  for (const f of flows) {
    balance = f.direction === 'Inflow' ? add(balance, f.amount) : sub(balance, f.amount);
    if (lt(balance, projectedMin)) projectedMin = balance;
    timeline.push({ date: f.date, balance });
  }

  const shortfall = max('0.00', sub(entity.operating_buffer, projectedMin));
  const surplus = max('0.00', sub(projectedMin, entity.operating_buffer));
  return {
    entity_id: entity.id,
    horizonDays,
    opening: entity.balance,
    projectedMin,
    ending: balance,
    buffer: entity.operating_buffer,
    belowBuffer: lt(projectedMin, entity.operating_buffer),
    shortfall,
    surplus,
    timeline,
  };
}

export function forecastAll(horizonDays = 7): ForecastResult[] {
  return repos
    .repo<Entity>('entities')
    .getAll()
    .map((e) => forecastEntity(e, horizonDays));
}

/** Persist a ForecastSnapshot per entity (typed contract record) and return them. */
export function snapshotForecasts(horizonDays = 7): ForecastSnapshot[] {
  const repo = repos.repo<ForecastSnapshot>('forecasts');
  repo.clear();
  return forecastAll(horizonDays).map((r) =>
    repo.insert({
      id: nextId('forecasts', 'fc_'),
      entity_id: r.entity_id,
      forecast_horizon_days: horizonDays,
      projected_min_balance: r.projectedMin,
      operating_buffer: r.buffer,
      generated_at: now(),
    }),
  );
}
