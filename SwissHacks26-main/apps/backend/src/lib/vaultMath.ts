// XLS-65 Single Asset Vault share math — pure, so the invariant is unit-testable apart from the route.
// First deposit mints shares 1:1; thereafter shares = amount / sharePrice, sharePrice = deposited/shares.
import type { VaultPosition, Money } from '@reduit/shared';
import { mul } from '@reduit/shared';

type Pool = Pick<VaultPosition, 'shares' | 'deposited'>;

export function sharePrice(v: Pool): number {
  const shares = Number(v.shares);
  return shares === 0 ? 1 : Number(v.deposited) / shares;
}

/** Shares minted for a deposit. First deposit (empty pool) is 1:1. */
export function sharesForDeposit(v: Pool, amount: Money): Money {
  return Number(v.shares) === 0 ? amount : mul(amount, 1 / sharePrice(v));
}

/** Shares burned for a withdrawal. */
export function sharesForWithdraw(v: Pool, amount: Money): Money {
  return mul(amount, 1 / sharePrice(v));
}
