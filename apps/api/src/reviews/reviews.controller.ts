import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createReviewSchema,
  editReviewSchema,
  imagePresignSchema,
  resolveReportSchema,
  reviewModerateSchema,
  reviewReportSchema,
  reviewResponseSchema,
  type CreateReviewInput,
  type EditReviewInput,
  type ImagePresignInput,
  type ResolveReportInput,
  type ReviewModerateInput,
  type ReviewReportInput,
  type ReviewResponseInput,
} from '@bmpl/validation';
import { REVIEW_SUBJECT_TYPES, type ReviewSubjectType } from '@bmpl/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Public, RequirePermission, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { ReviewsService, type Actor } from './reviews.service';

function subjectTypeOrThrow(s: string): ReviewSubjectType {
  if (!(REVIEW_SUBJECT_TYPES as readonly string[]).includes(s)) throw new BadRequestException('Unknown review subject.');
  return s as ReviewSubjectType;
}

/** Public review reads for a product / vendor / driver (guests included). */
@Public()
@Controller('marketplace/reviews')
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':subjectType/:subjectId')
  list(
    @Param('subjectType') subjectType: string,
    @Param('subjectId') subjectId: string,
    @Query('sort') sort?: string,
    @Query('rating') rating?: string,
    @Query('page') page?: string,
  ) {
    return this.reviews.listForSubject(subjectTypeOrThrow(subjectType), subjectId, { sort, rating: rating ? Number(rating) : undefined, page: page ? Number(page) : 1 });
  }
}

/** Customer reviews (own): create/edit, eligibility, mine, media, report, helpful. */
@Roles('CUSTOMER')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  private actor(u: AuthContext): Actor {
    return { userId: u.userId, status: u.status, permissions: u.permissions };
  }

  @Get('eligible')
  eligible(@CurrentUser() u: AuthContext) {
    return this.reviews.eligibleContexts(u.userId);
  }

  @Get('mine')
  mine(@CurrentUser() u: AuthContext) {
    return this.reviews.ownReviews(u.userId);
  }

  @StrictThrottle()
  @Post('media/presign')
  presign(@CurrentUser() u: AuthContext, @Body(ZodBody(imagePresignSchema)) b: ImagePresignInput) {
    return this.reviews.presignMedia(u.userId, b.fileName, b.contentType);
  }

  @StrictThrottle()
  @Post()
  create(@CurrentUser() u: AuthContext, @Body(ZodBody(createReviewSchema)) b: CreateReviewInput) {
    return this.reviews.create(this.actor(u), b);
  }

  @Patch(':id')
  edit(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(editReviewSchema)) b: EditReviewInput) {
    return this.reviews.edit(this.actor(u), id, b);
  }

  @Post(':id/report')
  report(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(reviewReportSchema)) b: ReviewReportInput) {
    return this.reviews.report(this.actor(u), id, b);
  }

  @Post(':id/helpful')
  helpful(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.reviews.toggleHelpful(this.actor(u), id);
  }
}

/** Vendor response to a review of their own product/store. */
@Roles('VENDOR')
@Controller('vendor/reviews')
export class VendorReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post(':id/response')
  respond(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(reviewResponseSchema)) b: ReviewResponseInput) {
    return this.reviews.respond({ userId: u.userId, status: u.status, permissions: u.permissions }, id, b);
  }
}

/** Admin review moderation. */
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @RequirePermission('reviews.read')
  list(@Query('status') status?: string, @Query('subjectType') subjectType?: string, @Query('reported') reported?: string) {
    return this.reviews.adminList({ status, subjectType, reported: reported === 'true' });
  }

  @Get('reports')
  @RequirePermission('reviews.read')
  reports(@Query('status') status?: string) {
    return this.reviews.reportsList(status);
  }

  @Post(':id/moderate')
  @RequirePermission('reviews.moderate')
  moderate(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(reviewModerateSchema)) b: ReviewModerateInput) {
    return this.reviews.moderate({ userId: u.userId, permissions: u.permissions }, id, b);
  }

  @Post('reports/:id/resolve')
  @RequirePermission('reviews.moderate')
  resolve(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(resolveReportSchema)) b: ResolveReportInput) {
    return this.reviews.resolveReport({ userId: u.userId, permissions: u.permissions }, id, b);
  }
}
