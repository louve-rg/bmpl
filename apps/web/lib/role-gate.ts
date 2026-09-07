import type { ApplicableRole } from './types';

/**
 * Say "verify your email first" BEFORE the refusal, not after it (BMPL-71).
 *
 * A verified email is required to apply for provider-type roles (BMPL-40, the
 * owner's ruling). The API refuses honestly at submit — this rule lets the
 * roles screen state that reason IN PLACE OF the Apply control, so nobody
 * fills in a whole application to learn it. The fare-gate pattern.
 *
 * The server stays the authority on both sides:
 * - which roles are gated comes from `requiresVerifiedEmail` on
 *   GET /roles/applicable (derived server-side; never re-derived here — a
 *   second list would drift from the first). An absent flag gates nothing.
 * - an UNKNOWN verification state (`null`) gates nothing: this is a courtesy
 *   ahead of the refusal, never a replacement for it, and the submit path
 *   still shows the server's 403 verbatim if it arrives anyway.
 */
export function verifyEmailFirst(
  role: Pick<ApplicableRole, 'canApply' | 'requiresVerifiedEmail'>,
  emailVerified: boolean | null,
): boolean {
  if (emailVerified !== false) return false;
  return role.canApply && role.requiresVerifiedEmail === true;
}

/**
 * The sentence shown in place of the Apply control. Mirrors the API's own
 * refusal wording, and points at the fix that is actually on the page (the
 * banner's resend button) — a block without a way out is what makes an honest
 * gate feel like a broken product. Every gated role is approval-gated
 * (the derivation guarantees it), so "apply" is always the right verb.
 */
export function verifyEmailFirstMessage(label: string): string {
  return `Verify your email address to apply for the ${label} role. Check your inbox for the verification link, or use “Resend verification email” above to get a new one.`;
}
