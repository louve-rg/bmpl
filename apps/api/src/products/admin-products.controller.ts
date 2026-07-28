import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { moderationDecisionSchema, type ModerationDecision } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { ProductsService } from './products.service';

/** Admin product moderation. Reads need products.read; decisions products.moderate. */
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  @RequirePermission('products.read')
  list(@Query('status') status?: string) {
    return this.products.adminList(status);
  }

  @Get(':id')
  @RequirePermission('products.read')
  get(@Param('id') id: string) {
    return this.products.adminGet(id);
  }

  @Post(':id/approve')
  @RequirePermission('products.moderate')
  approve(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(moderationDecisionSchema)) b: ModerationDecision) {
    return this.products.moderate(this.actor(u, req), id, 'approve', b.note);
  }

  @Post(':id/reject')
  @RequirePermission('products.moderate')
  reject(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(moderationDecisionSchema)) b: ModerationDecision) {
    return this.products.moderate(this.actor(u, req), id, 'reject', b.note);
  }

  @Post(':id/suspend')
  @RequirePermission('products.moderate')
  suspend(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(moderationDecisionSchema)) b: ModerationDecision) {
    return this.products.moderate(this.actor(u, req), id, 'suspend', b.note);
  }

  @Post(':id/restore')
  @RequirePermission('products.moderate')
  restore(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(moderationDecisionSchema)) b: ModerationDecision) {
    return this.products.moderate(this.actor(u, req), id, 'restore', b.note);
  }
}
