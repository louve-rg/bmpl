import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  driverAvailabilitySchema,
  driverProfileSchema,
  driverProfileUpdateSchema,
  driverServiceAreasSchema,
  driverServiceCitiesSchema,
  driverVehicleSchema,
  driverVehicleUpdateSchema,
  imagePresignSchema,
  type DriverAvailabilityInput,
  type DriverProfileInput,
  type DriverProfileUpdateInput,
  type DriverServiceAreasInput,
  type DriverServiceCitiesInput,
  type DriverVehicleInput,
  type DriverVehicleUpdateInput,
  type ImagePresignInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { rawBody, uploadFileName } from '../common/raw-upload';
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

  /** @deprecated Superseded by `profile/photo/upload` — see DriverService.presignProfilePhoto. */
  @StrictThrottle()
  @Post('profile/photo/presign')
  presignPhoto(@CurrentUser() u: AuthContext, @Body(ZodBody(imagePresignSchema)) body: ImagePresignInput) {
    return this.driver.presignProfilePhoto(u.userId, body.fileName, body.contentType);
  }

  /** Server-side profile-photo upload: raw bytes in, storage key out. */
  @StrictThrottle()
  @Post('profile/photo/upload')
  uploadPhoto(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.driver.uploadProfilePhoto(u.userId, rawBody(req), uploadFileName(req));
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

  /** @deprecated Superseded by `vehicles/photo/upload`. */
  @StrictThrottle()
  @Post('vehicles/photo/presign')
  presignVehiclePhoto(@CurrentUser() u: AuthContext, @Body(ZodBody(imagePresignSchema)) body: ImagePresignInput) {
    return this.driver.presignVehiclePhoto(u.userId, body.fileName, body.contentType);
  }

  /** Server-side vehicle-photo upload: raw bytes in, storage key out. */
  @StrictThrottle()
  @Post('vehicles/photo/upload')
  uploadVehiclePhoto(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.driver.uploadVehiclePhoto(u.userId, rawBody(req), uploadFileName(req));
  }

  @Put('service-areas')
  setServiceAreas(@CurrentUser() u: AuthContext, @Body(ZodBody(driverServiceAreasSchema)) body: DriverServiceAreasInput) {
    return this.driver.setServiceAreas(u.userId, body);
  }

  /** Narrow one already-served district to specific cities (empty list widens
   *  it back to the whole district). `:district` must be one of DISTRICTS —
   *  validated in the service, since it is a path param rather than a body. */
  @Put('service-areas/:district/cities')
  setServiceCities(
    @CurrentUser() u: AuthContext,
    @Param('district') district: string,
    @Body(ZodBody(driverServiceCitiesSchema)) body: DriverServiceCitiesInput,
  ) {
    return this.driver.setServiceCities(u.userId, district, body);
  }

  @Patch('availability')
  setAvailability(@CurrentUser() u: AuthContext, @Req() req: Request, @Body(ZodBody(driverAvailabilitySchema)) body: DriverAvailabilityInput) {
    return this.driver.setAvailability(u.userId, body, this.actor(u, req));
  }
}
