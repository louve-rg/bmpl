import { Injectable } from '@nestjs/common';

export interface CapturedEmail {
  to: string;
  subject: string;
  body: string;
  createdAt: string;
}

/**
 * DEV/TEST-ONLY email capture. When the email transport is the console logger
 * (development/test), outbound emails are also stored in a small ring buffer so
 * a developer or the integration suite can retrieve verification / reset tokens
 * the same way a user would read them from an inbox — without bypassing the real
 * token-generation and verification logic. Never enabled in production, and the
 * dev endpoint that reads this is not registered when NODE_ENV=production.
 */
@Injectable()
export class DevMailboxService {
  private readonly buffer: CapturedEmail[] = [];
  private readonly max = 200;
  private readonly enabled = process.env.NODE_ENV !== 'production';

  record(email: CapturedEmail): void {
    if (!this.enabled) return;
    this.buffer.push(email);
    if (this.buffer.length > this.max) this.buffer.shift();
  }

  latestFor(to: string): CapturedEmail | undefined {
    const lower = to.toLowerCase();
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i]!.to.toLowerCase() === lower) return this.buffer[i];
    }
    return undefined;
  }
}
