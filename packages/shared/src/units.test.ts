import { describe, expect, it } from 'vitest';
import {
  kmToMiles,
  milesToKm,
  mmToInches,
  inchesToMm,
  cmToInches,
  metersToFeet,
  gramsToOunces,
  gramsToPounds,
  poundsToGrams,
  kgToPounds,
  formatWeight,
  formatLengthMm,
  formatDimensionsMm,
  formatDistanceKm,
  poundsInputToGrams,
  inchesInputToMm,
  milesInputToKm,
  gramsToPoundsInput,
  mmToInchesInput,
  kmToMilesInput,
} from './units';

const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

describe('unit converters use the exact specified factors', () => {
  it('distance km↔mi', () => {
    expect(near(kmToMiles(1), 0.621371)).toBe(true);
    expect(near(kmToMiles(10), 6.21371)).toBe(true);
    expect(near(milesToKm(1), 1.609347)).toBe(true);
  });
  it('length mm/cm↔in, m→ft', () => {
    expect(near(mmToInches(1), 0.0393701)).toBe(true);
    expect(near(mmToInches(25.4), 1)).toBe(true);
    expect(near(inchesToMm(1), 25.4)).toBe(true);
    expect(near(cmToInches(1), 0.393701)).toBe(true);
    expect(near(metersToFeet(1), 3.28084)).toBe(true);
  });
  it('weight g→oz, kg→lb', () => {
    expect(near(gramsToOunces(1), 0.035274)).toBe(true);
    expect(near(kgToPounds(1), 2.20462)).toBe(true);
    expect(near(gramsToPounds(1000), 2.20462)).toBe(true);
    expect(near(poundsToGrams(1), 453.592, 0.01)).toBe(true);
  });
});

describe('display formatters (metric → imperial string)', () => {
  it('weight shows lb ≥ 1 lb, else oz; null-safe', () => {
    expect(formatWeight(1000)).toBe('2.2 lb'); // 2.20462 → 2.2
    expect(formatWeight(907)).toBe('2 lb'); // ≈2.00 → trimmed
    expect(formatWeight(200)).toBe('7.1 oz'); // 7.05 → 7.1
    expect(formatWeight(0)).toBeNull();
    expect(formatWeight(null)).toBeNull();
  });
  it('length + dimensions in inches', () => {
    expect(formatLengthMm(300)).toBe('11.8 in');
    expect(formatDimensionsMm(300, 200, 100)).toBe('11.8 × 7.9 × 3.9 in');
    expect(formatDimensionsMm(300, null, 100)).toBe('11.8 × — × 3.9 in');
    expect(formatDimensionsMm(null, null, null)).toBeNull();
  });
  it('distance in miles', () => {
    expect(formatDistanceKm(10)).toBe('6.2 mi');
    expect(formatDistanceKm(0)).toBe('0 mi');
    expect(formatDistanceKm(null)).toBeNull();
  });
});

describe('form-input helpers (imperial ⇄ canonical metric int) — round-trip', () => {
  it('pounds ⇄ grams', () => {
    expect(poundsInputToGrams('2')).toBe(907); // 2 * 453.592 → 907
    expect(poundsInputToGrams('')).toBeNull();
    expect(poundsInputToGrams('abc')).toBeNull();
    expect(gramsToPoundsInput(907)).toBe('2'); // 907 → 1.9996 → 2.00 → "2"
    expect(gramsToPoundsInput(null)).toBe('');
  });
  it('inches ⇄ mm', () => {
    expect(inchesInputToMm('12')).toBe(305); // 12 * 25.4 = 304.8 → 305
    expect(mmToInchesInput(305)).toBe('12.01');
    expect(mmToInchesInput(254)).toBe('10');
  });
  it('miles ⇄ km (radius)', () => {
    expect(milesInputToKm('5')).toBe(8); // 5 * 1.609347 = 8.05 → 8
    expect(kmToMilesInput(8)).toBe('4.97'); // 8 * 0.621371 = 4.97
  });
});
