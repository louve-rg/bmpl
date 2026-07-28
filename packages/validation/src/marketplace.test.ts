import { describe, expect, it } from 'vitest';
import {
  createCategorySchema,
  createVendorProfileSchema,
  moderationDecisionSchema,
  moneyMinorSchema,
  productSortSchema,
  productStatusSchema,
  slugSchema,
  timeOfDaySchema,
  updateCategorySchema,
  vendorApprovalStatusSchema,
  vendorHoursSchema,
  createProductSchema,
  productQuerySchema,
  productImageConfirmSchema,
  imageReorderSchema,
  createVariantSchema,
  inventoryAdjustSchema,
  inventorySettingsSchema,
  vendorQuerySchema,
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

describe('category schemas (M1)', () => {
  it('createCategorySchema applies sensible defaults', () => {
    const v = createCategorySchema.parse({ name: 'Electronics' });
    expect(v).toMatchObject({ name: 'Electronics', featured: false, isVisible: true, sortOrder: 0 });
  });

  it('createCategorySchema requires a name and validates an explicit slug', () => {
    expect(createCategorySchema.safeParse({ name: '' }).success).toBe(false);
    expect(createCategorySchema.safeParse({ name: 'X', slug: 'Bad Slug' }).success).toBe(false);
    expect(createCategorySchema.parse({ name: 'X', slug: 'good-slug' }).slug).toBe('good-slug');
  });

  it('updateCategorySchema rejects an empty patch but allows partial fields', () => {
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
    expect(updateCategorySchema.parse({ featured: true })).toEqual({ featured: true });
    expect(updateCategorySchema.parse({ parentId: null })).toEqual({ parentId: null });
  });
});

describe('vendor schemas (M2)', () => {
  it('createVendorProfileSchema requires a name and valid email', () => {
    expect(createVendorProfileSchema.safeParse({ businessName: 'X', contactEmail: 'a@b.co' }).success).toBe(false); // name too short
    expect(createVendorProfileSchema.safeParse({ businessName: 'My Shop', contactEmail: 'nope' }).success).toBe(false);
    const ok = createVendorProfileSchema.parse({ businessName: 'My Shop', contactEmail: 'A@B.CO' });
    expect(ok.contactEmail).toBe('a@b.co');
  });

  it('vendorHoursSchema enforces open<close and unique days', () => {
    expect(
      vendorHoursSchema.safeParse({ hours: [{ dayOfWeek: 1, isClosed: false, openTime: '17:00', closeTime: '09:00' }] }).success,
    ).toBe(false);
    expect(
      vendorHoursSchema.safeParse({
        hours: [
          { dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '17:00' },
          { dayOfWeek: 1, isClosed: true },
        ],
      }).success,
    ).toBe(false); // duplicate day
    expect(
      vendorHoursSchema.safeParse({ hours: [{ dayOfWeek: 2, isClosed: true }] }).success,
    ).toBe(true);
  });
});

describe('product schemas (M4)', () => {
  const base = { title: 'Earbuds', sku: 'WE-1', categoryId: 'clabcabcabcabcabcabcabca', priceMinor: 1000 };

  it('createProductSchema requires core fields and defaults featured=false', () => {
    const ok = createProductSchema.parse(base);
    expect(ok.featured).toBe(false);
    expect(createProductSchema.safeParse({ ...base, title: 'x' }).success).toBe(false); // title min 2
    expect(createProductSchema.safeParse({ title: 'X2', sku: 'S', priceMinor: 10 }).success).toBe(false); // missing category
  });

  it('rejects a sale price above the price', () => {
    expect(createProductSchema.safeParse({ ...base, salePriceMinor: 2000 }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, salePriceMinor: 500 }).success).toBe(true);
  });

  it('productQuerySchema applies pagination + sort defaults', () => {
    const q = productQuerySchema.parse({});
    expect(q).toMatchObject({ sort: 'newest', page: 1, pageSize: 24 });
    expect(productQuerySchema.parse({ page: '3', sort: 'price_asc' })).toMatchObject({ page: 3, sort: 'price_asc' });
  });

  it('productQuerySchema coerces filters (price/inStock/featured)', () => {
    const q = productQuerySchema.parse({ priceMin: '1000', priceMax: '5000', inStock: 'true', featured: 'true' });
    expect(q).toMatchObject({ priceMin: 1000, priceMax: 5000, inStock: true, featured: true });
    expect(productQuerySchema.safeParse({ pageSize: '999' }).success).toBe(false); // max 48
  });
});

describe('product image schemas (M5)', () => {
  it('productImageConfirmSchema requires a key, allows optional dims/text', () => {
    expect(productImageConfirmSchema.safeParse({}).success).toBe(false);
    const ok = productImageConfirmSchema.parse({ key: 'vendors/v/products/p/x.png', width: 800, height: 600, altText: 'a' });
    expect(ok.width).toBe(800);
    expect(productImageConfirmSchema.safeParse({ key: 'k', width: -1 }).success).toBe(false);
  });

  it('imageReorderSchema requires a non-empty id list', () => {
    expect(imageReorderSchema.safeParse({ order: [] }).success).toBe(false);
    expect(imageReorderSchema.safeParse({ order: ['clabcabcabcabcabcabcabca'] }).success).toBe(true);
  });
});

describe('variant + inventory schemas (M6)', () => {
  it('createVariantSchema needs at least one option value + defaults quantity', () => {
    expect(createVariantSchema.safeParse({ optionValueIds: [] }).success).toBe(false);
    const v = createVariantSchema.parse({ optionValueIds: ['clabcabcabcabcabcabcabca'] });
    expect(v.quantity).toBe(0);
  });

  it('inventoryAdjustSchema rejects zero delta + bad reason', () => {
    expect(inventoryAdjustSchema.safeParse({ delta: 0, reason: 'RESTOCK' }).success).toBe(false);
    expect(inventoryAdjustSchema.safeParse({ delta: 5, reason: 'NONSENSE' }).success).toBe(false);
    expect(inventoryAdjustSchema.parse({ delta: -2, reason: 'CORRECTION' }).delta).toBe(-2);
  });

  it('inventorySettingsSchema requires at least one field', () => {
    expect(inventorySettingsSchema.safeParse({}).success).toBe(false);
    expect(inventorySettingsSchema.parse({ unlimited: true })).toEqual({ unlimited: true });
  });

  it('vendorQuerySchema accepts optional q + district', () => {
    expect(vendorQuerySchema.parse({})).toEqual({});
    expect(vendorQuerySchema.parse({ q: 'shop', district: 'CAYO' })).toMatchObject({ q: 'shop', district: 'CAYO' });
    expect(vendorQuerySchema.safeParse({ district: 'ATLANTIS' }).success).toBe(false);
  });
});
