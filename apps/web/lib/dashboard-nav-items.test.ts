import { describe, expect, it } from 'vitest';
import { visibleRoleGroups, type HeldRole } from './dashboard-nav';
import {
  BASE_NAV,
  DRIVER_NAV,
  PASSENGER_DRIVER_NAV,
  PASSENGER_OPERATOR_NAV,
  ROLE_GROUPS,
  allNavHrefs,
  isNavItemActive,
  type NavItem,
} from './dashboard-nav-items';

const driver: HeldRole[] = [{ roleCode: 'CUSTOMER', status: 'APPROVED' }, { roleCode: 'DELIVERY_DRIVER', status: 'APPROVED' }];
const everyItem: NavItem[] = [...BASE_NAV, ...ROLE_GROUPS.flatMap((g) => g.items)];

describe('the navigation definition', () => {
  it('is the single source of truth for both the sidebar and the drawer', () => {
    // Not a behavioural assertion so much as a structural one: if this module
    // stops being importable as plain data, the two shells have started to
    // diverge and the mobile menu will quietly lose items.
    expect(ROLE_GROUPS.length).toBeGreaterThan(0);
    expect(BASE_NAV.length).toBeGreaterThan(0);
  });

  it('gives every item a label, an internal href and an icon', () => {
    for (const item of everyItem) {
      expect(item.label.trim(), JSON.stringify(item)).not.toBe('');
      expect(item.href.startsWith('/'), item.label).toBe(true);
      expect(item.icon.trim(), item.label).not.toBe('');
    }
  });

  it('has no duplicate hrefs within a group', () => {
    for (const group of [{ heading: 'base', items: BASE_NAV }, ...ROLE_GROUPS]) {
      const hrefs = group.items.map((i) => i.href);
      expect(new Set(hrefs).size, group.heading).toBe(hrefs.length);
    }
  });
});

describe('driver navigation', () => {
  it('is called Driver Dashboard and points at the driver dashboard', () => {
    // The client asked for "Driver Home" to be renamed and to actually navigate
    // to the dashboard.
    const home = DRIVER_NAV.find((i) => i.href === '/dashboard/driver');
    expect(home?.label).toBe('Driver Dashboard');
    expect(DRIVER_NAV.some((i) => i.label === 'Driver Home')).toBe(false);
  });

  it('exposes every destination the client asked for', () => {
    expect(DRIVER_NAV.map((i) => i.label)).toEqual([
      'Driver Dashboard',
      'My Deliveries',
      'My Earnings',
      'Driver Profile',
      'Vehicle Profile',
      'Application & Documents',
      'Service Areas',
    ]);
  });

  it('points each destination at a real driver route', () => {
    expect(DRIVER_NAV.map((i) => i.href)).toEqual([
      '/dashboard/driver',
      '/dashboard/driver/jobs',
      '/dashboard/driver/earnings',
      '/dashboard/driver/profile',
      '/dashboard/driver/vehicles',
      '/dashboard/driver/documents',
      '/dashboard/driver/service-areas',
    ]);
  });

  it('is shown to an approved driver and to nobody else', () => {
    expect(visibleRoleGroups(ROLE_GROUPS, driver).map((g) => g.heading)).toEqual(['Driver']);
    expect(visibleRoleGroups(ROLE_GROUPS, [{ roleCode: 'CUSTOMER', status: 'APPROVED' }])).toEqual([]);
    expect(visibleRoleGroups(ROLE_GROUPS, [{ roleCode: 'DELIVERY_DRIVER', status: 'PENDING' }])).toEqual([]);
  });
});

describe('passenger-driver navigation', () => {
  it('is its own group, separate from the parcel Driver group', () => {
    // Carrying passengers is a different job from carrying parcels; folding it
    // into DRIVER_NAV would show passenger pages to parcel-only drivers.
    const group = ROLE_GROUPS.find((g) => g.heading === 'Passenger Driver');
    expect(group?.requires).toEqual(['PASSENGER_DRIVER']);
    expect(group?.items).toBe(PASSENGER_DRIVER_NAV);
    expect(DRIVER_NAV.some((i) => i.href.startsWith('/dashboard/passenger-driver'))).toBe(false);
  });

  it('points each destination at a real passenger-driver route', () => {
    expect(PASSENGER_DRIVER_NAV.map((i) => i.href)).toEqual([
      '/dashboard/passenger-driver',
      '/dashboard/passenger-driver/trips',
      '/dashboard/passenger-driver/profile',
      '/dashboard/passenger-driver/vehicles',
    ]);
  });

  it('is shown to an approved passenger driver and to nobody else', () => {
    const passengerDriver: HeldRole[] = [
      { roleCode: 'CUSTOMER', status: 'APPROVED' },
      { roleCode: 'PASSENGER_DRIVER', status: 'APPROVED' },
    ];
    expect(visibleRoleGroups(ROLE_GROUPS, passengerDriver).map((g) => g.heading)).toEqual(['Passenger Driver']);
    expect(visibleRoleGroups(ROLE_GROUPS, [{ roleCode: 'PASSENGER_DRIVER', status: 'PENDING' }])).toEqual([]);
    // The same human holding both driving roles sees both groups.
    expect(visibleRoleGroups(ROLE_GROUPS, [...driver, { roleCode: 'PASSENGER_DRIVER', status: 'APPROVED' }]).map((g) => g.heading)).toEqual([
      'Driver',
      'Passenger Driver',
    ]);
  });
});

describe('passenger-operator navigation', () => {
  it('is its own group, gated on the provider role alone', () => {
    // Running a service and driving one are different jobs; the operator
    // group must not leak into either driver group or vice versa.
    const group = ROLE_GROUPS.find((g) => g.heading === 'Passenger Operator');
    expect(group?.requires).toEqual(['PASSENGER_PROVIDER']);
    expect(group?.items).toBe(PASSENGER_OPERATOR_NAV);
    expect(PASSENGER_DRIVER_NAV.some((i) => i.href.startsWith('/dashboard/passenger-operator'))).toBe(false);
  });

  it('points each destination at a real operator route', () => {
    expect(PASSENGER_OPERATOR_NAV.map((i) => i.href)).toEqual([
      '/dashboard/passenger-operator',
      '/dashboard/passenger-operator/routes',
      '/dashboard/passenger-operator/departures',
      '/dashboard/passenger-operator/bookings',
      '/dashboard/passenger-operator/vehicles',
      '/dashboard/passenger-operator/profile',
    ]);
  });

  it('is shown to an approved provider and to nobody else', () => {
    expect(
      visibleRoleGroups(ROLE_GROUPS, [
        { roleCode: 'CUSTOMER', status: 'APPROVED' },
        { roleCode: 'PASSENGER_PROVIDER', status: 'APPROVED' },
      ]).map((g) => g.heading),
    ).toEqual(['Passenger Operator']);
    expect(visibleRoleGroups(ROLE_GROUPS, [{ roleCode: 'PASSENGER_PROVIDER', status: 'PENDING' }])).toEqual([]);
  });
});

describe('rider navigation', () => {
  it('gives every signed-in customer the Passenger Service entry, ungated', () => {
    // The demand side of passenger transport is a customer capability like
    // Shipments — it must not sit behind any role.
    const rider = BASE_NAV.find((i) => i.href === '/dashboard/passenger');
    expect(rider?.label).toBe('Passenger Service');
    expect(ROLE_GROUPS.some((g) => g.items.some((i) => i.href === '/dashboard/passenger'))).toBe(false);
  });

  it('does not collide with the passenger-driver or operator prefixes', () => {
    // '/dashboard/passenger' vs '/dashboard/passenger-driver': prefix matching
    // is boundary-aware ('/passenger/' vs '/passenger-'), so each lights only
    // its own section.
    const hrefs = allNavHrefs([{ items: BASE_NAV }, ...ROLE_GROUPS]);
    expect(isNavItemActive('/dashboard/passenger', '/dashboard/passenger-driver', hrefs)).toBe(false);
    expect(isNavItemActive('/dashboard/passenger', '/dashboard/passenger/bookings', hrefs)).toBe(true);
  });
});

describe('isNavItemActive', () => {
  const hrefs = allNavHrefs([{ items: BASE_NAV }, ...ROLE_GROUPS]);

  it('matches Overview only on the dashboard root', () => {
    expect(isNavItemActive('/dashboard', '/dashboard', hrefs)).toBe(true);
    expect(isNavItemActive('/dashboard', '/dashboard/driver', hrefs)).toBe(false);
  });

  it('matches a section and its subtree', () => {
    expect(isNavItemActive('/dashboard/driver/jobs', '/dashboard/driver/jobs', hrefs)).toBe(true);
    expect(isNavItemActive('/dashboard/driver/jobs', '/dashboard/driver/jobs/abc123', hrefs)).toBe(true);
  });

  it('lights exactly one item when one nav href is a prefix of another', () => {
    // '/dashboard/driver' is the parent of six other nav hrefs. A plain prefix
    // match highlighted both the parent and the child on every driver sub-page.
    const active = hrefs.filter((h) => isNavItemActive(h, '/dashboard/driver/vehicles', hrefs));
    expect(active).toEqual(['/dashboard/driver/vehicles']);
  });

  it('keeps the parent active on the parent’s own page', () => {
    const active = hrefs.filter((h) => isNavItemActive(h, '/dashboard/driver', hrefs));
    expect(active).toEqual(['/dashboard/driver']);
  });

  it('never marks more than one item active for any nav destination', () => {
    for (const pathname of hrefs) {
      const active = hrefs.filter((h) => isNavItemActive(h, pathname, hrefs));
      expect(active.length, `${pathname} → ${active.join(', ')}`).toBeLessThanOrEqual(1);
    }
  });

  it('does not match a sibling that merely shares a prefix string', () => {
    // '/dashboard/driver' must not light up for '/dashboard/drivers-guide'.
    expect(isNavItemActive('/dashboard/driver', '/dashboard/drivers-guide', hrefs)).toBe(false);
  });
});
