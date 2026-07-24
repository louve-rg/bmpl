import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Rate-limit guard with two adjustments:
 *  - Skips in the automated test environment unless THROTTLE_TEST_ENABLED is set,
 *    so the deterministic integration suite is not throttled (the dedicated
 *    rate-limit spec opts in).
 *  - Proxy-aware client identification: `trust proxy` is enabled in main.ts, so
 *    `req.ip` already reflects the real client behind Railway's proxy.
 */
@Injectable()
export class BmplThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (
      process.env.NODE_ENV === 'test' &&
      !(process.env.THROTTLE_TEST_ENABLED === 'true' || process.env.THROTTLE_TEST_ENABLED === '1')
    ) {
      return true;
    }
    return super.shouldSkip(context);
  }

  protected override async getTracker(req: Request): Promise<string> {
    return req.ip ?? (req.socket?.remoteAddress || 'unknown');
  }
}
