// Money helpers. Balances are decimal strings; arithmetic happens on integer minor units (cents).
// NEVER use JS number for balances — float rounding corrupts treasury figures.

import type { Money } from './types.js';

const MINOR_UNITS = 2; // RLUSD cents
const SCALE = 10 ** MINOR_UNITS;

/** "500000.00" -> 50000000n (cents) */
export function toMinor(value: Money): bigint {
  const neg = value.trim().startsWith('-');
  const clean = value.trim().replace('-', '');
  const [whole, frac = ''] = clean.split('.');
  const fracPadded = (frac + '00').slice(0, MINOR_UNITS);
  const cents = BigInt(whole) * BigInt(SCALE) + BigInt(fracPadded || '0');
  return neg ? -cents : cents;
}

/** 50000000n (cents) -> "500000.00" */
export function fromMinor(cents: bigint): Money {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / BigInt(SCALE);
  const frac = (abs % BigInt(SCALE)).toString().padStart(MINOR_UNITS, '0');
  return `${neg ? '-' : ''}${whole.toString()}.${frac}`;
}

export const add = (a: Money, b: Money): Money => fromMinor(toMinor(a) + toMinor(b));
export const sub = (a: Money, b: Money): Money => fromMinor(toMinor(a) - toMinor(b));

/** Multiply a money amount by a unitless factor (e.g. an APR or bps fraction). Rounds to the cent. */
export function mul(a: Money, factor: number): Money {
  const cents = toMinor(a);
  // scale factor to avoid float drift on the multiply, then round
  const f = Math.round(factor * 1e9);
  const product = (cents * BigInt(f) + 500_000_000n) / 1_000_000_000n;
  return fromMinor(product);
}

export const gte = (a: Money, b: Money): boolean => toMinor(a) >= toMinor(b);
export const gt = (a: Money, b: Money): boolean => toMinor(a) > toMinor(b);
export const lt = (a: Money, b: Money): boolean => toMinor(a) < toMinor(b);
export const max = (a: Money, b: Money): Money => (gte(a, b) ? a : b);
