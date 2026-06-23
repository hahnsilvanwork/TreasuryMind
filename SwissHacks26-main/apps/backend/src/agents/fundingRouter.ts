// AG4 — Funding router. Turns the watchlist + radar into human-readable recommendations.
// Credit-line creation NEVER auto-executes (always requires approval).
import { gt } from '@reduit/shared';
import { POLICY } from '../config.js';
import { watchlist } from './sweep.js';
import { getRepos } from '../db/repository.js';
import type { Entity, CreditRadarSignal } from '@reduit/shared';
import { radarForEntity } from './radar.js';

export interface AgentRecommendation {
  id: string;
  entity_id: string;
  agent_module: string;
  recommended_action: 'CreateLine' | 'Sweep' | 'AutoSweep' | 'PauseSweep' | 'DirectTransfer';
  amount: string;
  source_entity_id: string | null;
  requires_approval: boolean;
  rationale: string;
}

const HQ_ID = 'ent_hq_ch';

export function recommendations(): AgentRecommendation[] {
  const out: AgentRecommendation[] = [];
  const entities = getRepos().repo<Entity>('entities');
  let n = 0;
  const id = () => `rec_${String(++n).padStart(3, '0')}`;

  for (const w of watchlist()) {
    const entity = entities.getById(w.entity_id)!;
    const radar: CreditRadarSignal = radarForEntity(entity);

    if (w.status === 'deficit') {
      if (w.autoSweepEligible) {
        out.push({
          id: id(), entity_id: w.entity_id, agent_module: 'FundingRouter', recommended_action: 'AutoSweep',
          amount: w.shortfall, source_entity_id: HQ_ID, requires_approval: false,
          rationale: `${w.entity_id} projected min ${w.projectedMin} below buffer ${w.buffer}; top-up ${w.shortfall} ≤ auto-sweep threshold ${POLICY.auto_sweep_threshold} → agent auto-sweeps unattended.`,
        });
      } else {
        out.push({
          id: id(), entity_id: w.entity_id, agent_module: 'FundingRouter', recommended_action: 'CreateLine',
          amount: w.shortfall, source_entity_id: HQ_ID, requires_approval: true,
          rationale: `${w.entity_id} projected min ${w.projectedMin}, ~${w.shortfall} below the ${w.buffer} buffer (radar ${radar.projected_cash_stress_score}/4); recommend a 7-day internal liquidity line — requires human approval.`,
        });
      }
    } else if (w.status === 'surplus' && gt(w.surplus, '0.00') && entity.role !== 'HQ') {
      out.push({
        id: id(), entity_id: w.entity_id, agent_module: 'SweepOptimizer', recommended_action: 'Sweep',
        amount: w.surplus, source_entity_id: w.entity_id, requires_approval: false,
        rationale: `${w.entity_id} projected surplus ${w.surplus} above buffer; sweep to the pooled vault.`,
      });
    }

    if (radar.projected_cash_stress_score >= 3) {
      out.push({
        id: id(), entity_id: w.entity_id, agent_module: 'CreditRadar', recommended_action: 'PauseSweep',
        amount: '0.00', source_entity_id: null, requires_approval: false,
        rationale: `${w.entity_id} radar ${radar.projected_cash_stress_score}/4 — pause any outbound sweep from this entity until stress clears.`,
      });
    }
  }
  return out;
}
