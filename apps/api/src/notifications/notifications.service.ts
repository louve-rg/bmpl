import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ConsoleChannelProvider,
  type ChannelProvider,
  type NotificationMessage,
} from '@bmpl/notifications';
import type { NotificationType } from '@bmpl/shared';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DevMailboxService } from './dev-mailbox.service';

/**
 * Notification foundation. Persists an in-app Notification row and dispatches to
 * registered channel providers. Phase 1 uses a console email provider; real
 * email/push transports register here without touching callers.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly emailProvider: ChannelProvider = new ConsoleChannelProvider('EMAIL');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
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

  /** Send an out-of-band email (dev: logged + captured). Never throws to the caller. */
  async sendEmail(message: NotificationMessage, email: string | null): Promise<void> {
    try {
      await this.emailProvider.send(message, { userId: message.userId, email });
      if (email) {
        this.devMailbox.record({
          to: email,
          subject: message.title,
          body: message.body,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      this.logger.error(`Email dispatch failed: ${String(err)}`);
    }
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
