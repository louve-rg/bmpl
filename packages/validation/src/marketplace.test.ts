import { describe, expect, it } from 'vitest';
import {
  moderationDecisionSchema,
  moneyMinorSchema,
  productSortSchema,
  productStatusSchema,
  slugSchema,
  timeOfDaySchema,
  vendorApprovalStatusSchema,
} from './marketplace';

describe('slugSchema', () => {
  it('accepts valid slugs', () => {
    expect(slugSchema.parse('deshawn-corner-store')).toBe('deshawn-corner-store');
    expect(slugSchema.parse('AB12')).toBe('ab12'); // lowercased
  });

  it('rejects invalid slugs', () => {
    expect(slugSchema.safeParse('-bad').success).toBe(false);
    expect(slugSchema.safeParse('bad-').success).toBe(false);
    expect(slugSchema.safeParse('has space').success).toBe(false);
    expect(slugSchema.safeParse('x').success).toBe(false); // too short
  });
});

describe('moneyMinorSchema', () => {
  it('coerces and validates integer minor units', () => {
    expect(moneyMinorSchema.parse('1999')).toBe(1999);
    expect(moneyMinorSchema.parse(0)).toBe(0);
  });

  it('rejects negatives and non-integers', () => {
    expect(moneyMinorSchema.safeParse(-1).success).toBe(false);
    expect(moneyMinorSchema.safeParse(9.99).success).toBe(false);
  });
});

describe('enum + helper schemas', () => {
  it('validate against the shared vocabularies', () => {
    expect(vendorApprovalStatusSchema.parse('APPROVED')).toBe('APPROVED');
    expect(productStatusSchema.safeParse('PENDING_REVIEW').success).toBe(true);
    expect(productStatusSchema.safeParse('LIVE').success).toBe(false);
    expect(productSortSchema.parse('price_asc')).toBe('price_asc');
  });

  it('timeOfDaySchema enforces HH:MM', () => {
    expect(timeOfDaySchema.parse('09:30')).toBe('09:30');
    expect(timeOfDaySchema.safeParse('9:30').success).toBe(false);
    expect(timeOfDaySchema.safeParse('24:00').success).toBe(false);
  });

  it('moderationDecisionSchema allows an optional note', () => {
    expect(moderationDecisionSchema.parse({})).toEqual({});
    expect(moderationDecisionSchema.parse({ note: 'looks good' })).toEqual({ note: 'looks good' });
  });
});
