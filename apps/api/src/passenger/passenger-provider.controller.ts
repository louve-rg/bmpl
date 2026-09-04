import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  passengerProviderProfileSchema,
  passengerProviderProfileUpdateSchema,
  passengerVehicleSchema,
  passengerVehicleUpdateSchema,
  type PassengerProviderProfileInput,
  type PassengerProviderProfileUpdateInput,
  type PassengerVehicleInput,
  type PassengerVehicleUpdateInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { PassengerProviderService } from './passenger-provider.service';

/**
 * Fleet-operator self-service: the profile behind PASSENGER_PROVIDER and the
 * fleet's vehicles. CUSTOMER-gated for the same applicant reason as the driver
 * surface; anything operational is gated downstream by role approval and
 * vehicle moderation, not here.
 */
@Roles('CUSTOMER')
@Controller('passenger/provider')
export class PassengerProviderController {
  constructor(private readonly provider: PassengerProviderService) {}

  @Get('profile')
  getProfile(@CurrentUser() u: AuthContext) {
    return this.provider.getProfile(u.userId);
  }

  @Put('profile')
  upsertProfile(@CurrentUser() u: AuthContext, @Body(ZodBody(passengerProviderProfileSchema)) body: PassengerProviderProfileInput) {
    return this.provider.upsertProfile(u.userId, body);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() u: AuthContext, @Body(ZodBody(passengerProviderProfileUpdateSchema)) body: PassengerProviderProfileUpdateInput) {
    return this.provider.updateProfile(u.userId, body);
  }

  @Get('vehicles')
  listVehicles(@CurrentUser() u: AuthContext) {
    return this.provider.listVehicles(u.userId);
  }

  @Post('vehicles')
  createVehicle(@CurrentUser() u: AuthContext, @Body(ZodBody(passengerVehicleSchema)) body: PassengerVehicleInput) {
    return this.provider.createVehicle(u.userId, body);
  }

  @Patch('vehicles/:id')
  updateVehicle(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(passengerVehicleUpdateSchema)) body: PassengerVehicleUpdateInput) {
    return this.provider.updateVehicle(u.userId, id, body);
  }

  @Delete('vehicles/:id')
  deleteVehicle(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.provider.deleteVehicle(u.userId, id);
  }
}
