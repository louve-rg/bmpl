import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PropertyOwnerService } from './property-owner.service';
import { AgentService } from './agent.service';

/**
 * Real Estate analytics (M25) — read-only aggregation. Admin metrics are platform-wide;
 * owner/agent metrics are scoped to listings they own/manage. No fabricated sale prices
 * or fake figures — every number is a live count from existing tables.
 */
@Injectable()
export class PropertyAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly owners: PropertyOwnerService,
    private readonly agents: AgentService,
  ) {}

  async adminOverview() {
    const [activeListings, submitted, underReview, reported, enquiries, viewings, sold, rented, activeOwners, activeAgents, byDistrictRaw, byTypeRaw, byPurposeRaw] = await Promise.all([
      this.prisma.propertyListing.count({ where: { status: { in: ['PUBLISHED', 'UNDER_OFFER'] } } }),
      this.prisma.propertyListing.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.propertyListing.count({ where: { status: 'UNDER_REVIEW' } }),
      this.prisma.propertyReport.count({ where: { status: 'OPEN' } }),
      this.prisma.propertyEnquiry.count(),
      this.prisma.propertyViewingRequest.count(),
      this.prisma.propertyListing.count({ where: { status: 'SOLD' } }),
      this.prisma.propertyListing.count({ where: { status: 'RENTED' } }),
      this.prisma.propertyOwnerProfile.count({ where: { approvalStatus: 'APPROVED' } }),
      this.prisma.realEstateAgentProfile.count({ where: { approvalStatus: 'APPROVED' } }),
      this.prisma.propertyListing.groupBy({ by: ['district'], where: { status: { in: ['PUBLISHED', 'UNDER_OFFER'] } }, _count: { _all: true } }),
      this.prisma.propertyListing.groupBy({ by: ['propertyType'], where: { status: { in: ['PUBLISHED', 'UNDER_OFFER'] } }, _count: { _all: true } }),
      this.prisma.propertyListing.groupBy({ by: ['purpose'], where: { status: { in: ['PUBLISHED', 'UNDER_OFFER'] } }, _count: { _all: true } }),
    ]);
    const purposeCount = (p: string) => byPurposeRaw.find((r) => r.purpose === p)?._count._all ?? 0;
    return {
      activeListings,
      approvalBacklog: submitted + underReview,
      submissions: submitted,
      underReview,
      reported,
      enquiries,
      viewingRequests: viewings,
      sold,
      rented,
      forSale: purposeCount('FOR_SALE'),
      forRent: purposeCount('FOR_RENT'),
      activeOwners,
      activeAgents,
      byDistrict: byDistrictRaw.map((r) => ({ district: r.district ?? 'Unspecified', count: r._count._all })).sort((a, b) => b.count - a.count),
      byType: byTypeRaw.map((r) => ({ propertyType: r.propertyType, count: r._count._all })).sort((a, b) => b.count - a.count),
    };
  }

  async ownerOverview(userId: string) {
    const owner = await this.owners.requireOwnerProfile(userId);
    const scope = { ownerProfileId: owner.id };
    const [total, active, views, saves, enquiries, viewings, byStatusRaw] = await Promise.all([
      this.prisma.propertyListing.count({ where: scope }),
      this.prisma.propertyListing.count({ where: { ...scope, status: { in: ['PUBLISHED', 'UNDER_OFFER'] } } }),
      this.prisma.propertyListing.aggregate({ where: scope, _sum: { viewCount: true } }),
      this.prisma.savedProperty.count({ where: { listing: scope } }),
      this.prisma.propertyEnquiry.count({ where: { listing: scope } }),
      this.prisma.propertyViewingRequest.count({ where: { listing: scope } }),
      this.prisma.propertyListing.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
    ]);
    return {
      totalListings: total,
      activeListings: active,
      totalViews: views._sum.viewCount ?? 0,
      saves,
      enquiries,
      viewingRequests: viewings,
      byStatus: byStatusRaw.map((r) => ({ status: r.status, count: r._count._all })),
    };
  }

  async agentOverview(userId: string) {
    const agent = await this.agents.requireAgentProfile(userId);
    const scope = { agentProfileId: agent.id };
    const [assigned, active, views, enquiries, viewings, pendingAssignments, byStatusRaw] = await Promise.all([
      this.prisma.propertyListing.count({ where: scope }),
      this.prisma.propertyListing.count({ where: { ...scope, status: { in: ['PUBLISHED', 'UNDER_OFFER'] } } }),
      this.prisma.propertyListing.aggregate({ where: scope, _sum: { viewCount: true } }),
      this.prisma.propertyEnquiry.count({ where: { listing: scope } }),
      this.prisma.propertyViewingRequest.count({ where: { listing: scope } }),
      this.prisma.propertyListingAssignment.count({ where: { agentProfileId: agent.id, status: 'PENDING' } }),
      this.prisma.propertyListing.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
    ]);
    return {
      assignedListings: assigned,
      activeListings: active,
      totalViews: views._sum.viewCount ?? 0,
      enquiries,
      viewingRequests: viewings,
      pendingAssignments,
      byStatus: byStatusRaw.map((r) => ({ status: r.status, count: r._count._all })),
    };
  }
}
