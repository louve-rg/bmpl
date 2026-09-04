import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  passengerAvailabilitySchema,
  passengerDriverProfileSchema,
  passengerDriverProfileUpdateSchema,
  passengerVehicleSchema,
  passengerVehicleUpdateSchema,
  type PassengerAvailabilityInput,
  type PassengerDriverProfileInput,
  type PassengerDriverProfileUpdateInput,
  type PassengerVehicleInput,
  type PassengerVehicleUpdateInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { PassengerDriverService } from './passenger-driver.service';

/**
 * Passenger-driver self-service. Gated to CUSTOMER (every user holds it) so an
 * APPLICANT can build their profile before the PASSENGER_DRIVER role is
 * approved — going ONLINE is gated by eligibility in the service, not by the
 * role guard, exactly as the delivery driver surface works.
 */
@Roles('CUSTOMER')
@Controller('passenger/driver')
export class PassengerDriverController {
  constructor(private readonly driver: PassengerDriverService) {}

  @Get('profile')
  getProfile(@CurrentUser() u: AuthContext) {
    return this.driver.getProfile(u.userId);
  }

  @Put('profile')
  upsertProfile(@CurrentUser() u: AuthContext, @Body(ZodBody(passengerDriverProfileSchema)) body: PassengerDriverProfileInput) {
    return this.driver.upsertProfile(u.userId, body);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() u: AuthContext, @Body(ZodBody(passengerDriverProfileUpdateSchema)) body: PassengerDriverProfileUpdateInput) {
    return this.driver.updateProfile(u.userId, body);
  }

  @Get('eligibility')
  eligibility(@CurrentUser() u: AuthContext) {
    return this.driver.eligibilityFor(u.userId);
  }

  @Get('vehicles')
  listVehicles(@CurrentUser() u: AuthContext) {
    return this.driver.listVehicles(u.userId);
  }

  @Post('vehicles')
  createVehicle(@CurrentUser() u: AuthContext, @Body(ZodBody(passengerVehicleSchema)) body: PassengerVehicleInput) {
    return this.driver.createVehicle(u.userId, body);
  }

  @Patch('vehicles/:id')
  updateVehicle(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(passengerVehicleUpdateSchema)) body: PassengerVehicleUpdateInput) {
    return this.driver.updateVehicle(u.userId, id, body);
  }

  @Delete('vehicles/:id')
  deleteVehicle(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.driver.deleteVehicle(u.userId, id);
  }

  @Patch('availability')
  setAvailability(@CurrentUser() u: AuthContext, @Body(ZodBody(passengerAvailabilitySchema)) body: PassengerAvailabilityInput) {
    return this.driver.setAvailability(u.userId, body);
  }
}
