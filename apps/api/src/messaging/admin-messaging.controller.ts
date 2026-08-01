import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { internalNoteSchema, sendMessageSchema, type InternalNoteInput, type SendMessageInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { MessagingService, type Actor } from './messaging.service';

/**
 * Admin/support console for support conversations. `support.read` lists/views;
 * `support.respond` joins, replies, adds internal notes, and closes/reopens.
 * Support agents get NO financial/account-admin powers here.
 */
@Controller('admin/support')
export class AdminMessagingController {
  constructor(private readonly messaging: MessagingService) {}

  private actor(user: AuthContext, req: Request): Actor {
    return { userId: user.userId, permissions: user.permissions, status: user.status, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  @RequirePermission('support.read')
  list(@CurrentUser() u: AuthContext, @Req() req: Request, @Query('status') status?: string) {
    return this.messaging.supportList(this.actor(u, req), { status });
  }

  @Get(':id')
  @RequirePermission('support.read')
  get(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.messaging.getConversation(this.actor(u, req), id);
  }

  @Post(':id/join')
  @RequirePermission('support.respond')
  join(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.messaging.supportJoin(this.actor(u, req), id);
  }

  @Post(':id/messages')
  @RequirePermission('support.respond')
  reply(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(sendMessageSchema)) b: SendMessageInput) {
    return this.messaging.sendMessage(this.actor(u, req), id, b);
  }

  @Post(':id/notes')
  @RequirePermission('support.respond')
  note(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(internalNoteSchema)) b: InternalNoteInput) {
    return this.messaging.addInternalNote(this.actor(u, req), id, b);
  }

  @Post(':id/close')
  @RequirePermission('support.respond')
  close(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.messaging.close(this.actor(u, req), id);
  }

  @Post(':id/reopen')
  @RequirePermission('support.respond')
  reopen(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.messaging.reopen(this.actor(u, req), id);
  }
}
