import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { jobCategorySchema, jobModerateSchema, resolveJobReportSchema, type JobCategoryInput, type JobModerateInput, type ResolveJobReportInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { JobsService } from './jobs.service';
import { JobReportsService } from './job-reports.service';
import { JobAnalyticsService } from './job-analytics.service';
import { EmployerAdminService } from './employer-admin.service';

/** Admin Belize Connect moderation & operations (least privilege per route). */
@Controller('admin/jobs')
export class AdminJobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly reports: JobReportsService,
    private readonly analytics: JobAnalyticsService,
    private readonly employersAdmin: EmployerAdminService,
  ) {}

  // ---- static routes first (before :id) ----
  @Get()
  @RequirePermission('jobs.read')
  list(@Query('status') status?: string, @Query('reported') reported?: string) {
    return this.jobs.adminList({ status, reported: reported === 'true' });
  }

  @Get('reports')
  @RequirePermission('jobs.read')
  reportQueue(@Query('status') status?: string) {
    return this.reports.adminList(status);
  }

  @Post('reports/:id/resolve')
  @RequirePermission('jobs.moderate')
  resolveReport(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(resolveJobReportSchema)) b: ResolveJobReportInput) {
    return this.reports.resolve({ userId: u.userId }, id, b);
  }

  @Get('analytics')
  @RequirePermission('jobs.read')
  adminAnalytics() {
    return this.analytics.adminOverview();
  }

  @Get('categories')
  @RequirePermission('jobs.read')
  categories() {
    return this.jobs.listCategories(true);
  }
  @Post('categories')
  @RequirePermission('job_categories.manage')
  createCategory(@CurrentUser() u: AuthContext, @Body(ZodBody(jobCategorySchema)) b: JobCategoryInput) {
    return this.jobs.createCategory({ userId: u.userId }, b);
  }
  @Patch('categories/:id')
  @RequirePermission('job_categories.manage')
  updateCategory(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(jobCategorySchema)) b: JobCategoryInput) {
    return this.jobs.updateCategory({ userId: u.userId }, id, b);
  }

  // ---- employer moderation (company suspend/restore; approval is via role review) ----
  @Get('employers')
  @RequirePermission('employers.read')
  employers(@Query('status') status?: string) {
    return this.employersAdmin.list(status);
  }
  @Get('employers/:id')
  @RequirePermission('employers.read')
  employerDetail(@Param('id') id: string) {
    return this.employersAdmin.detail(id);
  }
  @Post('employers/:id/suspend')
  @RequirePermission('employers.moderate')
  suspendEmployer(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body() b: { reason?: string }) {
    return this.employersAdmin.setApproval({ userId: u.userId }, id, 'SUSPENDED', b?.reason);
  }
  @Post('employers/:id/restore')
  @RequirePermission('employers.moderate')
  restoreEmployer(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.employersAdmin.setApproval({ userId: u.userId }, id, 'APPROVED');
  }

  // ---- job moderation ----
  @Get(':id')
  @RequirePermission('jobs.read')
  detail(@Param('id') id: string) {
    return this.jobs.adminDetail(id);
  }
  @Post(':id/moderate')
  @RequirePermission('jobs.moderate')
  moderate(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(jobModerateSchema)) b: JobModerateInput) {
    return this.jobs.moderate({ userId: u.userId, permissions: u.permissions }, id, b);
  }
}
