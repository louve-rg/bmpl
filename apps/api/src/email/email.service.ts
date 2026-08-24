import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
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

  constructor(@Inject(ENV) private readonly env: Env) {}

  async send(email: OutboundEmail): Promise<boolean> {
    switch (this.env.EMAIL_PROVIDER) {
      case 'resend':
        return this.sendViaResend(email);
      case 'smtp':
        this.logger.warn('SMTP transport is not implemented; email not sent.');
        return false;
      case 'console':
      default:
        // Do NOT log the body (it contains verification/reset tokens).
        this.logger.log(`[email:console] to=${email.to} subject="${email.subject}"`);
        return true;
    }
  }

  private async sendViaResend(email: OutboundEmail): Promise<boolean> {
    if (!this.env.RESEND_API_KEY) {
      this.logger.error('EMAIL_PROVIDER=resend but RESEND_API_KEY is missing; email not sent.');
      return false;
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
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(`Resend send error: ${String(err)}`);
      return false;
    }
  }
}
