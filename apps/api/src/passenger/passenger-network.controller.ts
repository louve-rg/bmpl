import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  passengerBookingCancelSchema,
  passengerRouteSchema,
  passengerRouteStopsSchema,
  passengerRouteUpdateSchema,
  passengerTripAssignSchema,
  passengerTripCancelSchema,
  passengerTripCreateSchema,
  type PassengerBookingCancelInput,
  type PassengerRouteInput,
  type PassengerRouteStopsInput,
  type PassengerRouteUpdateInput,
  type PassengerTripAssignInput,
  type PassengerTripCancelInput,
  type PassengerTripCreateInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { PassengerNetworkService } from './passenger-network.service';
import { PassengerOperationsService } from './passenger-operations.service';

/**
 * Operator self-service over their OWN routes and departures. Unlike the S1
 * application surface (CUSTOMER-gated: an applicant builds a profile before
 * approval), publishing a transport service is operational — it requires the
 * PASSENGER_PROVIDER role to actually be APPROVED. Every query underneath is
 * scoped to the caller's own provider profile, resolved from their userId.
 */
@Roles('PASSENGER_PROVIDER')
@Controller('passenger/provider')
export class PassengerNetworkController {
  constructor(
    private readonly network: PassengerNetworkService,
    private readonly ops: PassengerOperationsService,
  ) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get('routes')
  listRoutes(@CurrentUser() u: AuthContext) {
    return this.network.listRoutesForProvider(u.userId);
  }

  @Post('routes')
  createRoute(@CurrentUser() u: AuthContext, @Req() req: Request, @Body(ZodBody(passengerRouteSchema)) body: PassengerRouteInput) {
    return this.network.createRouteForProvider(this.actor(u, req), body);
  }

  @Get('routes/:id')
  getRoute(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.network.getRouteForProvider(u.userId, id);
  }

  @Patch('routes/:id')
  updateRoute(
    @CurrentUser() u: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(passengerRouteUpdateSchema)) body: PassengerRouteUpdateInput,
  ) {
    return this.network.updateRouteForProvider(this.actor(u, req), id, body);
  }

  @Put('routes/:id/stops')
  replaceStops(
    @CurrentUser() u: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(passengerRouteStopsSchema)) body: PassengerRouteStopsInput,
  ) {
    return this.network.replaceStopsForProvider(this.actor(u, req), id, body);
  }

  @Get('trips')
  listTrips(@CurrentUser() u: AuthContext, @Query('routeId') routeId?: string, @Query('status') status?: string) {
    return this.network.listTripsForProvider(u.userId, { routeId, status });
  }

  @Post('trips')
  createTrip(@CurrentUser() u: AuthContext, @Req() req: Request, @Body(ZodBody(passengerTripCreateSchema)) body: PassengerTripCreateInput) {
    return this.network.createTripForProvider(this.actor(u, req), body);
  }

  @Post('trips/:id/cancel')
  cancelTrip(
    @CurrentUser() u: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(passengerTripCancelSchema)) body: PassengerTripCancelInput,
  ) {
    return this.network.cancelTripForProvider(this.actor(u, req), id, body.reason);
  }

  // ---- movement (S3): staffing a departure and answering its riders ----

  @Post('trips/:id/assign')
  assignTrip(
    @CurrentUser() u: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(passengerTripAssignSchema)) body: PassengerTripAssignInput,
  ) {
    return this.ops.assignTripAsProvider(this.actor(u, req), id, body);
  }

  @Get('bookings')
  listBookings(@CurrentUser() u: AuthContext, @Query('tripId') tripId?: string, @Query('status') status?: string) {
    return this.ops.listProviderBookings(u.userId, { tripId, status });
  }

  @Post('bookings/:id/confirm')
  confirmBooking(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.ops.confirmBookingAsProvider(this.actor(u, req), id);
  }

  @Post('bookings/:id/cancel')
  cancelBooking(
    @CurrentUser() u: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(passengerBookingCancelSchema)) body: PassengerBookingCancelInput,
  ) {
    return this.ops.cancelBookingAsProvider(this.actor(u, req), id, body.reason);
  }
}
