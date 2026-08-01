import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { AdminAnalyticsController, VendorAnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics & Reporting (M22). Read-only aggregation over existing orders/payments/
 * settlements; reuses OwnershipService (vendor scoping) from ProductsModule. No
 * schema, money, or state changes.
 */
@Module({
  imports: [ProductsModule],
  controllers: [AdminAnalyticsController, VendorAnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
