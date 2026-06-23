// AG2/AG3 — watchlist + the autonomous sweep. When a watched entity's projected balance crosses
// below its operating buffer and the top-up is below the per-action threshold, the agent fires a
// policy-checked RLUSD Payment with NO human click (signed by the agent's regular key when live).
import type { Entity } from '@reduit/shared';
import { gt } from '@reduit/shared';
import { getRepos } from '../db/repository.js';
import { add, sub } from '@reduit/shared';
import { POLICY } from '../config.js';
import { evaluate } from '../policy/policyEngine.js';
import { submit } from '../xrpl/submit.js';
import { emit } from '../services/audit.js';
import { forecastAll, forecastEntity } from './forecast.js';

const HQ_ID = 'ent_hq_ch';
const repos = getRepos();
const entities = () => repos.repo<Entity>('entities');

export interface WatchEntry {
  entity_id: string;
  projectedMin: string;
  buffer: string;
  status: 'deficit' | 'surplus' | 'ok';
  shortfall: string;
  surplus: string;
  sweepable: boolean; // surplus that could be pooled
  autoSweepEligible: boolean; // deficit fundable below the auto threshold
}

export function watchlist(): WatchEntry[] {
  return forecastAll().map((fc) => ({
    entity_id: fc.entity_id,
    projectedMin: fc.projectedMin,
    buffer: fc.buffer,
    status: fc.belowBuffer ? 'deficit' : gt(fc.surplus, '0.00') ? 'surplus' : 'ok',
    shortfall: fc.shortfall,
    surplus: fc.surplus,
    sweepable: gt(fc.surplus, '0.00'),
    autoSweepEligible: fc.belowBuffer && Number(fc.shortfall) > 0 && Number(fc.shortfall) <= POLICY.auto_sweep_threshold,
  }));
}

export interface SweepResult {
  entity_id: string;
  amount: string;
  outcome: string;
  txHash: string | null;
  source: string;
}

/** Execute all auto-eligible sweeps unattended. Returns what fired. */
export async function runAutonomousSweeps(): Promise<SweepResult[]> {
  const results: SweepResult[] = [];
  for (const w of watchlist()) {
    if (!w.autoSweepEligible) continue;
    const amount = w.shortfall; // top up to the buffer
    const dest = entities().getById(w.entity_id)!;
    const hq = entities().getById(HQ_ID)!;

    const decision = evaluate({ action: 'agent_sweep', amount, destinationAllowlisted: true });
    if (decision.outcome !== 'ALLOW') {
      emit({
        entity_id: w.entity_id, action_type: 'AgentSweepDeferred', actor: 'SweepAgent',
        detail: { amount, reason: decision.outcome }, policy_decision: decision,
        tx_hash: null, source: 'SIMULATED', network: null,
      });
      results.push({ entity_id: w.entity_id, amount, outcome: decision.outcome, txHash: null, source: 'SIMULATED' });
      continue;
    }

    const nonce = `${w.entity_id}-${forecastEntity(dest).projectedMin}`;
    const tx = await submit({
      method: 'Payment', network: 'testnet', signer: 'agent',
      fields: { from: hq.wallet_address, to: dest.wallet_address, amount, currency: 'RLUSD', memo: { recommendationId: 'auto-sweep', policyId: decision.matched_rule, nonce } },
    });
    entities().update(hq.id, { balance: sub(hq.balance, amount) });
    entities().update(dest.id, { balance: add(dest.balance, amount) });
    emit({
      entity_id: w.entity_id, action_type: 'AgentSweepExecuted', actor: 'SweepAgent',
      detail: { amount, from: hq.id, to: dest.id, memo: { nonce }, explorerUrl: tx.explorerUrl, unattended: true },
      policy_decision: decision, tx_hash: tx.txHash, source: tx.source, network: tx.network,
    });
    results.push({ entity_id: w.entity_id, amount, outcome: 'EXECUTED', txHash: tx.txHash, source: tx.source });
  }
  return results;
}
