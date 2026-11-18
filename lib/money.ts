/**
 * Money helpers — amounts are always integer minor units (cents).
 * Never use floating-point for storage or totals.
 */

export type CurrencyCode = string;

/** Format minor units as a display string, e.g. 125099 → "$1,250.99" */
export function formatMinorUnits(
  minor: number,
  currency: CurrencyCode = 'USD',
  locale = 'en-US',
): string {
  if (!Number.isFinite(minor) || !Number.isInteger(minor)) {
    throw new Error('Amount must be a finite integer (minor units)');
  }

  const major = minor / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency.toUpperCase()} ${major.toFixed(2)}`;
  }
}

/** Parse a major-unit decimal string/number into minor units (max 2 decimal places). */
export function parseMajorToMinor(input: string | number): number {
  const raw = typeof input === 'number' ? input.toString() : String(input).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error('Invalid money amount; use up to 2 decimal places');
  }

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [wholePart, fracPart = ''] = unsigned.split('.');
  const cents = (fracPart + '00').slice(0, 2);
  const minor = Number.parseInt(wholePart || '0', 10) * 100 + Number.parseInt(cents, 10);
  if (!Number.isSafeInteger(minor)) {
    throw new Error('Amount out of safe integer range');
  }
  return negative ? -minor : minor;
}

/**
 * Line total: quantity × unit_amount_minor, rounded to nearest minor unit
 * (half away from zero) to avoid float drift.
 */
export function lineAmountMinor(quantity: number, unitAmountMinor: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive number');
  }
  if (!Number.isInteger(unitAmountMinor) || unitAmountMinor < 0) {
    throw new Error('Unit amount must be a non-negative integer (minor units)');
  }

  const product = quantity * unitAmountMinor;
  const rounded = product >= 0 ? Math.round(product) : -Math.round(-product);
  if (!Number.isSafeInteger(rounded)) {
    throw new Error('Line amount out of safe integer range');
  }
  return rounded;
}

export function sumMinor(amounts: number[]): number {
  let total = 0;
  for (const a of amounts) {
    if (!Number.isInteger(a)) {
      throw new Error('All amounts must be integers (minor units)');
    }
    total += a;
    if (!Number.isSafeInteger(total)) {
      throw new Error('Sum out of safe integer range');
    }
  }
  return total;
}
