import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  enquiryReplySchema,
  imagePresignSchema,
  propertyDocumentConfirmSchema,
  propertyImageConfirmSchema,
  propertyOwnerStatusSchema,
  updatePropertySchema,
  upsertAgencyProfileSchema,
  upsertAgentProfileSchema,
  viewingTransitionSchema,
  type EnquiryReplyInput,
  type ImagePresignInput,
  type PropertyDocumentConfirmInput,
  type PropertyImageConfirmInput,
  type PropertyOwnerStatusInput,
  type UpdatePropertyInput,
  type UpsertAgencyProfileInput,
  type UpsertAgentProfileInput,
  type ViewingTransitionInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { rawBody, uploadFileName } from '../common/raw-upload';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { AgentService } from './agent.service';
import { AgencyService } from './agency.service';
import { PropertiesService } from './properties.service';
import { PropertyEnquiriesService } from './property-enquiries.service';
import { PropertyAnalyticsService } from './property-analytics.service';

/** Real-estate agent surface — requires an APPROVED REAL_ESTATE_AGENT role. Agent +
 *  agency profiles, assignment acceptance, management of authorized listings, and the
 *  enquiry/viewing inbox for assigned listings. */
@Roles('REAL_ESTATE_AGENT')
@Controller('real-estate-agent')
export class AgentController {
  constructor(
    private readonly agents: AgentService,
    private readonly agencies: AgencyService,
    private readonly properties: PropertiesService,
    private readonly enquiries: PropertyEnquiriesService,
    private readonly analytics: PropertyAnalyticsService,
  ) {}

  private actor(u: AuthContext) {
    return { userId: u.userId, status: u.status, permissions: u.permissions };
  }

  // ---- agent profile + photo ----
  @Get('profile')
  profile(@CurrentUser() u: AuthContext) {
    return this.agents.getOwn(u.userId);
  }
  @Put('profile')
  upsert(@CurrentUser() u: AuthContext, @Body(ZodBody(upsertAgentProfileSchema)) b: UpsertAgentProfileInput) {
    return this.agents.upsertProfile(this.actor(u), b);
  }
  @StrictThrottle()
  /** Server-side agent-photo upload: raw bytes in, storage key out. */
  @Post('profile/photo/upload')
  uploadPhoto(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.agents.uploadPhoto(u.userId, rawBody(req), uploadFileName(req));
  }

  @Post('profile/photo/presign')
  presignPhoto(@CurrentUser() u: AuthContext, @Body(ZodBody(imagePresignSchema)) b: ImagePresignInput) {
    return this.agents.presignPhoto(u.userId, b.fileName, b.contentType);
  }
  @Post('profile/photo')
  confirmPhoto(@CurrentUser() u: AuthContext, @Body() b: { storageKey: string }) {
    return this.agents.confirmPhoto(u.userId, b.storageKey);
  }

  // ---- agency profile + logo/banner ----
  @Get('agency')
  agency(@CurrentUser() u: AuthContext) {
    return this.agencies.getOwn(u.userId);
  }
  @Put('agency')
  upsertAgency(@CurrentUser() u: AuthContext, @Body(ZodBody(upsertAgencyProfileSchema)) b: UpsertAgencyProfileInput) {
    return this.agencies.upsertProfile(this.actor(u), b);
  }
  @StrictThrottle()
  /** Server-side agency logo/banner upload: raw bytes in, storage key out. */
  @Post('agency/:kind/upload')
  uploadAgencyImage(@CurrentUser() u: AuthContext, @Param('kind') kind: string, @Req() req: Request) {
    return this.agencies.uploadImage(u.userId, kind === 'banner' ? 'banner' : 'logo', rawBody(req), uploadFileName(req));
  }

  @Post('agency/:kind/presign')
  presignAgencyImage(@CurrentUser() u: AuthContext, @Param('kind') kind: string, @Body(ZodBody(imagePresignSchema)) b: ImagePresignInput) {
    return this.agencies.presignImage(u.userId, kind === 'banner' ? 'banner' : 'logo', b.fileName, b.contentType);
  }
  @Post('agency/:kind/confirm')
  confirmAgencyImage(@CurrentUser() u: AuthContext, @Param('kind') kind: string, @Body() b: { storageKey: string }) {
    return this.agencies.confirmImage(u.userId, kind === 'banner' ? 'banner' : 'logo', b.storageKey);
  }

  // ---- assignments ----
  @Get('assignments')
  assignments(@CurrentUser() u: AuthContext, @Query('status') status?: string) {
    return this.properties.agentAssignments(this.actor(u), status);
  }
  @Post('assignments/:id/accept')
  acceptAssignment(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.properties.acceptAssignment(this.actor(u), id);
  }
  @Post('assignments/:id/decline')
  declineAssignment(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.properties.declineAssignment(this.actor(u), id);
  }

  // ---- assigned listings (management scoped to accepted assignments) ----
  @Get('listings')
  listListings(@CurrentUser() u: AuthContext, @Query('status') status?: string) {
    return this.properties.agentList(u.userId, status);
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

  // ---- images ----
  @StrictThrottle()
  /** Server-side listing-image upload: raw bytes in, storage key out. */
  @Post('listings/:id/images/upload')
  uploadImage(@CurrentUser() u: AuthContext, @Param('id') id: string, @Req() req: Request) {
    return this.properties.uploadImage(this.actor(u), id, rawBody(req), uploadFileName(req));
  }

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
  /** Server-side listing-document upload: raw bytes in, storage key out. */
  @Post('listings/:id/documents/upload')
  uploadDocument(@CurrentUser() u: AuthContext, @Param('id') id: string, @Req() req: Request) {
    return this.properties.uploadDocument(this.actor(u), id, rawBody(req), uploadFileName(req));
  }

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

  // ---- enquiries / viewings (assigned listings) ----
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
    return this.analytics.agentOverview(u.userId);
  }
}
