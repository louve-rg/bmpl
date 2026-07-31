import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { vehicleModerationSchema, type VehicleModerationInput } from '@bmpl/validation';
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
