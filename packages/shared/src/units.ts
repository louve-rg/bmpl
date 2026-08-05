/**
 * Imperial ⇄ metric units — THE single source of truth for the platform.
 *
 * Belize commerce/logistics is imperial, so every customer/vendor/driver/admin
 * surface DISPLAYS and INPUTS imperial (miles, inches, pounds/ounces). Storage and
 * the API stay CANONICAL METRIC (grams, millimetres, kilometres) — nothing in the
 * platform computes prices/fees from these physical quantities (delivery pricing is
 * zone/flat-fee based), so keeping canonical storage means conversions never change
 * a price and no data migration is required. Convert ONLY at the presentation and
 * form boundaries, always through these helpers — never re-derive factors inline.
 *
 * Exact conversion factors (as specified):
 *   1 km = 0.621371 mi | 1 mm = 0.0393701 in | 1 cm = 0.393701 in
 *   1 m  = 3.28084 ft   | 1 kg = 2.20462 lb  | 1 g  = 0.035274 oz
 */

// ---- factors ----
export const KM_TO_MI = 0.621371;
export const MI_TO_KM = 1 / KM_TO_MI; // ≈ 1.609347
export const MM_TO_IN = 0.0393701;
export const IN_TO_MM = 1 / MM_TO_IN; // ≈ 25.4
export const CM_TO_IN = 0.393701;
export const M_TO_FT = 3.28084;
export const KG_TO_LB = 2.20462;
export const G_TO_OZ = 0.035274;
export const OZ_TO_G = 1 / G_TO_OZ; // ≈ 28.3495
/** Grams→pounds derived from the kg factor (kept consistent: 2.20462/1000). */
export const G_TO_LB = KG_TO_LB / 1000; // ≈ 0.00220462
export const LB_TO_G = 1 / G_TO_LB; // ≈ 453.592
export const OZ_PER_LB = 16;

// ---- pure numeric converters ----
export const kmToMiles = (km: number): number => km * KM_TO_MI;
export const milesToKm = (mi: number): number => mi * MI_TO_KM;
export const mmToInches = (mm: number): number => mm * MM_TO_IN;
export const inchesToMm = (inches: number): number => inches * IN_TO_MM;
export const cmToInches = (cm: number): number => cm * CM_TO_IN;
export const metersToFeet = (m: number): number => m * M_TO_FT;
export const gramsToOunces = (g: number): number => g * G_TO_OZ;
export const ouncesToGrams = (oz: number): number => oz * OZ_TO_G;
export const gramsToPounds = (g: number): number => g * G_TO_LB;
export const poundsToGrams = (lb: number): number => lb * LB_TO_G;
export const kgToPounds = (kg: number): number => kg * KG_TO_LB;
export const poundsToKg = (lb: number): number => lb / KG_TO_LB;

/** Round to `dp` decimals, dropping a trailing `.0` (e.g. 2.0 → "2", 6.21 → "6.2"). */
function trim(n: number, dp = 1): string {
  const s = n.toFixed(dp);
  return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

// ---- display formatters (metric in → imperial string out) ----

/**
 * Weight for display: pounds at/above 1 lb, otherwise ounces (matches "g→oz, kg→lb").
 * `null`/≤0 → null so callers can omit the row.
 */
export function formatWeight(grams: number | null | undefined): string | null {
  if (grams == null || grams <= 0) return null;
  const lb = gramsToPounds(grams);
  if (lb >= 1) return `${trim(lb, 2)} lb`;
  return `${trim(gramsToOunces(grams), 1)} oz`;
}

/** Single length in inches, e.g. 300 mm → "11.8 in". null-safe. */
export function formatLengthMm(mm: number | null | undefined): string | null {
  if (mm == null || mm <= 0) return null;
  return `${trim(mmToInches(mm), 1)} in`;
}

/**
 * L × W × H in inches, e.g. (300,200,100) → "11.8 × 7.9 × 3.9 in". Missing dims show
 * an em dash; returns null only when all three are absent.
 */
export function formatDimensionsMm(
  lengthMm: number | null | undefined,
  widthMm: number | null | undefined,
  heightMm: number | null | undefined,
): string | null {
  if (lengthMm == null && widthMm == null && heightMm == null) return null;
  const one = (mm: number | null | undefined) => (mm == null ? '—' : trim(mmToInches(mm), 1));
  return `${one(lengthMm)} × ${one(widthMm)} × ${one(heightMm)} in`;
}

/** Distance in miles, e.g. 10 km → "6.2 mi". null-safe. */
export function formatDistanceKm(km: number | null | undefined): string | null {
  if (km == null || km < 0) return null;
  return `${trim(kmToMiles(km), 1)} mi`;
}

// ---- form-input helpers (imperial string ⇄ canonical metric int) ----

/** Parse a decimal imperial input and convert to a canonical metric integer for
 *  storage, or null when blank/invalid. `factor` maps the imperial unit → metric base. */
function toMetricInt(value: string, factor: number): number | null {
  const t = value.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * factor);
}
export const poundsInputToGrams = (lb: string): number | null => toMetricInt(lb, LB_TO_G);
export const inchesInputToMm = (inches: string): number | null => toMetricInt(inches, IN_TO_MM);
export const milesInputToKm = (mi: string): number | null => toMetricInt(mi, MI_TO_KM);

/** Canonical metric int → imperial string for pre-filling a form input (edit views).
 *  Empty string when null. Uses `dp` decimals, trailing zeros trimmed. */
function toImperialInput(value: number | null | undefined, factor: number, dp: number): string {
  if (value == null) return '';
  return trim(value * factor, dp);
}
export const gramsToPoundsInput = (g: number | null | undefined): string => toImperialInput(g, G_TO_LB, 2);
export const mmToInchesInput = (mm: number | null | undefined): string => toImperialInput(mm, MM_TO_IN, 2);
export const kmToMilesInput = (km: number | null | undefined): string => toImperialInput(km, KM_TO_MI, 2);
