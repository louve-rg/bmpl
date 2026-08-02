import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  createEnquirySchema,
  createViewingRequestSchema,
  propertyReportSchema,
  type CreateEnquiryInput,
  type CreateViewingRequestInput,
  type PropertyReportInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { PropertyDiscoveryService } from './property-discovery.service';
import { PropertyEnquiriesService } from './property-enquiries.service';
import { PropertyReportsService } from './property-reports.service';

/** Property-seeker surface (customers): saved + recently-viewed listings, enquiries,
 *  viewing requests, and reporting a listing. */
@Roles('CUSTOMER')
@Controller('property-seeker')
export class PropertySeekerController {
  constructor(
    private readonly discovery: PropertyDiscoveryService,
    private readonly enquiries: PropertyEnquiriesService,
    private readonly reports: PropertyReportsService,
  ) {}

  private actor(u: AuthContext) {
    return { userId: u.userId, status: u.status };
  }

  // ---- saved ----
  @Get('saved')
  listSaved(@CurrentUser() u: AuthContext) {
    return this.discovery.listSaved(u.userId);
  }
  @Get('saved/ids')
  savedIds(@CurrentUser() u: AuthContext) {
    return this.discovery.savedIds(u.userId);
  }
  @Post('saved/:listingId')
  save(@CurrentUser() u: AuthContext, @Param('listingId') listingId: string) {
    return this.discovery.save(u.userId, listingId);
  }
  @Delete('saved/:listingId')
  unsave(@CurrentUser() u: AuthContext, @Param('listingId') listingId: string) {
    return this.discovery.unsave(u.userId, listingId);
  }

  // ---- recently viewed ----
  @Get('recently-viewed')
  recentlyViewed(@CurrentUser() u: AuthContext) {
    return this.discovery.listRecentlyViewed(u.userId);
  }
  @Post('recently-viewed/:listingId')
  recordView(@CurrentUser() u: AuthContext, @Param('listingId') listingId: string) {
    return this.discovery.recordView(u.userId, listingId);
  }

  // ---- enquiries ----
  @StrictThrottle()
  @Post('enquiries')
  createEnquiry(@CurrentUser() u: AuthContext, @Body(ZodBody(createEnquirySchema)) b: CreateEnquiryInput) {
    return this.enquiries.createEnquiry(this.actor(u), b);
  }
  @Get('enquiries')
  myEnquiries(@CurrentUser() u: AuthContext) {
    return this.enquiries.listMineEnquiries(u.userId);
  }
  @Get('enquiries/:id')
  myEnquiry(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.enquiries.getMineEnquiry(u.userId, id);
  }
  @Post('enquiries/:id/conversation')
  openConversation(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.enquiries.openConversation(this.actor(u), id);
  }

  // ---- viewing requests ----
  @StrictThrottle()
  @Post('viewing-requests')
  createViewing(@CurrentUser() u: AuthContext, @Body(ZodBody(createViewingRequestSchema)) b: CreateViewingRequestInput) {
    return this.enquiries.createViewing(this.actor(u), b);
  }
  @Get('viewing-requests')
  myViewings(@CurrentUser() u: AuthContext) {
    return this.enquiries.listMineViewings(u.userId);
  }
  @Get('viewing-requests/:id')
  myViewing(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.enquiries.getMineViewing(u.userId, id);
  }
  @Post('viewing-requests/:id/cancel')
  cancelViewing(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body() b: { cancellationReason?: string }) {
    return this.enquiries.transitionViewing(this.actor(u), id, { status: 'CANCELLED', cancellationReason: b?.cancellationReason ?? null });
  }

  // ---- report a listing ----
  @Post('report/:listingId')
  report(@CurrentUser() u: AuthContext, @Param('listingId') listingId: string, @Body(ZodBody(propertyReportSchema)) b: PropertyReportInput) {
    return this.reports.report({ userId: u.userId }, listingId, b);
  }
}
