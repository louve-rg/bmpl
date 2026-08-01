import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { ReviewsService } from './reviews.service';
import { AdminReviewsController, PublicReviewsController, ReviewsController, VendorReviewsController } from './reviews.controller';

/**
 * Reviews & Ratings (M19). Verified reviews tied to completed transactions, with
 * aggregates recomputed onto the subject (product/vendor/driver), vendor responses,
 * reports, helpful votes, and admin moderation. Reuses OwnershipService (vendor
 * scoping) from ProductsModule; Storage/Audit/Notifications are @Global().
 */
@Module({
  imports: [PrismaModule, ProductsModule],
  controllers: [PublicReviewsController, ReviewsController, VendorReviewsController, AdminReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
