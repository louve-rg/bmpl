import { describe, expect, it } from 'vitest';
import {
  hasApprovedRole,
  hasPermission,
  isRoleSelectable,
  isSelfAction,
  selectableRoles,
  type AuthzSubject,
} from './index';

const subject: AuthzSubject = {
  userId: 'u1',
  roles: [
    { roleCode: 'CUSTOMER', status: 'APPROVED' },
    { roleCode: 'VENDOR', status: 'APPROVED' },
    { roleCode: 'DELIVERY_DRIVER', status: 'PENDING' },
    { roleCode: 'REAL_ESTATE_AGENT', status: 'REJECTED' },
    { roleCode: 'PASSENGER_DRIVER', status: 'SUSPENDED' },
  ],
  permissions: ['users.read', 'role_applications.review'],
};

describe('role authorization', () => {
  it('recognizes an approved role', () => {
    expect(hasApprovedRole(subject, 'VENDOR')).toBe(true);
  });

  it('treats non-approved roles as not usable', () => {
    expect(hasApprovedRole(subject, 'DELIVERY_DRIVER')).toBe(false);
    expect(hasApprovedRole(subject, 'REAL_ESTATE_AGENT')).toBe(false);
  });

  it('only APPROVED roles are selectable in the switcher', () => {
    expect(isRoleSelectable('APPROVED')).toBe(true);
    for (const s of ['PENDING', 'MORE_INFO_REQUIRED', 'REJECTED', 'SUSPENDED', 'REVOKED'] as const) {
      expect(isRoleSelectable(s)).toBe(false);
    }
    expect(selectableRoles(subject).sort()).toEqual(['CUSTOMER', 'VENDOR']);
  });

  it('checks admin permissions independently of roles', () => {
    expect(hasPermission(subject, 'role_applications.review')).toBe(true);
    expect(hasPermission(subject, 'admin.manage')).toBe(false);
  });

  it('detects self-actions to prevent self-approval', () => {
    expect(isSelfAction('u1', 'u1')).toBe(true);
    expect(isSelfAction('u1', 'u2')).toBe(false);
  });
});
