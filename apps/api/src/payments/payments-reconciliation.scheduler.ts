import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { PaymentsService } from './payments.service';

/** Hourly. Stale holds are a slow problem; sweeping them is not urgent work. */
const TICK_MS = 60 * 60 * 1000;
/** A hold gets a full day to become an authorization before it is given back. */
const STALE_AFTER_HOURS = 24;
const LOCK_KEY = 'bmpl:payments:hold-sweep';
const LOCK_TTL_SECONDS = 15 * 60;

/**
 * Gives back wallet holds whose payment never went anywhere.
 *
 * A soft hold is placed at checkout as a statement of intent, before anything
 * is authorized. Nothing released it when authorization simply never followed,
 * so reservations accumulated against wallets permanently — in production, a
 * customer with an empty wallet was being shown BZ$55 "on hold": money he did
 * not have, could not spend, and had no way to reclaim. Every such hold sat
 * there until somebody noticed, and nobody was looking.
 *
 * Follows the dispatch sweeper's shape deliberately — plain interval, Redis lock,
 * skip rather than run unguarded — so there is one scheduling pattern in this
 * codebase rather than two. A missed sweep self-corrects an hour later; a
 * double sweep is harmless anyway, because releasing a hold re-checks the
 * payment is still non-terminal inside its transaction.
 */
@Injectable()
export class PaymentsReconciliationScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(PaymentsReconciliationScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly payments: PaymentsService,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    let locked = false;
    try {
      const res = await this.redis.client.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
      locked = res === 'OK';
    } catch {
      return; // Redis unreachable: skip rather than sweep unguarded.
    }
    if (!locked) return;

    try {
      // No human did this. A null actor is how this codebase already records a
      // system action, and `AuditLog.actorId` is a real foreign key — a synthetic
      // "system" id would fail the insert rather than label the row.
      const result = await this.payments.expireStaleHolds({ userId: null }, STALE_AFTER_HOURS);
      if (result.expired.length > 0) {
        this.log.log(`released ${result.expired.length} stale wallet hold(s) of ${result.examined} examined`);
      }
    } catch (e) {
      this.log.error(`hold sweep failed: ${(e as Error).message}`);
    }
  }
}
