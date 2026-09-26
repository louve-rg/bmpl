import { Injectable } from '@nestjs/common';
import { belizeCalendarDate, DEFAULT_ANALYTICS_DAYS, MAX_ANALYTICS_DAYS, startOfBelizeDay, toCsv } from '@bmpl/shared';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { OwnershipService } from '../products/ownership.service';

/** Money amounts collected (GMV basis) — mirrors @bmpl/shared PAID_PAYMENT_STATUSES. */
const PAID = Prisma.sql`('AUTHORIZED','SETTLING','SETTLED')`;
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

interface SeriesPoint { date: string; orders: number; grossMinor: number }

/**
 * Analytics & Reporting (M22). READ-ONLY aggregation over existing orders,
 * payments, and settlements — no money movement, no schema change. Admin views are
 * platform-wide (gated by `analytics.read`); vendor views are strictly scoped to the
 * caller's own storefront via OwnershipService. GMV counts only collected money
 * (AUTHORIZED/SETTLING/SETTLED payments); realized platform/vendor revenue comes from
 * POSTED settlements.
 */
/**
 * Every analytics aggregate excludes simulation orders.
 *
 * A rehearsal placed through the real checkout is a real row in `orders`. It
 * must never reach GMV, order volume, units sold or the CSV export, or the
 * client's own dashboards would lie to them the moment anyone tests anything.
 */
const NOT_TEST = { isTest: false } as const;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  private clampDays(days?: number) {
    const d = Math.floor(days ?? DEFAULT_ANALYTICS_DAYS);
    return Math.min(Math.max(1, Number.isFinite(d) ? d : DEFAULT_ANALYTICS_DAYS), MAX_ANALYTICS_DAYS);
  }

  /** Fill a day-keyed aggregate into a continuous most-recent-first-free series. */
  private fillSeries(rows: Array<{ day: Date; orders: bigint | number; gross: bigint | number }>, days: number): SeriesPoint[] {
    const byDay = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), r]));
    const out: SeriesPoint[] = [];
    // The business's "today" is a Belize calendar day (see BMPL-197) - the SQL
    // side buckets `day` the same way (windowStart/the raw query below), so
    // the keys line up.
    const todayBelize = belizeCalendarDate(new Date());
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(todayBelize);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const row = byDay.get(key);
      out.push({ date: key, orders: n(row?.orders), grossMinor: n(row?.gross) });
    }
    return out;
  }

  // ===========================================================================
  // Admin (platform-wide) — requires analytics.read
  // ===========================================================================
  async adminOverview() {
    const [gmvAgg, totalOrders, cancelledOrders, settlementAgg, unitsAgg, approvedVendors, approvedDrivers, totalCustomers, publishedProducts, reviewAgg] =
      await Promise.all([
        // NOT_TEST on every aggregate: a rehearsal must not move GMV, order
        // volume or units. Payments are filtered through their order because a
        // simulation never has one anyway — belt and braces if that changes.
        this.prisma.payment.aggregate({ where: { status: { in: ['AUTHORIZED', 'SETTLING', 'SETTLED'] }, order: NOT_TEST }, _sum: { amountMinor: true }, _count: true }),
        this.prisma.order.count({ where: NOT_TEST }),
        this.prisma.order.count({ where: { ...NOT_TEST, status: 'CANCELLED' } }),
        this.prisma.vendorSettlement.aggregate({ where: { status: 'POSTED' }, _sum: { commissionMinor: true, platformFeeMinor: true, netMinor: true, grossMinor: true } }),
        this.prisma.orderItem.aggregate({ where: { vendorOrder: { order: { ...NOT_TEST, payment: { status: { in: ['AUTHORIZED', 'SETTLING', 'SETTLED'] } } } } }, _sum: { quantity: true } }),
        this.prisma.userRole.count({ where: { roleCode: 'VENDOR', status: 'APPROVED' } }),
        this.prisma.userRole.count({ where: { roleCode: 'DELIVERY_DRIVER', status: 'APPROVED' } }),
        this.prisma.user.count(),
        this.prisma.product.count({ where: { status: 'PUBLISHED' } }),
        this.prisma.review.aggregate({ where: { status: 'PUBLISHED' }, _count: true, _avg: { rating: true } }),
      ]);
    const gmvMinor = n(gmvAgg._sum.amountMinor);
    const paidOrders = gmvAgg._count;
    return {
      gmvMinor,
      paidOrders,
      totalOrders,
      cancelledOrders,
      aovMinor: paidOrders ? Math.round(gmvMinor / paidOrders) : 0,
      unitsSold: n(unitsAgg._sum.quantity),
      platformRevenueMinor: n(settlementAgg._sum.commissionMinor) + n(settlementAgg._sum.platformFeeMinor),
      vendorNetMinor: n(settlementAgg._sum.netMinor),
      settledGrossMinor: n(settlementAgg._sum.grossMinor),
      approvedVendors,
      approvedDrivers,
      totalCustomers,
      publishedProducts,
      reviewCount: reviewAgg._count,
      avgRating: reviewAgg._avg.rating ? Math.round(reviewAgg._avg.rating * 100) / 100 : 0,
    };
  }

  /** Start of the Belize calendar day, `days-1` Belize days before today (inclusive window of `days`). */
  private windowStart(days: number) {
    const start = startOfBelizeDay(new Date());
    start.setUTCDate(start.getUTCDate() - (days - 1));
    return start;
  }

  async adminSales(days?: number) {
    const d = this.clampDays(days);
    const since = this.windowStart(d);
    // Bucketed by BELIZE calendar day, not UTC (BMPL-197): createdAt is a
    // TIMESTAMP(3) with no time zone, so this arithmetic is on the literal
    // stored value, not a session-timezone conversion.
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; orders: bigint; gross: bigint }>>`
      SELECT date_trunc('day', p."createdAt" - interval '6 hours') AS day, COUNT(*)::bigint AS orders, COALESCE(SUM(p."amountMinor"),0)::bigint AS gross
      FROM payments p
      WHERE p.status IN ${PAID} AND p."createdAt" >= ${since}
      GROUP BY day ORDER BY day`;
    return { days: d, series: this.fillSeries(rows, d) };
  }

  async adminTopProducts(limit = 10) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; title: string; sold: bigint; revenue: bigint }>>`
      SELECT oi."productId" AS id, MAX(oi."productTitle") AS title, SUM(oi.quantity)::bigint AS sold, SUM(oi."subtotalMinor")::bigint AS revenue
      FROM order_items oi
      JOIN vendor_orders vo ON vo.id = oi."vendorOrderId"
      JOIN orders o ON o.id = vo."orderId"
      JOIN payments p ON p."orderId" = o.id
      WHERE oi."productId" IS NOT NULL AND p.status IN ${PAID}
      GROUP BY oi."productId" ORDER BY sold DESC LIMIT ${limit}`;
    return rows.map((r) => ({ productId: r.id, title: r.title, unitsSold: n(r.sold), revenueMinor: n(r.revenue) }));
  }

  async adminTopVendors(limit = 10) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string; orders: bigint; revenue: bigint }>>`
      SELECT vo."vendorProfileId" AS id, MAX(vp."businessName") AS name, COUNT(DISTINCT vo.id)::bigint AS orders, SUM(vo."subtotalMinor")::bigint AS revenue
      FROM vendor_orders vo
      JOIN vendor_profiles vp ON vp.id = vo."vendorProfileId"
      JOIN orders o ON o.id = vo."orderId"
      JOIN payments p ON p."orderId" = o.id
      WHERE p.status IN ${PAID}
      GROUP BY vo."vendorProfileId" ORDER BY revenue DESC LIMIT ${limit}`;
    return rows.map((r) => ({ vendorProfileId: r.id, businessName: r.name, orders: n(r.orders), revenueMinor: n(r.revenue) }));
  }

  async adminOrdersCsv() {
    const orders = await this.prisma.order.findMany({
      where: NOT_TEST,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { payment: { select: { status: true } }, vendorOrders: { select: { vendorProfile: { select: { businessName: true } } } } },
    });
    const header = ['orderNumber', 'createdAt', 'status', 'paymentStatus', 'itemCount', 'subtotalMinor', 'deliveryFeeMinor', 'totalMinor', 'vendors'];
    const rows = orders.map((o) => [
      o.orderNumber,
      o.createdAt.toISOString(),
      o.status,
      o.payment?.status ?? '',
      o.itemCount,
      n(o.subtotalMinor),
      n(o.deliveryFeeMinor),
      n(o.totalMinor),
      [...new Set(o.vendorOrders.map((v) => v.vendorProfile.businessName))].join('; '),
    ]);
    return toCsv(header, rows);
  }

  // ===========================================================================
  // Vendor (own storefront) — ownership-scoped
  // ===========================================================================
  async vendorOverview(userId: string) {
    const vp = await this.ownership.vendorProfileId(userId); // throws if not a vendor
    const [paidAgg, unitsAgg, settlementAgg, pendingSettlements, publishedProducts, profile] = await Promise.all([
      this.prisma.vendorOrder.aggregate({ where: { vendorProfileId: vp, order: { payment: { status: { in: ['AUTHORIZED', 'SETTLING', 'SETTLED'] } } } }, _sum: { subtotalMinor: true }, _count: true }),
      this.prisma.orderItem.aggregate({ where: { vendorOrder: { vendorProfileId: vp, order: { ...NOT_TEST, payment: { status: { in: ['AUTHORIZED', 'SETTLING', 'SETTLED'] } } } } }, _sum: { quantity: true } }),
      this.prisma.vendorSettlement.aggregate({ where: { vendorProfileId: vp, status: 'POSTED' }, _sum: { netMinor: true, commissionMinor: true, grossMinor: true } }),
      this.prisma.vendorSettlement.count({ where: { vendorProfileId: vp, status: 'PENDING' } }),
      this.prisma.product.count({ where: { vendorProfileId: vp, status: 'PUBLISHED' } }),
      this.prisma.vendorProfile.findUniqueOrThrow({ where: { id: vp }, select: { ratingAverage: true, ratingCount: true } }),
    ]);
    return {
      paidOrders: paidAgg._count,
      grossSalesMinor: n(paidAgg._sum.subtotalMinor),
      unitsSold: n(unitsAgg._sum.quantity),
      netRevenueMinor: n(settlementAgg._sum.netMinor),
      commissionPaidMinor: n(settlementAgg._sum.commissionMinor),
      settledGrossMinor: n(settlementAgg._sum.grossMinor),
      pendingSettlements,
      publishedProducts,
      ratingAverage: profile.ratingAverage,
      ratingCount: profile.ratingCount,
    };
  }

  async vendorSales(userId: string, days?: number) {
    const vp = await this.ownership.vendorProfileId(userId);
    const d = this.clampDays(days);
    const since = this.windowStart(d);
    // Belize calendar day, same reasoning as adminSales above (BMPL-197).
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; orders: bigint; gross: bigint }>>`
      SELECT date_trunc('day', vo."createdAt" - interval '6 hours') AS day, COUNT(DISTINCT vo.id)::bigint AS orders, COALESCE(SUM(vo."subtotalMinor"),0)::bigint AS gross
      FROM vendor_orders vo
      JOIN orders o ON o.id = vo."orderId"
      JOIN payments p ON p."orderId" = o.id
      WHERE vo."vendorProfileId" = ${vp} AND p.status IN ${PAID} AND vo."createdAt" >= ${since}
      GROUP BY day ORDER BY day`;
    return { days: d, series: this.fillSeries(rows, d) };
  }

  async vendorTopProducts(userId: string, limit = 10) {
    const vp = await this.ownership.vendorProfileId(userId);
    const rows = await this.prisma.$queryRaw<Array<{ id: string; title: string; sold: bigint; revenue: bigint }>>`
      SELECT oi."productId" AS id, MAX(oi."productTitle") AS title, SUM(oi.quantity)::bigint AS sold, SUM(oi."subtotalMinor")::bigint AS revenue
      FROM order_items oi
      JOIN vendor_orders vo ON vo.id = oi."vendorOrderId"
      JOIN orders o ON o.id = vo."orderId"
      JOIN payments p ON p."orderId" = o.id
      WHERE vo."vendorProfileId" = ${vp} AND oi."productId" IS NOT NULL AND p.status IN ${PAID}
      GROUP BY oi."productId" ORDER BY sold DESC LIMIT ${limit}`;
    return rows.map((r) => ({ productId: r.id, title: r.title, unitsSold: n(r.sold), revenueMinor: n(r.revenue) }));
  }

  async vendorOrdersCsv(userId: string) {
    const vp = await this.ownership.vendorProfileId(userId);
    const rows = await this.prisma.vendorOrder.findMany({
      where: { vendorProfileId: vp },
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { order: { select: { orderNumber: true, payment: { select: { status: true } } } } },
    });
    const header = ['vendorOrderNumber', 'orderNumber', 'createdAt', 'status', 'paymentStatus', 'deliveryMethod', 'itemCount', 'subtotalMinor'];
    const out = rows.map((r) => [
      r.orderNumber,
      r.order.orderNumber,
      r.createdAt.toISOString(),
      r.status,
      r.order.payment?.status ?? '',
      r.deliveryMethod,
      r.itemCount,
      n(r.subtotalMinor),
    ]);
    return toCsv(header, out);
  }
}
