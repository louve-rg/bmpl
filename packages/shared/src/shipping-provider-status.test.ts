import { describe, expect, it } from 'vitest';
import {
  canChangeProviderStatus,
  isOperableProviderStatus,
  mayContinueExistingProviderWork,
  providerStatusTarget,
  SHIPPING_PROVIDER_STATUS_ACTIONS,
  SHIPPING_PROVIDER_STATUSES,
} from './shipping-provider-status';

describe('the provider status transition table (D5)', () => {
  it('every status has at least one legal outbound action — no state is reachable that only a developer can leave', () => {
    const reachable = new Set(Object.values(SHIPPING_PROVIDER_STATUS_ACTIONS).flatMap((a) => a.from));
    for (const status of SHIPPING_PROVIDER_STATUSES) {
      expect(reachable.has(status)).toBe(true);
    }
  });

  it('the security line: RESUBMIT is the only CARRIER-actor action, and its only `from` is REJECTED', () => {
    const carrierActions = Object.entries(SHIPPING_PROVIDER_STATUS_ACTIONS).filter(([, a]) => a.actor === 'CARRIER');
    expect(carrierActions).toHaveLength(1);
    const [name, action] = carrierActions[0]!;
    expect(name).toBe('RESUBMIT');
    expect(action.from).toEqual(['REJECTED']);
    expect(action.to).toBe('PENDING');
  });

  it('no CARRIER-actor edge exists out of SUSPENDED or REVOKED at all — not merely refused, absent', () => {
    for (const [, action] of Object.entries(SHIPPING_PROVIDER_STATUS_ACTIONS)) {
      if (action.actor !== 'CARRIER') continue;
      expect(action.from).not.toContain('SUSPENDED');
      expect(action.from).not.toContain('REVOKED');
    }
  });

  it('canChangeProviderStatus/providerStatusTarget agree with the table', () => {
    expect(canChangeProviderStatus('APPROVE', 'PENDING')).toBe(true);
    expect(canChangeProviderStatus('APPROVE', 'APPROVED')).toBe(false);
    expect(providerStatusTarget('SUSPEND')).toBe('SUSPENDED');
    expect(canChangeProviderStatus('REVOKE', 'APPROVED')).toBe(true);
    expect(canChangeProviderStatus('REVOKE', 'SUSPENDED')).toBe(true);
    expect(canChangeProviderStatus('REVOKE', 'PENDING')).toBe(false);
  });

  it('only APPROVED is operable', () => {
    for (const status of SHIPPING_PROVIDER_STATUSES) {
      expect(isOperableProviderStatus(status)).toBe(status === 'APPROVED');
    }
  });

  it('MDF-500: APPROVED and SUSPENDED may continue existing work; REVOKED, REJECTED and PENDING may not', () => {
    for (const status of SHIPPING_PROVIDER_STATUSES) {
      expect(mayContinueExistingProviderWork(status)).toBe(status === 'APPROVED' || status === 'SUSPENDED');
    }
  });
});
