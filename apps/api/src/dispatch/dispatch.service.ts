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

/**
 * Who performed an assignment. A null userId means the DISPATCH ENGINE acted, not
 * a person — the audit trail and timeline distinguish the two, and
 * `assignedByUserId` is already nullable for exactly this case.
 */
interface AssigningActor {
  userId: string | null;
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
        const e = await this.drivers.assignmentEligibility(d.assignedDriverProfileId, district, d.assignedVehicleId ?? undefined, {
          isTestDelivery: d.vendorOrder.order.isTest,
        });
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
    // Only the matching side of the simulation boundary, and never the customer
    // themselves — an admin should not be offered a choice the assignment would
    // then refuse.
    return this.drivers.eligibleDriversForDistrict(district, {
      isTest: d.vendorOrder.order.isTest,
      excludeUserId: d.vendorOrder.order.userId,
    });
  }

  /**
   * Candidate pool for an admin preview. Automatic dispatch is live (see
   * DispatchEngineService); this is now a read-only "who would be considered"
   * view rather than the old stub that reported the feature as unimplemented.
   */
  async autoAssignPreview(deliveryId: string) {
    const candidates = await this.eligibleDrivers(deliveryId);
    return {
      implemented: true,
      message:
        candidates.length > 0
          ? 'Automatic dispatch will offer this delivery to the highest-ranked driver.'
          : 'No eligible driver is online for this district right now.',
      candidateCount: candidates.length,
      candidates,
    };
  }

  /**
   * Assign on behalf of the DISPATCH ENGINE rather than a person.
   *
   * Deliberately a thin entry into the same `assignInternal` an admin uses, so
   * automatic and manual assignment produce identical state: the same
   * assignment-time eligibility re-check, the same fresh pickup/delivery PINs,
   * the same append-only DeliveryAssignment history, timeline event, audit row,
   * notifications and messaging side effects. Duplicating any of that for the
   * automatic path is how the two silently diverge.
   *
   * `assignedByUserId` stays null, which is already nullable in the schema and is
   * what distinguishes a system assignment from an administrator's in the audit
   * trail.
   *
   * The ACTION is chosen from the delivery's CURRENT status, not hard-coded.
   * This used to always pass 'ASSIGN', whose only legal `from` is
   * PENDING_ASSIGNMENT — so the moment a delivery reached DRIVER_DECLINED
   * (a driver declined, or an offer lapsed and the sweeper released it) every
   * re-offer threw the state-machine guard, the engine's candidate loop logged
   * "candidate became ineligible" for each driver in turn and returned
   * NO_CANDIDATES. Automatic dispatch could therefore only ever make the FIRST
   * offer on a delivery: one decline and it sat unassigned while the sweeper
   * retried and silently failed every twenty seconds.
   *
   * DELIVERY_ACTIONS.REASSIGN already lists DRIVER_DECLINED as a legal `from`, so
   * the state machine is not widened here — the right existing action is used.
   * Its extra behaviour is a no-op for this case: the "close any ACTIVE/ACCEPTED
   * assignment" write matches nothing, because releasing the offer already marked
   * that row DECLINED.
   */
  async systemAssign(deliveryId: string, driverProfileId: string, vehicleId: string) {
    const current = await this.prisma.orderDelivery.findUnique({
      where: { id: deliveryId },
      select: { status: true },
    });
    // assignInternal re-reads and re-asserts inside its own flow, so a status
    // change between here and there produces the ordinary BadRequest the engine's
    // candidate loop already handles rather than a bad write.
    const action = current?.status === 'DRIVER_DECLINED' ? 'REASSIGN' : 'ASSIGN';
    return this.assignInternal({ userId: null }, deliveryId, driverProfileId, vehicleId, null, action);
  }

  // ---- assignment mutations ---------------------------------------------

  async assign(actor: Actor, deliveryId: string, dto: AssignDeliveryInput) {
    return this.assignInternal(actor, deliveryId, dto.driverProfileId, dto.vehicleId, null, 'ASSIGN');
  }

  async reassign(actor: Actor, deliveryId: string, dto: ReassignDeliveryInput) {
    return this.assignInternal(actor, deliveryId, dto.driverProfileId, dto.vehicleId, dto.reason, 'REASSIGN');
  }

  private async assignInternal(actor: AssigningActor, deliveryId: string, driverProfileId: string, vehicleId: string, reason: string | null, action: 'ASSIGN' | 'REASSIGN') {
    const current = await this.core.loadOrThrow(deliveryId);
    this.core.assertAction(action, current.status);
    const district = this.districtOrThrow(current);

    // Re-check eligibility AT ASSIGNMENT TIME (spec requirement). Passing the
    // order's simulation flag makes the test/real boundary a hard server-side
    // rule on the ADMIN path too, not just in the dispatch engine — an
    // administrator cannot hand a rehearsal to a real driver by mistake, nor a
    // real customer's delivery to a test account.
    // Nobody delivers their own order. This is the rule, not the filter: the
    // candidate search already leaves the customer out of the running, but every
    // assignment — automatic, administrator, or reassignment after a decline —
    // arrives here, so this is the line that has to hold when something upstream
    // is wrong or an administrator submits a driver id by hand.
    //
    // The comparison is on the USER, never the active role. A person may hold
    // both CUSTOMER and DELIVERY_DRIVER legitimately and drive for other people
    // all day; switching roles does not make them a different human being, and
    // it must not turn their own order into a job they can take, mark delivered
    // on their own say-so, and collect the fee for.
    const assignee = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      select: { userId: true },
    });
    if (!assignee) throw new BadRequestException('That driver profile does not exist.');
    if (assignee.userId === current.vendorOrder.order.userId) {
      throw new BadRequestException('Customer cannot be assigned as the driver for their own delivery.');
    }

    const e = await this.drivers.assignmentEligibility(driverProfileId, district, vehicleId, {
      isTestDelivery: current.vendorOrder.order.isTest,
    });
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
      await this.core.appendTimeline(tx, deliveryId, { fromStatus, toStatus: 'ASSIGNED', event: action, actorRole: actor.userId ? 'ADMIN' : 'SYSTEM', actorUserId: actor.userId, note: reason });
      await this.core.auditTransition(action, actor.userId, deliveryId, { driverProfileId, vehicleId, reason }, tx);
      await this.core.notify(
        [e.profile.userId, current.vendorOrder.order.userId, current.vendorOrder.vendorProfile.userId],
        { title: action === 'REASSIGN' ? 'Delivery reassigned' : 'Driver assigned', body: `Order ${current.vendorOrder.order.orderNumber}: a driver has been ${action === 'REASSIGN' ? 'reassigned' : 'assigned'}.`, data: { deliveryId } },
        tx,
      );
    });
    // NOTE: threads are deliberately NOT opened here. Being offered a job is not
    // the same as taking it — see DriverJobService.accept, which opens them once
    // the driver commits. M17 §4 specifies participants are "added on access",
    // and under automatic dispatch a single delivery may be offered to several
    // drivers in turn; enrolling each one at assignment would leave every driver
    // who ignored an offer holding permanent read access to a customer's thread.
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
