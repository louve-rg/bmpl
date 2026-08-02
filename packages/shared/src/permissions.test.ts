import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_BUNDLES } from './permissions';

describe('marketplace permissions (Phase 2)', () => {
  it('adds the marketplace permissions to the catalog', () => {
    for (const p of [
      'vendors.read',
      'vendors.moderate',
      'products.read',
      'products.moderate',
      'categories.manage',
    ] as const) {
      expect(PERMISSIONS).toContain(p);
    }
  });

  it('gives ADMIN full marketplace moderation', () => {
    expect(PERMISSION_BUNDLES.ADMIN).toEqual(
      expect.arrayContaining([
        'vendors.moderate',
        'products.moderate',
        'categories.manage',
      ]),
    );
  });

  it('gives SUPPORT_AGENT read-only marketplace access (no moderation)', () => {
    expect(PERMISSION_BUNDLES.SUPPORT_AGENT).toEqual(
      expect.arrayContaining(['vendors.read', 'products.read']),
    );
    expect(PERMISSION_BUNDLES.SUPPORT_AGENT).not.toContain('vendors.moderate');
    expect(PERMISSION_BUNDLES.SUPPORT_AGENT).not.toContain('products.moderate');
    expect(PERMISSION_BUNDLES.SUPPORT_AGENT).not.toContain('categories.manage');
  });

  it('SUPER_ADMIN holds every permission including the new ones', () => {
    expect(PERMISSION_BUNDLES.SUPER_ADMIN).toEqual([...PERMISSIONS]);
    expect(PERMISSION_BUNDLES.SUPER_ADMIN).toContain('categories.manage');
  });
});

describe('marketing & business promotion permissions (M26)', () => {
  it('adds the marketing permissions to the catalog', () => {
    for (const p of [
      'promotions.read',
      'promotions.moderate',
      'promotions.manage',
      'campaigns.manage',
      'coupons.manage',
      'marketing.analytics',
      'homepage.manage',
    ] as const) {
      expect(PERMISSIONS).toContain(p);
    }
  });

  it('ADMIN can moderate + manage promotions; SUPPORT_AGENT is read-only', () => {
    expect(PERMISSION_BUNDLES.ADMIN).toEqual(
      expect.arrayContaining(['promotions.moderate', 'promotions.manage', 'coupons.manage', 'homepage.manage']),
    );
    expect(PERMISSION_BUNDLES.SUPPORT_AGENT).toContain('promotions.read');
    expect(PERMISSION_BUNDLES.SUPPORT_AGENT).not.toContain('promotions.moderate');
    expect(PERMISSION_BUNDLES.SUPPORT_AGENT).not.toContain('coupons.manage');
    expect(PERMISSION_BUNDLES.SUPPORT_AGENT).not.toContain('homepage.manage');
  });
});
