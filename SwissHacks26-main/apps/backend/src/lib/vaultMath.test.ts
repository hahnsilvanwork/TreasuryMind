import { describe, it, expect } from 'vitest';
import { sharePrice, sharesForDeposit, sharesForWithdraw } from './vaultMath.js';

describe('vaultMath (XLS-65 share math)', () => {
  it('an empty pool prices shares 1:1', () => {
    const empty = { shares: '0.00', deposited: '0.00' };
    expect(sharePrice(empty)).toBe(1);
    expect(sharesForDeposit(empty, '100000.00')).toBe('100000.00');
  });

  it('mints shares at the current share price', () => {
    // pool worth 200k backed by 100k shares → price 2.0
    const pool = { shares: '100000.00', deposited: '200000.00' };
    expect(sharePrice(pool)).toBe(2);
    expect(sharesForDeposit(pool, '50000.00')).toBe('25000.00'); // 50k / 2.0
  });

  it('burns shares at the current share price on withdrawal', () => {
    const pool = { shares: '100000.00', deposited: '200000.00' };
    expect(sharesForWithdraw(pool, '50000.00')).toBe('25000.00');
  });

  it('deposit-then-withdraw of the same amount nets to the same shares (no drift)', () => {
    const pool = { shares: '300000.00', deposited: '300000.00' }; // price 1.0
    const minted = sharesForDeposit(pool, '25000.00');
    const burned = sharesForWithdraw(pool, '25000.00');
    expect(minted).toBe(burned);
  });
});
