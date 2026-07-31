import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { syncSuperAdminPermissions } from '@bmpl/database';
import { PERMISSIONS } from '@bmpl/shared';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';

/**
 * Idempotent startup maintenance (M10.1). Runs once per deploy INSIDE the
 * Railway environment (no external DB credentials), so operational cleanup ships
 * through the normal pipeline:
 *  1. Sync the full permission catalog to every APPROVED SUPER_ADMIN — makes a
 *     newly-added permission (e.g. `orders.read`) available immediately without a
 *     manual grant.
 *  2. Release inventory reservations created solely by the production
 *     verification account (bounded + idempotent).
 * Both steps are best-effort and never block startup.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return; // exercised directly by specs

    try {
      const r = await syncSuperAdminPermissions(this.prisma, PERMISSIONS);
      this.logger.log(`super-admin permission sync: ${r.superAdmins} admin(s) × ${r.permissions} permission(s)`);
    } catch (err) {
      this.logger.error(`super-admin permission sync failed: ${(err as Error).message}`);
    }

    try {
      const email = process.env.VERIFICATION_ACCOUNT_EMAIL ?? 'bmpl-cart-verify@example.com';
      const r = await this.orders.releaseVerificationReservations(email);
      if (r.orders > 0) {
        this.logger.log(`released reservations for ${r.orders} verification order(s) (${r.itemsReleased} item(s))`);
      }
      // Correct any stuck reserved count from earlier verification runs (safe/clamped).
      const rec = await this.orders.reconcileTerminalReservations(email);
      if (rec.corrected > 0) this.logger.log(`reconciled ${rec.corrected} stuck reservation(s) for the verification account`);
    } catch (err) {
      this.logger.error(`verification reservation cleanup failed: ${(err as Error).message}`);
    }
  }
}
