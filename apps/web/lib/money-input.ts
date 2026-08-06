/**
 * Money helpers for form inputs. The API and database speak integer minor units
 * (cents); vendors type and read natural dollar amounts ("25.00"). Every money
 * field in the dashboard goes through these so the presentation is consistent
 * and the stored representation never changes.
 */

/** 2500 → "25.00"; null → "" (empty field means "not set"). */
export const centsToDollars = (minor: number | null | undefined): string =>
  minor == null ? '' : (minor / 100).toFixed(2);

/** "25.00" → 2500; "" → null. Non-numeric input yields null rather than NaN. */
export const dollarsToCentsOrNull = (v: string): number | null => {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

/** Same as {@link dollarsToCentsOrNull} but for required fields — blank/invalid is 0. */
export const dollarsToCents = (v: string): number => dollarsToCentsOrNull(v) ?? 0;
