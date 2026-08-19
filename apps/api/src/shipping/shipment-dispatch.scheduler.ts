import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';

/** Same cadence as the delivery sweeper — courier work is the same urgency. */
const TICK_MS = 20_000;
const LOCK_KEY = 'bmpl:shipping:dispatch:sweep';
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
    try {
      if (!(await this.acquire())) return;
      const offers = await this.dispatch.sweepExpiredOffers();
      const picked = await this.dispatch.sweepUndispatched();
      if (offers.expired > 0 || offers.reoffered > 0 || picked > 0) {
        this.logger.log(
          `shipping sweep: ${offers.expired} offer(s) expired, ${offers.reoffered} re-offered, ${picked} newly offered`,
        );
      }
    } catch (err) {
      this.logger.error(`shipping dispatch sweep failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private async acquire(): Promise<boolean> {
    try {
      const res = await this.redis.client.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
      return res === 'OK';
    } catch (err) {
      this.logger.warn(`shipping dispatch sweep skipped — could not reach Redis: ${String(err)}`);
      return false;
    }
  }
}
