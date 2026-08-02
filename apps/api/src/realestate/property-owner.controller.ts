import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  assignAgentSchema,
  createPropertySchema,
  enquiryReplySchema,
  imagePresignSchema,
  propertyDocumentConfirmSchema,
  propertyImageConfirmSchema,
  propertyOwnerStatusSchema,
  updatePropertySchema,
  upsertPropertyOwnerProfileSchema,
  viewingTransitionSchema,
  type AssignAgentInput,
  type CreatePropertyInput,
  type EnquiryReplyInput,
  type ImagePresignInput,
  type PropertyDocumentConfirmInput,
  type PropertyImageConfirmInput,
  type PropertyOwnerStatusInput,
  type UpdatePropertyInput,
  type UpsertPropertyOwnerProfileInput,
  type ViewingTransitionInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { PropertyOwnerService } from './property-owner.service';
import { PropertiesService } from './properties.service';
import { PropertyEnquiriesService } from './property-enquiries.service';
import { PropertyAnalyticsService } from './property-analytics.service';

/** Property-owner surface — requires an APPROVED PROPERTY_OWNER role. Profile,
 *  listing authoring/lifecycle, images, private documents, agent assignment, and the
 *  enquiry/viewing inbox for their own listings. */
@Roles('PROPERTY_OWNER')
@Controller('property-owner')
export class PropertyOwnerController {
  constructor(
    private readonly owners: PropertyOwnerService,
    private readonly properties: PropertiesService,
    private readonly enquiries: PropertyEnquiriesService,
    private readonly analytics: PropertyAnalyticsService,
  ) {}

  private actor(u: AuthContext) {
    return { userId: u.userId, status: u.status, permissions: u.permissions };
  }

  // ---- profile ----
  @Get('profile')
  profile(@CurrentUser() u: AuthContext) {
    return this.owners.getOwn(u.userId);
  }
  @Put('profile')
  upsert(@CurrentUser() u: AuthContext, @Body(ZodBody(upsertPropertyOwnerProfileSchema)) b: UpsertPropertyOwnerProfileInput) {
    return this.owners.upsertProfile(this.actor(u), b);
  }

  // ---- listings ----
  @Get('listings')
  listListings(@CurrentUser() u: AuthContext, @Query('status') status?: string) {
    return this.properties.ownerList(u.userId, status);
  }
  @Post('listings')
  createListing(@CurrentUser() u: AuthContext, @Body(ZodBody(createPropertySchema)) b: CreatePropertyInput) {
    return this.properties.create(this.actor(u), b);
  }
  @Get('listings/:id')
  getListing(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.properties.managedDetail(this.actor(u), id);
  }
  @Patch('listings/:id')
  updateListing(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(updatePropertySchema)) b: UpdatePropertyInput) {
    return this.properties.update(this.actor(u), id, b);
  }
  @Post('listings/:id/submit')
  submitListing(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.properties.submit(this.actor(u), id);
  }
  @Post('listings/:id/status')
  ownerStatus(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(propertyOwnerStatusSchema)) b: PropertyOwnerStatusInput) {
    return this.properties.ownerStatus(this.actor(u), id, b);
  }
  @Post('listings/:id/assign-agent')
  assignAgent(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(assignAgentSchema)) b: AssignAgentInput) {
    return this.properties.assignAgent(this.actor(u), id, b);
  }

  // ---- images (public bucket) ----
  @StrictThrottle()
  @Post('listings/:id/images/presign')
  presignImage(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(imagePresignSchema)) b: ImagePresignInput) {
    return this.properties.presignImage(this.actor(u), id, b.fileName, b.contentType);
  }
  @Post('listings/:id/images')
  confirmImage(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(propertyImageConfirmSchema)) b: PropertyImageConfirmInput) {
    return this.properties.confirmImage(this.actor(u), id, b);
  }
  @Post('listings/:id/images/:imageId/primary')
  setPrimaryImage(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('imageId') imageId: string) {
    return this.properties.setPrimaryImage(this.actor(u), id, imageId);
  }
  @Post('listings/:id/images/reorder')
  reorderImages(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body() b: { imageIds: string[] }) {
    return this.properties.reorderImages(this.actor(u), id, b?.imageIds ?? []);
  }
  @Delete('listings/:id/images/:imageId')
  deleteImage(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('imageId') imageId: string) {
    return this.properties.deleteImage(this.actor(u), id, imageId);
  }

  // ---- private documents ----
  @StrictThrottle()
  @Post('listings/:id/documents/presign')
  presignDocument(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(imagePresignSchema)) b: ImagePresignInput) {
    return this.properties.presignDocument(this.actor(u), id, b.fileName, b.contentType);
  }
  @Post('listings/:id/documents')
  confirmDocument(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(propertyDocumentConfirmSchema)) b: PropertyDocumentConfirmInput) {
    return this.properties.confirmDocument(this.actor(u), id, b);
  }
  @Get('listings/:id/documents')
  listDocuments(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.properties.listDocuments(this.actor(u), id);
  }
  @Get('listings/:id/documents/:documentId/url')
  documentUrl(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('documentId') documentId: string) {
    return this.properties.documentUrl(this.actor(u), id, documentId);
  }

  // ---- enquiries (own listings) ----
  @Get('enquiries')
  listEnquiries(@CurrentUser() u: AuthContext, @Query('listingId') listingId?: string, @Query('status') status?: string) {
    return this.enquiries.listerListEnquiries(this.actor(u), { listingId, status });
  }
  @Get('enquiries/:id')
  getEnquiry(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.enquiries.listerGetEnquiry(this.actor(u), id);
  }
  @Post('enquiries/:id/reply')
  replyEnquiry(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(enquiryReplySchema)) b: EnquiryReplyInput) {
    return this.enquiries.replyEnquiry(this.actor(u), id, b);
  }
  @Post('enquiries/:id/close')
  closeEnquiry(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.enquiries.closeEnquiry(this.actor(u), id);
  }

  // ---- viewing requests (own listings) ----
  @Get('viewings')
  listViewings(@CurrentUser() u: AuthContext, @Query('listingId') listingId?: string, @Query('status') status?: string) {
    return this.enquiries.listerListViewings(this.actor(u), { listingId, status });
  }
  @Get('viewings/:id')
  getViewing(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.enquiries.listerGetViewing(this.actor(u), id);
  }
  @Post('viewings/:id/transition')
  transitionViewing(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(viewingTransitionSchema)) b: ViewingTransitionInput) {
    return this.enquiries.transitionViewing(this.actor(u), id, b);
  }

  // ---- analytics ----
  @Get('analytics')
  analyticsOverview(@CurrentUser() u: AuthContext) {
    return this.analytics.ownerOverview(u.userId);
  }
}
