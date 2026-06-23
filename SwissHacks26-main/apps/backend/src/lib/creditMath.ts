// XLS-66 internal credit line — first-loss cover math. Pure, so the cover invariant is unit-testable.
// HQ over-funds first-loss cover to COVER_FUNDING of principal; the broker requires at least
// COVER_RATE_MINIMUM. Invariant enforced identically in sim & live: cover ≥ CoverRateMinimum × principal.
import type { Money } from '@reduit/shared';
import { mul, gte } from '@reduit/shared';

export const COVER_RATE_MINIMUM = 0.1; // broker CoverRateMinimum
export const COVER_FUNDING = 0.25; // HQ over-funds first-loss cover to 25% of principal

export const coverFor = (principal: Money): Money => mul(principal, COVER_FUNDING);
export const minCoverFor = (principal: Money): Money => mul(principal, COVER_RATE_MINIMUM);
export const meetsCoverMinimum = (cover: Money, principal: Money): boolean =>
  gte(cover, minCoverFor(principal));
