import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { ThrottlingModule } from './throttling/throttling.module';
import { ObservabilityModule } from './observability/observability.module';
import { AuditModule } from './audit/audit.module';
import { EmailModule } from './email/email.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { AdminModule } from './admin/admin.module';
import { CategoriesModule } from './categories/categories.module';
import { VendorModule } from './vendor/vendor.module';
import { ProductsModule } from './products/products.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { DeliveryModule } from './delivery/delivery.module';
import { DriverModule } from './driver/driver.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { MessagingModule } from './messaging/messaging.module';
import { SettlementModule } from './settlement/settlement.module';
import { ReviewsModule } from './reviews/reviews.module';
import { EngagementModule } from './engagement/engagement.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { OpsModule } from './ops/ops.module';
import { JobsModule } from './jobs/jobs.module';
import { RealEstateModule } from './realestate/realestate.module';
import { MarketingModule } from './marketing/marketing.module';
import { PaymentsModule } from './payments/payments.module';
import { WalletModule } from './wallet/wallet.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { GeocodingModule } from './geocoding/geocoding.module';
import { ShippingModule } from './shipping/shipping.module';
import { HealthModule } from './health/health.module';
import { DevModule } from './dev/dev.module';
import { JwtAuthGuard, PermissionsGuard, RolesGuard } from './auth/guards';
import { CsrfGuard } from './auth/csrf.guard';
import { BmplThrottlerGuard } from './throttling/throttler.guard';

// Dev/test-only modules are excluded entirely from production builds at runtime.
const devModules = process.env.NODE_ENV === 'production' ? [] : [DevModule];

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    ThrottlingModule,
    ObservabilityModule,
    AuditModule,
    EmailModule,
    NotificationsModule,
    StorageModule,
    AuthModule,
    UsersModule,
    RolesModule,
    AdminModule,
    CategoriesModule,
    VendorModule,
    ProductsModule,
    CartModule,
    OrdersModule,
    DeliveryModule,
    DriverModule,
    DispatchModule,
    MessagingModule,
    SettlementModule,
    ReviewsModule,
    EngagementModule,
    DiscoveryModule,
    AnalyticsModule,
    OpsModule,
    JobsModule,
    RealEstateModule,
    MarketingModule,
    WalletModule,
    PaymentsModule,
    MaintenanceModule,
    HealthModule,
    GeocodingModule,
    ShippingModule,
    ...devModules,
  ],
  providers: [
    // Global guard chain, in order: rate limit → CSRF → authenticate (unless
    // @Public) → role → permission.
    { provide: APP_GUARD, useClass: BmplThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
