import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';

/** Same cadence as the delivery sweeper — courier work is the same urgency. */
const TICK_MS = 20_000;
const LOCK_KEY = 'bmpl:shipping:dispatch:sweep';
/**
 * CLOSE-16: a dead-man's switch for a crashed tick, not the normal release —
 * `tick()` releases the lock itself the moment it finishes (see `release`).
 * Before that release existed, EVERY tick held the lock for the full 60
 * seconds regardless of how long the sweep itself took (typically well under
 * a second), so one instance re-acquired roughly once a minute, not every 20
 * seconds as `onApplicationBootstrap`'s own log line claims. Harmless with a
 * single instance — just three missed ticks out of four. Not harmless with a
 * second instance also ticking against the same Redis (as happened during
 * CLOSE-1 verification, see PR #602's follow-up): whichever instance's tick
 * happened to win the lock then held it for a full minute, shutting the
 * OTHER instance out for up to three of its own 20-second cycles in a row —
 * turning an ordinary two-process collision into a near-total block on
 * whichever instance lost the race. The TTL stays at 60s on purpose, as the
 * comment above always said: if a tick ever crashes between acquiring the
 * lock and releasing it, the lock still clears on its own within a bounded
 * time instead of deadlocking every instance forever.
 */
const LOCK_TTL_SECONDS = 60;

/**
 * Drives courier-leg dispatch on an interval.
 *
 * A separate sweeper from the delivery one, and a separate lock, on purpose. If
 * shipping dispatch throws, ordinary marketplace delivery must keep being swept
 * — the whole point of keeping the two engines beside each other rather than
 * fusing them is that one cannot take the other down.
 *
 * Everything else mirrors the delivery scheduler deliberately, including
 * skipping the tick when Redis is unreachable: a missed sweep self-corrects on
 * the next tick, a double assignment does not.
 */
@Injectable()
export class ShipmentDispatchScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ShipmentDispatchScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly redis: RedisService,
    private readonly dispatch: ShipmentDispatchService,
  ) {}

  onApplicationBootstrap(): void {
    // Tests drive tick() directly; a background timer would leak across specs.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.log(`shipping dispatch sweeper started (every ${TICK_MS / 1000}s)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One sweep. Public so a spec — or an admin endpoint — can force a pass. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const token = await this.acquire();
    try {
      if (!token) return;
      const offers = await this.dispatch.sweepExpiredOffers();
      const picked = await this.dispatch.sweepUndispatched();
      const recovered = await this.dispatch.sweepExhaustedRecovery();
      if (offers.expired > 0 || offers.reoffered > 0 || picked > 0 || recovered > 0) {
        this.logger.log(
          `shipping sweep: ${offers.expired} offer(s) expired, ${offers.reoffered} re-offered, ${picked} newly offered, ${recovered} exhausted leg(s) recovered`,
        );
      }
    } catch (err) {
      this.logger.error(`shipping dispatch sweep failed: ${String(err)}`);
    } finally {
      if (token) await this.release(token);
      this.running = false;
    }
  }

  /** Cross-instance lock. Returns a release token when acquired, null otherwise. */
  private async acquire(): Promise<string | null> {
    const token = randomUUID();
    try {
      const res = await this.redis.client.set(LOCK_KEY, token, 'EX', LOCK_TTL_SECONDS, 'NX');
      return res === 'OK' ? token : null;
    } catch (err) {
      this.logger.warn(`shipping dispatch sweep skipped — could not reach Redis: ${String(err)}`);
      return null;
    }
  }

  /**
   * CLOSE-16: release the lock as soon as this tick is done, rather than
   * waiting out the TTL. The check-then-delete is one atomic Lua script, not
   * a plain DEL, so this can never delete a lock it no longer owns: if this
   * tick somehow ran past the 60-second TTL, Redis may already have expired
   * our entry and handed the key to another instance's tick by the time we
   * get here, and GET-then-compare-then-DEL in two round trips would risk
   * deleting THEIR lock instead of ours.
   */
  private async release(token: string): Promise<void> {
    try {
      await this.redis.client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        LOCK_KEY,
        token,
      );
    } catch (err) {
      // The TTL still clears it even if this fails — a release failure must
      // never turn into a lock held for the full minute for no reason.
      this.logger.warn(`shipping dispatch sweep lock release failed (will clear via TTL): ${String(err)}`);
    }
  }
}
