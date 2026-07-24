import { Injectable, Logger } from '@nestjs/common';
import type { NotificationMessage } from '@bmpl/notifications';
import type { NotificationType } from '@bmpl/shared';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { DevMailboxService } from './dev-mailbox.service';

/**
 * Notification foundation. Persists an in-app Notification row and dispatches
 * emails through the environment-selected EmailService (console/dev vs a cloud
 * provider). Push transports register here later without touching callers.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly devMailbox: DevMailboxService,
  ) {}

  /** Create an in-app notification (optionally within a transaction). */
  async createInApp(
    params: {
      userId: string;
      type: NotificationType;
      title: string;
      body: string;
      data?: Record<string, unknown>;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        channel: 'IN_APP',
        title: params.title,
        body: params.body,
        data: (params.data ?? undefined) as Prisma.InputJsonValue | undefined,
        sentAt: new Date(),
      },
    });
  }

  /**
   * Send an out-of-band email. Returns whether delivery was accepted (never
   * throws). The dev mailbox only records on success and only outside production,
   * so a failed send is not falsely reported as delivered.
   */
  async sendEmail(message: NotificationMessage, email: string | null): Promise<boolean> {
    if (!email) return false;
    const delivered = await this.email.send({
      to: email,
      subject: message.title,
      body: message.body,
    });
    if (delivered) {
      this.devMailbox.record({
        to: email,
        subject: message.title,
        body: message.body,
        createdAt: new Date().toISOString(),
      });
    } else {
      this.logger.error(`Email not delivered to ${email} (subject="${message.title}")`);
    }
    return delivered;
  }

  async listForUser(userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
