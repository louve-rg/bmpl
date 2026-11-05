import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { testModeSchema, vehicleModerationSchema, type TestModeInput, type VehicleModerationInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { AdminPassengerService } from './admin-passenger.service';
import { PassengerAffiliationService } from './passenger-affiliation.service';

/**
 * Admin passenger-supply management (read + vehicle moderation + the
 * admin-set-only simulation flags). Role approval / more-info / suspend /
 * restore / revoke reuse the existing admin role-application endpoints.
 * passengers.read / passengers.moderate mirror the delivery side's
 * drivers.read / drivers.moderate split.
 */
@Controller('admin/passengers')
export class AdminPassengerController {
  constructor(
    private readonly admin: AdminPassengerService,
    private readonly affiliations: PassengerAffiliationService,
  ) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get('drivers')
  @RequirePermission('passengers.read')
  listDrivers(
    @Query('district') district?: string,
    @Query('availability') availability?: string,
    @Query('roleStatus') roleStatus?: string,
  ) {
    return this.admin.listDrivers({ district, availability, roleStatus });
  }

  @Get('drivers/:id')
  @RequirePermission('passengers.read')
  getDriver(@Param('id') id: string) {
    return this.admin.getDriver(id);
  }

  @Get('providers')
  @RequirePermission('passengers.read')
  listProviders() {
    return this.admin.listProviders();
  }

  /**
   * MDF-553 gap 1: which driver is affiliated with which operator, PENDING
   * asks included, who initiated, and when it changed — not derivable from
   * `listDrivers`' current-membership pointer alone.
   */
  @Get('affiliations')
  @RequirePermission('passengers.read')
  listAffiliations(
    @Query('providerProfileId') providerProfileId?: string,
    @Query('driverProfileId') driverProfileId?: string,
    @Query('status') status?: string,
  ) {
    return this.affiliations.listForAdmin({ providerProfileId, driverProfileId, status });
  }

  @Patch('drivers/:id/test-mode')
  @RequirePermission('passengers.moderate')
  setDriverTestMode(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(testModeSchema)) b: TestModeInput) {
    return this.admin.setDriverTestMode(this.actor(u, req), id, b.isTest, b.reason);
  }

  @Patch('providers/:id/test-mode')
  @RequirePermission('passengers.moderate')
  setProviderTestMode(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(testModeSchema)) b: TestModeInput) {
    return this.admin.setProviderTestMode(this.actor(u, req), id, b.isTest, b.reason);
  }

  @Post('vehicles/:id/approve')
  @RequirePermission('passengers.moderate')
  approve(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(vehicleModerationSchema)) b: VehicleModerationInput) {
    return this.admin.moderateVehicle(this.actor(u, req), id, 'approve', b.reason);
  }

  @Post('vehicles/:id/reject')
  @RequirePermission('passengers.moderate')
  reject(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(vehicleModerationSchema)) b: VehicleModerationInput) {
    return this.admin.moderateVehicle(this.actor(u, req), id, 'reject', b.reason);
  }
}
