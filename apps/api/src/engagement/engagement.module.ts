import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { EngagementController } from './engagement.controller';
import { EngagementService } from './engagement.service';

/**
 * Saved Products (Wishlists) & Recently Viewed (M20). Own-account customer
 * convenience; reuses ProductsService (card serialization + viewability checks)
 * from ProductsModule. Prisma is @Global(). No money/inventory/approval logic.
 */
@Module({
  imports: [ProductsModule],
  controllers: [EngagementController],
  providers: [EngagementService],
  exports: [EngagementService],
})
export class EngagementModule {}
