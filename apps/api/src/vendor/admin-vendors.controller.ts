import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { moderationDecisionSchema, type ModerationDecision, testModeSchema, type TestModeInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { VendorService } from './vendor.service';

/** Admin vendor moderation. Reads need `vendors.read`; decisions `vendors.moderate`. */
@Controller('admin/vendors')
export class AdminVendorsController {
  constructor(private readonly vendor: VendorService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  @RequirePermission('vendors.read')
  list(@Query('status') status?: string) {
    return this.vendor.adminList(status);
  }

  @Get(':id')
  @RequirePermission('vendors.read')
  get(@Param('id') id: string) {
    return this.vendor.adminGet(id);
  }

  /**
   * Mark a storefront as a SIMULATION store, or back to a real one.
   *
   * This is the root of test isolation: checkout derives an order's `isTest`
   * from the storefront, so flagging a store here is what makes rehearsal orders
   * possible at all — and what keeps a customer from ever producing one, since
   * the flag exists nowhere in the checkout request.
   */
  @Patch(':id/test-mode')
  @RequirePermission('vendors.moderate')
  setTestMode(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(testModeSchema)) body: TestModeInput,
  ) {
    return this.vendor.setTestMode(this.actor(user, req), id, body.isTest, body.reason);
  }

  @Post(':id/approve')
  @RequirePermission('vendors.moderate')
  approve(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(moderationDecisionSchema)) body: ModerationDecision,
  ) {
    return this.vendor.moderate(this.actor(user, req), id, 'approve', body.note);
  }

  @Post(':id/reject')
  @RequirePermission('vendors.moderate')
  reject(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(moderationDecisionSchema)) body: ModerationDecision,
  ) {
    return this.vendor.moderate(this.actor(user, req), id, 'reject', body.note);
  }

  @Post(':id/suspend')
  @RequirePermission('vendors.moderate')
  suspend(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(moderationDecisionSchema)) body: ModerationDecision,
  ) {
    return this.vendor.moderate(this.actor(user, req), id, 'suspend', body.note);
  }

  @Post(':id/restore')
  @RequirePermission('vendors.moderate')
  restore(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(moderationDecisionSchema)) body: ModerationDecision,
  ) {
    return this.vendor.moderate(this.actor(user, req), id, 'restore', body.note);
  }
}
