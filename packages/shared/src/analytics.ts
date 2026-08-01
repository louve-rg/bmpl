/**
 * Analytics & Reporting (Phase 4 · M22) — shared constants + CSV helper.
 * Read-only aggregation over existing ledgers/orders; no money movement.
 */

/** Default look-back window for time-series analytics. */
export const DEFAULT_ANALYTICS_DAYS = 30;
export const MAX_ANALYTICS_DAYS = 365;

/** Payment statuses that represent real, collected money (GMV basis). */
export const PAID_PAYMENT_STATUSES = ['AUTHORIZED', 'SETTLING', 'SETTLED'] as const;

/** Escape + join a single CSV row (RFC-4180: quote fields containing ,"\n). */
export function csvRow(fields: Array<string | number | null | undefined>): string {
  return fields
    .map((f) => {
      const s = f === null || f === undefined ? '' : String(f);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

/** Build a CSV document from a header + rows. */
export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}
