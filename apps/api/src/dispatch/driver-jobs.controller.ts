import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  confirmDeliverySchema,
  confirmPickupSchema,
  declineJobSchema,
  imagePresignSchema,
  podConfirmSchema,
  type ConfirmDeliveryInput,
  type ConfirmPickupInput,
  type DeclineJobInput,
  type ImagePresignInput,
  type PodConfirmInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { rawBody, uploadFileName } from '../common/raw-upload';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { DriverJobService } from './driver-jobs.service';

/**
 * Driver job feed + operational transitions. Requires an APPROVED DELIVERY_DRIVER
 * role (RolesGuard) — a suspended/revoked driver is blocked by the guard, so they
 * can neither view nor act on jobs. A driver only ever sees their own assignments.
 */
@Roles('DELIVERY_DRIVER')
@Controller('driver/jobs')
export class DriverJobsController {
  constructor(private readonly jobs: DriverJobService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  list(@CurrentUser() u: AuthContext, @Query('scope') scope?: string) {
    return this.jobs.listJobs(u.userId, scope === 'completed' ? 'completed' : scope === 'all' ? 'all' : 'active');
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.jobs.getJob(u.userId, id);
  }

  @Post(':id/accept')
  accept(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.jobs.accept(this.actor(u, req), id);
  }

  @Post(':id/decline')
  decline(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(declineJobSchema)) b: DeclineJobInput) {
    return this.jobs.decline(this.actor(u, req), id, b);
  }

  @StrictThrottle()
  @Post(':id/confirm-pickup')
  confirmPickup(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(confirmPickupSchema)) b: ConfirmPickupInput) {
    return this.jobs.confirmPickup(this.actor(u, req), id, b);
  }

  @Post(':id/in-transit')
  inTransit(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.jobs.markInTransit(this.actor(u, req), id);
  }

  @Post(':id/arriving')
  arriving(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.jobs.markArriving(this.actor(u, req), id);
  }

  @StrictThrottle()
  @Post(':id/confirm-delivery')
  confirmDelivery(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(confirmDeliverySchema)) b: ConfirmDeliveryInput) {
    return this.jobs.confirmDelivery(this.actor(u, req), id, b);
  }

  @StrictThrottle()
  @Post(':id/pod/presign')
  presignPod(@CurrentUser() u: AuthContext, @Body(ZodBody(imagePresignSchema)) b: ImagePresignInput) {
    return this.jobs.presignPod(u.userId, b.fileName, b.contentType);
  }

  /** Server-side POD photo upload: raw bytes in, storage key out. */
  @StrictThrottle()
  @Post(':id/pod/upload')
  uploadPod(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.jobs.uploadPod(u.userId, rawBody(req), uploadFileName(req));
  }

  @Post(':id/pod/confirm')
  confirmPod(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(podConfirmSchema)) b: PodConfirmInput) {
    return this.jobs.confirmPod(this.actor(u, req), id, b);
  }
}
