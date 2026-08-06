import { describe, expect, it } from 'vitest';
import type { RoleCode } from '@bmpl/shared';
import { approvedRoles, visibleRoleGroups, type HeldRole, type RoleGatedGroup } from './dashboard-nav';

const role = (roleCode: RoleCode, status = 'APPROVED'): HeldRole => ({ roleCode, status });

/** Mirrors the real ROLE_GROUPS shape from the Sidebar (headings + required roles). */
const GROUPS: ReadonlyArray<RoleGatedGroup<string>> = [
  { heading: 'Belize Connect', items: ['Job Profile'], requires: ['JOB_SEEKER'] },
  { heading: 'Real Estate', items: ['Saved Properties'], requires: ['PROPERTY_OWNER', 'REAL_ESTATE_AGENT'] },
  { heading: 'Driver', items: ['Driver Home'], requires: ['DELIVERY_DRIVER'] },
  { heading: 'Vendor', items: ['My Store'], requires: ['VENDOR'] },
  { heading: 'Marketing', items: ['Promotions'], requires: ['VENDOR', 'EMPLOYER'] },
];

const headings = (roles: HeldRole[]): string[] => visibleRoleGroups(GROUPS, roles).map((g) => g.heading);

describe('visibleRoleGroups', () => {
  it('shows a driver ONLY the driver section', () => {
    // The reported bug: an approved delivery driver also saw Belize Connect and
    // Real Estate, because those two groups were not gated at all.
    expect(headings([role('CUSTOMER'), role('DELIVERY_DRIVER')])).toEqual(['Driver']);
  });

  it('shows a plain customer no role sections at all', () => {
    expect(headings([role('CUSTOMER')])).toEqual([]);
    expect(headings([])).toEqual([]);
  });

  it('ignores roles that are not APPROVED', () => {
    for (const status of ['PENDING', 'REJECTED', 'REVOKED', 'SUSPENDED']) {
      expect(headings([role('DELIVERY_DRIVER', status)]), status).toEqual([]);
    }
  });

  it('reveals a section as soon as its role is approved', () => {
    expect(headings([role('JOB_SEEKER', 'PENDING')])).toEqual([]);
    expect(headings([role('JOB_SEEKER')])).toEqual(['Belize Connect']);
  });

  it('shows every section the user qualifies for, in declaration order', () => {
    expect(headings([role('VENDOR'), role('DELIVERY_DRIVER')])).toEqual(['Driver', 'Vendor', 'Marketing']);
  });

  it('matches a group when the user holds ANY one of its roles', () => {
    expect(headings([role('PROPERTY_OWNER')])).toContain('Real Estate');
    expect(headings([role('REAL_ESTATE_AGENT')])).toContain('Real Estate');
    expect(headings([role('EMPLOYER')])).toEqual(['Marketing']);
  });

  it('never shows a group that requires no roles — an empty list is a mistake, not "everyone"', () => {
    const bad: ReadonlyArray<RoleGatedGroup<string>> = [{ heading: 'Oops', items: ['x'], requires: [] }];
    expect(visibleRoleGroups(bad, [role('CUSTOMER'), role('VENDOR')])).toEqual([]);
  });

  it('does not mutate or reorder the source groups', () => {
    const before = GROUPS.map((g) => g.heading);
    visibleRoleGroups(GROUPS, [role('VENDOR')]);
    expect(GROUPS.map((g) => g.heading)).toEqual(before);
  });
});

describe('approvedRoles', () => {
  it('keeps only APPROVED entries', () => {
    const set = approvedRoles([role('VENDOR'), role('EMPLOYER', 'PENDING'), role('CUSTOMER')]);
    expect([...set].sort()).toEqual(['CUSTOMER', 'VENDOR']);
  });
});
