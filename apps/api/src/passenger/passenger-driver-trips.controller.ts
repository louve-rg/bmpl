import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { paginationSchema } from '@bmpl/validation';
import type { Pagination } from '@bmpl/validation';
import { CurrentUser, Roles } from '../common/decorators';
import { ZodBody } from '../common/zod-validation.pipe';
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
  listMine(
    @CurrentUser() u: AuthContext,
    @Query('status') status: string | undefined,
    @Query(ZodBody(paginationSchema)) pagination: Pagination,
  ) {
    return this.ops.listDriverTrips(u.userId, { status, page: pagination.page, pageSize: pagination.pageSize });
  }

  /**
   * Who is riding, and where to find them (MDF-548). Scoped to a trip the
   * caller is actually assigned to — `listDriverTripBookings` resolves the
   * driver profile from the token and filters through it, never trusting a
   * bare tripId for someone else's departure.
   */
  @Get(':id/bookings')
  listBookings(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.ops.listDriverTripBookings(u.userId, { tripId: id });
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
