import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MessagingModule } from '../messaging/messaging.module';
import { JobSeekerService } from './job-seeker.service';
import { EmployerService } from './employer.service';
import { EmployerAdminService } from './employer-admin.service';
import { JobsService } from './jobs.service';
import { JobDiscoveryService } from './job-discovery.service';
import { ApplicationsService } from './applications.service';
import { JobReportsService } from './job-reports.service';
import { JobAnalyticsService } from './job-analytics.service';
import { JobsPublicController } from './jobs-public.controller';
import { JobSeekerController } from './job-seeker.controller';
import { EmployerController } from './employer.controller';
import { AdminJobsController } from './admin-jobs.controller';

/**
 * Belize Connect — Jobs & Employment (Phase 5 · M24). Reuses the BMPL account,
 * JOB_SEEKER/EMPLOYER roles + role-application approval, private R2 storage, M16
 * notifications, M17 messaging (JOB_APPLICATION context), moderation, and analytics.
 * Storage/Audit/Notifications are @Global(); MessagingModule is imported for the
 * employer↔applicant thread.
 */
@Module({
  imports: [PrismaModule, MessagingModule],
  controllers: [JobsPublicController, JobSeekerController, EmployerController, AdminJobsController],
  providers: [
    JobSeekerService,
    EmployerService,
    EmployerAdminService,
    JobsService,
    JobDiscoveryService,
    ApplicationsService,
    JobReportsService,
    JobAnalyticsService,
  ],
  exports: [JobsService, EmployerService, JobReportsService, JobAnalyticsService],
})
export class JobsModule {}
