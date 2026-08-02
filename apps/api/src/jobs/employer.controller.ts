import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  applicationNoteSchema,
  applicationStatusSchema,
  createJobSchema,
  imagePresignSchema,
  interviewSchema,
  interviewUpdateSchema,
  jobQuestionSchema,
  updateJobSchema,
  upsertEmployerProfileSchema,
  type ApplicationNoteInput,
  type ApplicationStatusInput,
  type CreateJobInput,
  type ImagePresignInput,
  type InterviewInput,
  type InterviewUpdateInput,
  type JobQuestionInput,
  type UpdateJobInput,
  type UpsertEmployerProfileInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { EmployerService } from './employer.service';
import { JobsService } from './jobs.service';
import { ApplicationsService } from './applications.service';
import { JobAnalyticsService } from './job-analytics.service';

/** Employer surface — requires an APPROVED EMPLOYER role. Company profile, job
 *  authoring/lifecycle, applicant pipeline, interviews, and own analytics. */
@Roles('EMPLOYER')
@Controller('employer')
export class EmployerController {
  constructor(
    private readonly employers: EmployerService,
    private readonly jobs: JobsService,
    private readonly applications: ApplicationsService,
    private readonly analytics: JobAnalyticsService,
  ) {}

  private actor(u: AuthContext) {
    return { userId: u.userId, status: u.status, permissions: u.permissions };
  }

  // ---- company profile ----
  @Get('profile')
  profile(@CurrentUser() u: AuthContext) {
    return this.employers.getOwn(u.userId);
  }
  @Put('profile')
  upsert(@CurrentUser() u: AuthContext, @Body(ZodBody(upsertEmployerProfileSchema)) b: UpsertEmployerProfileInput) {
    return this.employers.upsertProfile(this.actor(u), b);
  }
  @StrictThrottle()
  @Post('profile/:kind/presign')
  presignImage(@CurrentUser() u: AuthContext, @Param('kind') kind: string, @Body(ZodBody(imagePresignSchema)) b: ImagePresignInput) {
    return this.employers.presignImage(u.userId, kind === 'banner' ? 'banner' : 'logo', b.fileName, b.contentType);
  }
  @Post('profile/:kind/confirm')
  confirmImage(@CurrentUser() u: AuthContext, @Param('kind') kind: string, @Body() b: { storageKey: string }) {
    return this.employers.confirmImage(u.userId, kind === 'banner' ? 'banner' : 'logo', b.storageKey);
  }

  // ---- jobs ----
  @Get('jobs')
  listJobs(@CurrentUser() u: AuthContext, @Query('status') status?: string) {
    return this.jobs.employerList(u.userId, status);
  }
  @Post('jobs')
  createJob(@CurrentUser() u: AuthContext, @Body(ZodBody(createJobSchema)) b: CreateJobInput) {
    return this.jobs.create(this.actor(u), b);
  }
  @Get('jobs/:id')
  getJob(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.jobs.employerDetail(u.userId, id);
  }
  @Patch('jobs/:id')
  updateJob(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(updateJobSchema)) b: UpdateJobInput) {
    return this.jobs.update(this.actor(u), id, b);
  }
  @Post('jobs/:id/submit')
  submitJob(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.jobs.submit(this.actor(u), id);
  }
  @Post('jobs/:id/close')
  closeJob(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.jobs.close(this.actor(u), id);
  }
  @Post('jobs/:id/archive')
  archiveJob(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.jobs.archive(this.actor(u), id);
  }
  @Post('jobs/:id/duplicate')
  duplicateJob(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.jobs.duplicate(this.actor(u), id);
  }
  @Post('jobs/:id/questions')
  addQuestion(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(jobQuestionSchema)) b: JobQuestionInput) {
    return this.jobs.addQuestion(this.actor(u), id, b);
  }
  @Delete('jobs/:id/questions/:questionId')
  removeQuestion(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('questionId') questionId: string) {
    return this.jobs.removeQuestion(this.actor(u), id, questionId);
  }

  // ---- applications pipeline ----
  @Get('applications')
  listApplications(@CurrentUser() u: AuthContext, @Query('jobId') jobId?: string, @Query('status') status?: string) {
    return this.applications.employerList(u.userId, { jobId, status });
  }
  @Get('applications/:id')
  getApplication(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.applications.employerGet(u.userId, id);
  }
  @Get('applications/:id/resume-url')
  resumeUrl(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.applications.employerResumeUrl(u.userId, id);
  }
  @Post('applications/:id/status')
  setStatus(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(applicationStatusSchema)) b: ApplicationStatusInput) {
    return this.applications.setStatus(this.actor(u), id, b);
  }
  @Post('applications/:id/notes')
  addNote(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(applicationNoteSchema)) b: ApplicationNoteInput) {
    return this.applications.addNote(this.actor(u), id, b);
  }
  @Post('applications/:id/conversation')
  openConversation(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.applications.openConversation(this.actor(u), id);
  }
  @Post('applications/:id/interviews')
  scheduleInterview(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(interviewSchema)) b: InterviewInput) {
    return this.applications.scheduleInterview(this.actor(u), id, b);
  }
  @Patch('interviews/:interviewId')
  updateInterview(@CurrentUser() u: AuthContext, @Param('interviewId') interviewId: string, @Body(ZodBody(interviewUpdateSchema)) b: InterviewUpdateInput) {
    return this.applications.updateInterview(this.actor(u), interviewId, b);
  }

  // ---- analytics ----
  @Get('analytics')
  analyticsOverview(@CurrentUser() u: AuthContext) {
    return this.analytics.employerOverview(u.userId);
  }
}
