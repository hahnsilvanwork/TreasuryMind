import { describe, it, expect } from 'vitest';
import { evaluate } from './policyEngine.js';
import { POLICY, ALLOCATOR } from '../config.js';

describe('policyEngine', () => {
  describe('investment liquidity floor (D6/IA2 — hard block, overrides approver)', () => {
    const floor = '310000.00'; // 300k reserve + 10k margin

    it('BLOCKS when the allocation would drop available below the floor', () => {
      const d = evaluate({
        action: 'investment', amount: '250000.00', destinationAllowlisted: true,
        vaultAvailable: '500000.00', liquidityFloor: floor, tenorDays: 7,
      });
      expect(d.outcome).toBe('BLOCK');
      expect(d.matched_rule).toBe('liquidity_floor_hard_block');
    });

    it('blocks even with an approver present (hard, not advisory)', () => {
      const d = evaluate({
        action: 'investment', amount: '250000.00', destinationAllowlisted: true,
        approvedBy: 'cfo', vaultAvailable: '500000.00', liquidityFloor: floor, tenorDays: 7,
      });
      expect(d.outcome).toBe('BLOCK');
    });

    it('does NOT block when remaining lands exactly on the floor (gte, not gt)', () => {
      const d = evaluate({
        action: 'investment', amount: '190000.00', destinationAllowlisted: true,
        vaultAvailable: '500000.00', liquidityFloor: floor, tenorDays: 7,
      });
      expect(d.outcome).not.toBe('BLOCK'); // 500k − 190k = 310k == floor → floor passes
    });

    it('blocks one cent under the floor', () => {
      const d = evaluate({
        action: 'investment', amount: '190000.01', destinationAllowlisted: true,
        vaultAvailable: '500000.00', liquidityFloor: floor, tenorDays: 7,
      });
      expect(d.outcome).toBe('BLOCK'); // remaining 309999.99 < 310000.00
    });
  });

  describe('agent sweep tiers', () => {
    it('auto-allows at exactly the threshold', () => {
      const d = evaluate({ action: 'agent_sweep', amount: String(POLICY.auto_sweep_threshold) + '.00', destinationAllowlisted: true });
      expect(d.outcome).toBe('ALLOW');
      expect(d.matched_rule).toBe('agent_sweep_auto');
    });

    it('requires approval one cent over the threshold', () => {
      const d = evaluate({ action: 'agent_sweep', amount: String(POLICY.auto_sweep_threshold + 0.01), destinationAllowlisted: true });
      expect(d.outcome).toBe('APPROVAL_REQUIRED');
    });
  });

  describe('investment auto vs approval tiers (within the floor)', () => {
    const ok = { vaultAvailable: '1000000.00', liquidityFloor: '310000.00' };

    it('auto-invests small amount AND short tenor', () => {
      const d = evaluate({ action: 'investment', amount: String(ALLOCATOR.auto_invest_max_amount) + '.00', destinationAllowlisted: true, tenorDays: ALLOCATOR.auto_invest_max_tenor_days, ...ok });
      expect(d.outcome).toBe('ALLOW');
    });

    it('needs approval when the tenor is too long', () => {
      const d = evaluate({ action: 'investment', amount: '20000.00', destinationAllowlisted: true, tenorDays: 14, ...ok });
      expect(d.outcome).toBe('APPROVAL_REQUIRED');
    });

    it('needs approval when the amount is too large', () => {
      const d = evaluate({ action: 'investment', amount: '50000.00', destinationAllowlisted: true, tenorDays: 7, ...ok });
      expect(d.outcome).toBe('APPROVAL_REQUIRED');
    });
  });

  describe('human transfer instant cap', () => {
    it('allows within the instant-transfer cap', () => {
      const d = evaluate({ action: 'transfer', amount: String(POLICY.hq_instant_transfer_cap) + '.00', destinationAllowlisted: true });
      expect(d.outcome).toBe('ALLOW');
    });

    it('requires approval above the instant-transfer cap', () => {
      const d = evaluate({ action: 'transfer', amount: String(POLICY.hq_instant_transfer_cap + 1) + '.00', destinationAllowlisted: true });
      expect(d.outcome).toBe('APPROVAL_REQUIRED');
    });
  });
});
