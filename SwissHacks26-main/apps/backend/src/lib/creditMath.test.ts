import { describe, it, expect } from 'vitest';
import { coverFor, minCoverFor, meetsCoverMinimum, COVER_FUNDING, COVER_RATE_MINIMUM } from './creditMath.js';

describe('creditMath (XLS-66 first-loss cover)', () => {
  it('HQ over-funds cover to 25% of principal', () => {
    expect(COVER_FUNDING).toBe(0.25);
    expect(coverFor('100000.00')).toBe('25000.00');
  });

  it('broker minimum cover is 10% of principal', () => {
    expect(COVER_RATE_MINIMUM).toBe(0.1);
    expect(minCoverFor('100000.00')).toBe('10000.00');
  });

  it('the funded cover always satisfies the broker minimum (25% ≥ 10%)', () => {
    for (const p of ['1000.00', '100000.00', '750000.00']) {
      expect(meetsCoverMinimum(coverFor(p), p)).toBe(true);
    }
  });

  it('rejects cover below the broker minimum', () => {
    expect(meetsCoverMinimum('9999.99', '100000.00')).toBe(false); // < 10k
    expect(meetsCoverMinimum('10000.00', '100000.00')).toBe(true); // exactly 10k
  });
});
