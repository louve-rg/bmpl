import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { canPerform, DELIVERY_STATUS_LABELS, deliveryStage, type DeliveryStatus } from '@bmpl/shared';
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

  /**
   * List deliveries for the dispatch console with light filters.
   *
   * `automaticDispatch` is the engine's effective setting, passed in by the
   * controller (DispatchEngineService.settings() stays the single authority —
   * this service must not re-derive the default). With automatic dispatch off,
   * a ready-but-unassigned delivery moves ONLY when a human assigns it, and
   * before this flag ops had no signal that anyone had to act.
   */
  async list(
    filter: { status?: string; district?: string; vendorProfileId?: string; unassigned?: boolean },
    automaticDispatch: boolean,
  ) {
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
            status: true,
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
      // "A human must assign this or it moves never": dispatchable by the
      // engine's own two-fact readiness test (timestamp AND vendor-order
      // status agree — the backfill lesson), no driver holding it, and the
      // engine itself switched off.
      needsManualAssignment:
        deliveryStage(d) === 'AWAITING_DISPATCH' && d.vendorOrder.status === 'READY_FOR_PICKUP' && !automaticDispatch,
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
          city: d.vendorOrder.order.addresses[0]?.city ?? null,
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
    const district = this.core.districtOrThrow(d);
    // Only the matching side of the simulation boundary, and never the customer
    // themselves — an admin should not be offered a choice the assignment would
    // then refuse.
    return this.drivers.eligibleDriversForDistrict(district, {
      isTest: d.vendorOrder.order.isTest,
      excludeUserId: d.vendorOrder.order.userId,
      city: this.core.cityOf(d),
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
    const district = this.core.districtOrThrow(current);

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
      city: this.core.cityOf(current),
    });
    if (!e.eligible) throw new BadRequestException(`Driver is not eligible: ${e.reasons.join('; ')}.`);

    const fromStatus = current.status;
    // Whatever this read actually saw holding the delivery — null for a fresh
    // ASSIGN (REASSIGN's own legal-`from` list requires it to already be held;
    // ASSIGN requires PENDING_ASSIGNMENT, which is never held). Re-asserted
    // inside the write below alongside fromStatus, together they are exactly
    // the state this call is allowed to act on — not state-in-general.
    const fromDriverProfileId = current.assignedDriverProfileId;

    // Generate fresh pickup + delivery PINs for this assignment outside the
    // transaction — pure, no DB — so the guarded write below is the FIRST
    // statement inside it, same shape as DriverJobService.accept()/decline().
    const pickupPin = this.core.genPin();
    const deliveryPin = this.core.genPin();

    const won = await this.prisma.$transaction(async (tx) => {
      // Conditional write, NOT an unconditional update by id. `current` above
      // is a read taken before this transaction opened — a second writer
      // (another admin, a concurrent reassign, or the dispatch engine's own
      // systemAssign re-entering the same delivery) can act on it in between.
      // An unconditional `update` would then silently discard whichever write
      // commits first: same PINs column, same driver column, no unique
      // constraint to catch it, no error either side. Re-asserting BOTH the
      // status AND the driver this call actually read, inside the statement
      // itself, makes the database the arbiter — exactly one writer's WHERE
      // still matches when it executes, so the database is the arbiter, not
      // a read that went stale the moment it was taken. `fromDriverProfileId`
      // matters as much as `fromStatus`: a REASSIGN's `from` and `to` can
      // both be 'ASSIGNED' (reassigning an already-assigned delivery to a
      // different driver), so status alone cannot tell two concurrent
      // reassigns apart — only re-asserting which driver was actually read
      // closes that case too.
      const claimed = await tx.orderDelivery.updateMany({
        where: { id: deliveryId, status: fromStatus, assignedDriverProfileId: fromDriverProfileId },
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
      if (claimed.count === 0) return false;

      // End any active assignment (append-only: mark REASSIGNED, never
      // delete). Runs only after the guarded write above has already won —
      // a losing call must not touch this either.
      if (action === 'REASSIGN') {
        await tx.deliveryAssignment.updateMany({
          where: { orderDeliveryId: deliveryId, status: { in: ['ACTIVE', 'ACCEPTED'] } },
          data: { status: 'REASSIGNED', endedAt: new Date(), endReason: reason },
        });
      }
      await tx.deliveryAssignment.create({
        data: { orderDeliveryId: deliveryId, driverProfileId, vehicleId, assignedByUserId: actor.userId, status: 'ACTIVE' },
      });
      await this.core.appendTimeline(tx, deliveryId, { fromStatus, toStatus: 'ASSIGNED', event: action, actorRole: actor.userId ? 'ADMIN' : 'SYSTEM', actorUserId: actor.userId, note: reason });
      await this.core.auditTransition(action, actor.userId, deliveryId, { driverProfileId, vehicleId, reason }, tx);
      await this.core.notify(
        [e.profile.userId, current.vendorOrder.order.userId, current.vendorOrder.vendorProfile.userId],
        { event: action === 'REASSIGN' ? 'DRIVER_REASSIGNED' : 'DELIVERY_DRIVER_ASSIGNED', title: action === 'REASSIGN' ? 'Delivery reassigned' : 'Driver assigned', body: `Order ${current.vendorOrder.order.orderNumber}: a driver has been ${action === 'REASSIGN' ? 'reassigned' : 'assigned'}.`, data: { deliveryId } },
        tx,
      );
      return true;
    });

    if (!won) {
      throw new ConflictException(
        'This delivery changed state before the assignment could be written — reload and try again.',
      );
    }
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
    const won = await this.prisma.$transaction((tx) => this.cancelInTx(tx, current, dto.reason, actor.userId, 'ADMIN'));
    if (!won) {
      throw new ConflictException('This delivery changed state before it could be cancelled — reload and try again.');
    }
    await this.messaging.onDeliveryEvent(deliveryId, 'This delivery was cancelled.', null);
    return this.get(deliveryId);
  }

  /**
   * The write CANCEL actually performs, factored out so ORD-RELEASE-AFTER-READY's
   * release-triggered cancellation (below) can compose it atomically inside the
   * SAME transaction as the reservation release, instead of re-deriving the
   * write — same shape as OrdersService.releaseReservationsInTx/releaseReservations.
   *
   * Conditional write, NOT an unconditional update by id. CANCEL's own legal
   * `from` list includes DRIVER_ACCEPTED — the same status CONFIRM_PICKUP's
   * only legal `from` is — so an admin cancelling and the assigned driver
   * confirming pickup can both legally act on the same row at the same
   * instant. An unconditional update here let whichever committed last
   * silently win: a cancelled order resurrecting to PICKUP_CONFIRMED with
   * inventory finalized after everyone was told it was cancelled, or
   * inventory finalized on an order that then ends up CANCELLED underneath
   * the driver who just picked it up. Re-asserting the status this call
   * actually read, inside the write, closes it — same pattern as
   * DriverJobService.accept()/confirmPickup and DispatchService.assignInternal.
   */
  private async cancelInTx(
    tx: Prisma.TransactionClient,
    current: { id: string; status: DeliveryStatus; assignedDriverProfileId: string | null; vendorOrder: { order: { userId: string; orderNumber: string }; vendorProfile: { userId: string } } },
    reason: string | null,
    actorId: string | null,
    actorRole: 'ADMIN' | 'SYSTEM',
  ): Promise<boolean> {
    const fromStatus = current.status;
    const claimed = await tx.orderDelivery.updateMany({
      where: { id: current.id, status: fromStatus },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason },
    });
    if (claimed.count === 0) return false;
    await tx.deliveryAssignment.updateMany({
      where: { orderDeliveryId: current.id, status: { in: ['ACTIVE', 'ACCEPTED'] } },
      data: { status: 'CANCELLED', endedAt: new Date(), endReason: reason },
    });
    await this.core.appendTimeline(tx, current.id, { fromStatus, toStatus: 'CANCELLED', event: 'CANCEL', actorRole, actorUserId: actorId, note: reason });
    await this.core.auditTransition('CANCEL', actorId, current.id, { reason }, tx);
    // Same recipient list `cancel()` always computed (the first element is
    // redundant with the second whenever a driver is assigned — pre-existing,
    // left unchanged here; `notify()` fans out to each DISTINCT user).
    await this.core.notify(
      [current.assignedDriverProfileId ? current.vendorOrder.order.userId : null, current.vendorOrder.order.userId, current.vendorOrder.vendorProfile.userId, current.assignedDriverProfileId ? (await tx.driverProfile.findUnique({ where: { id: current.assignedDriverProfileId }, select: { userId: true } }))?.userId : null],
      { event: 'DELIVERY_CANCELLED', title: 'Delivery cancelled', body: `The delivery for order ${current.vendorOrder.order.orderNumber} was cancelled.`, data: { deliveryId: current.id } },
      tx,
    );
    return true;
  }

  /**
   * ORD-RELEASE-AFTER-READY. `VendorFulfilmentService.markReady()` already
   * refuses to create an OrderDelivery for a released order (#797), but the
   * reverse direction had no guard at all: `OrdersService.releaseReservationsInTx`
   * could release payment on an order the vendor had ALREADY readied, after
   * which dispatch, driver accept/pickup/delivery all proceeded normally on a
   * CANCELLED payment — settlement later refuses it, so the loss lands on
   * whoever physically handed over the goods.
   *
   * This is the one place that decides whether a release may proceed, called
   * BY releaseReservationsInTx inside its own transaction (same composable
   * shape it already uses for everything else it touches), so a release and
   * its consequence for an in-flight delivery commit or roll back together —
   * never a window where the order reads "released" while a delivery is still
   * live and nothing has reacted to it yet.
   *
   * Decision (stated, not guessed): the release itself is allowed to proceed
   * — it is an admin financial decision (a refund) and must not be gated on
   * logistics — and any delivery still live is CANCELLED as part of the same
   * release, reusing the existing CANCEL edge and its existing notification,
   * never a new mechanism. This moves state only: no refund, no escrow
   * release, no settlement adjustment and no wallet entry beyond what
   * releaseReservationsInTx already does on its own — CANCEL has never
   * reversed money and does not start here.
   *
   * The one case this does NOT resolve, by design: CANCEL's own legal `from`
   * list (packages/shared/dispatch.ts) deliberately excludes PICKUP_CONFIRMED,
   * IN_TRANSIT and ARRIVING — once a driver already holds the parcel,
   * cancelling is not a safe state transition (inventory is already
   * finalized, and the goods are not at the vendor to "un-ready"). Widening
   * CANCEL to reach those states would reopen that deliberate constraint for
   * a case with no existing safe edge to express it, which is a product
   * decision, not an engineering one. Rather than invent one, this REFUSES
   * the whole release while any of this order's deliveries is in one of
   * those three statuses (the admin sees why; the release can be retried once
   * the delivery resolves itself) — flagged to Michael as the one slice of
   * this gap that may need the owner's call, not decided silently here.
   */
  async cancelForReleasedOrder(tx: Prisma.TransactionClient, orderId: string, actorId: string | null): Promise<void> {
    const deliveries = await tx.orderDelivery.findMany({
      where: { vendorOrder: { orderId } },
      include: { vendorOrder: { include: { order: { select: { userId: true, orderNumber: true } }, vendorProfile: { select: { userId: true } } } } },
    });
    const blocked = deliveries.find((d) => d.status === 'PICKUP_CONFIRMED' || d.status === 'IN_TRANSIT' || d.status === 'ARRIVING');
    if (blocked) {
      throw new ConflictException(
        `Cannot release this order's reservations: delivery ${blocked.id} has already been picked up and cannot be safely cancelled from "${DELIVERY_STATUS_LABELS[blocked.status]}". Wait for it to resolve (delivered, or a reported problem cancelled), or escalate for a decision.`,
      );
    }
    for (const d of deliveries) {
      if (!canPerform('CANCEL', d.status)) continue; // already terminal (DELIVERED/CANCELLED) — nothing to do
      const won = await this.cancelInTx(
        tx,
        d,
        "This order's payment was returned to the customer; the delivery could not proceed.",
        actorId,
        'SYSTEM',
      );
      if (!won) {
        throw new ConflictException('This delivery changed state before the release could be applied — reload and try again.');
      }
    }
  }

  // ---- PIN reveal (deliveries.verify) -----------------------------------

  /** Admin PIN reveal (override visibility). Never returned in general payloads. */
  async revealPins(deliveryId: string) {
    const d = await this.prisma.orderDelivery.findUnique({ where: { id: deliveryId }, select: { pickupPin: true, deliveryPin: true, pickupVerificationStatus: true, deliveryVerificationStatus: true } });
    if (!d) throw new NotFoundException('Delivery not found.');
    return { pickupPin: d.pickupPin, deliveryPin: d.deliveryPin, pickupVerificationStatus: d.pickupVerificationStatus, deliveryVerificationStatus: d.deliveryVerificationStatus };
  }

}
