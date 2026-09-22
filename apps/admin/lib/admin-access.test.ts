import { describe, expect, it } from 'vitest';
import { canEnterConsole } from './admin-access';

/** The seeded uat-ops-full account, as /me actually reports it: an APPROVED
 *  ADMIN role and logistics grants only — no users.read. This exact shape
 *  could never enter the console before BMPL-143. */
const scopedLogisticsAdmin = {
  roles: [
    { roleCode: 'CUSTOMER', status: 'APPROVED' },
    { roleCode: 'ADMIN', status: 'APPROVED' },
  ],
  adminPermissions: ['logistics.manage', 'logistics.operate', 'logistics.read', 'logistics.verify'],
};

describe('canEnterConsole', () => {
  it('admits a scoped admin: APPROVED ADMIN role + at least one grant', () => {
    expect(canEnterConsole(scopedLogisticsAdmin)).toBe(true);
    // One grant is enough — the screens do the narrowing, not the door.
    expect(canEnterConsole({ roles: [{ roleCode: 'ADMIN', status: 'APPROVED' }], adminPermissions: ['logistics.read'] })).toBe(true);
  });

  it('refuses an ordinary customer', () => {
    expect(canEnterConsole({ roles: [{ roleCode: 'CUSTOMER', status: 'APPROVED' }], adminPermissions: [] })).toBe(false);
  });

  it('refuses an ADMIN role with zero grants — a role without capability is not entry', () => {
    expect(canEnterConsole({ roles: [{ roleCode: 'ADMIN', status: 'APPROVED' }], adminPermissions: [] })).toBe(false);
  });

  it('refuses grants without the ADMIN role', () => {
    expect(canEnterConsole({ roles: [{ roleCode: 'CUSTOMER', status: 'APPROVED' }], adminPermissions: ['logistics.read'] })).toBe(false);
  });

  it('refuses a non-APPROVED admin role (pending, suspended, revoked)', () => {
    for (const status of ['PENDING', 'SUSPENDED', 'REVOKED']) {
      expect(canEnterConsole({ roles: [{ roleCode: 'ADMIN', status }], adminPermissions: ['logistics.read'] }), status).toBe(false);
    }
  });

  it('fails closed on missing or null data', () => {
    expect(canEnterConsole(null)).toBe(false);
    expect(canEnterConsole(undefined)).toBe(false);
    expect(canEnterConsole({})).toBe(false);
    expect(canEnterConsole({ roles: null, adminPermissions: null })).toBe(false);
    expect(canEnterConsole({ roles: [{ roleCode: 'ADMIN', status: 'APPROVED' }] })).toBe(false);
  });
});
