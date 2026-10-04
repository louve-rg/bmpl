/**
 * The three compact summary boxes in the account menu: Jobs, Earnings, Wallet
 * (Edward's items 8, 9 and 10). The rules are the owner's and each one stops
 * the menu stating something false:
 *
 * - JOBS is counted by role, and the sublabel names exactly what is counted.
 *   A user with no job-related role sees "Not applicable", never 0.
 * - EARNINGS is today and this week only, from the endpoints that already
 *   compute them. There is no lifetime total. Those endpoints return the
 *   newest 300 rows, so a window that reaches the oldest row we received
 *   cannot be summed honestly: it shows "Not available" instead of a figure.
 * - The word "payout" does not appear anywhere. No payout exists in BML.
 * - WALLET comes from the `exists` flag. "No wallet yet" is shown rather than
 *   a zero balance, because a zero would be a claim we cannot make.
 *
 * Pure functions only, so the rules are testable without a browser.
 */

/** GET /driver/earnings and GET /vendor/settlements return at most this many rows. */
export const EARNINGS_ROW_CAP = 300;
/** GET /employer/jobs returns at most this many rows. */
export const EMPLOYER_JOB_CAP = 200;
/** GET /job-seeker/applications returns at most this many rows. */
export const SEEKER_APPLICATION_CAP = 200;

export interface MoneyRow {
  calculatedAt: string;
  netMinor: number;
  status: string;
  currency: string;
}

/** Local midnight today. */
export function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Local midnight on the most recent Monday. */
export function startOfWeek(now: Date): Date {
  const day = startOfToday(now);
  const sinceMonday = (day.getDay() + 6) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - sinceMonday);
}

/**
 * The net total of rows calculated on or after `since`, or null when the list
 * was cut off before reaching `since` (so the true total is unknown).
 *
 * Rows are newest first. If the list is full AND its oldest row is still inside
 * the window, older rows in the window may be missing, so the total is null.
 */
export function netSince(rows: MoneyRow[], since: Date, cap: number): { minor: number; currency: string } | null {
  const oldest = rows[rows.length - 1];
  if (rows.length >= cap && oldest && new Date(oldest.calculatedAt) >= since) return null;
  let minor = 0;
  let currency = rows[0]?.currency ?? 'BZD';
  for (const r of rows) {
    if (r.status === 'FAILED') continue;
    if (new Date(r.calculatedAt) < since) continue;
    minor += r.netMinor;
    currency = r.currency;
  }
  return { minor, currency };
}

/**
 * Money as the app shows it elsewhere (same rule as the earnings page), with thousands
 * separators (display only). The value and its rounding are unchanged: toFixed(2) of the major amount.
 */
export function moneyLabel(minor: number, currency = 'BZD'): string {
  const [whole, cents] = (Math.abs(minor) / 100).toFixed(2).split('.');
  const sign = minor < 0 ? '-' : '';
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (currency === 'USD' ? 'US$' : '$') + sign + grouped + '.' + cents;
}
