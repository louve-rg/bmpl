import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  imagePresignSchema,
  jobReportSchema,
  jobSeekerCertificationSchema,
  jobSeekerEducationSchema,
  jobSeekerExperienceSchema,
  jobSeekerLanguageSchema,
  jobSeekerSkillSchema,
  resumeConfirmSchema,
  submitApplicationSchema,
  upsertJobSeekerProfileSchema,
  type ImagePresignInput,
  type JobReportInput,
  type SubmitApplicationInput,
  type UpsertJobSeekerProfileInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { JobSeekerService } from './job-seeker.service';
import { JobDiscoveryService } from './job-discovery.service';
import { ApplicationsService } from './applications.service';
import { JobReportsService } from './job-reports.service';

/** Job-seeker surface: profile, résumés, saved/viewed jobs, and applications. */
@Roles('CUSTOMER')
@Controller('job-seeker')
export class JobSeekerController {
  constructor(
    private readonly seeker: JobSeekerService,
    private readonly discovery: JobDiscoveryService,
    private readonly applications: ApplicationsService,
    private readonly reports: JobReportsService,
  ) {}

  private actor(u: AuthContext) {
    return { userId: u.userId, status: u.status };
  }

  // ---- profile ----
  @Get('profile')
  profile(@CurrentUser() u: AuthContext) {
    return this.seeker.getOwn(u.userId);
  }
  @Put('profile')
  upsert(@CurrentUser() u: AuthContext, @Body(ZodBody(upsertJobSeekerProfileSchema)) b: UpsertJobSeekerProfileInput) {
    return this.seeker.upsertProfile(this.actor(u), b);
  }

  // ---- child collections ----
  @Post('skills')
  addSkill(@CurrentUser() u: AuthContext, @Body(ZodBody(jobSeekerSkillSchema)) b: { name: string }) {
    return this.seeker.addSkill(u.userId, b);
  }
  @Post('education')
  addEducation(@CurrentUser() u: AuthContext, @Body(ZodBody(jobSeekerEducationSchema)) b: never) {
    return this.seeker.addEducation(u.userId, b);
  }
  @Post('experience')
  addExperience(@CurrentUser() u: AuthContext, @Body(ZodBody(jobSeekerExperienceSchema)) b: never) {
    return this.seeker.addExperience(u.userId, b);
  }
  @Post('certifications')
  addCertification(@CurrentUser() u: AuthContext, @Body(ZodBody(jobSeekerCertificationSchema)) b: never) {
    return this.seeker.addCertification(u.userId, b);
  }
  @Post('languages')
  addLanguage(@CurrentUser() u: AuthContext, @Body(ZodBody(jobSeekerLanguageSchema)) b: never) {
    return this.seeker.addLanguage(u.userId, b);
  }
  @Delete(':kind/:id')
  removeChild(@CurrentUser() u: AuthContext, @Param('kind') kind: string, @Param('id') id: string) {
    const map: Record<string, 'skill' | 'education' | 'experience' | 'certification' | 'language'> = { skills: 'skill', education: 'education', experience: 'experience', certifications: 'certification', languages: 'language' };
    return this.seeker.removeChild(u.userId, map[kind] ?? 'skill', id);
  }

  // ---- résumés (private) ----
  @StrictThrottle()
  @Post('resumes/presign')
  presignResume(@CurrentUser() u: AuthContext, @Body(ZodBody(imagePresignSchema)) b: ImagePresignInput) {
    return this.seeker.presignResume(u.userId, b.fileName, b.contentType);
  }
  @Post('resumes')
  confirmResume(@CurrentUser() u: AuthContext, @Body(ZodBody(resumeConfirmSchema)) b: never) {
    return this.seeker.confirmResume(u.userId, b);
  }
  @Post('resumes/:id/primary')
  primaryResume(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.seeker.setPrimaryResume(u.userId, id);
  }
  @Delete('resumes/:id')
  deleteResume(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.seeker.deleteResume(u.userId, id);
  }
  @Get('resumes/:id/url')
  resumeUrl(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.seeker.ownResumeUrl(u.userId, id);
  }

  // ---- saved + recently viewed jobs ----
  @Get('saved')
  listSaved(@CurrentUser() u: AuthContext) {
    return this.discovery.listSaved(u.userId);
  }
  @Get('saved/ids')
  savedIds(@CurrentUser() u: AuthContext) {
    return this.discovery.savedIds(u.userId);
  }
  @Post('saved/:jobId')
  save(@CurrentUser() u: AuthContext, @Param('jobId') jobId: string) {
    return this.discovery.save(u.userId, jobId);
  }
  @Delete('saved/:jobId')
  unsave(@CurrentUser() u: AuthContext, @Param('jobId') jobId: string) {
    return this.discovery.unsave(u.userId, jobId);
  }
  @Get('recently-viewed')
  recentlyViewed(@CurrentUser() u: AuthContext) {
    return this.discovery.listRecentlyViewed(u.userId);
  }
  @Post('recently-viewed/:jobId')
  recordView(@CurrentUser() u: AuthContext, @Param('jobId') jobId: string) {
    return this.discovery.recordView(u.userId, jobId);
  }

  // ---- applications ----
  @StrictThrottle()
  @Post('applications')
  apply(@CurrentUser() u: AuthContext, @Body(ZodBody(submitApplicationSchema)) b: SubmitApplicationInput) {
    return this.applications.submit(this.actor(u), b);
  }
  @Get('applications')
  myApplications(@CurrentUser() u: AuthContext) {
    return this.applications.listMine(u.userId);
  }
  @Get('applications/:id')
  myApplication(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.applications.getMine(u.userId, id);
  }
  @Post('applications/:id/withdraw')
  withdraw(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.applications.withdraw(this.actor(u), id);
  }
  @Post('applications/:id/conversation')
  openConversation(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.applications.openConversation(this.actor(u), id);
  }

  // ---- report a job ----
  @Post('report/:jobId')
  report(@CurrentUser() u: AuthContext, @Param('jobId') jobId: string, @Body(ZodBody(jobReportSchema)) b: JobReportInput) {
    return this.reports.report({ userId: u.userId }, jobId, b);
  }
}
