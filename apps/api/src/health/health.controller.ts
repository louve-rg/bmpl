import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';

/**
 * Liveness and readiness probes. Readiness actually contacts PostgreSQL, Redis,
 * and object storage — so the API never reports "ready" while silently degraded
 * or falling back to mocks. Both endpoints are public (no auth).
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  /** Liveness — process is up. `commit` (Railway-injected git SHA) makes it
   *  possible to confirm exactly which build is live during a deploy. */
  @Public()
  @Get()
  live() {
    const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? null;
    return { status: 'ok', uptime: process.uptime(), commit: sha ? sha.slice(0, 7) : null };
  }

  /**
   * Readiness — required dependencies (database, Redis) must be reachable.
   * Storage is OPTIONAL: an unconfigured storage backend reports 'not_configured'
   * and does NOT fail readiness (the API runs fine without file uploads until
   * Cloudflare R2 is configured). A configured-but-unreachable storage IS a failure.
   */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis, storage] = await Promise.all([
      this.checkDatabase(),
      this.redis.ping(),
      this.storage.healthStatus(),
    ]);
    const ready = database && redis && storage !== 'error';
    if (!ready) res.status(503);
    return {
      status: ready ? 'ready' : 'degraded',
      checks: { database, redis, storage },
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
