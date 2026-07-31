import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  driverAvailabilitySchema,
  driverProfileSchema,
  driverProfileUpdateSchema,
  driverServiceAreasSchema,
  driverVehicleSchema,
  driverVehicleUpdateSchema,
  imagePresignSchema,
  type DriverAvailabilityInput,
  type DriverProfileInput,
  type DriverProfileUpdateInput,
  type DriverServiceAreasInput,
  type DriverVehicleInput,
  type DriverVehicleUpdateInput,
  type ImagePresignInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { DriverService } from './driver.service';

/**
 * Driver-owner endpoints. Gated to CUSTOMER (every user holds it) so an APPLICANT
 * can build their profile + view their dashboard/status before approval. Sensitive
 * actions (going ONLINE) are gated by eligibility in the service, not the role.
 */
@Roles('CUSTOMER')
@Controller('driver')
export class DriverController {
  constructor(private readonly driver: DriverService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get('dashboard')
  dashboard(@CurrentUser() u: AuthContext) {
    return this.driver.dashboard(u.userId);
  }

  @Get('profile')
  getProfile(@CurrentUser() u: AuthContext) {
    return this.driver.getProfile(u.userId);
  }

  @Put('profile')
  upsertProfile(@CurrentUser() u: AuthContext, @Body(ZodBody(driverProfileSchema)) body: DriverProfileInput) {
    return this.driver.upsertProfile(u.userId, body);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() u: AuthContext, @Body(ZodBody(driverProfileUpdateSchema)) body: DriverProfileUpdateInput) {
    return this.driver.updateProfile(u.userId, body);
  }

  @StrictThrottle()
  @Post('profile/photo/presign')
  presignPhoto(@CurrentUser() u: AuthContext, @Body(ZodBody(imagePresignSchema)) body: ImagePresignInput) {
    return this.driver.presignProfilePhoto(u.userId, body.fileName, body.contentType);
  }

  @Get('profile/photo')
  photoUrl(@CurrentUser() u: AuthContext) {
    return this.driver.profilePhotoUrl(u.userId);
  }

  @Get('vehicles')
  listVehicles(@CurrentUser() u: AuthContext) {
    return this.driver.listVehicles(u.userId);
  }

  @Post('vehicles')
  createVehicle(@CurrentUser() u: AuthContext, @Body(ZodBody(driverVehicleSchema)) body: DriverVehicleInput) {
    return this.driver.createVehicle(u.userId, body);
  }

  @Patch('vehicles/:id')
  updateVehicle(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(driverVehicleUpdateSchema)) body: DriverVehicleUpdateInput) {
    return this.driver.updateVehicle(u.userId, id, body);
  }

  @Delete('vehicles/:id')
  deleteVehicle(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.driver.deleteVehicle(u.userId, id);
  }

  @StrictThrottle()
  @Post('vehicles/photo/presign')
  presignVehiclePhoto(@CurrentUser() u: AuthContext, @Body(ZodBody(imagePresignSchema)) body: ImagePresignInput) {
    return this.driver.presignVehiclePhoto(u.userId, body.fileName, body.contentType);
  }

  @Put('service-areas')
  setServiceAreas(@CurrentUser() u: AuthContext, @Body(ZodBody(driverServiceAreasSchema)) body: DriverServiceAreasInput) {
    return this.driver.setServiceAreas(u.userId, body);
  }

  @Patch('availability')
  setAvailability(@CurrentUser() u: AuthContext, @Req() req: Request, @Body(ZodBody(driverAvailabilitySchema)) body: DriverAvailabilityInput) {
    return this.driver.setAvailability(u.userId, body, this.actor(u, req));
  }
}
