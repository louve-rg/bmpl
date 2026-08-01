import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createSupportConversationSchema,
  imagePresignSchema,
  sendMessageSchema,
  type CreateSupportConversationInput,
  type ImagePresignInput,
  type SendMessageInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { MessagingService, type Actor } from './messaging.service';

/**
 * Context-scoped conversations for customers, vendors, and drivers. No arbitrary
 * user-to-user chat — every conversation is opened against a business context the
 * caller has a live relationship to. Any authenticated user may reach these routes;
 * access to a specific conversation is authorized per-context in the service.
 */
@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  private actor(user: AuthContext, req: Request): Actor {
    return { userId: user.userId, permissions: user.permissions, status: user.status, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  list(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.messaging.listForUser(this.actor(u, req));
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.messaging.unreadCount(this.actor(u, req));
  }

  @StrictThrottle()
  @Post('attachments/presign')
  presign(@CurrentUser() u: AuthContext, @Body(ZodBody(imagePresignSchema)) b: ImagePresignInput) {
    return this.messaging.presignAttachment(u.userId, b.fileName, b.contentType);
  }

  @Post('vendor-order/:id')
  openVendorOrder(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.messaging.openVendorOrder(this.actor(u, req), id);
  }

  @Post('delivery/:id')
  openDelivery(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Query('with') withParty?: string) {
    return this.messaging.openDelivery(this.actor(u, req), id, withParty);
  }

  @Post('support')
  openSupport(@CurrentUser() u: AuthContext, @Req() req: Request, @Body(ZodBody(createSupportConversationSchema)) b: CreateSupportConversationInput) {
    return this.messaging.openSupport(this.actor(u, req), b);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.messaging.getConversation(this.actor(u, req), id);
  }

  @StrictThrottle()
  @Post(':id/messages')
  send(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(sendMessageSchema)) b: SendMessageInput) {
    return this.messaging.sendMessage(this.actor(u, req), id, b);
  }

  @Post(':id/read')
  read(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.messaging.markRead(this.actor(u, req), id);
  }

  @Post(':id/close')
  close(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.messaging.close(this.actor(u, req), id);
  }

  @Post(':id/reopen')
  reopen(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.messaging.reopen(this.actor(u, req), id);
  }
}
