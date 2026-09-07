import { describe, expect, it } from 'vitest';
import { verifyEmailFirst, verifyEmailFirstMessage } from './role-gate';

const gated = { canApply: true, requiresVerifiedEmail: true };
const ungated = { canApply: true, requiresVerifiedEmail: false };

describe('verifyEmailFirst', () => {
  it('gates an unverified person out of a provider-type application', () => {
    expect(verifyEmailFirst(gated, false)).toBe(true);
  });

  it('never gates a verified person — they must notice no change', () => {
    expect(verifyEmailFirst(gated, true)).toBe(false);
    expect(verifyEmailFirst(ungated, true)).toBe(false);
  });

  it('never gates an ungated role — JOB_SEEKER stays open to the unverified', () => {
    // A person looking for work is deliberately outside the gate (BMPL-40).
    // The flag comes from the server; this UI must not imply otherwise.
    expect(verifyEmailFirst(ungated, false)).toBe(false);
  });

  it('gates nothing when the verification state is unknown', () => {
    // Courtesy ahead of the refusal, never a replacement for it: if /me has
    // not answered, the person may proceed and the server remains the
    // authority at submit.
    expect(verifyEmailFirst(gated, null)).toBe(false);
  });

  it('gates nothing when the server did not send the flag', () => {
    // A deploy-window API without requiresVerifiedEmail must degrade to the
    // old behaviour (server 403 at submit), not to a wrongly-shown block.
    const flagless = { canApply: true } as unknown as typeof gated;
    expect(verifyEmailFirst(flagless, false)).toBe(false);
  });

  it('does not fire on a role that cannot be applied for anyway', () => {
    // Held / pending roles already show their status in place of the button.
    expect(verifyEmailFirst({ canApply: false, requiresVerifiedEmail: true }, false)).toBe(false);
  });
});

describe('verifyEmailFirstMessage', () => {
  it('says what to do, not just that the person is blocked', () => {
    // The sentence a person acts on: the reason, then the fix that exists on
    // the same page.
    expect(verifyEmailFirstMessage('Vendor')).toBe(
      'Verify your email address to apply for the Vendor role. Check your inbox for the verification link, or use “Resend verification email” above to get a new one.',
    );
  });
});
