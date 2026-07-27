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
