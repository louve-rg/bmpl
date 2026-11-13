import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DevMailboxService } from '../notifications/dev-mailbox.service';

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Distinguishes WHY `delivered` came out the way it did. `sent` is the only
 * outcome where a real provider accepted the message. `simulated` is the
 * console transport's accept-but-discard path — `delivered` stays `true` for
 * it (see `send()` below) so the dev mailbox and every existing caller keep
 * working exactly as before, but `outcome` lets a log reader, the admin
 * diagnostic (`OpsService.emailDiagnostics`) or a future caller of
 * `sendDetailed()` tell "really sent" apart from "accepted and thrown away".
 */
export type EmailSendOutcome = 'sent' | 'simulated' | 'not_implemented' | 'missing_credential' | 'provider_error';

export interface EmailSendResult {
  /** Same semantics `send()` has always returned: whether the caller may treat
   *  this as emailed. `true` for `sent` AND `simulated` — changing `simulated`
   *  to `false` would silently stop the dev mailbox from recording local/test
   *  verification + reset tokens, which is existing, relied-upon behavior. */
  delivered: boolean;
  outcome: EmailSendOutcome;
}

/** Read-only, admin-facing report of the transport's actual configuration.
 *  Never includes a credential value, prefix or length — presence only. */
export interface EmailDiagnostics {
  provider: Env['EMAIL_PROVIDER'];
  /** Whether the credential this provider requires is present. `console`
   *  requires none, so this is vacuously `true` for it. */
  credentialPresent: boolean;
  /** Whether this exact provider+credential combination can actually
   *  deliver mail right now. `false` for `console` (nothing is ever really
   *  sent) and for `smtp` (transport not implemented) even with a credential. */
  canDeliver: boolean;
}

/**
 * Transactional email transport with an environment-selected provider:
 *  - `console` (local/dev): logs a one-line summary; the actual body is captured
 *    by the dev mailbox (dev only) for token retrieval — no real send.
 *  - `resend` (cloud): posts to the Resend API. Requires RESEND_API_KEY.
 *  - `smtp`: placeholder for a future SMTP transport.
 *
 * `send` returns whether delivery was accepted. Callers must NOT report a
 * sensitive action as emailed when this returns false. Tokens are never logged.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly devMailbox: DevMailboxService,
  ) {}

  /** Back-compat wrapper — existing callers keep the exact boolean they always
   *  got. New code that needs to tell a real send apart from the console
   *  transport's simulated accept should call `sendDetailed()` instead. */
  async send(email: OutboundEmail): Promise<boolean> {
    return (await this.sendDetailed(email)).delivered;
  }

  /**
   * MDF-709 follow-up (Stanley, via the dispatcher): the dev mailbox used to
   * be filled by whichever CALLER happened to remember to do it —
   * `notifications.service.ts`'s `sendEmail` and `TerminalService`'s
   * `inviteMember`/`resendInvite` each ran their own identical `if
   * (delivered) devMailbox.record(...)` after calling this service. That
   * is not a dev mailbox, it is three ad-hoc captures — the MDF-709 reveal
   * email (`ShipmentService.requestDeliveryCodeEmail`/
   * `requestCollectionCodeEmail`) went through this exact method and was
   * never captured anywhere, because nobody had added a fourth copy of the
   * same four lines for it. Recording here, once, for every accepted send
   * regardless of caller, is the fix — not a workaround, the correct
   * design. Safe by construction: `DevMailboxService.record` is already a
   * no-op outside `NODE_ENV !== production` (its own `enabled` flag), and
   * `DevModule` is never registered in production at all (`app.module.ts`),
   * so this changes nothing about what a production deploy does.
   *
   * The three callers above had their own `devMailbox.record()` calls
   * DELETED in the same change that added this — recording at both layers
   * would double the dev mailbox's buffer for every email any of them
   * sends, and a reader (Stanley's own `latestFor()`) would see duplicates.
   */
  async sendDetailed(email: OutboundEmail): Promise<EmailSendResult> {
    const result = await this.dispatch(email);
    if (result.delivered) {
      this.devMailbox.record({ to: email.to, subject: email.subject, body: email.body, createdAt: new Date().toISOString() });
    }
    return result;
  }

  private async dispatch(email: OutboundEmail): Promise<EmailSendResult> {
    switch (this.env.EMAIL_PROVIDER) {
      case 'resend':
        return this.sendViaResend(email);
      case 'smtp':
        this.logger.warn('SMTP transport is not implemented; email not sent.');
        return { delivered: false, outcome: 'not_implemented' };
      case 'console':
      default:
        // Do NOT log the body (it contains verification/reset tokens). The
        // "simulated" tag is what lets a log reader tell this apart from a
        // real send — see EmailSendOutcome.
        this.logger.log(`[email:console] simulated accept (not delivered) to=${email.to} subject="${email.subject}"`);
        return { delivered: true, outcome: 'simulated' };
    }
  }

  /** Admin-facing diagnostic — see EmailDiagnostics. */
  getDiagnostics(): EmailDiagnostics {
    const provider = this.env.EMAIL_PROVIDER;
    if (provider === 'resend') {
      const credentialPresent = !!this.env.RESEND_API_KEY;
      return { provider, credentialPresent, canDeliver: credentialPresent };
    }
    if (provider === 'smtp') {
      return { provider, credentialPresent: !!this.env.SMTP_URL, canDeliver: false };
    }
    return { provider: 'console', credentialPresent: true, canDeliver: false };
  }

  private async sendViaResend(email: OutboundEmail): Promise<EmailSendResult> {
    if (!this.env.RESEND_API_KEY) {
      this.logger.error('EMAIL_PROVIDER=resend but RESEND_API_KEY is missing; email not sent.');
      return { delivered: false, outcome: 'missing_credential' };
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.env.EMAIL_FROM,
          to: email.to,
          subject: email.subject,
          text: email.body,
        }),
      });
      if (!res.ok) {
        // Resend explains the refusal in the body — most often an unverified
        // sending domain, which the status code alone does not distinguish from
        // a bad key. The body carries no credential (the key is only ever sent
        // in the request header), so it is safe to log and it is the difference
        // between a diagnosable misconfiguration and a silent one.
        const detail = await res.text().catch(() => '');
        this.logger.error(`Resend send failed: HTTP ${res.status}${detail ? ` ${detail.slice(0, 300)}` : ''}`);
        return { delivered: false, outcome: 'provider_error' };
      }
      return { delivered: true, outcome: 'sent' };
    } catch (err) {
      this.logger.error(`Resend send error: ${String(err)}`);
      return { delivered: false, outcome: 'provider_error' };
    }
  }
}
