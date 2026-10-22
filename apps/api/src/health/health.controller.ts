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

  /** Liveness — process is up. `commit` (Railway-injected git SHA, or
   *  `GIT_COMMIT_SHA` set by hand for a local boot) makes it possible to
   *  confirm exactly which build is live during a deploy (and that the
   *  pre-deploy migration hook ran, since a failed hook halts promotion) — and,
   *  same field, lets scripts/dev-server-check.mjs tell a dev server running
   *  a stale commit (after a branch switch, restart forgotten) from one that
   *  is current. `GIT_COMMIT_SHA` mirrors the fallback `main.ts` already uses
   *  for the `X-BMPL-Api-Commit` header — this endpoint previously checked
   *  only `RAILWAY_GIT_COMMIT_SHA`, so a local boot always reported `null`
   *  even when a caller had set the variable by hand. Deliberately NOT
   *  falling further to `APP_VERSION`/`'dev'` the way the header does: those
   *  are not commits, and leaking one into this field would let an identity
   *  check misread "no info available" as "a real, different commit".
   *  `startedAt` is when THIS container booted: together with `commit` it
   *  distinguishes "the deploy promoted a fresh build" from "an older container is
   *  still serving", which a commit SHA alone cannot show when a deploy is skipped.
   *  See docs/DEPLOYMENT.md §2a — Railway only rebuilds on a watch-path match.
   *  M10: checkout/orders. M11.1: startup maintenance releases the verification
   *  account's reservations + wallet holds on boot (idempotent).
   *
   *  This path IS Railway's `healthcheckPath` (railway.json: `healthcheckTimeout: 100`),
   *  the gate a newly built container must clear before cutover; `restartPolicyType:
   *  ON_FAILURE` / `restartPolicyMaxRetries: 3` govern that NEW container only, not
   *  the one already serving. docs/DEPLOYMENT.md:386-387 documents, for the
   *  pre-deploy migration hook one stage earlier in the same release sequence, that
   *  "a failed migration halts the deploy — the previous version keeps serving." NO
   *  equivalent sentence exists in this repo for a healthcheck-stage failure
   *  specifically. It is consistent with the same pipeline and with Railway's general
   *  published behaviour, and deployment `7219995090` (b1d5c0d, failed in_progress
   *  after ~2h20m without `f2d2c99` ever stopping serving) is observed evidence for
   *  it — but that failure never reached this endpoint at all (it stayed
   *  `in_progress`, never progressing to a healthcheck attempt), so it does not
   *  close the gap either. Treat "a failed healthcheck here leaves the previous
   *  container serving" as consistent with the design, not as an established,
   *  repo-documented fact, until something closes this gap on purpose. */
  // MDF-376 deploy probe: comment-only, matches railway.json's `apps/api/**`
  // watchPatterns entry so it alone can trigger a deployment. No behavior
  // change — nothing below this line is touched.
  @Public()
  @Get()
  live() {
    const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null;
    const uptime = process.uptime();
    return {
      status: 'ok',
      uptime,
      commit: sha ? sha.slice(0, 7) : null,
      startedAt: new Date(Date.now() - uptime * 1000).toISOString(),
    };
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
