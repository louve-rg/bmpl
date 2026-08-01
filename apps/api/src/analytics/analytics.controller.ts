import { Controller, Get, Header, Query } from '@nestjs/common';
import { CurrentUser, RequirePermission, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { AnalyticsService } from './analytics.service';

/**
 * Platform analytics & reporting (M22). Read-only aggregation, gated by
 * `analytics.read` (ADMIN + SUPER_ADMIN; NOT support — revenue-sensitive).
 */
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @RequirePermission('analytics.read')
  overview() {
    return this.analytics.adminOverview();
  }

  @Get('sales')
  @RequirePermission('analytics.read')
  sales(@Query('days') days?: string) {
    return this.analytics.adminSales(days ? Number(days) : undefined);
  }

  @Get('top-products')
  @RequirePermission('analytics.read')
  topProducts(@Query('limit') limit?: string) {
    return this.analytics.adminTopProducts(limit ? Number(limit) : undefined);
  }

  @Get('top-vendors')
  @RequirePermission('analytics.read')
  topVendors(@Query('limit') limit?: string) {
    return this.analytics.adminTopVendors(limit ? Number(limit) : undefined);
  }

  @Get('reports/orders.csv')
  @RequirePermission('analytics.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="orders-report.csv"')
  ordersCsv() {
    return this.analytics.adminOrdersCsv();
  }
}

/** A vendor's OWN storefront analytics & reports (ownership-scoped). */
@Roles('VENDOR')
@Controller('vendor/analytics')
export class VendorAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@CurrentUser() u: AuthContext) {
    return this.analytics.vendorOverview(u.userId);
  }

  @Get('sales')
  sales(@CurrentUser() u: AuthContext, @Query('days') days?: string) {
    return this.analytics.vendorSales(u.userId, days ? Number(days) : undefined);
  }

  @Get('top-products')
  topProducts(@CurrentUser() u: AuthContext, @Query('limit') limit?: string) {
    return this.analytics.vendorTopProducts(u.userId, limit ? Number(limit) : undefined);
  }

  @Get('reports/orders.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="my-orders-report.csv"')
  ordersCsv(@CurrentUser() u: AuthContext) {
    return this.analytics.vendorOrdersCsv(u.userId);
  }
}
