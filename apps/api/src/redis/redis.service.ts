import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/**
 * Thin Redis client wrapper. Phase 1 uses Redis only for the readiness probe
 * (no business feature depends on it yet); queues/cache/rate-limiting land in a
 * later phase and will build on this client. `lazyConnect` keeps startup fast
 * and lets the readiness check own connection health reporting.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(ENV) private readonly env: Env) {
    // ioredis auto-enables TLS for rediss:// URLs (Railway/Upstash). REDIS_TLS
    // forces TLS even for a redis:// URL when a provider requires it.
    const forceTls = this.env.REDIS_TLS && !this.env.REDIS_URL.startsWith('rediss://');
    this.client = new Redis(this.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      ...(forceTls ? { tls: {} } : {}),
    });
    this.client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch (err) {
      this.logger.warn(`Redis initial connect failed: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  /** Returns true if Redis responds to PING. */
  async ping(): Promise<boolean> {
    try {
      const res = await this.client.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Namespaces a scheduler lock key with `REDIS_LOCK_NAMESPACE` when set
   * (dev-only — see env.ts). Unset in production, so this is a no-op there;
   * two production replicas sharing one lock stays correct and unchanged.
   * Every scheduler lock key should be built through this, not a raw string,
   * so one worktree's API can never silently win another's sweep (CLOSE-18).
   */
  lockKey(key: string): string {
    return this.env.REDIS_LOCK_NAMESPACE ? `${this.env.REDIS_LOCK_NAMESPACE}:${key}` : key;
  }
}
