import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { DispatchEngineService } from './dispatch-engine.service';

/** How often to look for lapsed offers and undispatched work. */
const TICK_MS = 20_000;
/** Lock key + TTL. The TTL must exceed a tick so a crashed run cannot deadlock. */
const LOCK_KEY = 'bmpl:dispatch:sweep';
const LOCK_TTL_SECONDS = 60;

/**
 * Drives the dispatch engine on an interval (M26.3 · Part 4).
 *
 * Something has to notice that an offer lapsed — a driver who never opens the
 * app must not hold a customer's order forever, and there is no request in
 * flight at the moment the timer runs out to notice it.
 *
 * Implemented as a plain interval rather than by adding @nestjs/schedule. The
 * dependency would buy a cron parser this does not need, and changing the
 * lockfile is a known source of deploy trouble on this project. A 20-second tick
 * against two indexed queries is not worth a new package.
 *
 * A Redis lock guards each tick. Today Railway runs a single instance, so it is
 * a no-op — but the day a second one starts, two schedulers would otherwise
 * offer the same delivery to two drivers. `SET NX EX` is cheap insurance against
 * a scaling change nobody remembers to audit for this. If Redis is unreachable
 * the tick is SKIPPED rather than run unguarded: a missed sweep self-corrects on
 * the next tick, a double assignment does not.
 */
@Injectable()
export class DispatchSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DispatchSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly redis: RedisService,
    private readonly engine: DispatchEngineService,
  ) {}

  onApplicationBootstrap(): void {
    // Tests drive tick() directly; a background timer would leak across specs.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // Do not hold the process open on shutdown purely for the sweeper.
    this.timer.unref?.();
    this.logger.log(`dispatch sweeper started (every ${TICK_MS / 1000}s)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One sweep. Public so a spec — or an admin endpoint — can force a pass. */
  async tick(): Promise<void> {
    // Guard against a slow sweep overlapping the next tick within this process.
    if (this.running) return;
    this.running = true;
    try {
      if (!(await this.acquire())) return;
      const offers = await this.engine.sweepExpiredOffers();
      const picked = await this.engine.sweepUndispatched();
      // Only log when something actually happened — a quiet platform should not
      // write three lines a minute forever.
      if (offers.expired > 0 || offers.reassigned > 0 || picked > 0) {
        this.logger.log(
          `dispatch sweep: ${offers.expired} offer(s) expired, ${offers.reassigned} reassigned, ${picked} newly assigned`,
        );
      }
    } catch (err) {
      this.logger.error(`dispatch sweep failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /** Cross-instance lock. Returns false when another instance holds it or Redis is down. */
  private async acquire(): Promise<boolean> {
    try {
      const res = await this.redis.client.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
      return res === 'OK';
    } catch (err) {
      this.logger.warn(`dispatch sweep skipped — could not reach Redis: ${String(err)}`);
      return false;
    }
  }
}
