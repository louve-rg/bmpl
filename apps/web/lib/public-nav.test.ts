import { describe, expect, it } from 'vitest';
import { PUBLIC_NAV_GROUPS, PUBLIC_NAV_HOME, isGroupCurrent, isItemCurrent } from './public-nav';

/**
 * P6: Edward's hierarchy as data. Pins the eight-part structure, that Vendors
 * sits under Commerce, that the four landing anchors are gone, and that the
 * four named gaps are absent rather than stubbed.
 */
const headings = PUBLIC_NAV_GROUPS.map((g) => g.heading);
const allItems = PUBLIC_NAV_GROUPS.flatMap((g) => g.items);
const allLabels = [PUBLIC_NAV_HOME.label, ...headings, ...allItems.map((i) => i.label)];

describe('public nav hierarchy (P6)', () => {
  it('opens with Home and keeps Edward’s group order', () => {
    expect(PUBLIC_NAV_HOME).toEqual({ label: 'Home', href: '/' });
    expect(headings).toEqual([
      'Commerce',
      'Transport & Logistics',
      'Belize Connect',
      'Real Estate',
      'Opportunities & Earnings',
    ]);
  });

  it('puts Vendors under Commerce, beside Marketplace, View Cart and Orders', () => {
    const commerce = PUBLIC_NAV_GROUPS.find((g) => g.heading === 'Commerce')!;
    expect(commerce.items.map((i) => i.label)).toEqual(['Marketplace', 'Vendors', 'View Cart', 'Orders']);
    expect(commerce.items.find((i) => i.label === 'Vendors')!.href).toBe('/vendors');
  });

  it('has no landing-page anchor or dead link anywhere', () => {
    for (const item of allItems) {
      expect(item.href.startsWith('/')).toBe(true);
      expect(item.href.startsWith('/#')).toBe(false);
      expect(item.href).not.toBe('#');
    }
  });

  it('drops the four anchors and leaves the named gaps out, not stubbed', () => {
    for (const gone of ['Services', 'For Providers', 'Wallet', 'Mobile App', 'Marketing', 'Get Help', 'Lease', 'Names']) {
      expect(allLabels).not.toContain(gone);
    }
  });

  it('routes Sale and Rent as filtered views of /properties, not new pages', () => {
    const sale = allItems.find((i) => i.label === 'Sale')!;
    const rent = allItems.find((i) => i.label === 'Rent')!;
    expect(sale.href).toBe('/properties?purpose=FOR_SALE');
    expect(rent.href).toBe('/properties?purpose=FOR_RENT');
  });
});

// The active-page rule for the public nav. Leaves match exactly on the path and
// on every query parameter in their href; groups also light for a page nested
// under one of their items.
describe('isItemCurrent', () => {
  it('matches the same path', () => {
    expect(isItemCurrent('/products', '/products', '')).toBe(true);
  });

  it('ignores a trailing slash', () => {
    expect(isItemCurrent('/products', '/products/', '')).toBe(true);
  });

  it('does not match a nested path (leaves are exact)', () => {
    expect(isItemCurrent('/products', '/products/some-product', '')).toBe(false);
  });

  it('tells Sale and Rent apart by their query on the same path', () => {
    expect(isItemCurrent('/properties?purpose=FOR_SALE', '/properties', 'purpose=FOR_SALE')).toBe(true);
    expect(isItemCurrent('/properties?purpose=FOR_SALE', '/properties', 'purpose=FOR_RENT')).toBe(false);
    expect(isItemCurrent('/properties?purpose=FOR_SALE', '/properties', '')).toBe(false);
  });

  it('a plain leaf still matches when the page has extra query parameters', () => {
    expect(isItemCurrent('/shipping', '/shipping', 'ref=abc')).toBe(true);
  });

  it('Home matches only the root', () => {
    expect(isItemCurrent('/', '/', '')).toBe(true);
    expect(isItemCurrent('/', '/products', '')).toBe(false);
  });
});

describe('isGroupCurrent', () => {
  const group = (heading: string) => PUBLIC_NAV_GROUPS.find((g) => g.heading === heading)!;

  it('is current when the page is one of its items', () => {
    expect(isGroupCurrent(group('Commerce'), '/orders', '')).toBe(true);
  });

  it('is current when the page is nested under one of its items', () => {
    expect(isGroupCurrent(group('Commerce'), '/products/some-product', '')).toBe(true);
    expect(isGroupCurrent(group('Real Estate'), '/properties/123', '')).toBe(true);
  });

  it('is not current for a page outside its items', () => {
    expect(isGroupCurrent(group('Commerce'), '/login', '')).toBe(false);
  });

  it('does not treat a longer path prefix as nested (/productsfoo is not /products)', () => {
    expect(isGroupCurrent(group('Commerce'), '/productsfoo', '')).toBe(false);
  });

  it('Home is never a group, and the root lights no group', () => {
    for (const g of PUBLIC_NAV_GROUPS) {
      expect(isGroupCurrent(g, '/', '')).toBe(false);
    }
  });
});

// Favorites is not a public group. Edward's hierarchy puts it under the account
// menu, and the saved-addresses page is already in the account navigation, so the
// destination survives and only the public entry is gone.
describe('Favorites is not in the public nav', () => {
  it('has no Favorites group and no link to the personal addresses page', () => {
    expect(headings).not.toContain('Favorites');
    expect(allItems.map((i) => i.href)).not.toContain('/dashboard/addresses');
  });
});
