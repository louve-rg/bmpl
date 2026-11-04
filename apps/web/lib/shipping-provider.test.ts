import { describe, expect, it } from 'vitest';
import { isPendingProposal, navApplicationBadge, operatingStatusLabel, orgStatusView, type ProviderStatus } from './shipping-provider';

describe('isPendingProposal', () => {
  it('is a live proposal only while both accept and reject are still open', () => {
    expect(isPendingProposal({ canAccept: true, canReject: true })).toBe(true);
  });
  it('is not pending once either answer has been given', () => {
    expect(isPendingProposal({ canAccept: false, canReject: false })).toBe(false);
  });
});

describe('orgStatusView — mirrors assertProviderOperableStatus/assertProviderContinuationAllowed', () => {
  it('SUSPENDED reads as a reversible administrative hold that still allows finishing an already-accepted leg', () => {
    const v = orgStatusView('SUSPENDED');
    expect(v.tone).toBe('warning');
    expect(v.body).toMatch(/finish any leg you already accepted/);
    expect(v.body).toMatch(/cannot accept a new proposal/);
  });

  it('REVOKED reads as a terminal-for-the-org-right-now security cutoff that blocks even continuing accepted work', () => {
    const v = orgStatusView('REVOKED');
    expect(v.tone).toBe('error');
    expect(v.body).toMatch(/cannot take on or continue any work/);
    expect(v.body).toMatch(/including a leg you had already accepted/);
  });

  it('SUSPENDED and REVOKED read distinctly from each other, not as the same severity', () => {
    expect(orgStatusView('SUSPENDED').tone).not.toBe(orgStatusView('REVOKED').tone);
  });

  it('APPROVED and PENDING read as non-error states', () => {
    expect(orgStatusView('APPROVED').tone).toBe('success');
    expect(orgStatusView('PENDING').tone).toBe('info');
  });
});

describe('navApplicationBadge (MDF-526) — labels the Carrier nav heading legibly while the role is not yet approved', () => {
  it('gives every ProviderStatus a short, distinct word', () => {
    const statuses: ProviderStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED'];
    const labels = statuses.map(navApplicationBadge);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('APPROVED still reads as not-yet-live, since the badge only renders before role approval', () => {
    expect(navApplicationBadge('APPROVED')).toMatch(/pending/i);
  });
});

describe('operatingStatusLabel', () => {
  it('labels the three real values and falls back to the raw string for anything else', () => {
    expect(operatingStatusLabel('OPERATING')).toBe('Operating');
    expect(operatingStatusLabel('REDUCED')).toBe('Reduced');
    expect(operatingStatusLabel('NOT_OPERATING')).toBe('Not operating');
    expect(operatingStatusLabel('SOMETHING_ELSE')).toBe('SOMETHING_ELSE');
  });
});
