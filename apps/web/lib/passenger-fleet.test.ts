import { describe, expect, it } from 'vitest';
import { affiliationView, consentLabel, consentPath, settledLabel } from './passenger-fleet';

describe('affiliationView — mutual consent, from each side', () => {
  it('never lets the side that asked answer its own ask', () => {
    // The whole point of the feature: a PENDING ask offers its INITIATOR only
    // withdrawal — the consent verbs belong to the counterparty alone.
    expect(affiliationView({ status: 'PENDING', initiatedBy: 'PROVIDER' }, 'PROVIDER')).toEqual({
      kind: 'awaiting',
      action: 'withdraw',
      waitingOn: 'them',
    });
    expect(affiliationView({ status: 'PENDING', initiatedBy: 'DRIVER' }, 'DRIVER')).toEqual({
      kind: 'awaiting',
      action: 'withdraw',
      waitingOn: 'them',
    });
  });

  it('offers the counterparty exactly consent-or-decline on a pending ask', () => {
    expect(affiliationView({ status: 'PENDING', initiatedBy: 'PROVIDER' }, 'DRIVER')).toEqual({
      kind: 'answer',
      actions: ['consent', 'decline'],
      waitingOn: 'you',
    });
    expect(affiliationView({ status: 'PENDING', initiatedBy: 'DRIVER' }, 'PROVIDER')).toEqual({
      kind: 'answer',
      actions: ['consent', 'decline'],
      waitingOn: 'you',
    });
  });

  it('lets either side end an active affiliation — consent creates, either side dissolves', () => {
    for (const side of ['DRIVER', 'PROVIDER'] as const) {
      for (const initiatedBy of ['DRIVER', 'PROVIDER'] as const) {
        expect(affiliationView({ status: 'ACCEPTED', initiatedBy }, side)).toEqual({ kind: 'active', action: 'end' });
      }
    }
  });

  it('offers no verbs at all on a settled row', () => {
    for (const status of ['DECLINED', 'WITHDRAWN', 'ENDED']) {
      expect(affiliationView({ status, initiatedBy: 'DRIVER' }, 'PROVIDER')).toEqual({ kind: 'settled' });
      expect(affiliationView({ status, initiatedBy: 'PROVIDER' }, 'DRIVER')).toEqual({ kind: 'settled' });
    }
  });
});

describe('consent vocabulary', () => {
  it('matches each side of the API: a driver accepts, an operator approves', () => {
    expect(consentLabel('DRIVER')).toBe('Accept');
    expect(consentPath('DRIVER')).toBe('accept');
    expect(consentLabel('PROVIDER')).toBe('Approve');
    expect(consentPath('PROVIDER')).toBe('approve');
  });
});

describe('settledLabel', () => {
  it('says who settled it, from the reader’s side', () => {
    expect(settledLabel({ status: 'DECLINED', endedBy: 'DRIVER' }, 'DRIVER')).toBe('You declined');
    expect(settledLabel({ status: 'DECLINED', endedBy: 'DRIVER' }, 'PROVIDER')).toBe('Declined');
    expect(settledLabel({ status: 'WITHDRAWN', endedBy: 'PROVIDER' }, 'PROVIDER')).toBe('You withdrew');
    expect(settledLabel({ status: 'ENDED', endedBy: 'PROVIDER' }, 'DRIVER')).toBe('Ended');
  });
});
