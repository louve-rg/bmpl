import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createVendorProfileSchema,
  imageConfirmSchema,
  imagePresignSchema,
  updateVendorLocationSchema,
  updateVendorProfileSchema,
  vendorHoursSchema,
  vendorLocationSchema,
  vendorSettingsSchema,
  type CreateVendorProfileInput,
  type ImageConfirmInput,
  type ImagePresignInput,
  type UpdateVendorProfileInput,
  type VendorHoursInput,
  type VendorLocationInput,
  type VendorSettingsInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { rawBody, uploadFileName } from '../common/raw-upload';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { VendorService } from './vendor.service';

/**
 * Vendor-owner storefront management. `@Roles('VENDOR')` (global RolesGuard)
 * requires an APPROVED VENDOR role; every action is implicitly scoped to the
 * caller's own profile (resolved by userId) so cross-vendor access is impossible.
 */
@Roles('VENDOR')
@Controller('vendor')
export class VendorController {
  constructor(private readonly vendor: VendorService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get('profile')
  getOwn(@CurrentUser() user: AuthContext) {
    return this.vendor.getOwn(user.userId);
  }

  /** Owner preview of their own storefront (any approval status). */
  @Get('profile/preview')
  preview(@CurrentUser() user: AuthContext) {
    return this.vendor.previewOwn(user.userId);
  }

  @Post('profile')
  create(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(createVendorProfileSchema)) body: CreateVendorProfileInput,
  ) {
    return this.vendor.create(user.userId, body);
  }

  @Patch('profile')
  update(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(updateVendorProfileSchema)) body: UpdateVendorProfileInput,
  ) {
    return this.vendor.update(user.userId, body);
  }

  @Post('profile/submit')
  submit(@CurrentUser() user: AuthContext, @Req() req: Request) {
    return this.vendor.submit(this.actor(user, req));
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(vendorSettingsSchema)) body: VendorSettingsInput,
  ) {
    return this.vendor.updateSettings(user.userId, body);
  }

  // ---- Locations ----
  @Post('profile/locations')
  addLocation(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(vendorLocationSchema)) body: VendorLocationInput,
  ) {
    return this.vendor.addLocation(user.userId, body);
  }

  @Patch('profile/locations/:id')
  updateLocation(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body(ZodBody(updateVendorLocationSchema)) body: Partial<VendorLocationInput>,
  ) {
    return this.vendor.updateLocation(user.userId, id, body);
  }

  @Delete('profile/locations/:id')
  deleteLocation(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.vendor.deleteLocation(user.userId, id);
  }

  // ---- Opening hours (replace-all) ----
  @Put('profile/hours')
  setHours(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(vendorHoursSchema)) body: VendorHoursInput,
  ) {
    return this.vendor.setHours(user.userId, body);
  }

  // ---- Logo / banner (public bucket) ----
  /** Server-side logo/banner upload: raw bytes in, storage key out. */
  @StrictThrottle()
  @Post('profile/logo/upload')
  uploadLogo(@CurrentUser() user: AuthContext, @Req() req: Request) {
    return this.vendor.uploadImage(user.userId, 'logo', rawBody(req), uploadFileName(req));
  }

  @StrictThrottle()
  @Post('profile/banner/upload')
  uploadBanner(@CurrentUser() user: AuthContext, @Req() req: Request) {
    return this.vendor.uploadImage(user.userId, 'banner', rawBody(req), uploadFileName(req));
  }

  @StrictThrottle()
  @Post('profile/logo/presign')
  presignLogo(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(imagePresignSchema)) body: ImagePresignInput,
  ) {
    return this.vendor.presignImage(user.userId, 'logo', body.fileName, body.contentType);
  }

  @Post('profile/logo/confirm')
  confirmLogo(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(imageConfirmSchema)) body: ImageConfirmInput,
  ) {
    return this.vendor.confirmImage(user.userId, 'logo', body.key);
  }

  @StrictThrottle()
  @Post('profile/banner/presign')
  presignBanner(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(imagePresignSchema)) body: ImagePresignInput,
  ) {
    return this.vendor.presignImage(user.userId, 'banner', body.fileName, body.contentType);
  }

  @Post('profile/banner/confirm')
  confirmBanner(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(imageConfirmSchema)) body: ImageConfirmInput,
  ) {
    return this.vendor.confirmImage(user.userId, 'banner', body.key);
  }
}
