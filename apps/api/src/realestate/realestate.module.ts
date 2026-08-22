import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PropertyOwnerService } from './property-owner.service';
import { AgentService } from './agent.service';
import { AgencyService } from './agency.service';
import { PropertiesService } from './properties.service';
import { PropertyDiscoveryService } from './property-discovery.service';
import { PropertyEnquiriesService } from './property-enquiries.service';
import { PropertyReportsService } from './property-reports.service';
import { PropertyAnalyticsService } from './property-analytics.service';
import { RealEstateAdminService } from './realestate-admin.service';
import { PropertyPublicController } from './property-public.controller';
import { PropertyOwnerController } from './property-owner.controller';
import { AgentController } from './agent.controller';
import { PropertySeekerController } from './property-seeker.controller';
import { AdminPropertiesController } from './admin-properties.controller';

/**
 * Real Estate (Phase 6 · M25). Owner/agent/agency listings, moderation before public,
 * discovery, saved/recently-viewed, enquiries + viewing requests (with the M17
 * PROPERTY_ENQUIRY messaging context), reporting, and analytics. Reuses the BML
 * account, PROPERTY_OWNER/REAL_ESTATE_AGENT roles + role-application approval, public +
 * private R2 storage, M16 notifications, and moderation. Storage/Audit/Notifications are
 * @Global(); MessagingModule is imported for the lister↔enquirer thread.
 */
@Module({
  imports: [PrismaModule, MessagingModule],
  controllers: [PropertyPublicController, PropertyOwnerController, AgentController, PropertySeekerController, AdminPropertiesController],
  providers: [
    PropertyOwnerService,
    AgentService,
    AgencyService,
    PropertiesService,
    PropertyDiscoveryService,
    PropertyEnquiriesService,
    PropertyReportsService,
    PropertyAnalyticsService,
    RealEstateAdminService,
  ],
  exports: [PropertiesService, PropertyReportsService, PropertyAnalyticsService],
})
export class RealEstateModule {}
