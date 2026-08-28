import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  canTransitionPayment,
  computeSettlement,
  DEFAULT_FEE_CONFIG,
  settlementReference,
  type FeeConfig,
  type PaymentStatus,
} from '@bmpl/shared';
import type { UpdateFeeConfigInput } from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import type { Currency } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OwnershipService } from '../products/ownership.service';

const money = (v: bigint | null | undefined): number => (v == null ? 0 : Number(v));

/**
 * Settlement & Earnings (M18). After a vendor-order's fulfilment completes,
 * distributes its escrowed funds INTERNALLY (vendor net → vendor wallet, driver
 * earning → driver wallet, platform fees → SYSTEM_PLATFORM_FEES) via the ONE
 * approved wallet path (WalletService.postTransaction), in a single balanced,
 * atomic, idempotent transaction. NO external withdrawal, payout, or refund.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ownership: OwnershipService,
  ) {}

  // ===========================================================================
  // Fee configuration (server-side source of truth)
  // ===========================================================================
  private async ensureConfigRow(): Promise<{ id: string; currency: Currency; config: FeeConfig }> {
    const active = await this.prisma.platformFeeConfig.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' } });
    const row = active ?? (await this.prisma.platformFeeConfig.create({ data: {} }));
    return {
      id: row.id,
      currency: row.currency,
      config: { commissionBps: row.commissionBps, driverEarningMethod: row.driverEarningMethod, driverFlatMinor: row.driverFlatMinor, driverDeliveryFeeBps: row.driverDeliveryFeeBps },
    };
  }

  async getFeeConfig() {
    const { id, currency, config } = await this.ensureConfigRow();
    return { id, currency, commissionBps: config.commissionBps, driverEarningMethod: config.driverEarningMethod, driverFlatMinor: money(config.driverFlatMinor), driverDeliveryFeeBps: config.driverDeliveryFeeBps, defaults: { commissionBps: DEFAULT_FEE_CONFIG.commissionBps, driverDeliveryFeeBps: DEFAULT_FEE_CONFIG.driverDeliveryFeeBps } };
  }

  async updateFeeConfig(actorId: string, dto: UpdateFeeConfigInput) {
    const { id } = await this.ensureConfigRow();
    const before = await this.prisma.platformFeeConfig.findUniqueOrThrow({ where: { id } });
    const updated = await this.prisma.platformFeeConfig.update({
      where: { id },
      data: {
        commissionBps: dto.commissionBps ?? undefined,
        driverEarningMethod: dto.driverEarningMethod ?? undefined,
        driverFlatMinor: dto.driverFlatMinor === undefined ? undefined : BigInt(dto.driverFlatMinor),
        driverDeliveryFeeBps: dto.driverDeliveryFeeBps ?? undefined,
      },
    });
    await this.audit.record({ action: 'PLATFORM_FEE_CONFIG_UPDATED', actorId, previousValue: { commissionBps: before.commissionBps, driverEarningMethod: before.driverEarningMethod, driverFlatMinor: money(before.driverFlatMinor), driverDeliveryFeeBps: before.driverDeliveryFeeBps }, newValue: { commissionBps: updated.commissionBps, driverEarningMethod: updated.driverEarningMethod, driverFlatMinor: money(updated.driverFlatMinor), driverDeliveryFeeBps: updated.driverDeliveryFeeBps } });
    return this.getFeeConfig();
  }

  // ===========================================================================
  // Settle a single vendor-order (the money path)
  // ===========================================================================

  /**
   * Settle one vendor-order. Idempotent via the settlement:<id>:v1 ledger
   * reference AND the unique VendorSettlement row. Returns { settled, reason }.
   * Best-effort caller (delivery completion) — never throws to its caller; a
   * calculation/ledger failure records a FAILED settlement + alerts admins and
   * leaves escrow untouched.
   */

  /**
   * Settle a delivered shipment.
   *
   * A shipment has no vendor: the whole price is BML's own service revenue,
   * split between the drivers who actually carried the parcel and the platform.
   * The split is NOT invented here — it uses the same `PlatformFeeConfig` the
   * marketplace already settles by, so changing the driver share changes both.
   *
   * One balanced ESCROW_RELEASE moves everything at once, keyed by a reference
   * unique to the shipment, so the ledger itself makes a second settlement
   * impossible rather than relying on a status check winning a race.
   */
  async settleShipment(shipmentId: string, actorId?: string | null): Promise<{ settled: boolean; reason?: string }> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        payment: true,
        legs: { select: { id: true, kind: true, status: true, priceMinor: true, assignedDriverProfileId: true } },
      },
    });
    if (!shipment) return { settled: false, reason: 'shipment not found' };
    if (shipment.status !== 'DELIVERED' && shipment.status !== 'AWAITING_COLLECTION') {
      return { settled: false, reason: `shipment is ${shipment.status}` };
    }

    const payment = shipment.payment;
    // Nothing was owed, so there is nothing to settle. A free shipment is not a
    // failure — it is a shipment the network could not price.
    if (!payment) return { settled: false, reason: 'shipment has no payment' };
    if (payment.status === 'SETTLED') return { settled: true };
    if (payment.status !== 'AUTHORIZED') return { settled: false, reason: `payment is ${payment.status}` };

    const currency = payment.currency;
    const { config } = await this.ensureConfigRow();

    return this.prisma.$transaction(async (tx) => {
      const escrow = await this.wallet.ensureSystemAccount('SYSTEM_ESCROW', currency, tx);
      const platform = await this.wallet.ensureSystemAccount('SYSTEM_PLATFORM_FEES', currency, tx);

      const gross = payment.amountMinor;
      const lines: Array<{ accountId: string; direction: 'DEBIT' | 'CREDIT'; amountMinor: bigint }> = [
        { accountId: escrow.id, direction: 'DEBIT', amountMinor: gross },
      ];

      // One earning per courier leg that a driver actually completed. A leg
      // nobody drove — a line-haul the carrier flew, or a cancelled leg — earns
      // nobody anything.
      let driverTotal = 0n;
      const earnings: Array<{ id: string }> = [];
      for (const leg of shipment.legs) {
        if (leg.kind === 'LINE_HAUL' || leg.status !== 'COMPLETED' || !leg.assignedDriverProfileId) continue;

        const share = (leg.priceMinor * BigInt(config.driverDeliveryFeeBps)) / 10_000n;
        if (share <= 0n) continue;

        const profile = await tx.driverProfile.findUnique({
          where: { id: leg.assignedDriverProfileId },
          select: { userId: true },
        });
        if (!profile) continue;
        const driverAcct = await this.wallet.ensureUserAccount(profile.userId, currency, tx);

        const earning = await tx.driverEarning.create({
          data: {
            driverProfileId: leg.assignedDriverProfileId,
            shipmentLegId: leg.id,
            currency,
            method: config.driverEarningMethod,
            grossMinor: share,
            adjustmentsMinor: 0n,
            netMinor: share,
            status: 'PENDING',
            snapshot: {
              legPriceMinor: money(leg.priceMinor),
              driverDeliveryFeeBps: config.driverDeliveryFeeBps,
              method: config.driverEarningMethod,
            } as Prisma.InputJsonValue,
            calculatedAt: new Date(),
          },
          select: { id: true },
        });
        earnings.push(earning);
        lines.push({ accountId: driverAcct.id, direction: 'CREDIT', amountMinor: share });
        driverTotal += share;
      }

      // Whatever the drivers did not take is the platform's. Computed as a
      // remainder rather than as its own percentage, so the transaction balances
      // exactly and no rounding dust is stranded in escrow.
      const platformRevenue = gross - driverTotal;
      if (platformRevenue > 0n) lines.push({ accountId: platform.id, direction: 'CREDIT', amountMinor: platformRevenue });

      const txn = await this.wallet.postTransaction(
        tx,
        {
          type: 'ESCROW_RELEASE',
          currency,
          reference: `shipment:${shipment.id}:settle`, // unique → ledger idempotency
          description: `Settlement for shipment ${shipment.reference}`,
          lines,
        },
        true,
        // Mirrors what went INTO escrow rather than re-deriving from the
        // shipment. A real sender paying with UAT credit escrowed simulation
        // money, and the vendor/courier settlement of it is simulation money
        // too — otherwise test funds turn into real earnings on the way out.
        shipment.payment ? await this.wallet.escrowIsTest(shipment.payment.id, tx) : shipment.isTest,
      );

      for (const e of earnings) {
        await tx.driverEarning.update({ where: { id: e.id }, data: { status: 'POSTED', walletTransactionId: txn.id, postedAt: new Date() } });
      }
      await tx.walletHold.updateMany({
        where: { paymentId: payment.id, status: 'AUTHORIZED' },
        data: { status: 'RELEASED', releasedAt: new Date(), releaseReason: 'settled' },
      });
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'SETTLED' } });
      await tx.paymentEvent.create({
        data: { paymentId: payment.id, type: 'STATE_CHANGED', fromStatus: 'AUTHORIZED', toStatus: 'SETTLED' },
      });

      await this.audit.record({ action: 'ESCROW_RELEASED_SETTLEMENT', actorId: actorId ?? null, newValue: { shipmentId: shipment.id, grossMinor: money(gross), walletTransactionId: txn.id } }, tx);
      await this.audit.record({ action: 'PLATFORM_FEE_POSTED', actorId: actorId ?? null, newValue: { shipmentId: shipment.id, amountMinor: money(platformRevenue) } }, tx);
      await this.audit.record({ action: 'PAYMENT_SETTLED', actorId: actorId ?? null, newValue: { paymentId: payment.id, shipmentId: shipment.id } }, tx);
      await this.audit.record({ action: 'WALLET_TRANSACTION_POSTED', actorId: actorId ?? null, newValue: { walletTransactionId: txn.id, type: 'ESCROW_RELEASE' } }, tx);

      return { settled: true };
    });
  }

  async settleVendorOrder(vendorOrderId: string, actorId?: string | null): Promise<{ settled: boolean; reason?: string; settlementId?: string }> {
    // Idempotent short-circuit: already POSTED.
    const prior = await this.prisma.vendorSettlement.findUnique({ where: { vendorOrderId } });
    if (prior?.status === 'POSTED') return { settled: true, settlementId: prior.id };

    const vo = await this.prisma.vendorOrder.findUnique({
      where: { id: vendorOrderId },
      include: {
        vendorProfile: { select: { id: true, userId: true, businessName: true } },
        order: { select: { id: true, orderNumber: true, userId: true, isTest: true, payment: { select: { id: true, status: true, currency: true } } } },
        delivery: { select: { id: true, feeMinor: true, status: true, assignedDriverProfileId: true, assignedDriver: { select: { userId: true } } } },
      },
    });
    if (!vo) return { settled: false, reason: 'vendor order not found' };

    // ---- Guards (fulfilment + funding) ----
    const payment = vo.order.payment;
    if (!payment || !['AUTHORIZED', 'SETTLING', 'SETTLED'].includes(payment.status)) {
      return { settled: false, reason: 'order payment is not authorized (no escrow funds)' };
    }
    const hasDelivery = !!vo.delivery;
    if (hasDelivery && vo.delivery!.status !== 'DELIVERED') {
      return { settled: false, reason: 'delivery not complete' };
    }
    if (!hasDelivery) {
      // PICKUP vendor-orders have no completion signal in the current system.
      return { settled: false, reason: 'pickup fulfilment settlement is not supported yet' };
    }

    const { config, currency } = await this.ensureConfigRow();
    const deliveryFee = vo.delivery?.feeMinor ?? 0n;
    const breakdown = computeSettlement({ merchandiseSubtotalMinor: vo.subtotalMinor, deliveryFeeMinor: deliveryFee, hasDelivery }, config);

    const driverUserId = vo.delivery?.assignedDriver?.userId ?? null;
    const driverProfileId = vo.delivery?.assignedDriverProfileId ?? null;
    const settleDriver = hasDelivery && !!driverUserId && !!driverProfileId && breakdown.driverAllocationMinor > 0n;
    // If there is a delivery fee but no driver to pay, the platform keeps that share.
    const driverAllocation = settleDriver ? breakdown.driverAllocationMinor : 0n;
    const platformRevenue = settleDriver ? breakdown.platformRevenueMinor : breakdown.commissionMinor + deliveryFee;

    const snapshot = {
      config: { commissionBps: config.commissionBps, driverEarningMethod: config.driverEarningMethod, driverFlatMinor: money(config.driverFlatMinor), driverDeliveryFeeBps: config.driverDeliveryFeeBps },
      inputs: { merchandiseSubtotalMinor: money(vo.subtotalMinor), deliveryFeeMinor: money(deliveryFee), hasDelivery },
      breakdown: {
        grossMinor: money(breakdown.grossMinor),
        commissionMinor: money(breakdown.commissionMinor),
        driverAllocationMinor: money(driverAllocation),
        platformFeeMinor: money(platformRevenue - breakdown.commissionMinor),
        platformRevenueMinor: money(platformRevenue),
        vendorNetMinor: money(breakdown.vendorNetMinor),
      },
    } as Prisma.InputJsonValue;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Resolve accounts.
        const escrow = await this.wallet.ensureSystemAccount('SYSTEM_ESCROW', currency, tx);
        const platform = await this.wallet.ensureSystemAccount('SYSTEM_PLATFORM_FEES', currency, tx);
        const vendorAcct = await this.wallet.ensureUserAccount(vo.vendorProfile.userId, currency, tx);
        const driverAcct = settleDriver ? await this.wallet.ensureUserAccount(driverUserId!, currency, tx) : null;

        // Escrow must actually hold this order's funds.
        const escrowBalance = await this.wallet.balanceMinor(escrow.id, tx);
        if (escrowBalance < breakdown.grossMinor) {
          throw new BadRequestException('Insufficient escrow balance for settlement.');
        }

        // Create the records (PENDING) then post the balanced ledger transaction.
        const settlement = await tx.vendorSettlement.create({
          data: {
            vendorProfileId: vo.vendorProfile.id,
            vendorOrderId: vo.id,
            paymentId: payment.id,
            currency,
            merchandiseSubtotalMinor: vo.subtotalMinor,
            deliveryFeeMinor: deliveryFee,
            commissionMinor: breakdown.commissionMinor,
            driverAllocationMinor: driverAllocation,
            platformFeeMinor: platformRevenue - breakdown.commissionMinor,
            grossMinor: breakdown.grossMinor,
            netMinor: breakdown.vendorNetMinor,
            status: 'PENDING',
            snapshot,
            calculatedAt: new Date(),
          },
        });
        let earning: { id: string } | null = null;
        if (settleDriver) {
          earning = await tx.driverEarning.create({
            data: {
              driverProfileId: driverProfileId!,
              orderDeliveryId: vo.delivery!.id,
              vendorOrderId: vo.id,
              settlementId: settlement.id,
              currency,
              method: config.driverEarningMethod,
              grossMinor: driverAllocation,
              adjustmentsMinor: 0n,
              netMinor: driverAllocation,
              status: 'PENDING',
              snapshot: { deliveryFeeMinor: money(deliveryFee), method: config.driverEarningMethod, driverDeliveryFeeBps: config.driverDeliveryFeeBps, driverFlatMinor: money(config.driverFlatMinor) } as Prisma.InputJsonValue,
              calculatedAt: new Date(),
            },
            select: { id: true },
          });
        }

        // Build the single balanced escrow-release transaction (skip zero credits).
        const lines: Array<{ accountId: string; direction: 'DEBIT' | 'CREDIT'; amountMinor: bigint }> = [
          { accountId: escrow.id, direction: 'DEBIT', amountMinor: breakdown.grossMinor },
        ];
        if (breakdown.vendorNetMinor > 0n) lines.push({ accountId: vendorAcct.id, direction: 'CREDIT', amountMinor: breakdown.vendorNetMinor });
        if (driverAcct && driverAllocation > 0n) lines.push({ accountId: driverAcct.id, direction: 'CREDIT', amountMinor: driverAllocation });
        if (platformRevenue > 0n) lines.push({ accountId: platform.id, direction: 'CREDIT', amountMinor: platformRevenue });

        const txn = await this.wallet.postTransaction(
          tx,
          {
            type: 'ESCROW_RELEASE',
            currency,
            reference: settlementReference(vo.id), // unique → ledger idempotency
            description: `Settlement for ${vo.orderNumber}`,
            lines,
          },
          true, // sanctioned internal money movement
          // Inherited from the order, like every other posting on its journey.
          // Left off, a simulation order settled as REAL money: the driver's
          // earning and the platform's share both landed in real revenue, and a
          // rehearsal showed up in production reporting.
          // Same rule as the escrow it settles: follow the money, not the
          // account. See ShipmentService settlement for the reasoning.
          vo.order.payment ? await this.wallet.escrowIsTest(vo.order.payment.id, tx) : vo.order.isTest,
        );

        // Flip records to POSTED.
        await tx.vendorSettlement.update({ where: { id: settlement.id }, data: { status: 'POSTED', walletTransactionId: txn.id, postedAt: new Date() } });
        if (earning) await tx.driverEarning.update({ where: { id: earning.id }, data: { status: 'POSTED', walletTransactionId: txn.id, postedAt: new Date() } });

        // Aggregate the parent payment status (only delivery vendor-orders settle).
        const settleable = await tx.vendorOrder.count({ where: { orderId: vo.order.id, delivery: { isNot: null } } });
        const settled = await tx.vendorSettlement.count({ where: { vendorOrder: { orderId: vo.order.id }, status: 'POSTED' } });
        const nextStatus: PaymentStatus = settled >= settleable ? 'SETTLED' : 'SETTLING';

        // Once the last vendor-order has settled the escrow is gone, so the hold
        // that reserved it has nothing left to reserve. Leaving it AUTHORIZED
        // meant a customer who had received their goods still saw that money as
        // "on hold" on their wallet, permanently — the same complaint the stale
        // pre-authorization holds produced, arriving from the other end.
        if (nextStatus === 'SETTLED') {
          await tx.walletHold.updateMany({
            where: { paymentId: payment.id, status: 'AUTHORIZED' },
            data: { status: 'RELEASED', releasedAt: new Date(), releaseReason: 'settled' },
          });
        }

        if (payment.status !== nextStatus && canTransitionPayment(payment.status as PaymentStatus, nextStatus)) {
          await tx.payment.update({ where: { id: payment.id }, data: { status: nextStatus } });
          await tx.paymentEvent.create({ data: { paymentId: payment.id, type: 'STATE_CHANGED', fromStatus: payment.status as PaymentStatus, toStatus: nextStatus } });
          await this.audit.record({ action: nextStatus === 'SETTLED' ? 'PAYMENT_SETTLED' : 'PAYMENT_SETTLING', actorId: actorId ?? null, newValue: { paymentId: payment.id, orderId: vo.order.id } }, tx);
        }

        // Audit the money postings.
        await this.audit.record({ action: 'SETTLEMENT_CALCULATED', actorId: actorId ?? null, newValue: { vendorOrderId: vo.id, ...(snapshot as object) } }, tx);
        await this.audit.record({ action: 'ESCROW_RELEASED_SETTLEMENT', actorId: actorId ?? null, newValue: { vendorOrderId: vo.id, grossMinor: money(breakdown.grossMinor), walletTransactionId: txn.id } }, tx);
        await this.audit.record({ action: 'VENDOR_SETTLEMENT_POSTED', actorId: actorId ?? null, targetUserId: vo.vendorProfile.userId, newValue: { settlementId: settlement.id, netMinor: money(breakdown.vendorNetMinor) } }, tx);
        await this.audit.record({ action: 'PLATFORM_FEE_POSTED', actorId: actorId ?? null, newValue: { vendorOrderId: vo.id, amountMinor: money(platformRevenue) } }, tx);
        if (earning) await this.audit.record({ action: 'DRIVER_EARNING_POSTED', actorId: actorId ?? null, targetUserId: driverUserId, newValue: { earningId: earning.id, netMinor: money(driverAllocation) } }, tx);
        await this.audit.record({ action: 'WALLET_TRANSACTION_POSTED', actorId: actorId ?? null, newValue: { walletTransactionId: txn.id, type: 'ESCROW_RELEASE' } }, tx);
        await this.audit.record({ action: 'SETTLEMENT_POSTED', actorId: actorId ?? null, newValue: { settlementId: settlement.id } }, tx);

        // Notify vendor + driver (in-tx).
        await this.notifications.notifyUsers([vo.vendorProfile.userId], { type: 'MARKETPLACE', category: 'PAYMENT', event: 'PAYMENT_AUTHORIZED', title: 'Order settled', body: `Your earnings for order ${vo.orderNumber} were credited to your wallet.`, data: { settlementId: settlement.id } }, tx);
        if (settleDriver) await this.notifications.notifyUsers([driverUserId], { type: 'MARKETPLACE', category: 'DELIVERY', event: 'DELIVERY_DELIVERED', title: 'Earning credited', body: `Your delivery earning for ${vo.orderNumber} was credited to your wallet.`, data: { earningId: earning?.id } }, tx);

        return { settlementId: settlement.id };
      });
      return { settled: true, settlementId: result.settlementId };
    } catch (e) {
      // Idempotent replay: another settlement already posted this reference.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.vendorSettlement.findUnique({ where: { vendorOrderId } });
        if (existing) return { settled: true, settlementId: existing.id };
      }
      // Genuine failure: record a FAILED settlement (no ledger entries were written
      // — the whole tx rolled back) and alert admins. Escrow is preserved.
      const reason = e instanceof Error ? e.message : 'settlement failed';
      this.logger.error(`Settlement failed for vendor-order ${vendorOrderId}: ${reason}`);
      await this.recordFailure(vendorOrderId, vo.vendorProfile.id, payment.id, snapshot, reason, actorId ?? null);
      return { settled: false, reason };
    }
  }

  private async recordFailure(vendorOrderId: string, vendorProfileId: string, paymentId: string, snapshot: Prisma.InputJsonValue, reason: string, actorId: string | null) {
    try {
      await this.prisma.vendorSettlement.upsert({
        where: { vendorOrderId },
        create: { vendorOrderId, vendorProfileId, paymentId, merchandiseSubtotalMinor: 0n, deliveryFeeMinor: 0n, commissionMinor: 0n, driverAllocationMinor: 0n, platformFeeMinor: 0n, grossMinor: 0n, netMinor: 0n, status: 'FAILED', failureReason: reason.slice(0, 500), snapshot },
        update: { status: 'FAILED', failureReason: reason.slice(0, 500) },
      });
    } catch {
      /* a POSTED row already exists — nothing to fail */
    }
    await this.audit.record({ action: 'SETTLEMENT_FAILED', actorId, newValue: { vendorOrderId, reason: reason.slice(0, 500) } });
    await this.notifications.notifyAdmins('settlements.read', { type: 'SECURITY', category: 'ADMIN_ALERT', event: 'ADMIN_ORDER_EXCEPTION', title: 'Settlement failed', body: `A settlement for a delivered order failed and needs review: ${reason.slice(0, 140)}`, data: { vendorOrderId } });
  }

  /** Admin retry of a FAILED settlement. */
  async retry(actorId: string, vendorOrderId: string) {
    const existing = await this.prisma.vendorSettlement.findUnique({ where: { vendorOrderId } });
    if (existing?.status === 'POSTED') return { settled: true, settlementId: existing.id };
    if (existing?.status === 'FAILED') await this.prisma.vendorSettlement.delete({ where: { vendorOrderId } }); // clear so the create path runs cleanly
    return this.settleVendorOrder(vendorOrderId, actorId);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async vendorSettlements(userId: string) {
    const vp = await this.ownership.vendorProfileId(userId);
    const rows = await this.prisma.vendorSettlement.findMany({ where: { vendorProfileId: vp }, orderBy: { createdAt: 'desc' }, take: 300, include: { vendorOrder: { select: { orderNumber: true } } } });
    const totals = { pendingMinor: 0, postedMinor: 0 };
    for (const r of rows) {
      if (r.status === 'POSTED') totals.postedMinor += money(r.netMinor);
      else if (r.status === 'PENDING') totals.pendingMinor += money(r.netMinor);
    }
    return { totals, settlements: rows.map((r) => this.shapeSettlement(r)) };
  }

  async vendorSettlementDetail(userId: string, id: string) {
    const vp = await this.ownership.vendorProfileId(userId);
    const r = await this.prisma.vendorSettlement.findUnique({ where: { id }, include: { vendorOrder: { select: { orderNumber: true } } } });
    if (!r || r.vendorProfileId !== vp) throw new NotFoundException('Settlement not found.');
    return { ...this.shapeSettlement(r), snapshot: r.snapshot };
  }

  async driverEarnings(userId: string) {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!p) throw new ForbiddenException('No driver profile.');
    const rows = await this.prisma.driverEarning.findMany({ where: { driverProfileId: p.id }, orderBy: { createdAt: 'desc' }, take: 300 });
    const totals = { pendingMinor: 0, postedMinor: 0, completedDeliveries: rows.filter((r) => r.status === 'POSTED').length };
    for (const r of rows) {
      if (r.status === 'POSTED') totals.postedMinor += money(r.netMinor);
      else if (r.status === 'PENDING') totals.pendingMinor += money(r.netMinor);
    }
    return { totals, earnings: rows.map((r) => this.shapeEarning(r)) };
  }

  async driverEarningDetail(userId: string, id: string) {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!p) throw new ForbiddenException('No driver profile.');
    const r = await this.prisma.driverEarning.findUnique({ where: { id } });
    if (!r || r.driverProfileId !== p.id) throw new NotFoundException('Earning not found.');
    return { ...this.shapeEarning(r), snapshot: r.snapshot };
  }

  /** Customer: settlement status of their own order's payment. */
  async customerOrderSettlement(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { userId: true, orderNumber: true, payment: { select: { status: true } }, vendorOrders: { select: { id: true, orderNumber: true, settlement: { select: { status: true, postedAt: true } } } } } });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found.');
    return {
      orderNumber: order.orderNumber,
      paymentStatus: order.payment?.status ?? null,
      vendorOrders: order.vendorOrders.map((vo) => ({ orderNumber: vo.orderNumber, settlementStatus: vo.settlement?.status ?? null, settledAt: vo.settlement?.postedAt ?? null })),
    };
  }

  // ---- admin ----
  async adminList(filter: { status?: string } = {}) {
    const rows = await this.prisma.vendorSettlement.findMany({ where: filter.status ? { status: filter.status as never } : {}, orderBy: { createdAt: 'desc' }, take: 300, include: { vendorProfile: { select: { businessName: true } }, vendorOrder: { select: { orderNumber: true } } } });
    return rows.map((r) => ({ ...this.shapeSettlement(r), vendor: r.vendorProfile.businessName }));
  }

  async adminDetail(id: string) {
    const r = await this.prisma.vendorSettlement.findUnique({ where: { id }, include: { vendorProfile: { select: { businessName: true } }, vendorOrder: { select: { orderNumber: true } }, driverEarnings: true } });
    if (!r) throw new NotFoundException('Settlement not found.');
    return { ...this.shapeSettlement(r), vendor: r.vendorProfile.businessName, snapshot: r.snapshot, driverEarnings: r.driverEarnings.map((e) => this.shapeEarning(e)) };
  }

  async adminDriverEarnings() {
    const rows = await this.prisma.driverEarning.findMany({ orderBy: { createdAt: 'desc' }, take: 300, include: { driverProfile: { select: { displayName: true } } } });
    return rows.map((r) => ({ ...this.shapeEarning(r), driver: r.driverProfile.displayName }));
  }

  async adminExceptions() {
    const rows = await this.prisma.vendorSettlement.findMany({ where: { status: 'FAILED' }, orderBy: { updatedAt: 'desc' }, take: 100, include: { vendorOrder: { select: { orderNumber: true } } } });
    return rows.map((r) => ({ id: r.id, vendorOrderId: r.vendorOrderId, orderNumber: r.vendorOrder?.orderNumber ?? null, failureReason: r.failureReason, updatedAt: r.updatedAt }));
  }

  /**
   * Reconciliation: internal liabilities vs escrow, and global ledger net.
   * A mismatch is surfaced (not hidden) for the admin console.
   */
  async reconciliation() {
    const accounts = await this.prisma.walletAccount.findMany({ where: { userId: null } });
    const escrow = accounts.find((a) => a.type === 'SYSTEM_ESCROW');
    const platform = accounts.find((a) => a.type === 'SYSTEM_PLATFORM_FEES');
    const escrowBalance = escrow ? await this.wallet.balanceMinor(escrow.id) : 0n;
    const platformBalance = platform ? await this.wallet.balanceMinor(platform.id) : 0n;
    const pendingVendor = await this.prisma.vendorSettlement.aggregate({ where: { status: 'PENDING' }, _sum: { netMinor: true } });
    const pendingDriver = await this.prisma.driverEarning.aggregate({ where: { status: 'PENDING' }, _sum: { netMinor: true } });
    // Global ledger net (must be exactly zero if every transaction balanced).
    const entries = await this.prisma.walletLedgerEntry.findMany({ select: { direction: true, amountMinor: true } });
    const globalNet = entries.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    return {
      escrowBalanceMinor: money(escrowBalance),
      platformRevenueMinor: money(platformBalance),
      pendingVendorLiabilityMinor: money(pendingVendor._sum.netMinor),
      pendingDriverLiabilityMinor: money(pendingDriver._sum.netMinor),
      globalLedgerNetMinor: money(globalNet),
      balanced: globalNet === 0n,
      failedSettlements: await this.prisma.vendorSettlement.count({ where: { status: 'FAILED' } }),
    };
  }

  async adminAccounts() {
    return this.wallet.adminAccounts();
  }

  // ---- serialization ----
  private shapeSettlement(r: { id: string; vendorOrderId: string; currency: string; merchandiseSubtotalMinor: bigint; deliveryFeeMinor: bigint; commissionMinor: bigint; driverAllocationMinor: bigint; platformFeeMinor: bigint; grossMinor: bigint; netMinor: bigint; status: string; failureReason: string | null; calculatedAt: Date; postedAt: Date | null; vendorOrder?: { orderNumber: string } | null }) {
    return {
      id: r.id,
      vendorOrderId: r.vendorOrderId,
      orderNumber: r.vendorOrder?.orderNumber ?? null,
      currency: r.currency,
      merchandiseSubtotalMinor: money(r.merchandiseSubtotalMinor),
      deliveryFeeMinor: money(r.deliveryFeeMinor),
      commissionMinor: money(r.commissionMinor),
      driverAllocationMinor: money(r.driverAllocationMinor),
      platformFeeMinor: money(r.platformFeeMinor),
      grossMinor: money(r.grossMinor),
      netMinor: money(r.netMinor),
      status: r.status,
      failureReason: r.failureReason,
      calculatedAt: r.calculatedAt,
      postedAt: r.postedAt,
    };
  }

  private shapeEarning(r: { id: string; orderDeliveryId: string | null; vendorOrderId: string | null; shipmentLegId?: string | null; currency: string; method: string; grossMinor: bigint; adjustmentsMinor: bigint; netMinor: bigint; status: string; calculatedAt: Date; postedAt: Date | null }) {
    return {
      id: r.id,
      orderDeliveryId: r.orderDeliveryId,
      vendorOrderId: r.vendorOrderId,
      currency: r.currency,
      method: r.method,
      grossMinor: money(r.grossMinor),
      adjustmentsMinor: money(r.adjustmentsMinor),
      netMinor: money(r.netMinor),
      status: r.status,
      calculatedAt: r.calculatedAt,
      postedAt: r.postedAt,
    };
  }
}
