import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  assignDeliverySchema,
  cancelDeliverySchema,
  reassignDeliverySchema,
  type AssignDeliveryInput,
  type CancelDeliveryInput,
  type ReassignDeliveryInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { DispatchService } from './dispatch.service';

/**
 * Admin dispatch console. Read (deliveries.read), assign/reassign
 * (deliveries.assign), cancel (deliveries.manage), PIN reveal (deliveries.verify),
 * proof (proof_of_delivery.read). NO automatic matching (preview never assigns).
 */
@Controller('admin/deliveries')
export class AdminDispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  @RequirePermission('deliveries.read')
  list(
    @Query('status') status?: string,
    @Query('district') district?: string,
    @Query('vendorProfileId') vendorProfileId?: string,
    @Query('unassigned') unassigned?: string,
  ) {
    return this.dispatch.list({ status, district, vendorProfileId, unassigned: unassigned === 'true' });
  }

  @Get(':id')
  @RequirePermission('deliveries.read')
  get(@Param('id') id: string) {
    return this.dispatch.get(id);
  }

  @Get(':id/timeline')
  @RequirePermission('deliveries.read')
  timeline(@Param('id') id: string) {
    return this.dispatch.timeline(id);
  }

  @Get(':id/history')
  @RequirePermission('deliveries.read')
  history(@Param('id') id: string) {
    return this.dispatch.history(id);
  }

  @Get(':id/eligible-drivers')
  @RequirePermission('deliveries.assign')
  eligibleDrivers(@Param('id') id: string) {
    return this.dispatch.eligibleDrivers(id);
  }

  @Get(':id/auto-assign-preview')
  @RequirePermission('deliveries.assign')
  autoAssignPreview(@Param('id') id: string) {
    return this.dispatch.autoAssignPreview(id);
  }

  @Get(':id/proof')
  @RequirePermission('proof_of_delivery.read')
  proof(@Param('id') id: string) {
    return this.dispatch.proof(id);
  }

  @Get(':id/pins')
  @RequirePermission('deliveries.verify')
  pins(@Param('id') id: string) {
    return this.dispatch.revealPins(id);
  }

  @Post(':id/assign')
  @RequirePermission('deliveries.assign')
  assign(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(assignDeliverySchema)) b: AssignDeliveryInput) {
    return this.dispatch.assign(this.actor(u, req), id, b);
  }

  @Post(':id/reassign')
  @RequirePermission('deliveries.assign')
  reassign(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(reassignDeliverySchema)) b: ReassignDeliveryInput) {
    return this.dispatch.reassign(this.actor(u, req), id, b);
  }

  @Post(':id/cancel')
  @RequirePermission('deliveries.manage')
  cancel(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(cancelDeliverySchema)) b: CancelDeliveryInput) {
    return this.dispatch.cancel(this.actor(u, req), id, b);
  }
}
