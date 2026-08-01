import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DELIVERY_STATUS_LABELS, type DeliveryStatus } from '@bmpl/shared';
import type { AssignDeliveryInput, CancelDeliveryInput, ReassignDeliveryInput } from '@bmpl/validation';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { DriverService } from '../driver/driver.service';
import { MessagingService } from '../messaging/messaging.service';
import { DeliveryCoreService } from './delivery-core.service';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

const money = (v: bigint) => Number(v);

/**
 * Admin dispatch: view deliveries, list eligible drivers, assign / reassign /
 * cancel, and read timelines, assignment history, and proof of delivery. NO
 * automatic matching (a placeholder is exposed but never assigns). Eligibility is
 * re-checked at assignment time via DriverService.
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drivers: DriverService,
    private readonly core: DeliveryCoreService,
    private readonly messaging: MessagingService,
  ) {}

  // ---- reads -------------------------------------------------------------

  /** List deliveries for the dispatch console with light filters. */
  async list(filter: { status?: string; district?: string; vendorProfileId?: string; unassigned?: boolean }) {
    const where: Prisma.OrderDeliveryWhereInput = {};
    if (filter.status) where.status = filter.status as DeliveryStatus;
    if (filter.unassigned) where.assignedDriverProfileId = null;
    if (filter.vendorProfileId) where.vendorOrder = { vendorProfileId: filter.vendorProfileId };
    if (filter.district) {
      where.vendorOrder = { ...(where.vendorOrder as object), order: { addresses: { some: { district: filter.district as never } } } };
    }
    const rows = await this.prisma.orderDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        vendorOrder: {
          select: {
            orderNumber: true,
            vendorProfile: { select: { businessName: true } },
            order: { select: { orderNumber: true, addresses: { select: { district: true, city: true } } } },
          },
        },
        assignedDriver: { select: { displayName: true } },
      },
    });
    return rows.map((d) => ({
      id: d.id,
      status: d.status,
      statusLabel: DELIVERY_STATUS_LABELS[d.status],
      orderNumber: d.vendorOrder.order.orderNumber,
      vendorOrderNumber: d.vendorOrder.orderNumber,
      vendor: d.vendorOrder.vendorProfile.businessName,
      district: d.vendorOrder.order.addresses[0]?.district ?? null,
      city: d.vendorOrder.order.addresses[0]?.city ?? null,
      feeMinor: money(d.feeMinor),
      driver: d.assignedDriver?.displayName ?? null,
      createdAt: d.createdAt,
    }));
  }

  async get(deliveryId: string) {
    const d = await this.core.loadOrThrow(deliveryId);
    const serialized = await this.core.serialize(d, 'ADMIN');
    // Attach current-driver eligibility (why a driver may/may not act) when assigned.
    let currentDriverEligibility = null;
    if (d.assignedDriverProfileId) {
      const district = d.vendorOrder.order.addresses[0]?.district;
      if (district) {
        const e = await this.drivers.assignmentEligibility(d.assignedDriverProfileId, district, d.assignedVehicleId ?? undefined);
        currentDriverEligibility = { eligible: e.eligible, reasons: e.reasons };
      }
    }
    return { ...serialized, currentDriverEligibility };
  }

  async timeline(deliveryId: string) {
    const d = await this.core.loadOrThrow(deliveryId);
    return this.core.timeline(d);
  }

  async history(deliveryId: string) {
    const d = await this.core.loadOrThrow(deliveryId);
    return this.core.assignmentHistory(d);
  }

  async proof(deliveryId: string) {
    const d = await this.core.loadOrThrow(deliveryId);
    const serialized = await this.core.serialize(d, 'ADMIN');
    return { recipientName: d.recipientName, deliveredAt: d.deliveredAt, deliveryNotes: d.deliveryNotes, podPhotoUrls: serialized.podPhotoUrls };
  }

  /** Eligible drivers for a delivery's destination district. */
  async eligibleDrivers(deliveryId: string) {
    const d = await this.core.loadOrThrow(deliveryId);
    const district = this.districtOrThrow(d);
    return this.drivers.eligibleDriversForDistrict(district);
  }

  /** Placeholder for a future auto-assignment engine — it MUST NOT assign. */
  async autoAssignPreview(deliveryId: string) {
    const candidates = await this.eligibleDrivers(deliveryId);
    return {
      implemented: false,
      message: 'Automatic matching is not enabled. Assign a driver manually.',
      candidateCount: candidates.length,
    };
  }

  // ---- assignment mutations ---------------------------------------------

  async assign(actor: Actor, deliveryId: string, dto: AssignDeliveryInput) {
    return this.assignInternal(actor, deliveryId, dto.driverProfileId, dto.vehicleId, null, 'ASSIGN');
  }

  async reassign(actor: Actor, deliveryId: string, dto: ReassignDeliveryInput) {
    return this.assignInternal(actor, deliveryId, dto.driverProfileId, dto.vehicleId, dto.reason, 'REASSIGN');
  }

  private async assignInternal(actor: Actor, deliveryId: string, driverProfileId: string, vehicleId: string, reason: string | null, action: 'ASSIGN' | 'REASSIGN') {
    const current = await this.core.loadOrThrow(deliveryId);
    this.core.assertAction(action, current.status);
    const district = this.districtOrThrow(current);

    // Re-check eligibility AT ASSIGNMENT TIME (spec requirement).
    const e = await this.drivers.assignmentEligibility(driverProfileId, district, vehicleId);
    if (!e.eligible) throw new BadRequestException(`Driver is not eligible: ${e.reasons.join('; ')}.`);

    const fromStatus = current.status;
    await this.prisma.$transaction(async (tx) => {
      // End any active assignment (append-only: mark REASSIGNED, never delete).
      if (action === 'REASSIGN') {
        await tx.deliveryAssignment.updateMany({
          where: { orderDeliveryId: deliveryId, status: { in: ['ACTIVE', 'ACCEPTED'] } },
          data: { status: 'REASSIGNED', endedAt: new Date(), endReason: reason },
        });
      }
      // Generate fresh pickup + delivery PINs for this assignment.
      const pickupPin = this.core.genPin();
      const deliveryPin = this.core.genPin();
      await tx.orderDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'ASSIGNED',
          assignedDriverProfileId: driverProfileId,
          assignedVehicleId: vehicleId,
          assignedByUserId: actor.userId,
          assignedAt: new Date(),
          ...(action === 'REASSIGN' ? { reassignedAt: new Date(), reassignmentReason: reason } : {}),
          // Reset per-attempt verification state.
          acceptedAt: null,
          declinedAt: null,
          declineReason: null,
          pickupPin,
          pickupPinAttempts: 0,
          pickupVerificationStatus: 'PENDING',
          deliveryPin,
          deliveryPinAttempts: 0,
          deliveryVerificationStatus: 'PENDING',
        },
      });
      await tx.deliveryAssignment.create({
        data: { orderDeliveryId: deliveryId, driverProfileId, vehicleId, assignedByUserId: actor.userId, status: 'ACTIVE' },
      });
      await this.core.appendTimeline(tx, deliveryId, { fromStatus, toStatus: 'ASSIGNED', event: action, actorRole: 'ADMIN', actorUserId: actor.userId, note: reason });
      await this.core.auditTransition(action, actor.userId, deliveryId, { driverProfileId, vehicleId, reason }, tx);
      await this.core.notify(
        [e.profile.userId, current.vendorOrder.order.userId, current.vendorOrder.vendorProfile.userId],
        { title: action === 'REASSIGN' ? 'Delivery reassigned' : 'Driver assigned', body: `Order ${current.vendorOrder.order.orderNumber}: a driver has been ${action === 'REASSIGN' ? 'reassigned' : 'assigned'}.`, data: { deliveryId } },
        tx,
      );
    });
    // Best-effort: system message + driver-participant swap in any DELIVERY thread.
    await this.messaging.onDeliveryEvent(deliveryId, action === 'REASSIGN' ? 'Delivery reassigned to a new driver.' : 'A driver was assigned.', e.profile.userId);
    return this.get(deliveryId);
  }

  async cancel(actor: Actor, deliveryId: string, dto: CancelDeliveryInput) {
    const current = await this.core.loadOrThrow(deliveryId);
    this.core.assertAction('CANCEL', current.status);
    const fromStatus = current.status;
    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryAssignment.updateMany({
        where: { orderDeliveryId: deliveryId, status: { in: ['ACTIVE', 'ACCEPTED'] } },
        data: { status: 'CANCELLED', endedAt: new Date(), endReason: dto.reason },
      });
      await tx.orderDelivery.update({
        where: { id: deliveryId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: dto.reason },
      });
      await this.core.appendTimeline(tx, deliveryId, { fromStatus, toStatus: 'CANCELLED', event: 'CANCEL', actorRole: 'ADMIN', actorUserId: actor.userId, note: dto.reason });
      await this.core.auditTransition('CANCEL', actor.userId, deliveryId, { reason: dto.reason }, tx);
      await this.core.notify(
        [current.assignedDriver ? current.vendorOrder.order.userId : null, current.vendorOrder.order.userId, current.vendorOrder.vendorProfile.userId, current.assignedDriverProfileId ? (await tx.driverProfile.findUnique({ where: { id: current.assignedDriverProfileId }, select: { userId: true } }))?.userId : null],
        { title: 'Delivery cancelled', body: `The delivery for order ${current.vendorOrder.order.orderNumber} was cancelled.`, data: { deliveryId } },
        tx,
      );
    });
    await this.messaging.onDeliveryEvent(deliveryId, 'This delivery was cancelled.', null);
    return this.get(deliveryId);
  }

  // ---- PIN reveal (deliveries.verify) -----------------------------------

  /** Admin PIN reveal (override visibility). Never returned in general payloads. */
  async revealPins(deliveryId: string) {
    const d = await this.prisma.orderDelivery.findUnique({ where: { id: deliveryId }, select: { pickupPin: true, deliveryPin: true, pickupVerificationStatus: true, deliveryVerificationStatus: true } });
    if (!d) throw new NotFoundException('Delivery not found.');
    return { pickupPin: d.pickupPin, deliveryPin: d.deliveryPin, pickupVerificationStatus: d.pickupVerificationStatus, deliveryVerificationStatus: d.deliveryVerificationStatus };
  }

  // ---- helpers -----------------------------------------------------------

  private districtOrThrow(d: { vendorOrder: { order: { addresses: Array<{ district: string }> } } }): string {
    const district = d.vendorOrder.order.addresses[0]?.district;
    if (!district) throw new BadRequestException('This delivery has no destination district; cannot assign.');
    return district;
  }
}
