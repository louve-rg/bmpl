import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  passengerBookingCancelSchema,
  passengerBookingCreateSchema,
  type PassengerBookingCancelInput,
  type PassengerBookingCreateInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { PassengerOperationsService } from './passenger-operations.service';

/**
 * The rider's side of passenger transport: discover what services run, browse
 * published departures on their side of the simulation boundary, request
 * seats, and manage their own bookings. Every query is self-scoped on userId;
 * the fare gate refuses a booking on any service whose operator has not
 * published a fare.
 */
@Roles('CUSTOMER')
@Controller('passenger')
export class PassengerRiderController {
  constructor(private readonly ops: PassengerOperationsService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get('services')
  listServices(@CurrentUser() u: AuthContext) {
    return this.ops.listServices(u.userId);
  }

  @Get('departures')
  listDepartures(@CurrentUser() u: AuthContext) {
    return this.ops.listDepartures(u.userId);
  }

  @Get('departures/:id')
  getDeparture(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.ops.getDeparture(u.userId, id);
  }

  @Post('bookings')
  createBooking(@CurrentUser() u: AuthContext, @Req() req: Request, @Body(ZodBody(passengerBookingCreateSchema)) body: PassengerBookingCreateInput) {
    return this.ops.createBooking(this.actor(u, req), body);
  }

  @Get('bookings')
  listBookings(@CurrentUser() u: AuthContext) {
    return this.ops.listOwnBookings(u.userId);
  }

  @Post('bookings/:id/cancel')
  cancelBooking(
    @CurrentUser() u: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(passengerBookingCancelSchema)) body: PassengerBookingCancelInput,
  ) {
    return this.ops.cancelOwnBooking(this.actor(u, req), id, body.reason);
  }
}
