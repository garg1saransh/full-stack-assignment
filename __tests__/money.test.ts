import { describe, expect, it } from 'vitest';
import {
  formatMinorUnits,
  lineAmountMinor,
  parseMajorToMinor,
  sumMinor,
} from '@/lib/money';

describe('money helpers', () => {
  it('parses major units into integer cents', () => {
    expect(parseMajorToMinor('10')).toBe(1000);
    expect(parseMajorToMinor('10.5')).toBe(1050);
    expect(parseMajorToMinor('10.99')).toBe(1099);
    expect(parseMajorToMinor(0.01)).toBe(1);
  });

  it('rejects more than two decimal places', () => {
    expect(() => parseMajorToMinor('1.999')).toThrow(/2 decimal/);
  });

  it('formats minor units as currency', () => {
    expect(formatMinorUnits(125099, 'USD')).toMatch(/1,250\.99/);
  });

  it('computes line amounts without float drift', () => {
    // 3 × $33.33 = 9999 cents ($99.99) when using integer unit amount
    expect(lineAmountMinor(3, 3333)).toBe(9999);
    // fractional quantity rounded to nearest cent
    expect(lineAmountMinor(1.5, 100)).toBe(150);
  });

  it('sums safely and rejects non-integers', () => {
    expect(sumMinor([100, 200, 50])).toBe(350);
    expect(() => sumMinor([1.5 as unknown as number])).toThrow(/integers/);
  });

  it('rejects non-integer format input', () => {
    expect(() => formatMinorUnits(10.5)).toThrow(/integer/);
  });
});
