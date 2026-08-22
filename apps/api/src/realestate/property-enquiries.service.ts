import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { canTransitionViewing, TERMINAL_VIEWING_STATUSES, type ViewingRequestStatus } from '@bmpl/shared';
import type { CreateEnquiryInput, CreateViewingRequestInput, EnquiryReplyInput, ViewingTransitionInput } from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessagingService } from '../messaging/messaging.service';
import { PropertiesService } from './properties.service';

export interface Actor {
  userId: string;
  status?: string;
  permissions?: string[];
}

const LIVE_STATUSES: string[] = ['PUBLISHED', 'UNDER_OFFER'];

/**
 * Property enquiries & viewing requests (M25). An authenticated customer enquires
 * about (or requests a viewing of) a live listing; the enquirer and the listing's
 * owner/assigned agent are the only non-admin parties who can see or act on it. Enquiries
 * open a scoped PROPERTY_ENQUIRY messaging thread; viewing requests follow a validated
 * transition map with append-only events, audit, and notifications.
 */
@Injectable()
export class PropertyEnquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly messaging: MessagingService,
    private readonly properties: PropertiesService,
  ) {}

  private async liveListing(listingId: string) {
    const l = await this.prisma.propertyListing.findUnique({
      where: { id: listingId },
      include: { ownerProfile: { select: { userId: true, approvalStatus: true } }, agentProfile: { select: { userId: true, approvalStatus: true } } },
    });
    if (!l || !LIVE_STATUSES.includes(l.status) || l.ownerProfile.approvalStatus === 'SUSPENDED') throw new NotFoundException('Listing not found.');
    const listerUserId = l.agentProfile?.userId ?? l.ownerProfile.userId;
    return { listing: l, ownerUserId: l.ownerProfile.userId, agentUserId: l.agentProfile?.userId ?? null, listerUserId };
  }

  // ===========================================================================
  // Enquiries — enquirer side
  // ===========================================================================
  async createEnquiry(actor: Actor, dto: CreateEnquiryInput) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot send enquiries.');
    const { listing, listerUserId } = await this.liveListing(dto.listingId);
    if (listerUserId === actor.userId) throw new BadRequestException('You cannot inquire about your own listing.');
    const enquiry = await this.prisma.propertyEnquiry.create({
      data: {
        listingId: dto.listingId,
        enquirerId: actor.userId,
        type: dto.type ?? 'GENERAL',
        message: dto.message,
        preferredContact: dto.preferredContact ?? null,
        contactPhone: dto.contactPhone ?? null,
        status: 'OPEN',
      },
    });
    await this.audit.record({ action: 'PROPERTY_ENQUIRY_CREATED', actorId: actor.userId, newValue: { enquiryId: enquiry.id, listingId: dto.listingId } });
    await this.notifications.createInApp({ userId: listerUserId, type: 'MARKETPLACE', category: 'PROPERTY', event: 'PRODUCT_MODERATED', title: 'New enquiry', body: `New inquiry about "${listing.title}".`, data: { enquiryId: enquiry.id, listingId: dto.listingId } });
    await this.messaging.postPropertyEnquirySystem(enquiry.id, listerUserId, actor.userId, `Inquiry about "${listing.title}": ${dto.message.slice(0, 200)}`);
    return this.getMineEnquiry(actor.userId, enquiry.id);
  }

  async listMineEnquiries(userId: string) {
    const rows = await this.prisma.propertyEnquiry.findMany({
      where: { enquirerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { listing: { select: { title: true, slug: true, reference: true, status: true } } },
    });
    return rows.map((e) => this.enquiryCard(e));
  }

  async getMineEnquiry(userId: string, enquiryId: string) {
    const e = await this.prisma.propertyEnquiry.findFirst({ where: { id: enquiryId, enquirerId: userId }, include: { listing: { select: { title: true, slug: true, reference: true, status: true } } } });
    if (!e) throw new NotFoundException('Inquiry not found.');
    return this.enquiryDetail(e);
  }

  async openConversation(actor: Actor, enquiryId: string) {
    // Authorization is enforced inside MessagingService.openPropertyEnquiry.
    return this.messaging.openPropertyEnquiry({ userId: actor.userId, status: actor.status }, enquiryId);
  }

  // ===========================================================================
  // Enquiries — lister side (owner or assigned agent of the listing)
  // ===========================================================================
  private async requireListerEnquiry(actor: Actor, enquiryId: string) {
    const e = await this.prisma.propertyEnquiry.findUnique({ where: { id: enquiryId }, include: { listing: { select: { id: true, title: true } } } });
    if (!e) throw new NotFoundException('Inquiry not found.');
    await this.properties.requireManageable(actor, e.listingId); // throws 404 unless owner/accepted-agent
    return e;
  }

  async listerListEnquiries(actor: Actor, filter: { listingId?: string; status?: string } = {}) {
    const rows = await this.prisma.propertyEnquiry.findMany({
      where: {
        listing: { OR: [{ ownerProfile: { userId: actor.userId } }, { agentProfile: { userId: actor.userId } }] },
        ...(filter.listingId ? { listingId: filter.listingId } : {}),
        ...(filter.status ? { status: filter.status as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { listing: { select: { title: true, slug: true, reference: true, status: true } }, enquirer: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((e) => ({ ...this.enquiryCard(e), enquirer: `${e.enquirer.firstName} ${e.enquirer.lastName}`.trim() }));
  }

  async listerGetEnquiry(actor: Actor, enquiryId: string) {
    await this.requireListerEnquiry(actor, enquiryId);
    const e = await this.prisma.propertyEnquiry.findUniqueOrThrow({ where: { id: enquiryId }, include: { listing: { select: { title: true, slug: true, reference: true, status: true } }, enquirer: { select: { firstName: true, lastName: true, email: true } } } });
    return { ...this.enquiryDetail(e), enquirer: { name: `${e.enquirer.firstName} ${e.enquirer.lastName}`.trim(), email: e.enquirer.email } };
  }

  async replyEnquiry(actor: Actor, enquiryId: string, dto: EnquiryReplyInput) {
    const e = await this.requireListerEnquiry(actor, enquiryId);
    await this.prisma.propertyEnquiry.update({ where: { id: enquiryId }, data: { status: e.status === 'CLOSED' ? e.status : 'RESPONDED', respondedAt: new Date() } });
    // Post the reply as a real message on the enquiry thread (authorizes the lister).
    const conv = await this.messaging.openPropertyEnquiry({ userId: actor.userId, status: actor.status }, enquiryId);
    await this.messaging.sendMessage({ userId: actor.userId, status: actor.status }, conv.id, { body: dto.message });
    await this.audit.record({ action: 'PROPERTY_ENQUIRY_UPDATED', actorId: actor.userId, newValue: { enquiryId, action: 'REPLY' } });
    await this.notifications.createInApp({ userId: e.enquirerId, type: 'MARKETPLACE', category: 'PROPERTY', event: 'MESSAGE_RECEIVED', title: 'Reply to your enquiry', body: `You received a reply about "${e.listing.title}".`, data: { enquiryId } });
    return this.listerGetEnquiry(actor, enquiryId);
  }

  async closeEnquiry(actor: Actor, enquiryId: string) {
    const e = await this.requireListerEnquiry(actor, enquiryId);
    await this.prisma.propertyEnquiry.update({ where: { id: enquiryId }, data: { status: 'CLOSED', closedAt: new Date() } });
    await this.audit.record({ action: 'PROPERTY_ENQUIRY_UPDATED', actorId: actor.userId, newValue: { enquiryId, action: 'CLOSE' } });
    await this.notifications.createInApp({ userId: e.enquirerId, type: 'MARKETPLACE', category: 'PROPERTY', event: 'PRODUCT_MODERATED', title: 'Inquiry closed', body: `Your inquiry about "${e.listing.title}" was closed.`, data: { enquiryId } });
    return this.listerGetEnquiry(actor, enquiryId);
  }

  // ===========================================================================
  // Viewing requests
  // ===========================================================================
  async createViewing(actor: Actor, dto: CreateViewingRequestInput) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot request viewings.');
    const { listing, listerUserId } = await this.liveListing(dto.listingId);
    if (listerUserId === actor.userId) throw new BadRequestException('You cannot request a viewing of your own listing.');
    const req = await this.prisma.propertyViewingRequest.create({
      data: {
        listingId: dto.listingId,
        requesterId: actor.userId,
        requestedDate: dto.requestedDate,
        requestedTime: dto.requestedTime ?? null,
        timezone: dto.timezone ?? 'America/Belize',
        alternateDate: dto.alternateDate ?? null,
        alternateTime: dto.alternateTime ?? null,
        message: dto.message ?? null,
        status: 'REQUESTED',
        events: { create: { fromStatus: null, toStatus: 'REQUESTED', actorId: actor.userId } },
      },
    });
    await this.audit.record({ action: 'PROPERTY_VIEWING_REQUESTED', actorId: actor.userId, newValue: { viewingId: req.id, listingId: dto.listingId } });
    await this.notifications.createInApp({ userId: listerUserId, type: 'MARKETPLACE', category: 'PROPERTY', event: 'PRODUCT_MODERATED', title: 'New viewing request', body: `A viewing was requested for "${listing.title}".`, data: { viewingId: req.id, listingId: dto.listingId } });
    return this.getMineViewing(actor.userId, req.id);
  }

  async listMineViewings(userId: string) {
    const rows = await this.prisma.propertyViewingRequest.findMany({
      where: { requesterId: userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { listing: { select: { title: true, slug: true, reference: true } } },
    });
    return rows.map((v) => this.viewingCard(v));
  }

  async getMineViewing(userId: string, viewingId: string) {
    const v = await this.prisma.propertyViewingRequest.findFirst({ where: { id: viewingId, requesterId: userId }, include: { listing: { select: { title: true, slug: true, reference: true } }, events: { orderBy: { createdAt: 'asc' } } } });
    if (!v) throw new NotFoundException('Viewing request not found.');
    return this.viewingDetail(v);
  }

  async listerListViewings(actor: Actor, filter: { listingId?: string; status?: string } = {}) {
    const rows = await this.prisma.propertyViewingRequest.findMany({
      where: {
        listing: { OR: [{ ownerProfile: { userId: actor.userId } }, { agentProfile: { userId: actor.userId } }] },
        ...(filter.listingId ? { listingId: filter.listingId } : {}),
        ...(filter.status ? { status: filter.status as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { listing: { select: { title: true, slug: true, reference: true } }, requester: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((v) => ({ ...this.viewingCard(v), requester: `${v.requester.firstName} ${v.requester.lastName}`.trim() }));
  }

  async listerGetViewing(actor: Actor, viewingId: string) {
    const v = await this.loadViewingForLister(actor, viewingId);
    return { ...this.viewingDetail(v), requester: v.requesterName };
  }

  /** Owner/agent OR requester drives a transition, validated against the map. */
  async transitionViewing(actor: Actor, viewingId: string, dto: ViewingTransitionInput) {
    const v = await this.prisma.propertyViewingRequest.findUnique({
      where: { id: viewingId },
      include: { listing: { select: { id: true, title: true, ownerProfile: { select: { userId: true } }, agentProfile: { select: { userId: true } } } } },
    });
    if (!v) throw new NotFoundException('Viewing request not found.');
    const isRequester = v.requesterId === actor.userId;
    const isLister = await this.isLister(actor, v.listingId);
    if (!isRequester && !isLister) throw new NotFoundException('Viewing request not found.');
    const to = dto.status as ViewingRequestStatus;
    // The requester may only CANCEL; the owner/agent drives every other transition.
    if (isRequester && !isLister && to !== 'CANCELLED') throw new ForbiddenException('You can only cancel your viewing request.');
    if (TERMINAL_VIEWING_STATUSES.includes(v.status as ViewingRequestStatus)) throw new BadRequestException('This viewing request is already closed.');
    if (!canTransitionViewing(v.status as ViewingRequestStatus, to)) throw new BadRequestException(`Cannot move a viewing from ${v.status} to ${to}.`);
    const extra: Prisma.PropertyViewingRequestUpdateInput = {};
    if (to === 'CONFIRMED') {
      extra.confirmedDate = dto.confirmedDate ?? v.confirmedDate ?? v.requestedDate;
      extra.confirmedTime = dto.confirmedTime ?? v.confirmedTime ?? v.requestedTime;
    }
    if (to === 'PROPOSED' || to === 'RESCHEDULED') {
      if (dto.confirmedDate) extra.confirmedDate = dto.confirmedDate;
      if (dto.confirmedTime) extra.confirmedTime = dto.confirmedTime;
    }
    if (to === 'CANCELLED' || to === 'DECLINED') extra.cancellationReason = dto.cancellationReason ?? dto.note ?? null;
    await this.prisma.$transaction(async (tx) => {
      await tx.propertyViewingRequest.update({ where: { id: viewingId }, data: { status: to, ...extra } });
      await tx.propertyViewingEvent.create({ data: { requestId: viewingId, fromStatus: v.status as never, toStatus: to, actorId: actor.userId, note: dto.note ?? null } });
    });
    await this.audit.record({ action: 'PROPERTY_VIEWING_UPDATED', actorId: actor.userId, newValue: { viewingId, from: v.status, to } });
    const listerUserId = v.listing.agentProfile?.userId ?? v.listing.ownerProfile.userId;
    const notifyUserId = actor.userId === v.requesterId ? listerUserId : v.requesterId;
    await this.notifications.createInApp({ userId: notifyUserId, type: 'MARKETPLACE', category: 'PROPERTY', event: 'PRODUCT_MODERATED', title: 'Viewing request updated', body: `The viewing for "${v.listing.title}" is now ${to.replace(/_/g, ' ').toLowerCase()}.`, data: { viewingId } });
    return isRequester && !isLister ? this.getMineViewing(actor.userId, viewingId) : this.listerGetViewing(actor, viewingId);
  }

  // ===========================================================================
  // helpers
  // ===========================================================================
  private async isLister(actor: Actor, listingId: string) {
    try {
      await this.properties.requireManageable(actor, listingId);
      return true;
    } catch {
      return false;
    }
  }

  private async loadViewingForLister(actor: Actor, viewingId: string) {
    const v = await this.prisma.propertyViewingRequest.findUnique({
      where: { id: viewingId },
      include: { listing: { select: { title: true, slug: true, reference: true } }, events: { orderBy: { createdAt: 'asc' } }, requester: { select: { firstName: true, lastName: true } } },
    });
    if (!v) throw new NotFoundException('Viewing request not found.');
    await this.properties.requireManageable(actor, v.listingId);
    return { ...v, requesterName: `${v.requester.firstName} ${v.requester.lastName}`.trim() };
  }

  private enquiryCard(e: { id: string; listingId: string; type: string; status: string; createdAt: Date; respondedAt: Date | null; listing: { title: string; slug: string; reference: string; status: string } }) {
    return { id: e.id, listingId: e.listingId, listing: e.listing, type: e.type, status: e.status, createdAt: e.createdAt, respondedAt: e.respondedAt };
  }
  private enquiryDetail(e: { id: string; listingId: string; type: string; status: string; message: string; preferredContact: string | null; contactPhone: string | null; createdAt: Date; respondedAt: Date | null; closedAt: Date | null; listing: { title: string; slug: string; reference: string; status: string } }) {
    return { ...this.enquiryCard(e), message: e.message, preferredContact: e.preferredContact, contactPhone: e.contactPhone, closedAt: e.closedAt };
  }
  private viewingCard(v: { id: string; listingId: string; status: string; requestedDate: Date; requestedTime: string | null; confirmedDate: Date | null; confirmedTime: string | null; createdAt: Date; listing: { title: string; slug: string; reference: string } }) {
    return { id: v.id, listingId: v.listingId, listing: v.listing, status: v.status, requestedDate: v.requestedDate, requestedTime: v.requestedTime, confirmedDate: v.confirmedDate, confirmedTime: v.confirmedTime, createdAt: v.createdAt };
  }
  private viewingDetail(v: Parameters<PropertyEnquiriesService['viewingCard']>[0] & { message?: string | null; timezone?: string; alternateDate?: Date | null; alternateTime?: string | null; cancellationReason?: string | null; events?: Array<{ fromStatus: string | null; toStatus: string; note: string | null; createdAt: Date }> }) {
    return {
      ...this.viewingCard(v),
      message: v.message ?? null,
      timezone: v.timezone ?? null,
      alternateDate: v.alternateDate ?? null,
      alternateTime: v.alternateTime ?? null,
      cancellationReason: v.cancellationReason ?? null,
      timeline: (v.events ?? []).map((ev) => ({ from: ev.fromStatus, to: ev.toStatus, note: ev.note, at: ev.createdAt })),
    };
  }
}
