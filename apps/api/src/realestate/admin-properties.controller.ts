import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { propertyModerateSchema, resolvePropertyReportSchema, type PropertyModerateInput, type ResolvePropertyReportInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { PropertiesService } from './properties.service';
import { PropertyReportsService } from './property-reports.service';
import { PropertyAnalyticsService } from './property-analytics.service';
import { RealEstateAdminService } from './realestate-admin.service';

/** Admin Real Estate moderation & operations (least privilege per route). */
@Controller('admin/properties')
export class AdminPropertiesController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly reports: PropertyReportsService,
    private readonly analytics: PropertyAnalyticsService,
    private readonly admin: RealEstateAdminService,
  ) {}

  // ---- static routes first (before :id) ----
  @Get()
  @RequirePermission('properties.read')
  list(@Query('status') status?: string, @Query('district') district?: string, @Query('reported') reported?: string) {
    return this.properties.adminList({ status, district, reported: reported === 'true' });
  }

  @Get('reports')
  @RequirePermission('property_reports.read')
  reportQueue(@Query('status') status?: string) {
    return this.reports.adminList(status);
  }

  @Post('reports/:id/resolve')
  @RequirePermission('properties.moderate')
  resolveReport(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(resolvePropertyReportSchema)) b: ResolvePropertyReportInput) {
    return this.reports.resolve({ userId: u.userId }, id, b);
  }

  @Get('analytics')
  @RequirePermission('properties.read')
  adminAnalytics() {
    return this.analytics.adminOverview();
  }

  // ---- owner moderation ----
  @Get('owners')
  @RequirePermission('property_owners.read')
  owners(@Query('status') status?: string) {
    return this.admin.listOwners(status);
  }
  @Get('owners/:id')
  @RequirePermission('property_owners.read')
  ownerDetail(@Param('id') id: string) {
    return this.admin.ownerDetail(id);
  }
  @Post('owners/:id/suspend')
  @RequirePermission('property_owners.moderate')
  suspendOwner(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body() b: { reason?: string }) {
    return this.admin.setOwnerApproval({ userId: u.userId }, id, 'SUSPENDED', b?.reason);
  }
  @Post('owners/:id/restore')
  @RequirePermission('property_owners.moderate')
  restoreOwner(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.admin.setOwnerApproval({ userId: u.userId }, id, 'APPROVED');
  }

  // ---- agent moderation ----
  @Get('agents')
  @RequirePermission('real_estate_agents.read')
  agents(@Query('status') status?: string) {
    return this.admin.listAgents(status);
  }
  @Get('agents/:id')
  @RequirePermission('real_estate_agents.read')
  agentDetail(@Param('id') id: string) {
    return this.admin.agentDetail(id);
  }
  @Post('agents/:id/suspend')
  @RequirePermission('real_estate_agents.moderate')
  suspendAgent(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body() b: { reason?: string }) {
    return this.admin.setAgentApproval({ userId: u.userId }, id, 'SUSPENDED', b?.reason);
  }
  @Post('agents/:id/restore')
  @RequirePermission('real_estate_agents.moderate')
  restoreAgent(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.admin.setAgentApproval({ userId: u.userId }, id, 'APPROVED');
  }

  // ---- listing moderation ----
  @Get(':id')
  @RequirePermission('properties.read')
  detail(@Param('id') id: string) {
    return this.properties.adminDetail(id);
  }
  @Post(':id/moderate')
  @RequirePermission('properties.moderate')
  moderate(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(propertyModerateSchema)) b: PropertyModerateInput) {
    return this.properties.moderate({ userId: u.userId, permissions: u.permissions }, id, b);
  }
  @Get(':id/documents')
  @RequirePermission('property_documents.read')
  documents(@Param('id') id: string) {
    return this.properties.adminListDocuments(id);
  }
}
