import { describe, it, expect } from 'vitest';
import { toMinor, fromMinor, add, sub, mul, gte, gt, lt, max } from './money.js';

describe('money', () => {
  it('round-trips without precision loss', () => {
    expect(fromMinor(toMinor('500000.00'))).toBe('500000.00');
    expect(fromMinor(toMinor('150000.37'))).toBe('150000.37');
    expect(fromMinor(toMinor('-30000.00'))).toBe('-30000.00');
  });

  it('adds and subtracts', () => {
    expect(add('450000.00', '120000.00')).toBe('570000.00');
    expect(sub('570000.00', '50000.00')).toBe('520000.00');
  });

  it('multiplies by a factor (APR / bps) and rounds to the cent', () => {
    // 20,000 @ 3.5% for ~7d would be computed elsewhere; here just the factor
    expect(mul('100000.00', 0.035)).toBe('3500.00');
    expect(mul('50000000.00', 0.0005)).toBe('25000.00'); // 5 bps on 50M
  });

  it('subtracts across zero into negatives', () => {
    expect(sub('100.00', '150.00')).toBe('-50.00');
    expect(add('-50.00', '50.00')).toBe('0.00');
  });

  it('pads and truncates to two minor units (never rounds in toMinor)', () => {
    expect(fromMinor(toMinor('0.1'))).toBe('0.10');
    expect(fromMinor(toMinor('1.999'))).toBe('1.99'); // 3rd decimal dropped, not rounded
  });

  it('rounds mul half-up at the cent', () => {
    expect(mul('1.00', 0.005)).toBe('0.01'); // 0.005 → up
    expect(mul('1.00', 0.004)).toBe('0.00'); // 0.004 → down
  });

  it('compares', () => {
    expect(gte('310000.00', '310000.00')).toBe(true);
    expect(gte('309999.99', '310000.00')).toBe(false);
    expect(gt('2.00', '2.00')).toBe(false);
    expect(gt('2.01', '2.00')).toBe(true);
    expect(lt('1.99', '2.00')).toBe(true);
    expect(max('5.00', '3.00')).toBe('5.00');
    expect(max('3.00', '5.00')).toBe('5.00');
  });
});
