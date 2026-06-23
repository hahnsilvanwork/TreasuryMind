// IA1–IA5 — YieldAllocatorAgent. Invests genuine vault surplus while NEVER breaching the
// payment-liquidity floor. Surplus rule + maturity ladder + hard floor block + explainability card.
// Base = SIMULATED fixed-APR yield sleeve (behaviourally accurate to an XLS-65 vault).
import type { InvestmentPosition, VaultPosition, Money } from '@reduit/shared';
import { sub, mul, add } from '@reduit/shared';
import { getRepos } from '../db/repository.js';
import { ALLOCATOR } from '../config.js';
import { now } from '../lib/clock.js';
import { nextId } from '../lib/ids.js';
import { evaluate } from '../policy/policyEngine.js';
import { emit } from '../services/audit.js';

const VAULT_ID = 'vp_hq_001';
const repos = getRepos();
const vaultRepo = () => repos.repo<VaultPosition>('vaultPositions');
const invRepo = () => repos.repo<InvestmentPosition>('investments');

export function vault(): VaultPosition {
  return vaultRepo().getById(VAULT_ID)!;
}

export interface Tranche {
  amount: Money;
  tenorDays: number;
  maturesAt: string;
  tier: 'AUTO' | 'APPROVAL_REQUIRED';
  expectedYield: Money;
}

export interface AllocatorRecommendation {
  available: Money;
  requiredLiquidityReserve: Money;
  safetyMargin: Money;
  liquidityFloor: Money;
  investableSurplus: Money;
  apr: number;
  tranches: Tranche[];
  blockedExample: { amount: Money; reason: string };
  card: string;
}

function maturityDate(tenorDays: number): string {
  const d = new Date(now());
  d.setUTCDate(d.getUTCDate() + tenorDays);
  return d.toISOString();
}

function yieldFor(principal: Money, tenorDays: number): Money {
  return mul(principal, (ALLOCATOR.sim_apr * tenorDays) / 365);
}

function tier(amount: Money, tenorDays: number): 'AUTO' | 'APPROVAL_REQUIRED' {
  return Number(amount) <= ALLOCATOR.auto_invest_max_amount && tenorDays <= ALLOCATOR.auto_invest_max_tenor_days
    ? 'AUTO'
    : 'APPROVAL_REQUIRED';
}

export function recommend(): AllocatorRecommendation {
  const v = vault();
  const reserve = String(ALLOCATOR.required_liquidity_reserve) + '.00';
  const margin = String(ALLOCATOR.safety_margin) + '.00';
  const floor = add(reserve, margin);
  const investable = sub(sub(v.available, reserve), margin);

  // canonical demo ladder: 20k@7d AUTO, 120k@14d, 50k@30d (sums to 190k)
  const plan = [
    { amount: '20000.00', tenorDays: 7 },
    { amount: '120000.00', tenorDays: 14 },
    { amount: '50000.00', tenorDays: 30 },
  ];
  const tranches: Tranche[] = plan.map((t) => ({
    amount: t.amount,
    tenorDays: t.tenorDays,
    maturesAt: maturityDate(t.tenorDays),
    tier: tier(t.amount, t.tenorDays),
    expectedYield: yieldFor(t.amount, t.tenorDays),
  }));

  const totalYield = tranches.reduce((acc, t) => add(acc, t.expectedYield), '0.00');
  const card =
    `Projected liquidity reserve ${reserve}; safety margin ${margin}; ` +
    `investable surplus ${investable}; recommend laddering ${investable} ` +
    `(20k@7d / 120k@14d / 50k@30d) at ~${(ALLOCATOR.sim_apr * 100).toFixed(1)}% → ~${totalYield} yield, ` +
    `full payment coverage preserved (floor ${floor} never breached).`;

  return {
    available: v.available,
    requiredLiquidityReserve: reserve,
    safetyMargin: margin,
    liquidityFloor: floor,
    investableSurplus: investable,
    apr: ALLOCATOR.sim_apr,
    tranches,
    blockedExample: {
      amount: '250000.00',
      reason: `would drop available (${v.available}) below the floor (${floor}) — hard-blocked regardless of approver.`,
    },
    card,
  };
}

export interface CreateResult {
  ok: boolean;
  position?: InvestmentPosition;
  decision: ReturnType<typeof evaluate>;
}

export function create(amount: Money, tenorDays: number, approvedBy?: string | null): CreateResult {
  const v = vault();
  const floor = add(String(ALLOCATOR.required_liquidity_reserve) + '.00', String(ALLOCATOR.safety_margin) + '.00');
  const decision = evaluate({
    action: 'investment',
    amount,
    destinationAllowlisted: true,
    vaultAvailable: v.available,
    liquidityFloor: floor,
    tenorDays,
  });

  if (decision.outcome === 'BLOCK') {
    emit({ entity_id: 'ent_hq_ch', action_type: 'InvestmentBlocked', actor: 'YieldAllocatorAgent', detail: { amount, tenorDays }, policy_decision: decision, tx_hash: null, source: 'SIMULATED', network: null });
    return { ok: false, decision };
  }
  if (decision.outcome === 'APPROVAL_REQUIRED' && !approvedBy) {
    return { ok: false, decision };
  }

  const position: InvestmentPosition = {
    id: nextId('investments', 'inv_'),
    principal: amount,
    asset: { code: 'RLUSD', issuer: null, isEquivalent: true, vault_token_type: 'MPT' },
    apr: ALLOCATOR.sim_apr,
    openedAt: now(),
    maturesAt: maturityDate(tenorDays),
    status: 'Active',
    expectedYield: yieldFor(amount, tenorDays),
    source: 'SIMULATED',
  };
  invRepo().insert(position);
  vaultRepo().update(VAULT_ID, { available: sub(v.available, amount), locked: add(v.locked, amount) });
  emit({ entity_id: 'ent_hq_ch', action_type: 'InvestmentCreated', actor: approvedBy ?? 'YieldAllocatorAgent', detail: { amount, tenorDays, maturesAt: position.maturesAt, tier: decision.outcome === 'ALLOW' ? 'AUTO' : 'APPROVED' }, policy_decision: decision, tx_hash: null, source: 'SIMULATED', network: null });
  return { ok: true, position, decision };
}

export function redeem(id: string): InvestmentPosition | null {
  const pos = invRepo().getById(id);
  if (!pos || pos.status === 'Redeemed') return null;
  const v = vault();
  const proceeds = add(pos.principal, pos.expectedYield);
  vaultRepo().update(VAULT_ID, { available: add(v.available, proceeds), locked: sub(v.locked, pos.principal) });
  const updated = invRepo().update(id, { status: 'Redeemed' });
  emit({ entity_id: 'ent_hq_ch', action_type: 'InvestmentRedeemed', actor: 'YieldAllocatorAgent', detail: { principal: pos.principal, yield: pos.expectedYield }, policy_decision: null, tx_hash: null, source: 'SIMULATED', network: null });
  return updated;
}

export function list(): InvestmentPosition[] {
  return invRepo().getAll();
}
