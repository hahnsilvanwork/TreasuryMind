// Policy Engine — the 7-check matrix + the liquidity-floor hard-block.
// Every chain action passes here; the decision is written into the AuditEvent (golden rule).
// STUB: the checks are scaffolded; fill the real allowlist/cap logic against policy-engine-and-audit.md.
import type { PolicyDecision, Money } from '@reduit/shared';
import { gte, sub } from '@reduit/shared';
import { POLICY, ALLOCATOR } from '../config.js';

export interface PolicyContext {
  action: 'transfer' | 'agent_sweep' | 'credit_line' | 'investment';
  amount: Money;
  destinationAllowlisted: boolean;
  approvedBy?: string | null;
  // investment-only:
  vaultAvailable?: Money;
  liquidityFloor?: Money;
  tenorDays?: number;
}

export function evaluate(ctx: PolicyContext): PolicyDecision {
  const checks: { name: string; passed: boolean }[] = [];
  const check = (name: string, passed: boolean) => {
    checks.push({ name, passed });
    return passed;
  };

  // 0. HARD liquidity-floor block (D6/IA2) — evaluated FIRST, overrides every approver.
  if (ctx.action === 'investment' && ctx.vaultAvailable && ctx.liquidityFloor) {
    const remaining = sub(ctx.vaultAvailable, ctx.amount);
    if (!check('liquidity_floor', gte(remaining, ctx.liquidityFloor))) {
      return {
        outcome: 'BLOCK',
        matched_rule: 'liquidity_floor_hard_block',
        checks,
        rationale: `Allocation would drop vault.available below the payment-liquidity floor — blocked regardless of approver.`,
      };
    }
  }

  check('destination_allowlisted', ctx.destinationAllowlisted);
  check('status_active', true); // TODO: entity not suspended
  check('within_daily_cap', true); // TODO: sum today's agent spend ≤ daily_spend_cap

  // tiered auto vs approval
  const amountNum = Number(ctx.amount);
  if (ctx.action === 'agent_sweep') {
    const autoOk = ctx.destinationAllowlisted && amountNum <= POLICY.auto_sweep_threshold;
    check('within_auto_sweep_threshold', amountNum <= POLICY.auto_sweep_threshold);
    return autoOk
      ? { outcome: 'ALLOW', matched_rule: 'agent_sweep_auto', checks, rationale: 'Below per-action threshold and allowlisted — auto-executes.' }
      : { outcome: 'APPROVAL_REQUIRED', matched_rule: 'agent_sweep_over_threshold', checks, rationale: 'Above auto-sweep threshold — requires human approval.' };
  }

  if (ctx.action === 'investment') {
    const autoOk =
      amountNum <= ALLOCATOR.auto_invest_max_amount &&
      (ctx.tenorDays ?? 0) <= ALLOCATOR.auto_invest_max_tenor_days;
    check('within_auto_invest_limits', autoOk);
    return autoOk
      ? { outcome: 'ALLOW', matched_rule: 'invest_auto', checks, rationale: 'Small amount AND short tenor — auto-invest.' }
      : { outcome: 'APPROVAL_REQUIRED', matched_rule: 'invest_needs_approval', checks, rationale: 'Larger amount OR longer tenor — requires human approval.' };
  }

  // human-initiated transfer / credit line
  const needsApproval = amountNum > POLICY.hq_instant_transfer_cap;
  return needsApproval
    ? { outcome: 'APPROVAL_REQUIRED', matched_rule: 'over_instant_cap', checks, rationale: 'Above instant-transfer cap — requires approval.' }
    : { outcome: 'ALLOW', matched_rule: 'within_caps', checks, rationale: 'Within caps and allowlisted.' };
}
