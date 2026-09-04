import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  adminPassengerRouteSchema,
  passengerBookingCancelSchema,
  passengerRouteStopsSchema,
  passengerRouteUpdateSchema,
  passengerTripAssignSchema,
  passengerTripCancelSchema,
  passengerTripCreateSchema,
  type AdminPassengerRouteInput,
  type PassengerBookingCancelInput,
  type PassengerRouteStopsInput,
  type PassengerRouteUpdateInput,
  type PassengerTripAssignInput,
  type PassengerTripCancelInput,
  type PassengerTripCreateInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { PassengerNetworkService } from './passenger-network.service';
import { PassengerOperationsService } from './passenger-operations.service';

/**
 * Ops oversight of the passenger network: every operator's routes and
 * departures, plus the ability to act on any of them — the vendors-and-products
 * model, where owners self-serve and admin reaches across all owners. Reads sit
 * behind passengers.read; mutations behind passengers.moderate, the same split
 * as the rest of the passenger domain. An admin-created route still BELONGS to
 * the operator named in the request, and inherits that operator's side of the
 * simulation boundary — admin authorship changes who typed it in, not whose
 * service it is.
 */
@Controller('admin/passengers')
export class AdminPassengerNetworkController {
  constructor(
    private readonly network: PassengerNetworkService,
    private readonly ops: PassengerOperationsService,
  ) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get('routes')
  @RequirePermission('passengers.read')
  listRoutes(@Query('isTest') isTest?: string) {
    return this.network.listAllRoutes({ isTest: isTest === undefined ? undefined : isTest === 'true' });
  }

  @Get('routes/:id')
  @RequirePermission('passengers.read')
  getRoute(@Param('id') id: string) {
    return this.network.getRouteAdmin(id);
  }

  @Post('routes')
  @RequirePermission('passengers.moderate')
  createRoute(@CurrentUser() u: AuthContext, @Req() req: Request, @Body(ZodBody(adminPassengerRouteSchema)) body: AdminPassengerRouteInput) {
    return this.network.createRouteAdmin(this.actor(u, req), body);
  }

  @Patch('routes/:id')
  @RequirePermission('passengers.moderate')
  updateRoute(
    @CurrentUser() u: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(passengerRouteUpdateSchema)) body: PassengerRouteUpdateInput,
  ) {
    return this.network.updateRouteAdmin(this.actor(u, req), id, body);
  }

  @Put('routes/:id/stops')
  @RequirePermission('passengers.moderate')
  replaceStops(
    @CurrentUser() u: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(passengerRouteStopsSchema)) body: PassengerRouteStopsInput,
  ) {
    return this.network.replaceStopsAdmin(this.actor(u, req), id, body);
  }

  @Get('trips')
  @RequirePermission('passengers.read')
  listTrips(@Query('routeId') routeId?: string, @Query('status') status?: string) {
    return this.network.listAllTrips({ routeId, status });
  }

  @Post('trips')
  @RequirePermission('passengers.moderate')
  createTrip(@CurrentUser() u: AuthContext, @Req() req: Request, @Body(ZodBody(passengerTripCreateSchema)) body: PassengerTripCreateInput) {
    return this.network.createTripAdmin(this.actor(u, req), body);
  }

  @Post('trips/:id/cancel')
  @RequirePermission('passengers.moderate')
  cancelTrip(
    @CurrentUser() u: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(passengerTripCancelSchema)) body: PassengerTripCancelInput,
  ) {
    return this.network.cancelTripAdmin(this.actor(u, req), id, body.reason);
  }

  // ---- movement oversight (S3) ----

  @Get('bookings')
  @RequirePermission('passengers.read')
  listBookings(@Query('tripId') tripId?: string, @Query('status') status?: string) {
    return this.ops.listAllBookings({ tripId, status });
  }

  @Post('trips/:id/assign')
  @RequirePermission('passengers.moderate')
  assignTrip(
    @CurrentUser() u: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(passengerTripAssignSchema)) body: PassengerTripAssignInput,
  ) {
    return this.ops.assignTripAsAdmin(this.actor(u, req), id, body);
  }

  @Post('bookings/:id/confirm')
  @RequirePermission('passengers.moderate')
  confirmBooking(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.ops.confirmBookingAsAdmin(this.actor(u, req), id);
  }

  @Post('bookings/:id/cancel')
  @RequirePermission('passengers.moderate')
  cancelBooking(
    @CurrentUser() u: AuthContext,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ZodBody(passengerBookingCancelSchema)) body: PassengerBookingCancelInput,
  ) {
    return this.ops.cancelBookingAsAdmin(this.actor(u, req), id, body.reason);
  }
}
