import { Injectable, Logger } from '@nestjs/common';
import type { NotificationMessage } from '@bmpl/notifications';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPE_TO_CATEGORY,
  type NotificationCategory,
  type NotificationType,
} from '@bmpl/shared';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { DevMailboxService } from './dev-mailbox.service';

/** Common params for creating a notification event. */
interface NotifyParams {
  type: NotificationType;
  category?: NotificationCategory;
  event?: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

type RecipientWithEvent = Prisma.NotificationRecipientGetPayload<{ include: { notification: true } }>;

/**
 * Centralized notification engine (M16). A single funnel that every module uses:
 * it persists a Notification EVENT plus one NotificationRecipient per audience
 * member (fan-out), and owns read/unread + dismiss state and per-category channel
 * preferences. In-app is always stored; email/push are gated by preferences when
 * those channels are wired. Push/email transports register here without touching
 * callers.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly devMailbox: DevMailboxService,
  ) {}

  private resolveCategory(p: NotifyParams): NotificationCategory {
    return p.category ?? NOTIFICATION_TYPE_TO_CATEGORY[p.type] ?? 'SYSTEM';
  }

  /**
   * Create an in-app notification for a SINGLE user (back-compatible signature —
   * all existing callers pass { userId, type, title, body, data }). Optionally
   * within a transaction.
   */
  async createInApp(
    params: NotifyParams & { userId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.notifyUsers([params.userId], params, tx);
  }

  /**
   * Create ONE notification event delivered to MANY recipients (fan-out). De-dupes
   * userIds and ignores null/undefined. No-op when there are no recipients.
   */
  async notifyUsers(
    userIds: Array<string | null | undefined>,
    params: NotifyParams,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const unique = [...new Set(userIds.filter((u): u is string => !!u))];
    if (unique.length === 0) return;
    const client = tx ?? this.prisma;
    await client.notification.create({
      data: {
        type: params.type,
        category: this.resolveCategory(params),
        event: params.event ?? null,
        title: params.title,
        body: params.body,
        data: (params.data ?? undefined) as Prisma.InputJsonValue | undefined,
        recipients: { create: unique.map((userId) => ({ userId, channel: 'IN_APP' as const })) },
      },
    });
  }

  /**
   * Fan out an ADMIN alert to every user holding an admin permission (e.g.
   * `vendors.read` for vendor applications, `deliveries.read` for failed
   * deliveries). Category defaults to ADMIN_ALERT.
   */
  async notifyAdmins(
    permission: string,
    params: NotifyParams,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const grants = await client.adminPermissionGrant.findMany({ where: { permission }, select: { userId: true } });
    await this.notifyUsers(
      grants.map((g) => g.userId),
      { category: 'ADMIN_ALERT', ...params },
      tx,
    );
  }

  // ---- reads (recipient-scoped) -----------------------------------------

  /**
   * List the caller's notifications (newest first), excluding dismissed ones.
   * Cursor-paginated by recipient id. Filters by category and unread-only.
   */
  async listForUser(
    userId: string,
    opts: { category?: string; unreadOnly?: boolean; limit?: number; cursor?: string } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const where: Prisma.NotificationRecipientWhereInput = {
      userId,
      deletedAt: null,
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(opts.category && (NOTIFICATION_CATEGORIES as readonly string[]).includes(opts.category)
        ? { notification: { category: opts.category as NotificationCategory } }
        : {}),
    };
    const rows = await this.prisma.notificationRecipient.findMany({
      where,
      include: { notification: true },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return {
      items: items.map((r) => this.serialize(r)),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
      unreadCount: await this.unreadCount(userId),
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notificationRecipient.count({ where: { userId, readAt: null, deletedAt: null } });
  }

  /** Mark one of the caller's notifications read (scoped by userId — no-op otherwise). */
  async markRead(userId: string, recipientId: string): Promise<void> {
    await this.prisma.notificationRecipient.updateMany({
      where: { id: recipientId, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notificationRecipient.updateMany({
      where: { userId, readAt: null, deletedAt: null },
      data: { readAt: new Date() },
    });
  }

  /** Soft-dismiss one of the caller's notifications. */
  async remove(userId: string, recipientId: string): Promise<void> {
    await this.prisma.notificationRecipient.updateMany({
      where: { id: recipientId, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  private serialize(r: RecipientWithEvent) {
    return {
      id: r.id, // recipient id — the handle for read/delete
      notificationId: r.notificationId,
      type: r.notification.type,
      category: r.notification.category,
      event: r.notification.event,
      title: r.notification.title,
      body: r.notification.body,
      data: r.notification.data,
      read: r.readAt != null,
      readAt: r.readAt,
      createdAt: r.createdAt,
    };
  }

  // ---- preferences -------------------------------------------------------

  /** All categories with the user's stored preference merged over the defaults. */
  async getPreferences(userId: string) {
    const stored = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const byCategory = new Map(stored.map((p) => [p.category, p]));
    return NOTIFICATION_CATEGORIES.map((category) => {
      const p = byCategory.get(category);
      return { category, inApp: p?.inApp ?? true, email: p?.email ?? false, push: p?.push ?? false };
    });
  }

  async setPreference(userId: string, category: NotificationCategory, prefs: { inApp?: boolean; email?: boolean; push?: boolean }) {
    await this.prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category } },
      create: { userId, category, inApp: prefs.inApp ?? true, email: prefs.email ?? false, push: prefs.push ?? false },
      update: {
        ...(prefs.inApp !== undefined ? { inApp: prefs.inApp } : {}),
        ...(prefs.email !== undefined ? { email: prefs.email } : {}),
        ...(prefs.push !== undefined ? { push: prefs.push } : {}),
      },
    });
    return this.getPreferences(userId);
  }

  // ---- email (unchanged; future channel) --------------------------------

  /**
   * Send an out-of-band email. Returns whether delivery was accepted (never
   * throws). The dev mailbox only records on success and only outside production.
   */
  async sendEmail(message: NotificationMessage, email: string | null): Promise<boolean> {
    if (!email) return false;
    const delivered = await this.email.send({ to: email, subject: message.title, body: message.body });
    if (delivered) {
      this.devMailbox.record({ to: email, subject: message.title, body: message.body, createdAt: new Date().toISOString() });
    } else {
      this.logger.error(`Email not delivered to ${email} (subject="${message.title}")`);
    }
    return delivered;
  }
}
