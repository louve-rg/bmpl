import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { DiscoveryController, RecommendationsController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

/**
 * Discovery & Recommendations (M21). Deterministic, non-AI heuristics over the
 * existing catalog + M19 ratings + M20 saved/viewed signals. Reuses ProductsService
 * (card serialization) from ProductsModule; Prisma is @Global(). Read-only — no
 * schema, money, inventory, or moderation changes.
 */
@Module({
  imports: [ProductsModule],
  controllers: [DiscoveryController, RecommendationsController],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
