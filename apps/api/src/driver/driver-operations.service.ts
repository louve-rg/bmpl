import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Delivery states where the job is on a driver's plate right now. */
const ACTIVE_STATUSES = [
  'ASSIGNED',
  'DRIVER_ACCEPTED',
  'PICKUP_CONFIRMED',
  'IN_TRANSIT',
  'ARRIVING',
] as const;

/**
 * Operational figures for the Driver Operations Center (M26.3 · Part 5).
 *
 * READ-ONLY and purely derived. It computes nothing that is stored anywhere else
 * and changes no state, so it cannot disagree with the systems it reports on —
 * earnings still come from DriverEarning rows written by settlement, eligibility
 * still from DriverService. This exists so the dashboard is one round trip
 * instead of six, not to become a second source of truth.
 *
 * Deliberately kept out of DriverService: that class is already the authority on
 * driver rules and identity, and bolting reporting onto it would mean every
 * eligibility check drags a pile of aggregate queries along with it.
 */
@Injectable()
export class DriverOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(driverProfileId: string, userId: string, now: Date = new Date()) {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    // Rolling 7 days rather than a calendar week: a driver checking earnings on
    // Monday morning wants the last week's work, not two hours of it.
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      activeDeliveries,
      deliveredToday,
      deliveredThisWeek,
      earningsRows,
      assignmentCounts,
      profile,
      unreadNotifications,
    ] = await Promise.all([
      this.prisma.orderDelivery.findMany({
        where: {
          assignedDriverProfileId: driverProfileId,
          status: { in: ACTIVE_STATUSES as unknown as string[] as never },
        },
        orderBy: { assignedAt: 'asc' },
        select: {
          id: true,
          status: true,
          assignedAt: true,
          acceptedAt: true,
          offerExpiresAt: true,
          estimateLabel: true,
          vendorOrder: {
            select: {
              orderNumber: true,
              vendorProfile: { select: { businessName: true } },
              order: { select: { addresses: { select: { city: true, district: true } } } },
            },
          },
        },
      }),
      this.prisma.orderDelivery.count({
        where: {
          assignedDriverProfileId: driverProfileId,
          status: 'DELIVERED',
          deliveredAt: { gte: startOfToday },
        },
      }),
      this.prisma.orderDelivery.count({
        where: {
          assignedDriverProfileId: driverProfileId,
          status: 'DELIVERED',
          deliveredAt: { gte: weekAgo },
        },
      }),
      this.prisma.driverEarning.findMany({
        where: { driverProfileId, createdAt: { gte: weekAgo } },
        select: { netMinor: true, status: true, createdAt: true },
      }),
      // One grouped query rather than three counts — acceptance and completion
      // rates are both derived from the same assignment history.
      this.prisma.deliveryAssignment.groupBy({
        by: ['status'],
        where: { driverProfileId },
        _count: { _all: true },
      }),
      this.prisma.driverProfile.findUnique({
        where: { id: driverProfileId },
        select: {
          availability: true,
          ratingAverage: true,
          ratingCount: true,
          completedDeliveries: true,
          licenceExpiry: true,
          userId: true,
        },
      }),
      // Filtered on userId directly so it uses the [userId, readAt] index
      // rather than joining back through the driver profile.
      this.prisma.notificationRecipient.count({ where: { userId, readAt: null } }),
    ]);

    const countOf = (status: string) =>
      assignmentCounts.find((a) => a.status === status)?._count._all ?? 0;
    const accepted = countOf('ACCEPTED') + countOf('COMPLETED');
    const declined = countOf('DECLINED');
    const offered = accepted + declined;
    const completed = countOf('COMPLETED');

    const earnedToday = earningsRows
      .filter((e) => e.createdAt >= startOfToday)
      .reduce((sum, e) => sum + Number(e.netMinor), 0);
    const earnedThisWeek = earningsRows.reduce((sum, e) => sum + Number(e.netMinor), 0);
    const pendingPayout = earningsRows
      .filter((e) => e.status === 'PENDING')
      .reduce((sum, e) => sum + Number(e.netMinor), 0);

    // The single job the driver is actually doing. An outstanding OFFER is
    // separated from work in progress: one needs a decision now, the other needs
    // driving, and merging them buries the thing with a countdown on it.
    const pendingOffer = activeDeliveries.find((d) => d.status === 'ASSIGNED' && !d.acceptedAt);
    const current = activeDeliveries.find((d) => d.status !== 'ASSIGNED' || d.acceptedAt);

    return {
      availability: profile?.availability ?? 'OFFLINE',
      currentDelivery: current ? this.shape(current) : null,
      pendingOffer: pendingOffer ? this.shape(pendingOffer) : null,
      upcoming: activeDeliveries
        .filter((d) => d.id !== current?.id && d.id !== pendingOffer?.id)
        .map((d) => this.shape(d)),
      counts: {
        activeNow: activeDeliveries.length,
        deliveredToday,
        deliveredThisWeek,
        completedAllTime: profile?.completedDeliveries ?? 0,
      },
      earnings: {
        todayMinor: earnedToday,
        weekMinor: earnedThisWeek,
        pendingPayoutMinor: pendingPayout,
      },
      performance: {
        ratingAverage: profile?.ratingAverage ?? null,
        ratingCount: profile?.ratingCount ?? 0,
        // Null rather than 0 when nothing has been offered yet: a new driver has
        // no acceptance rate, and showing "0%" reads like a bad one.
        acceptanceRate: offered > 0 ? Math.round((accepted / offered) * 100) : null,
        completionRate: accepted > 0 ? Math.round((completed / accepted) * 100) : null,
      },
      unreadNotifications,
    };
  }

  private shape(d: {
    id: string;
    status: string;
    assignedAt: Date | null;
    acceptedAt: Date | null;
    offerExpiresAt: Date | null;
    estimateLabel: string | null;
    vendorOrder: {
      orderNumber: string;
      vendorProfile: { businessName: string };
      order: { addresses: Array<{ city: string; district: string }> };
    };
  }) {
    return {
      id: d.id,
      status: d.status,
      orderNumber: d.vendorOrder.orderNumber,
      vendor: d.vendorOrder.vendorProfile.businessName,
      destination: d.vendorOrder.order.addresses[0]
        ? `${d.vendorOrder.order.addresses[0].city}, ${d.vendorOrder.order.addresses[0].district.replace(/_/g, ' ')}`
        : null,
      estimateLabel: d.estimateLabel,
      assignedAt: d.assignedAt,
      acceptedAt: d.acceptedAt,
      // Drives the accept/decline countdown; null once accepted.
      offerExpiresAt: d.offerExpiresAt,
    };
  }
}
