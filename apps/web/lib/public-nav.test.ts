import { describe, expect, it } from 'vitest';
import { PUBLIC_NAV_GROUPS, PUBLIC_NAV_HOME } from './public-nav';

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
      'Favorites',
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
