import { BRAND } from '@bmpl/shared';

/**
 * Design tokens shared across web + admin (and available to mobile). Single
 * source for the Belize brand palette so the apps stay visually consistent.
 */
export const colors = BRAND.colors;

export const gradients = {
  hero: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #3b82f6 100%)',
  accent: 'linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)',
};

export const roleStatusColor: Record<string, { bg: string; fg: string }> = {
  APPROVED: { bg: '#dcfce7', fg: '#15803d' },
  PENDING: { bg: '#fef3c7', fg: '#b45309' },
  MORE_INFO_REQUIRED: { bg: '#dbeafe', fg: '#1d4ed8' },
  REJECTED: { bg: '#fee2e2', fg: '#b91c1c' },
  SUSPENDED: { bg: '#ffedd5', fg: '#c2410c' },
  REVOKED: { bg: '#e2e8f0', fg: '#334155' },
};
