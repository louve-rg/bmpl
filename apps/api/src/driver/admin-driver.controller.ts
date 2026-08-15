import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { testModeSchema, vehicleModerationSchema, type TestModeInput, type VehicleModerationInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { AdminDriverService } from './admin-driver.service';

/** Admin driver management (read + vehicle moderation). Role approval / more-info /
 *  suspend / restore / revoke reuse the existing admin role-application endpoints. */
@Controller('admin/drivers')
export class AdminDriverController {
  constructor(private readonly driver: AdminDriverService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  @RequirePermission('drivers.read')
  list(
    @Query('district') district?: string,
    @Query('availability') availability?: string,
    @Query('roleStatus') roleStatus?: string,
  ) {
    return this.driver.list({ district, availability, roleStatus });
  }

  @Get(':id')
  @RequirePermission('drivers.read')
  get(@Param('id') id: string) {
    return this.driver.get(id);
  }

  /**
   * Designate a driver profile as a SIMULATION driver, or return it to a real one.
   *
   * A test driver is offered ONLY simulation deliveries, and a real driver is
   * never offered one — the boundary is symmetric and enforced in
   * DriverService.assignmentEligibility, which every assignment path uses.
   */
  @Patch(':id/test-mode')
  @RequirePermission('drivers.moderate')
  setTestMode(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(testModeSchema)) body: TestModeInput,
  ) {
    return this.driver.setTestMode(this.actor(user, req), id, body.isTest, body.reason);
  }

  @Post('vehicles/:id/approve')
  @RequirePermission('drivers.moderate')
  approve(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(vehicleModerationSchema)) b: VehicleModerationInput) {
    return this.driver.moderateVehicle(this.actor(u, req), id, 'approve', b.reason);
  }

  @Post('vehicles/:id/reject')
  @RequirePermission('drivers.moderate')
  reject(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(vehicleModerationSchema)) b: VehicleModerationInput) {
    return this.driver.moderateVehicle(this.actor(u, req), id, 'reject', b.reason);
  }
}
