import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { PassengerOperationsService } from './passenger-operations.service';

/**
 * The assigned driver's movement surface. Separate from the S1
 * profile/vehicle controller because that one is CUSTOMER-gated (an applicant
 * builds a profile before approval); actually MOVING people requires the
 * PASSENGER_DRIVER role to be APPROVED. EN_ROUTE_TO_PICKUP is deliberately
 * absent — that is the on-demand taxi state, and on-demand is a later slice.
 */
@Roles('PASSENGER_DRIVER')
@Controller('passenger/driver/trips')
export class PassengerDriverTripsController {
  constructor(private readonly ops: PassengerOperationsService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  listMine(@CurrentUser() u: AuthContext) {
    return this.ops.listDriverTrips(u.userId);
  }

  @Post(':id/start')
  start(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.ops.startTrip(this.actor(u, req), id);
  }

  @Post(':id/complete')
  complete(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.ops.completeTrip(this.actor(u, req), id);
  }
}
