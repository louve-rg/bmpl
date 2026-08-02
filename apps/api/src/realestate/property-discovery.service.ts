import { Injectable, NotFoundException } from '@nestjs/common';
import { PROPERTIES_PAGE_SIZE, RECENTLY_VIEWED_PROPERTIES_MAX } from '@bmpl/shared';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { PropertiesService } from './properties.service';
import { AgentService } from './agent.service';
import { AgencyService } from './agency.service';

export interface PropertySearchQuery {
  q?: string;
  purpose?: string;
  propertyType?: string;
  district?: string;
  locality?: string;
  priceMin?: number;
  priceMax?: number;
  bedrooms?: number;
  bathrooms?: number;
  minPropertySize?: number;
  minLandSize?: number;
  furnishing?: string;
  amenities?: string[];
  availableNow?: boolean;
  agentSlug?: string;
  agencySlug?: string;
  includeSold?: boolean;
  sort?: string;
  page?: number;
}

/**
 * Public property discovery (M25): search/filter/sort over PUBLISHED/UNDER_OFFER
 * listings of APPROVED owners (and non-suspended assigned agents). Drafts, in-review,
 * rejected, suspended, withdrawn, sold/rented (by default), and archived listings are
 * excluded. Respects each listing's locationVisibility; never leaks exact address or
 * private documents. Saved + recently-viewed mirror the M24 job-discovery collections.
 */
@Injectable()
export class PropertyDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
    private readonly agents: AgentService,
    private readonly agencies: AgencyService,
  ) {}

  private baseWhere(includeSold = false): Prisma.PropertyListingWhereInput {
    return {
      status: { in: includeSold ? ['PUBLISHED', 'UNDER_OFFER', 'SOLD', 'RENTED'] : ['PUBLISHED', 'UNDER_OFFER'] },
      ownerProfile: { approvalStatus: 'APPROVED' },
      OR: [{ agentProfileId: null }, { agentProfile: { approvalStatus: 'APPROVED' } }],
    };
  }

  async publicSearch(query: PropertySearchQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = PROPERTIES_PAGE_SIZE;
    const and: Prisma.PropertyListingWhereInput[] = [this.baseWhere(query.includeSold)];
    if (query.q) {
      const c = { contains: query.q, mode: 'insensitive' as const };
      and.push({ OR: [{ title: c }, { description: c }, { locality: c }, { amenities: { some: { name: c } } }, { agentProfile: { displayName: c } }, { agency: { name: c } }] });
    }
    if (query.purpose) and.push({ purpose: query.purpose as never });
    if (query.propertyType) and.push({ propertyType: query.propertyType as never });
    if (query.district) and.push({ district: query.district as never });
    if (query.locality) and.push({ locality: { contains: query.locality, mode: 'insensitive' } });
    if (query.priceMin != null) and.push({ priceMinor: { gte: BigInt(query.priceMin) } });
    if (query.priceMax != null) and.push({ priceMinor: { lte: BigInt(query.priceMax) } });
    if (query.bedrooms != null) and.push({ bedrooms: { gte: query.bedrooms } });
    if (query.bathrooms != null) and.push({ bathrooms: { gte: query.bathrooms } });
    if (query.minPropertySize != null) and.push({ propertySize: { gte: query.minPropertySize } });
    if (query.minLandSize != null) and.push({ landSize: { gte: query.minLandSize } });
    if (query.furnishing) and.push({ furnishing: query.furnishing as never });
    if (query.amenities?.length) and.push({ amenities: { some: { name: { in: query.amenities } } } });
    if (query.availableNow) and.push({ OR: [{ availabilityDate: null }, { availabilityDate: { lte: new Date() } }] });
    if (query.agentSlug) and.push({ agentProfile: { slug: query.agentSlug } });
    if (query.agencySlug) and.push({ agency: { slug: query.agencySlug } });
    const where: Prisma.PropertyListingWhereInput = { AND: and };
    const orderBy = this.orderBy(query.sort);
    const [rows, total] = await Promise.all([
      this.prisma.propertyListing.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: { images: true, agentProfile: { select: { displayName: true, slug: true } }, agency: { select: { name: true, slug: true } } } }),
      this.prisma.propertyListing.count({ where }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: await Promise.all(rows.map((l) => this.publicCard(l))),
    };
  }

  private orderBy(sort?: string): Prisma.PropertyListingOrderByWithRelationInput {
    switch (sort) {
      case 'price_asc':
        return { priceMinor: 'asc' };
      case 'price_desc':
        return { priceMinor: 'desc' };
      case 'property_size':
        return { propertySize: { sort: 'desc', nulls: 'last' } };
      case 'land_size':
        return { landSize: { sort: 'desc', nulls: 'last' } };
      case 'most_viewed':
        return { viewCount: 'desc' };
      case 'newest':
      case 'relevance':
      default:
        return { publishedAt: 'desc' };
    }
  }

  async publicDetail(slug: string) {
    const found = await this.prisma.propertyListing.findFirst({ where: { slug, ...this.baseWhere() }, select: { id: true } });
    if (!found) throw new NotFoundException('Listing not found.');
    await this.prisma.propertyListing.update({ where: { id: found.id }, data: { viewCount: { increment: 1 } } });
    const l = await this.prisma.propertyListing.findUniqueOrThrow({
      where: { id: found.id },
      include: {
        amenities: { orderBy: { name: 'asc' } },
        utilities: { orderBy: { name: 'asc' } },
        images: { orderBy: { position: 'asc' } },
        agentProfile: { select: { id: true, displayName: true, slug: true, photoKey: true, phone: true, email: true } },
        agency: { select: { id: true, name: true, slug: true, logoKey: true } },
      },
    });
    const detail = {
      id: l.id,
      title: l.title,
      slug: l.slug,
      reference: l.reference,
      status: l.status,
      purpose: l.purpose,
      propertyType: l.propertyType,
      description: l.description,
      priceMinor: Number(l.priceMinor),
      currency: l.currency,
      rentalPeriod: l.rentalPeriod,
      negotiable: l.negotiable,
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms,
      halfBathrooms: l.halfBathrooms,
      parkingSpaces: l.parkingSpaces,
      propertySize: l.propertySize,
      landSize: l.landSize,
      areaUnit: l.areaUnit,
      yearBuilt: l.yearBuilt,
      furnishing: l.furnishing,
      tenure: l.tenure,
      petPolicy: l.petPolicy,
      availabilityDate: l.availabilityDate,
      leaseTerm: l.leaseTerm,
      condition: l.condition,
      videoUrl: l.videoUrl,
      authorityVerified: l.authorityVerified,
      viewCount: l.viewCount,
      publishedAt: l.publishedAt,
      location: this.properties.publicLocation(l),
      amenities: l.amenities.map((a) => a.name),
      utilities: l.utilities.map((u) => u.name),
      images: await Promise.all(l.images.map(async (img) => ({ id: img.id, url: await this.properties.urlOrNull(img.storageKey, 'public'), altText: img.altText, caption: img.caption, areaLabel: img.areaLabel, isPrimary: img.isPrimary }))),
      agent: l.agentProfile ? { displayName: l.agentProfile.displayName, slug: l.agentProfile.slug, phone: l.agentProfile.phone, email: l.agentProfile.email, photoUrl: await this.properties.urlOrNull(l.agentProfile.photoKey, 'public') } : null,
      agency: l.agency ? { name: l.agency.name, slug: l.agency.slug, logoUrl: await this.properties.urlOrNull(l.agency.logoKey, 'public') } : null,
    };
    const [related, moreFromAgent] = await Promise.all([
      this.related(l.id, l.district, l.propertyType),
      l.agentProfile ? this.moreFromAgent(l.id, l.agentProfile.id) : Promise.resolve([]),
    ]);
    return { ...detail, related, moreFromAgent };
  }

  private async related(listingId: string, district: string | null, propertyType: string, limit = 6) {
    const rows = await this.prisma.propertyListing.findMany({
      where: { AND: [this.baseWhere(), { id: { not: listingId } }, { OR: [district ? { district: district as never } : {}, { propertyType: propertyType as never }] }] },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      include: { images: true, agentProfile: { select: { displayName: true, slug: true } }, agency: { select: { name: true, slug: true } } },
    });
    return Promise.all(rows.map((l) => this.publicCard(l)));
  }

  private async moreFromAgent(listingId: string, agentProfileId: string, limit = 6) {
    const rows = await this.prisma.propertyListing.findMany({
      where: { AND: [this.baseWhere(), { id: { not: listingId } }, { agentProfileId }] },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      include: { images: true, agentProfile: { select: { displayName: true, slug: true } }, agency: { select: { name: true, slug: true } } },
    });
    return Promise.all(rows.map((l) => this.publicCard(l)));
  }

  /** Public listings for an agent's page. */
  async agentListings(slug: string) {
    const agent = await this.agents.publicAgent(slug);
    const p = await this.prisma.realEstateAgentProfile.findUniqueOrThrow({ where: { slug } });
    const rows = await this.prisma.propertyListing.findMany({
      where: { AND: [this.baseWhere(), { agentProfileId: p.id }] },
      orderBy: { publishedAt: 'desc' },
      take: 50,
      include: { images: true, agentProfile: { select: { displayName: true, slug: true } }, agency: { select: { name: true, slug: true } } },
    });
    return { agent, listings: await Promise.all(rows.map((l) => this.publicCard(l))) };
  }

  /** Public listings for an agency page. */
  async agencyListings(slug: string) {
    const agency = await this.agencies.publicAgency(slug);
    const a = await this.prisma.agencyProfile.findUniqueOrThrow({ where: { slug } });
    const rows = await this.prisma.propertyListing.findMany({
      where: { AND: [this.baseWhere(), { agencyId: a.id }] },
      orderBy: { publishedAt: 'desc' },
      take: 50,
      include: { images: true, agentProfile: { select: { displayName: true, slug: true } }, agency: { select: { name: true, slug: true } } },
    });
    return { agency, listings: await Promise.all(rows.map((l) => this.publicCard(l))) };
  }

  private async publicCard(l: Parameters<PropertiesService['card']>[0] & { agentProfile?: { displayName: string; slug: string } | null; agency?: { name: string; slug: string } | null }) {
    return {
      ...(await this.properties.card(l)),
      agent: l.agentProfile ? { displayName: l.agentProfile.displayName, slug: l.agentProfile.slug } : null,
      agency: l.agency ? { name: l.agency.name, slug: l.agency.slug } : null,
    };
  }

  // ===========================================================================
  // Saved properties (M20/M24 pattern)
  // ===========================================================================
  private async assertViewable(listingId: string) {
    const l = await this.prisma.propertyListing.findFirst({ where: { id: listingId, ...this.baseWhere() }, select: { id: true } });
    if (!l) throw new NotFoundException('Listing not found.');
  }

  async save(userId: string, listingId: string) {
    await this.assertViewable(listingId);
    try {
      await this.prisma.savedProperty.create({ data: { userId, listingId } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    return { saved: true };
  }
  async unsave(userId: string, listingId: string) {
    await this.prisma.savedProperty.deleteMany({ where: { userId, listingId } });
    return { saved: false };
  }
  async savedIds(userId: string) {
    const rows = await this.prisma.savedProperty.findMany({ where: { userId }, select: { listingId: true } });
    return { listingIds: rows.map((r) => r.listingId) };
  }
  async listSaved(userId: string) {
    const rows = await this.prisma.savedProperty.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { listing: { include: { images: true, agentProfile: { select: { displayName: true, slug: true } }, agency: { select: { name: true, slug: true } } } } },
    });
    return {
      items: await Promise.all(
        rows.map(async (r) => {
          const closed = !['PUBLISHED', 'UNDER_OFFER'].includes(r.listing.status);
          return { savedAt: r.createdAt, closed, ...(await this.publicCard(r.listing)) };
        }),
      ),
    };
  }

  async recordView(userId: string, listingId: string) {
    await this.assertViewable(listingId);
    await this.prisma.recentlyViewedProperty.upsert({ where: { userId_listingId: { userId, listingId } }, create: { userId, listingId }, update: { viewedAt: new Date() } });
    const overflow = await this.prisma.recentlyViewedProperty.findMany({ where: { userId }, orderBy: { viewedAt: 'desc' }, skip: RECENTLY_VIEWED_PROPERTIES_MAX, select: { id: true } });
    if (overflow.length) await this.prisma.recentlyViewedProperty.deleteMany({ where: { id: { in: overflow.map((r) => r.id) } } });
    return { ok: true };
  }
  async listRecentlyViewed(userId: string) {
    const rows = await this.prisma.recentlyViewedProperty.findMany({
      where: { userId },
      orderBy: { viewedAt: 'desc' },
      take: RECENTLY_VIEWED_PROPERTIES_MAX,
      include: { listing: { include: { images: true, agentProfile: { select: { displayName: true, slug: true } }, agency: { select: { name: true, slug: true } } } } },
    });
    return {
      items: await Promise.all(
        rows.filter((r) => ['PUBLISHED', 'UNDER_OFFER'].includes(r.listing.status)).map(async (r) => ({ viewedAt: r.viewedAt, ...(await this.publicCard(r.listing)) })),
      ),
    };
  }
}
