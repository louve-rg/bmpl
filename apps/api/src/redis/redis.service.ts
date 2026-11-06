import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { ENV } from '../config/config.module';
import { isProd, type Env } from '../config/env';

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
   * (dev-only — see env.ts). Every scheduler lock key should be built
   * through this, not a raw string, so one worktree's API can never
   * silently win another's sweep (CLOSE-18).
   *
   * STRUCTURALLY ignored in production, not just unset-by-convention: if
   * `REDIS_LOCK_NAMESPACE` were ever set in production (a copied .env, a
   * mistyped Railway variable, someone debugging), two replicas would get
   * DIFFERENT lock keys and both would sweep at once — duplicate
   * assignments and conflicting offers, the exact thing a single shared
   * lock exists to prevent. "Nobody sets it" is a convention; this makes
   * "setting it cannot do that" structural. Logs loudly rather than silently
   * swallowing the mistake, so a stray production variable is found instead
   * of hidden.
   */
  lockKey(key: string): string {
    if (isProd(this.env)) {
      if (this.env.REDIS_LOCK_NAMESPACE) {
        this.logger.error(
          `REDIS_LOCK_NAMESPACE is set in production ("${this.env.REDIS_LOCK_NAMESPACE}") and is being IGNORED. ` +
            'This variable must never be set outside local development — two replicas with different ' +
            'namespaces would stop sharing their scheduler lock. Remove it from this environment.',
        );
      }
      return key;
    }
    return this.env.REDIS_LOCK_NAMESPACE ? `${this.env.REDIS_LOCK_NAMESPACE}:${key}` : key;
  }
}
