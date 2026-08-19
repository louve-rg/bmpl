import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  isAllowedMessageAttachmentMime,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  STORAGE_PREFIX,
  userInitials,
  type ConversationContext,
  type ConversationParticipantRole,
} from '@bmpl/shared';
import type { CreateSupportConversationInput, InternalNoteInput, SendMessageInput } from '@bmpl/validation';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadIngestService } from '../storage/upload-ingest.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AVATAR_SELECT, publicAvatarUrl } from '../common/avatar-url';

export interface Actor {
  userId: string;
  permissions?: string[];
  status?: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/** The parties resolved from a business context + display labels. */
interface ContextParties {
  customerUserId?: string | null;
  vendorUserId?: string | null;
  currentDriverUserId?: string | null;
  // Belize Connect Jobs (M24) — employer↔applicant thread parties.
  employerUserId?: string | null;
  applicantUserId?: string | null;
  // Real Estate (M25) — lister↔enquirer thread parties.
  listerUserId?: string | null;
  enquirerUserId?: string | null;
  label: string;
  orderNumber?: string | null;
}

const CONV_INCLUDE = {
  participants: {
    include: { user: { select: { firstName: true, lastName: true, ...AVATAR_SELECT } } },
  },
} satisfies Prisma.ConversationInclude;
type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof CONV_INCLUDE }>;

/**
 * Everything a serialized message needs. The sender's picture rides along so a
 * thread shows who is talking — the two parties in an order conversation already
 * know each other's full names, so unlike public reviews these are not shortened.
 */
const MESSAGE_INCLUDE = {
  attachments: true,
  sender: { select: { firstName: true, lastName: true, ...AVATAR_SELECT } },
} satisfies Prisma.MessageInclude;
type MessageRow = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

/**
 * Scoped, context-bound conversations (M17). No arbitrary user-to-user chat: every
 * conversation is tied to a vendor-order, a delivery, or a support case, and access
 * is authorized against the caller's live relationship to that context. Driver SEND
 * access is checked dynamically against the delivery's CURRENT assigned driver, so a
 * reassigned driver keeps read/history but loses send access automatically.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: UploadIngestService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private isSupport(actor: Actor): boolean {
    return !!actor.permissions?.includes('support.read') || !!actor.permissions?.includes('support.respond');
  }
  private canRespondSupport(actor: Actor): boolean {
    return !!actor.permissions?.includes('support.respond');
  }

  // ===========================================================================
  // Context resolution
  // ===========================================================================
  private async resolveParties(contextType: ConversationContext, contextId: string): Promise<ContextParties> {
    if (contextType === 'VENDOR_ORDER') {
      const vo = await this.prisma.vendorOrder.findUnique({
        where: { id: contextId },
        include: { order: { select: { userId: true, orderNumber: true } }, vendorProfile: { select: { userId: true, businessName: true } } },
      });
      if (!vo) throw new NotFoundException('Order not found.');
      return { customerUserId: vo.order.userId, vendorUserId: vo.vendorProfile.userId, label: `Order ${vo.order.orderNumber} · ${vo.vendorProfile.businessName}`, orderNumber: vo.order.orderNumber };
    }
    if (contextType === 'DELIVERY') {
      const d = await this.prisma.orderDelivery.findUnique({
        where: { id: contextId },
        include: {
          assignedDriver: { select: { userId: true } },
          vendorOrder: { include: { order: { select: { userId: true, orderNumber: true } }, vendorProfile: { select: { userId: true, businessName: true } } } },
        },
      });
      if (!d) throw new NotFoundException('Delivery not found.');
      return {
        customerUserId: d.vendorOrder.order.userId,
        vendorUserId: d.vendorOrder.vendorProfile.userId,
        currentDriverUserId: d.assignedDriver?.userId ?? null,
        label: `Delivery · Order ${d.vendorOrder.order.orderNumber}`,
        orderNumber: d.vendorOrder.order.orderNumber,
      };
    }
    if (contextType === 'SHIPMENT_LEG') {
      const leg = await this.prisma.shipmentLeg.findUnique({
        where: { id: contextId },
        include: {
          assignedDriver: { select: { userId: true } },
          shipment: { select: { customerUserId: true, reference: true } },
        },
      });
      if (!leg) throw new NotFoundException('Job not found.');
      // No vendor: a shipment is between a sender and a recipient, and the
      // customer who booked it is the party the driver may need to reach.
      return {
        customerUserId: leg.shipment.customerUserId ?? undefined,
        currentDriverUserId: leg.assignedDriver?.userId ?? null,
        label: `Shipment ${leg.shipment.reference} · ${leg.kind === 'FIRST_MILE' ? 'collection' : 'delivery'}`,
      };
    }
    if (contextType === 'JOB_APPLICATION') {
      const app = await this.prisma.jobApplication.findUnique({
        where: { id: contextId },
        include: { job: { include: { employerProfile: { select: { userId: true, companyName: true } } } } },
      });
      if (!app) throw new NotFoundException('Application not found.');
      return { applicantUserId: app.applicantId, employerUserId: app.job.employerProfile.userId, label: `${app.jobTitleSnapshot} · ${app.companySnapshot}` };
    }
    if (contextType === 'PROPERTY_ENQUIRY') {
      const enq = await this.prisma.propertyEnquiry.findUnique({
        where: { id: contextId },
        include: { listing: { include: { ownerProfile: { select: { userId: true } }, agentProfile: { select: { userId: true } } } } },
      });
      if (!enq) throw new NotFoundException('Enquiry not found.');
      // The lister is the assigned agent when present, otherwise the owner.
      const listerUserId = enq.listing.agentProfile?.userId ?? enq.listing.ownerProfile.userId;
      return { enquirerUserId: enq.enquirerId, listerUserId, label: `Enquiry · ${enq.listing.title}` };
    }
    // SUPPORT_CASE / ORDER — parties are recorded as participants directly.
    return { label: 'Support' };
  }

  // ===========================================================================
  // Open / create conversations
  // ===========================================================================

  /** Customer↔Vendor conversation for a vendor-order. */
  async openVendorOrder(actor: Actor, vendorOrderId: string) {
    const parties = await this.resolveParties('VENDOR_ORDER', vendorOrderId);
    if (actor.userId !== parties.customerUserId && actor.userId !== parties.vendorUserId) {
      throw new NotFoundException('Order not found.');
    }
    const conv = await this.ensureConversation('VENDOR_ORDER', vendorOrderId, 'CUSTOMER_VENDOR', actor.userId, parties.label, [
      { userId: parties.customerUserId!, role: 'CUSTOMER' },
      { userId: parties.vendorUserId!, role: 'VENDOR' },
    ]);
    return this.getConversation(actor, conv.id);
  }

  /** Delivery conversation. The pairing is decided by the caller's relationship
   *  (customer→CUSTOMER_DRIVER, vendor→VENDOR_DRIVER); a driver picks via `withParty`. */
  async openDelivery(actor: Actor, deliveryId: string, withParty?: string) {
    const p = await this.resolveParties('DELIVERY', deliveryId);
    if (!p.currentDriverUserId) throw new BadRequestException('No driver is assigned to this delivery yet.');
    let pairing: 'CUSTOMER_DRIVER' | 'VENDOR_DRIVER';
    let members: Array<{ userId: string; role: ConversationParticipantRole }>;
    if (actor.userId === p.customerUserId) {
      pairing = 'CUSTOMER_DRIVER';
      members = [{ userId: p.customerUserId!, role: 'CUSTOMER' }, { userId: p.currentDriverUserId, role: 'DRIVER' }];
    } else if (actor.userId === p.vendorUserId) {
      pairing = 'VENDOR_DRIVER';
      members = [{ userId: p.vendorUserId!, role: 'VENDOR' }, { userId: p.currentDriverUserId, role: 'DRIVER' }];
    } else if (actor.userId === p.currentDriverUserId) {
      pairing = withParty === 'vendor' ? 'VENDOR_DRIVER' : 'CUSTOMER_DRIVER';
      const other = pairing === 'VENDOR_DRIVER' ? { userId: p.vendorUserId!, role: 'VENDOR' as const } : { userId: p.customerUserId!, role: 'CUSTOMER' as const };
      members = [other, { userId: p.currentDriverUserId, role: 'DRIVER' }];
    } else {
      throw new NotFoundException('Delivery not found.');
    }
    const conv = await this.ensureConversation('DELIVERY', deliveryId, pairing, actor.userId, p.label, members);
    return this.getConversation(actor, conv.id);
  }

  /** Open a support case for the caller, optionally linked to an order/delivery. */
  async openSupport(actor: Actor, dto: CreateSupportConversationInput) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot start conversations.');
    const contextId = randomUUID(); // each support case is distinct (multiple allowed)
    const conv = await this.ensureConversation('SUPPORT_CASE', contextId, 'USER_SUPPORT', actor.userId, dto.subject, [{ userId: actor.userId, role: 'CUSTOMER' }], dto.subject);
    // The opening message is the case body.
    await this.persistMessage(actor, conv.id, { body: dto.message }, 'USER');
    await this.audit.record({ action: 'CONVERSATION_CREATED', actorId: actor.userId, newValue: { conversationId: conv.id, contextType: 'SUPPORT_CASE', subject: dto.subject, relatedType: dto.relatedType ?? null, relatedId: dto.relatedId ?? null } });
    return this.getConversation(actor, conv.id);
  }

  /**
   * Open (or return) the employer↔applicant conversation for a job application
   * (M24). Only the applicant or the employer who owns the job may open it.
   */
  async openJobApplication(actor: Actor, applicationId: string) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot start conversations.');
    const p = await this.resolveParties('JOB_APPLICATION', applicationId);
    if (actor.userId !== p.applicantUserId && actor.userId !== p.employerUserId) throw new NotFoundException('Application not found.');
    const conv = await this.ensureConversation('JOB_APPLICATION', applicationId, 'EMPLOYER_APPLICANT', actor.userId, p.label, [
      { userId: p.applicantUserId!, role: 'APPLICANT' },
      { userId: p.employerUserId!, role: 'EMPLOYER' },
    ], p.label);
    return this.getConversation(actor, conv.id);
  }

  /**
   * Best-effort SYSTEM message on a job-application thread (M24). Creates/reconciles
   * the employer↔applicant conversation and posts an immutable system line. Called
   * from the applications pipeline after the transaction; never throws to the caller.
   */
  async postJobApplicationSystem(applicationId: string, applicantUserId: string, employerUserId: string, text: string): Promise<void> {
    try {
      const conv = await this.ensureConversation('JOB_APPLICATION', applicationId, 'EMPLOYER_APPLICANT', applicantUserId, text, [
        { userId: applicantUserId, role: 'APPLICANT' },
        { userId: employerUserId, role: 'EMPLOYER' },
      ]);
      await this.prisma.$transaction(async (tx) => {
        await tx.message.create({ data: { conversationId: conv.id, senderId: null, type: 'SYSTEM', body: text } });
        await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
      });
    } catch {
      // Messaging is a best-effort side-channel — a failure never blocks the pipeline.
    }
  }

  /**
   * Open (or return) the lister↔enquirer conversation for a property enquiry (M25).
   * Only the enquirer or the listing's owner/assigned agent may open it.
   */
  async openPropertyEnquiry(actor: Actor, enquiryId: string) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot start conversations.');
    const p = await this.resolveParties('PROPERTY_ENQUIRY', enquiryId);
    if (actor.userId !== p.enquirerUserId && actor.userId !== p.listerUserId) throw new NotFoundException('Enquiry not found.');
    const conv = await this.ensureConversation('PROPERTY_ENQUIRY', enquiryId, 'LISTER_ENQUIRER', actor.userId, p.label, [
      { userId: p.enquirerUserId!, role: 'ENQUIRER' },
      { userId: p.listerUserId!, role: 'LISTER' },
    ], p.label);
    return this.getConversation(actor, conv.id);
  }

  /**
   * Best-effort SYSTEM message on a property-enquiry thread (M25). Creates/reconciles
   * the lister↔enquirer conversation and posts an immutable system line. Called from the
   * enquiries pipeline; never throws to the caller.
   */
  async postPropertyEnquirySystem(enquiryId: string, listerUserId: string, enquirerUserId: string, text: string): Promise<void> {
    try {
      const conv = await this.ensureConversation('PROPERTY_ENQUIRY', enquiryId, 'LISTER_ENQUIRER', enquirerUserId, text, [
        { userId: enquirerUserId, role: 'ENQUIRER' },
        { userId: listerUserId, role: 'LISTER' },
      ]);
      await this.prisma.$transaction(async (tx) => {
        await tx.message.create({ data: { conversationId: conv.id, senderId: null, type: 'SYSTEM', body: text } });
        await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
      });
    } catch {
      // Messaging is a best-effort side-channel — a failure never blocks the pipeline.
    }
  }

  /** Idempotent conversation upsert + participant reconciliation. */
  private async ensureConversation(
    contextType: ConversationContext,
    contextId: string,
    pairing: string,
    createdById: string,
    label: string,
    members: Array<{ userId: string; role: ConversationParticipantRole }>,
    subject?: string,
  ) {
    const existing = await this.prisma.conversation.findUnique({ where: { contextType_contextId_pairing: { contextType, contextId, pairing } } });
    if (existing) {
      // Reconcile participants (e.g. a newly assigned driver joins an existing thread).
      for (const m of members) {
        await this.prisma.conversationParticipant.upsert({
          where: { conversationId_userId: { conversationId: existing.id, userId: m.userId } },
          create: { conversationId: existing.id, userId: m.userId, role: m.role, canSend: true },
          update: { canSend: true, leftAt: null },
        });
      }
      return existing;
    }
    const created = await this.prisma.conversation.create({
      data: {
        contextType,
        contextId,
        pairing,
        subject: subject ?? null,
        createdById,
        participants: { create: members.map((m) => ({ userId: m.userId, role: m.role })) },
        // Seed an immutable system message describing the context.
        messages: { create: { type: 'SYSTEM', body: `Conversation started — ${label}.` } },
        lastMessageAt: new Date(),
      },
    });
    if (contextType !== 'SUPPORT_CASE') {
      await this.audit.record({ action: 'CONVERSATION_CREATED', actorId: createdById, newValue: { conversationId: created.id, contextType, contextId, pairing } });
    }
    return created;
  }

  // ===========================================================================
  // Authorization
  // ===========================================================================

  /** Load a conversation the actor is allowed to READ, or 404. Returns access info. */
  private async authorize(actor: Actor, conversationId: string): Promise<{ conv: ConversationRow; role: ConversationParticipantRole | 'SUPPORT' | null; isSupport: boolean; parties: ContextParties }> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: CONV_INCLUDE });
    if (!conv) throw new NotFoundException('Conversation not found.');
    const parties = await this.resolveParties(conv.contextType, conv.contextId);
    const participant = conv.participants.find((p) => p.userId === actor.userId);
    const isSupport = this.isSupport(actor);
    // Relationship-based access (covers a current driver / customer / vendor even
    // before a participant row exists) — but ONLY if that role belongs to THIS
    // conversation's pairing, so a customer related to a delivery still cannot read
    // the vendor↔driver pickup thread. Support can read any conversation.
    const rawRelated =
      actor.userId === parties.currentDriverUserId ? 'DRIVER'
      : actor.userId === parties.customerUserId ? 'CUSTOMER'
      : actor.userId === parties.vendorUserId ? 'VENDOR'
      : actor.userId === parties.employerUserId ? 'EMPLOYER'
      : actor.userId === parties.applicantUserId ? 'APPLICANT'
      : actor.userId === parties.listerUserId ? 'LISTER'
      : actor.userId === parties.enquirerUserId ? 'ENQUIRER'
      : null;
    const pairingRoles = conv.pairing.split('_'); // e.g. CUSTOMER_DRIVER → [CUSTOMER, DRIVER]
    const relatedRole = rawRelated && pairingRoles.includes(rawRelated) ? rawRelated : null;
    if (!participant && !relatedRole && !isSupport) throw new NotFoundException('Conversation not found.');
    const role: ConversationParticipantRole | 'SUPPORT' | null = participant?.role ?? relatedRole ?? (isSupport ? 'SUPPORT' : null);
    return { conv, role, isSupport, parties };
  }

  /** Throw unless the actor may SEND right now (open + active relationship + not suspended). */
  private assertCanSend(actor: Actor, ctx: { conv: ConversationRow; role: ConversationParticipantRole | 'SUPPORT' | null; parties: ContextParties }) {
    if (ctx.conv.status === 'CLOSED') throw new ForbiddenException('This conversation is closed.');
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot send messages.');
    const { role, parties } = ctx;
    if (role === 'SUPPORT') {
      if (!this.canRespondSupport(actor)) throw new ForbiddenException('You cannot reply here.');
      return;
    }
    // Only the CURRENT driver may send. This applies to every context that HAS a
    // current driver — a delivery and a shipment courier leg both do. It was
    // originally written as `contextType === 'DELIVERY'`, which silently stopped
    // applying the moment shipment legs arrived: a driver who had handed the
    // parcel on could keep messaging the customer indefinitely. Keying on the
    // resolved party rather than on the context name is what stops the next new
    // context inheriting the same hole.
    const driverScoped = ctx.conv.contextType === 'DELIVERY' || ctx.conv.contextType === 'SHIPMENT_LEG';
    if (role === 'DRIVER' && driverScoped && actor.userId !== parties.currentDriverUserId) {
      throw new ForbiddenException(
        ctx.conv.contextType === 'SHIPMENT_LEG'
          ? 'You are no longer carrying this shipment.'
          : 'You are no longer assigned to this delivery.',
      );
    }
    if (!role) throw new ForbiddenException('You cannot send messages here.');
    const participant = ctx.conv.participants.find((p) => p.userId === actor.userId);
    if (participant && !participant.canSend) throw new ForbiddenException('You can no longer send messages here.');
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  async sendMessage(actor: Actor, conversationId: string, dto: SendMessageInput) {
    const ctx = await this.authorize(actor, conversationId);
    this.assertCanSend(actor, ctx);
    // Ensure the sender is a participant (a current driver/customer/vendor may not
    // have a row yet) so read state + isolation work.
    await this.ensureSelfParticipant(actor, ctx);
    await this.persistMessage(actor, conversationId, dto, 'USER');
    await this.notifyOthers(ctx, actor.userId, dto.attachmentKeys?.length ? 'attachment' : 'message');
    return this.getConversation(actor, conversationId);
  }

  /** Support/admin internal note — never visible to end users. */
  async addInternalNote(actor: Actor, conversationId: string, dto: InternalNoteInput) {
    if (!this.canRespondSupport(actor)) throw new ForbiddenException('Support permission required.');
    const ctx = await this.authorize(actor, conversationId);
    await this.ensureSupportParticipant(ctx.conv.id, actor.userId);
    await this.persistMessage(actor, conversationId, { body: dto.body }, 'INTERNAL_NOTE');
    await this.audit.record({ action: 'INTERNAL_NOTE_ADDED', actorId: actor.userId, newValue: { conversationId } });
    return this.getConversation(actor, conversationId);
  }

  private async persistMessage(actor: Actor, conversationId: string, dto: SendMessageInput, type: 'USER' | 'SYSTEM' | 'INTERNAL_NOTE') {
    const attachments = dto.attachmentKeys?.length ? await this.resolveAttachments(actor.userId, dto.attachmentKeys) : [];
    const message = await this.prisma.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: {
          conversationId,
          senderId: type === 'SYSTEM' ? null : actor.userId,
          type,
          body: dto.body,
          attachments: attachments.length ? { create: attachments } : undefined,
        },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
      // The sender has implicitly read up to their own message.
      await tx.conversationParticipant.updateMany({ where: { conversationId, userId: actor.userId }, data: { lastReadAt: new Date() } });
      return m;
    });
    if (type === 'USER') {
      await this.audit.record({ action: 'MESSAGE_SENT', actorId: actor.userId, newValue: { conversationId, messageId: message.id, attachments: attachments.length } });
      if (attachments.length) await this.audit.record({ action: 'MESSAGE_ATTACHMENT_ADDED', actorId: actor.userId, newValue: { conversationId, messageId: message.id, count: attachments.length } });
    }
    return message;
  }

  private async resolveAttachments(userId: string, keys: string[]) {
    const namespace = STORAGE_PREFIX.messageAttachment(userId);
    const out: Array<{ storageKey: string; mimeType: string; fileSizeBytes: number }> = [];
    for (const key of keys) {
      this.storage.assertKeyInNamespace(key, namespace);
      const meta = await this.storage.headObject(key, 'private');
      if (!meta) throw new BadRequestException('An uploaded attachment could not be found in storage.');
      if (!isAllowedMessageAttachmentMime(meta.contentType)) throw new BadRequestException('Unsupported attachment type.');
      if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_MESSAGE_ATTACHMENT_BYTES) throw new BadRequestException('An attachment exceeds the maximum allowed size.');
      out.push({ storageKey: key, mimeType: meta.contentType, fileSizeBytes: meta.sizeBytes });
    }
    return out;
  }

  /** Server-side message-attachment upload (browser → API → private storage). */
  async uploadAttachment(userId: string, buffer: Buffer | undefined, fileName?: string) {
    return this.ingest.document(buffer, STORAGE_PREFIX.messageAttachment(userId), 'private', {
      fileName,
      fallbackName: 'attachment',
    });
  }

  /** @deprecated Prefer {@link uploadAttachment} — the browser PUT is cross-origin and fails as "Load failed". */
  async presignAttachment(userId: string, fileName: string, contentType: string) {
    if (!isAllowedMessageAttachmentMime(contentType)) throw new BadRequestException('Use an image or PDF.');
    const key = this.storage.buildKey(STORAGE_PREFIX.messageAttachment(userId), fileName);
    return this.storage.presignUpload(key, contentType, 'private');
  }

  // ===========================================================================
  // Read state
  // ===========================================================================

  async markRead(actor: Actor, conversationId: string) {
    const ctx = await this.authorize(actor, conversationId);
    await this.ensureSelfParticipant(actor, ctx);
    const now = new Date();
    await this.prisma.conversationParticipant.updateMany({ where: { conversationId, userId: actor.userId }, data: { lastReadAt: now } });
    // Best-effort read receipt on the latest visible message.
    const last = await this.prisma.message.findFirst({ where: { conversationId, senderId: { not: actor.userId }, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (last) {
      await this.prisma.messageReadReceipt.upsert({ where: { messageId_userId: { messageId: last.id, userId: actor.userId } }, create: { messageId: last.id, userId: actor.userId, readAt: now }, update: { readAt: now } });
    }
    return { ok: true };
  }

  async unreadCount(actor: Actor) {
    const parts = await this.prisma.conversationParticipant.findMany({ where: { userId: actor.userId }, select: { conversationId: true, lastReadAt: true } });
    let total = 0;
    for (const p of parts) {
      total += await this.countUnread(p.conversationId, actor.userId, p.lastReadAt, this.isSupport(actor));
    }
    return { count: total };
  }

  private async countUnread(conversationId: string, userId: string, lastReadAt: Date | null, isSupport: boolean) {
    return this.prisma.message.count({
      where: {
        conversationId,
        senderId: { not: userId },
        deletedAt: null,
        ...(isSupport ? {} : { type: { not: 'INTERNAL_NOTE' } }),
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });
  }

  // ===========================================================================
  // Reads (list + detail)
  // ===========================================================================

  async listForUser(actor: Actor) {
    const parts = await this.prisma.conversationParticipant.findMany({
      where: { userId: actor.userId },
      include: { conversation: { include: CONV_INCLUDE } },
      orderBy: { conversation: { lastMessageAt: 'desc' } },
      take: 100,
    });
    const isSupport = this.isSupport(actor);
    return Promise.all(
      parts.map(async (p) => {
        const conv = p.conversation;
        const parties = await this.resolveParties(conv.contextType, conv.contextId);
        const last = await this.prisma.message.findFirst({ where: { conversationId: conv.id, deletedAt: null, ...(isSupport ? {} : { type: { not: 'INTERNAL_NOTE' } }) }, orderBy: { createdAt: 'desc' }, select: { body: true, type: true, createdAt: true } });
        return {
          id: conv.id,
          contextType: conv.contextType,
          pairing: conv.pairing,
          subject: conv.subject ?? parties.label,
          status: conv.status,
          contextLabel: parties.label,
          lastMessage: last ? { preview: last.type === 'SYSTEM' ? last.body : last.body.slice(0, 120), type: last.type, createdAt: last.createdAt } : null,
          lastMessageAt: conv.lastMessageAt,
          unreadCount: await this.countUnread(conv.id, actor.userId, p.lastReadAt, isSupport),
        };
      }),
    );
  }

  async getConversation(actor: Actor, conversationId: string) {
    const ctx = await this.authorize(actor, conversationId);
    const showInternal = ctx.isSupport;
    const messages = await this.prisma.message.findMany({
      where: { conversationId, ...(showInternal ? {} : { type: { not: 'INTERNAL_NOTE' } }) },
      orderBy: { createdAt: 'asc' },
      include: MESSAGE_INCLUDE,
      take: 500,
    });
    const serialized = await Promise.all(messages.map((m) => this.serializeMessage(m, actor.userId)));
    return {
      id: ctx.conv.id,
      contextType: ctx.conv.contextType,
      contextId: ctx.conv.contextId,
      pairing: ctx.conv.pairing,
      subject: ctx.conv.subject ?? ctx.parties.label,
      contextLabel: ctx.parties.label,
      status: ctx.conv.status,
      viewerRole: ctx.role,
      canSend: this.computeCanSend(actor, ctx),
      participants: ctx.conv.participants.map((p) => ({
        userId: p.userId,
        role: p.role,
        name: `${p.user.firstName} ${p.user.lastName}`,
        initials: userInitials(p.user.firstName, p.user.lastName),
        avatarUrl: publicAvatarUrl(p.user),
        canSend: p.canSend,
      })),
      messages: serialized,
    };
  }

  private computeCanSend(actor: Actor, ctx: { conv: ConversationRow; role: ConversationParticipantRole | 'SUPPORT' | null; parties: ContextParties }): boolean {
    try {
      this.assertCanSend(actor, ctx);
      return true;
    } catch {
      return false;
    }
  }

  private async serializeMessage(m: MessageRow, viewerId: string) {
    const attachments = await Promise.all(
      m.attachments.map(async (a) => {
        let url: string | null = null;
        try {
          url = (await this.storage.presignDownload(a.storageKey, 'private')).url;
        } catch {
          url = null;
        }
        return { id: a.id, mimeType: a.mimeType, fileName: a.fileName, fileSizeBytes: a.fileSizeBytes, scanStatus: a.scanStatus, url };
      }),
    );
    return {
      id: m.id,
      type: m.type,
      body: m.deletedAt ? '[message removed]' : m.body,
      deleted: !!m.deletedAt,
      senderId: m.senderId,
      senderName: m.sender ? `${m.sender.firstName} ${m.sender.lastName}` : null,
      senderInitials: m.sender ? userInitials(m.sender.firstName, m.sender.lastName) : null,
      senderAvatarUrl: m.sender ? publicAvatarUrl(m.sender) : null,
      isMine: m.senderId === viewerId,
      attachments,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
    };
  }

  // ===========================================================================
  // Close / reopen + support join
  // ===========================================================================

  async close(actor: Actor, conversationId: string) {
    const ctx = await this.authorize(actor, conversationId);
    if (!this.canRespondSupport(actor) && ctx.conv.createdById !== actor.userId) throw new ForbiddenException('You cannot close this conversation.');
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'CLOSED', closedAt: new Date(), closedById: actor.userId } });
    await this.persistMessage(actor, conversationId, { body: 'Conversation closed.' }, 'SYSTEM');
    await this.audit.record({ action: 'CONVERSATION_CLOSED', actorId: actor.userId, newValue: { conversationId } });
    return this.getConversation(actor, conversationId);
  }

  async reopen(actor: Actor, conversationId: string) {
    const ctx = await this.authorize(actor, conversationId);
    if (!this.canRespondSupport(actor) && ctx.conv.createdById !== actor.userId) throw new ForbiddenException('You cannot reopen this conversation.');
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'OPEN', closedAt: null, closedById: null } });
    await this.persistMessage(actor, conversationId, { body: 'Conversation reopened.' }, 'SYSTEM');
    await this.audit.record({ action: 'CONVERSATION_REOPENED', actorId: actor.userId, newValue: { conversationId } });
    return this.getConversation(actor, conversationId);
  }

  /** Support agent joins a support thread (requires support.respond). */
  async supportJoin(actor: Actor, conversationId: string) {
    if (!this.canRespondSupport(actor)) throw new ForbiddenException('Support permission required.');
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Conversation not found.');
    await this.ensureSupportParticipant(conversationId, actor.userId);
    await this.persistMessage(actor, conversationId, { body: 'Support joined the conversation.' }, 'SYSTEM');
    await this.audit.record({ action: 'SUPPORT_JOINED', actorId: actor.userId, newValue: { conversationId } });
    // Notify the case owner that support responded.
    if (conv.createdById && conv.createdById !== actor.userId) {
      await this.notifications.createInApp({ userId: conv.createdById, type: 'ACCOUNT', category: 'MESSAGE', event: 'SUPPORT_RESPONSE', title: 'Support joined', body: 'A support agent joined your conversation.', data: { conversationId } });
    }
    return this.getConversation(actor, conversationId);
  }

  // ===========================================================================
  // Admin / support lists
  // ===========================================================================

  async supportList(actor: Actor, filter: { status?: string } = {}) {
    if (!this.isSupport(actor)) throw new ForbiddenException('Support permission required.');
    const rows = await this.prisma.conversation.findMany({
      where: { contextType: 'SUPPORT_CASE', ...(filter.status === 'OPEN' || filter.status === 'CLOSED' ? { status: filter.status } : {}) },
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
      include: { createdBy: { select: { firstName: true, lastName: true, email: true } }, _count: { select: { messages: true } } },
    });
    return rows.map((c) => ({ id: c.id, subject: c.subject, status: c.status, requester: c.createdBy ? { name: `${c.createdBy.firstName} ${c.createdBy.lastName}`, email: c.createdBy.email } : null, messageCount: c._count.messages, lastMessageAt: c.lastMessageAt, createdAt: c.createdAt }));
  }

  // ===========================================================================
  // helpers
  // ===========================================================================

  /** Add the acting user as a participant if they reached the conversation via a
   *  live relationship (current driver / customer / vendor / support) without a row
   *  yet. Never re-enables a disabled (reassigned) participant. */
  private async ensureSelfParticipant(actor: Actor, ctx: { conv: ConversationRow; role: ConversationParticipantRole | 'SUPPORT' | null }) {
    if (!ctx.role) return;
    const role: ConversationParticipantRole = ctx.role === 'SUPPORT' ? 'SUPPORT' : ctx.role;
    await this.prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId: ctx.conv.id, userId: actor.userId } },
      create: { conversationId: ctx.conv.id, userId: actor.userId, role, canSend: true },
      update: {}, // preserve existing canSend/leftAt (e.g. reassignment state)
    });
  }

  private async ensureSupportParticipant(conversationId: string, userId: string) {
    await this.prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, role: 'SUPPORT', canSend: true },
      update: { role: 'SUPPORT', canSend: true, leftAt: null },
    });
  }

  private async notifyOthers(ctx: { conv: ConversationRow }, senderId: string, kind: 'message' | 'attachment') {
    const recipients = ctx.conv.participants.filter((p) => p.userId !== senderId).map((p) => p.userId);
    await this.notifications.notifyUsers(recipients, {
      type: 'MARKETPLACE',
      category: 'MESSAGE',
      event: kind === 'attachment' ? 'MESSAGE_ATTACHMENT' : 'MESSAGE_RECEIVED',
      title: 'New message',
      body: kind === 'attachment' ? 'You received a new message with an attachment.' : 'You received a new message.',
      data: { conversationId: ctx.conv.id },
    });
  }

  // ===========================================================================
  // Dispatch hook (best-effort; never throws) — SYSTEM messages + driver swap.
  // ===========================================================================
  /**
   * Open the customer↔driver and vendor↔driver threads for a delivery, so both
   * exist the moment a driver is assigned (M26.3 · Part 11).
   *
   * Previously a conversation only came into being when somebody navigated to it
   * and called openDelivery — which meant `onDeliveryEvent` had nothing to post
   * into, and a customer wanting to tell their driver "gate code is 4821" had to
   * discover the thread first. Assignment is the moment both parties become able
   * to need each other, so it is the moment the threads should exist.
   *
   * Reuses ensureConversation, which is already idempotent and already reconciles
   * participants when a driver is replaced — so a reassignment moves send rights
   * to the new driver without creating a second thread.
   *
   * Best-effort by design: messaging must never fail an assignment. A delivery
   * with no chat thread is a degraded experience; a delivery that failed to
   * assign because chat was unavailable is a broken one.
   */
  async ensureDeliveryThreads(deliveryId: string, driverUserId: string): Promise<void> {
    try {
      const parties = await this.resolveParties('DELIVERY', deliveryId);
      if (parties.customerUserId) {
        await this.ensureConversation('DELIVERY', deliveryId, 'CUSTOMER_DRIVER', driverUserId, parties.label, [
          { userId: parties.customerUserId, role: 'CUSTOMER' },
          { userId: driverUserId, role: 'DRIVER' },
        ]);
      }
      if (parties.vendorUserId) {
        await this.ensureConversation('DELIVERY', deliveryId, 'VENDOR_DRIVER', driverUserId, parties.label, [
          { userId: parties.vendorUserId, role: 'VENDOR' },
          { userId: driverUserId, role: 'DRIVER' },
        ]);
      }
    } catch (err) {
      this.logger.warn(`could not open delivery threads for ${deliveryId}: ${String(err)}`);
    }
  }

  /**
   * Open the one thread a courier leg needs, on acceptance.
   *
   * Deliberately ONE conversation, not two: there is no vendor in a shipment,
   * and the leg's own scope already decides which end of the journey this driver
   * is allowed to talk to. Best-effort, exactly as the delivery version is — a
   * leg with no chat thread is degraded, a leg that failed to accept because
   * chat was unavailable is broken.
   */
  async ensureShipmentLegThread(legId: string, driverUserId: string): Promise<void> {
    try {
      const parties = await this.resolveParties('SHIPMENT_LEG', legId);
      if (!parties.customerUserId) return;
      await this.ensureConversation('SHIPMENT_LEG', legId, 'CUSTOMER_DRIVER', driverUserId, parties.label, [
        { userId: parties.customerUserId, role: 'CUSTOMER' },
        { userId: driverUserId, role: 'DRIVER' },
      ]);
    } catch (err) {
      this.logger.warn(`could not open shipment leg thread for ${legId}: ${String(err)}`);
    }
  }

  async onDeliveryEvent(deliveryId: string, text: string, newDriverUserId?: string | null): Promise<void> {
    try {
      const convs = await this.prisma.conversation.findMany({ where: { contextType: 'DELIVERY', contextId: deliveryId }, select: { id: true } });
      for (const c of convs) {
        await this.prisma.message.create({ data: { conversationId: c.id, type: 'SYSTEM', body: text } });
        await this.prisma.conversation.update({ where: { id: c.id }, data: { lastMessageAt: new Date() } });
        // Disable send for any DRIVER participant who is no longer the current driver.
        if (newDriverUserId !== undefined) {
          await this.prisma.conversationParticipant.updateMany({
            where: { conversationId: c.id, role: 'DRIVER', ...(newDriverUserId ? { userId: { not: newDriverUserId } } : {}) },
            data: { canSend: false, leftAt: new Date() },
          });
        }
      }
    } catch {
      // messaging is non-critical to the delivery transaction
    }
  }
}
