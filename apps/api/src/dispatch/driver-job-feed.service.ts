import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  canReorderQueueItem,
  compareDriverJobs,
  DELIVERY_STATUS_LABELS,
  DRIVER_JOB_KIND_LABELS,
  DRIVER_JOB_KIND_SHAPE,
  DRIVER_OPEN_STATUSES,
  driverJobActionLabel,
  driverViewForStatus,
  nextDriverAction,
  queueStopKind,
  recommendRoute,
  reorderBlockedReason,
  ROUTE_ESTIMATE_DISCLOSURE,
  type DeliveryStatus,
  type DriverDeliveryView,
  type DriverJobKind,
  type DriverJobSummary,
  type LocationInput,
} from '@bmpl/shared';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';

/** Statuses a driver still has work to do on. Shared by both job kinds. */
const OPEN: DeliveryStatus[] = [...DRIVER_OPEN_STATUSES];

const DELIVERY_ROWS = {
  vendorOrder: {
    select: {
      orderNumber: true,
      itemCount: true,
      vendorProfile: {
        select: {
          businessName: true,
          locations: { orderBy: { isPrimary: 'desc' as const }, take: 1, select: { city: true, district: true, latitude: true, longitude: true } },
        },
      },
      order: {
        select: { orderNumber: true, isTest: true, addresses: { select: { city: true, district: true, latitude: true, longitude: true } } },
      },
    },
  },
} satisfies Prisma.OrderDeliveryInclude;

const LEG_ROWS = {
  originHub: { select: { name: true, city: true, district: true, latitude: true, longitude: true } },
  destinationHub: { select: { name: true, city: true, district: true, latitude: true, longitude: true } },
  shipment: {
    select: {
      reference: true,
      isTest: true,
      pieces: true,
      description: true,
      originCity: true, originDistrict: true, originLatitude: true, originLongitude: true,
      destinationCity: true, destinationDistrict: true, destinationLatitude: true, destinationLongitude: true,
    },
  },
} satisfies Prisma.ShipmentLegInclude;

type DeliveryRow = Prisma.OrderDeliveryGetPayload<{ include: typeof DELIVERY_ROWS }>;
type LegRow = Prisma.ShipmentLegGetPayload<{ include: typeof LEG_ROWS }>;

/** A summary plus the coordinates the router needs. Coordinates never go out. */
interface Routable {
  job: DriverJobSummary;
  stop: LocationInput;
  routable: boolean;
}

/**
 * The driver's work, from wherever it came.
 *
 * A driver holds one queue, not two. Their next stop might be a marketplace
 * delivery or the first mile of somebody's parcel to San Pedro, and asking them
 * to check two screens and reconcile the geography themselves would be the
 * platform pushing its own internal seams onto the person in the vehicle.
 *
 * This service PROJECTS. It reads both tables and shapes them into one
 * vocabulary; it never writes, and it never merges the two state machines.
 * Transitions still go to whichever service owns that record, with its own
 * guards intact. The seam stays exactly where it should be — in the backend,
 * invisible from the cab.
 */
@Injectable()
export class DriverJobFeedService {
  constructor(private readonly prisma: PrismaService) {}

  private async myProfileId(userId: string): Promise<string> {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!p) throw new ForbiddenException('No driver profile.');
    return p.id;
  }

  /** Every job in one of the four views, both kinds, in one ordering. */
  async list(userId: string, scope: DriverDeliveryView | 'open' | 'all' = 'open'): Promise<DriverJobSummary[]> {
    const profileId = await this.myProfileId(userId);
    const [deliveries, legs] = await Promise.all([
      this.prisma.orderDelivery.findMany({
        where: { assignedDriverProfileId: profileId, ...deliveryScope(scope) },
        take: 200,
        include: DELIVERY_ROWS,
      }),
      this.prisma.shipmentLeg.findMany({
        where: { assignedDriverProfileId: profileId, ...legScope(scope) },
        take: 200,
        include: LEG_ROWS,
      }),
    ]);

    const jobs = [...deliveries.map((d) => this.fromDelivery(d)), ...legs.map((l) => this.fromLeg(l))];
    // Completed work reads best newest-first; open work oldest-first, because the
    // thing that has been waiting longest is the thing to do.
    return scope === 'completed'
      ? jobs.sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime())
      : jobs.sort(compareDriverJobs);
  }

  /** Tab badges, counted across both kinds in one round trip each. */
  async counts(userId: string): Promise<Record<DriverDeliveryView, number>> {
    const profileId = await this.myProfileId(userId);
    const [deliveries, legs] = await Promise.all([
      this.prisma.orderDelivery.groupBy({
        by: ['status', 'acceptedAt'],
        where: { assignedDriverProfileId: profileId, status: { in: [...OPEN, 'DELIVERED'] as never } },
        _count: { _all: true },
      }),
      this.prisma.shipmentLeg.groupBy({
        by: ['courierStatus', 'acceptedAt'],
        where: { assignedDriverProfileId: profileId, courierStatus: { in: [...OPEN, 'DELIVERED'] as never } },
        _count: { _all: true },
      }),
    ]);

    const counts: Record<DriverDeliveryView, number> = { available: 0, assigned: 0, active: 0, completed: 0 };
    for (const row of deliveries) {
      const view = driverViewForStatus(row.status as DeliveryStatus, row.acceptedAt);
      if (view) counts[view] += row._count._all;
    }
    for (const row of legs) {
      if (!row.courierStatus) continue;
      const view = driverViewForStatus(row.courierStatus as DeliveryStatus, row.acceptedAt);
      if (view) counts[view] += row._count._all;
    }
    return counts;
  }

  /**
   * The driver's actionable queue with a recommended order over BOTH kinds.
   *
   * The safety rule that made the delivery route optimizer sound carries over
   * unchanged, and matters more here: only ONE stop per job is offered to the
   * optimizer — where the driver is actually headed next. A job whose parcel has
   * not been collected contributes its pickup, never its drop-off. That is what
   * makes it impossible for a recommendation to send a driver to a destination
   * before the thing being delivered is in the vehicle.
   *
   * A last-mile leg that the shipment has not released is not in this list at
   * all: it has no driver assigned, because dispatch would not offer it.
   */
  async queue(userId: string) {
    const profileId = await this.myProfileId(userId);
    const [deliveries, legs, profile] = await Promise.all([
      this.prisma.orderDelivery.findMany({
        where: { assignedDriverProfileId: profileId, status: { in: OPEN as never } },
        take: 50,
        include: DELIVERY_ROWS,
      }),
      this.prisma.shipmentLeg.findMany({
        where: { assignedDriverProfileId: profileId, courierStatus: { in: OPEN as never } },
        take: 50,
        include: LEG_ROWS,
      }),
      this.prisma.driverProfile.findUnique({ where: { id: profileId }, select: { homeDistrict: true } }),
    ]);

    const items: Routable[] = [
      ...deliveries.map((d) => ({
        job: this.fromDelivery(d),
        stop: this.deliveryStop(d),
        routable: d.acceptedAt != null && d.status !== 'ASSIGNED',
      })),
      ...legs.map((l) => ({
        job: this.fromLeg(l),
        stop: this.legStop(l),
        routable: l.acceptedAt != null && l.courierStatus !== 'ASSIGNED',
      })),
    ].sort((a, b) => compareDriverJobs(a.job, b.job));

    // Unaccepted offers are shown but not routed: planning around work that may
    // belong to somebody else in ninety seconds is planning around nothing.
    const routable = items.filter((i) => i.routable);
    const route = recommendRoute(
      routable.map((i) => ({ id: i.job.id, location: i.stop, manualPosition: i.job.queuePosition })),
      // BMPL has no live driver GPS. The home district is the best legitimate
      // proxy for a starting point, and it is the driver's own data.
      profile?.homeDistrict ? { district: profile.homeDistrict } : null,
    );
    const legByJob = new Map(route.legs.map((l) => [l.id, l]));

    const projected = items.map((i, index) => {
        const leg = legByJob.get(i.job.id);
        const stop = stopKindFor(i.job);
        return {
          ...i.job,
          position: index + 1,
          recommendedPosition: leg?.position ?? null,
          // What the driver is heading to for THIS job, right now.
          stopKind: queueStopKind(i.job.status),
          stopLabel: stop.label,
          stopArea: stop.place,
          legDistanceKm: leg?.legDistanceKm ?? null,
          legMinutes: leg?.legMinutes ?? null,
          estimatePrecision: leg?.precision ?? 'UNKNOWN',
          // `nextAction` keeps its existing OBJECT shape — the driver app reads
          // `.kind` off it. `nextActionLabel` is the new, job-aware wording that
          // sits beside it rather than replacing it.
          nextAction: nextDriverAction(i.job.status, i.job.acceptedAt ? new Date(i.job.acceptedAt) : null),
          nextActionLabel: driverJobActionLabel(i.job.kind, i.job.status),
          canReorder: canReorderQueueItem(i.job.status, i.job.acceptedAt ? new Date(i.job.acceptedAt) : null),
          reorderBlockedReason: reorderBlockedReason(i.job.status, i.job.acceptedAt ? new Date(i.job.acceptedAt) : null),
        };
    });

    return {
      items: projected,
      // True when the driver's own order already matches the recommendation. The
      // UI hides the "use recommended order" action on it, so DROPPING this field
      // silently removed the driver's way back to the suggested route after any
      // manual reorder — which is exactly what happened when this queue replaced
      // the delivery-only one.
      followsRecommendation: projected
        .filter((i) => i.recommendedPosition != null)
        .every((i, index) => i.recommendedPosition === index + 1),
      route: {
        // Existing contract: the ids in recommended order. Kept exactly.
        recommendedOrder: [...route.legs].sort((a, b) => a.position - b.position).map((l) => l.id),
        totalDistanceKm: route.totalDistanceKm,
        totalMinutes: route.totalMinutes,
        precision: route.precision,
        disclosure: ROUTE_ESTIMATE_DISCLOSURE[route.precision],
      },
    };
  }

  /* ------------------------------------------------------------ projection */

  private fromDelivery(d: DeliveryRow): DriverJobSummary {
    const pickup = d.vendorOrder.vendorProfile.locations[0] ?? null;
    const dropoff = d.vendorOrder.order.addresses[0] ?? null;
    const status = d.status as DeliveryStatus;
    return {
      id: d.id,
      kind: 'MARKETPLACE',
      kindLabel: DRIVER_JOB_KIND_LABELS.MARKETPLACE,
      view: driverViewForStatus(status, d.acceptedAt),
      status,
      statusLabel: DELIVERY_STATUS_LABELS[status],
      reference: d.vendorOrder.order.orderNumber,
      pickup: { name: d.vendorOrder.vendorProfile.businessName, area: area(pickup) },
      // The far end stays an AREA until the driver accepts — same rule the
      // delivery feed already applies, carried over rather than re-decided.
      dropoff: { name: null, area: area(dropoff) },
      load: `${d.vendorOrder.itemCount} ${d.vendorOrder.itemCount === 1 ? 'item' : 'items'}`,
      feeMinor: Number(d.feeMinor),
      assignedAt: d.assignedAt,
      acceptedAt: d.acceptedAt,
      completedAt: d.deliveredAt,
      offerExpiresAt: d.offerExpiresAt,
      queuePosition: d.driverQueuePosition,
      isTest: d.vendorOrder.order.isTest,
      // ---- The pre-existing marketplace contract, unchanged. ----
      // The driver app in production reads these today. The normalized fields
      // above are ADDED beside them, never instead of them: renaming a field a
      // live app depends on is the same outage as deleting it.
      ...{
        orderNumber: d.vendorOrder.order.orderNumber,
        vendor: d.vendorOrder.vendorProfile.businessName,
        pickupArea: area(pickup),
        itemCount: d.vendorOrder.itemCount,
        city: dropoff?.city ?? null,
        district: dropoff?.district ?? null,
        deliveredAt: d.deliveredAt,
      },
    };
  }

  private fromLeg(l: LegRow): DriverJobSummary {
    const kind = l.kind as DriverJobKind;
    const status = (l.courierStatus ?? 'PENDING_ASSIGNMENT') as DeliveryStatus;
    const s = l.shipment;

    // First mile: sender's door to a terminal. Last mile: the mirror image.
    // Direct: sender's door straight to the recipient's door, no terminal.
    const senderArea = { name: null, area: area({ city: s.originCity, district: s.originDistrict }) };
    const recipientArea = { name: null, area: area({ city: s.destinationCity, district: s.destinationDistrict }) };
    const door = kind === 'LAST_MILE' ? recipientArea : senderArea;
    const hub = kind === 'FIRST_MILE'
      ? { name: l.destinationHub?.name ?? null, area: area(l.destinationHub) }
      : { name: l.originHub?.name ?? null, area: area(l.originHub) };

    const pieces = s.pieces ?? 1;
    return {
      id: l.id,
      kind,
      kindLabel: DRIVER_JOB_KIND_LABELS[kind],
      view: driverViewForStatus(status, l.acceptedAt),
      status,
      statusLabel: DELIVERY_STATUS_LABELS[status],
      reference: s.reference,
      pickup: kind === 'LAST_MILE' ? hub : door,
      dropoff: kind === 'DIRECT' ? recipientArea : kind === 'FIRST_MILE' ? hub : door,
      load: s.description || `${pieces} ${pieces === 1 ? 'parcel' : 'parcels'}`,
      feeMinor: Number(l.priceMinor),
      assignedAt: l.assignedAt,
      acceptedAt: l.acceptedAt,
      completedAt: l.completedAt,
      offerExpiresAt: l.offerExpiresAt,
      queuePosition: l.driverQueuePosition,
      isTest: s.isTest,
    };
  }

  private deliveryStop(d: DeliveryRow): LocationInput {
    const target = queueStopKind(d.status) === 'PICKUP'
      ? d.vendorOrder.vendorProfile.locations[0]
      : d.vendorOrder.order.addresses[0];
    return { latitude: target?.latitude ?? null, longitude: target?.longitude ?? null, district: target?.district ?? null };
  }

  private legStop(l: LegRow): LocationInput {
    const collecting = queueStopKind((l.courierStatus ?? 'PENDING_ASSIGNMENT') as DeliveryStatus) === 'PICKUP';
    const s = l.shipment;
    // A door-to-door run starts and ends at an address; there is no hub either
    // side of it, so routing the driver via one would be actively wrong.
    if (l.kind === 'DIRECT') {
      return collecting
        ? { latitude: s.originLatitude, longitude: s.originLongitude, district: s.originDistrict }
        : { latitude: s.destinationLatitude, longitude: s.destinationLongitude, district: s.destinationDistrict };
    }
    if (l.kind === 'FIRST_MILE') {
      return collecting
        ? { latitude: s.originLatitude, longitude: s.originLongitude, district: s.originDistrict }
        : { latitude: l.destinationHub?.latitude ?? null, longitude: l.destinationHub?.longitude ?? null, district: l.destinationHub?.district ?? null };
    }
    return collecting
      ? { latitude: l.originHub?.latitude ?? null, longitude: l.originHub?.longitude ?? null, district: l.originHub?.district ?? null }
      : { latitude: s.destinationLatitude, longitude: s.destinationLongitude, district: s.destinationDistrict };
  }
}

/** Where the driver is headed for this job right now, in plain words. */
function stopKindFor(job: DriverJobSummary): { label: string; place: string | null } {
  const collecting = queueStopKind(job.status) === 'PICKUP';
  const end = collecting ? job.pickup : job.dropoff;
  return {
    label: collecting ? `Collect · ${DRIVER_JOB_KIND_SHAPE[job.kind]}` : 'Deliver',
    place: end.name ?? end.area,
  };
}

function area(v: { city?: string | null; district?: string | null } | null | undefined): string | null {
  if (!v) return null;
  return [v.city, v.district?.replace(/_/g, ' ')].filter(Boolean).join(', ') || null;
}

/**
 * Scope filters, mirroring the delivery feed's EXACTLY.
 *
 * `assigned` is the subtle one and was got wrong first time: a job the driver
 * has taken is ASSIGNED-with-an-acceptedAt only momentarily, and spends most of
 * its life as DRIVER_ACCEPTED. Both belong in the same tab, which is why this is
 * an OR and not a single status.
 */
function deliveryScope(scope: DriverDeliveryView | 'open' | 'all'): Prisma.OrderDeliveryWhereInput {
  switch (scope) {
    case 'available':
      return { status: 'ASSIGNED', acceptedAt: null };
    case 'assigned':
      return { OR: [{ status: 'ASSIGNED', acceptedAt: { not: null } }, { status: 'DRIVER_ACCEPTED' }] };
    case 'active':
      return { status: { in: ['PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'] as never } };
    case 'completed':
      return { status: 'DELIVERED' };
    case 'open':
      return { status: { in: OPEN as never } };
    default:
      return {};
  }
}

/** The same shapes over `courierStatus`, so both kinds land in the same tabs. */
function legScope(scope: DriverDeliveryView | 'open' | 'all'): Prisma.ShipmentLegWhereInput {
  switch (scope) {
    case 'available':
      return { courierStatus: 'ASSIGNED', acceptedAt: null };
    case 'assigned':
      return { OR: [{ courierStatus: 'ASSIGNED', acceptedAt: { not: null } }, { courierStatus: 'DRIVER_ACCEPTED' }] };
    case 'active':
      return { courierStatus: { in: ['PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'] as never } };
    case 'completed':
      return { courierStatus: 'DELIVERED' };
    case 'open':
      return { courierStatus: { in: OPEN as never } };
    default:
      return { courierStatus: { not: null } };
  }
}
