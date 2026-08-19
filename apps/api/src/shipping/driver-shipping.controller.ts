import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { declineJobSchema, legHandoffSchema, type DeclineJobInput, type LegHandoffInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { ShipmentDriverService } from './shipment-driver.service';

/**
 * A driver working a shipment courier leg.
 *
 * A sibling of `/driver/jobs`, not a replacement: the LIST is unified (a driver
 * sees one queue), but the transitions stay on separate routes because they act
 * on separate records with separate guards. The driver app reads `jobKind` off
 * the job and posts to the matching family — which is the seam staying in the
 * backend where it belongs, rather than two state machines being fused into one
 * that is correct for neither.
 */
@Roles('DELIVERY_DRIVER')
@Controller('driver/shipping-jobs')
export class DriverShippingController {
  constructor(private readonly jobs: ShipmentDriverService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
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
    return this.jobs.decline(this.actor(u, req), id, b.reason);
  }

  /** The parcel is in the vehicle. Custody moves here. */
  @Post(':id/pickup')
  pickup(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.jobs.confirmPickup(this.actor(u, req), id);
  }

  @Post(':id/in-transit')
  inTransit(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.jobs.markInTransit(this.actor(u, req), id);
  }

  @Post(':id/arriving')
  arriving(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.jobs.markArriving(this.actor(u, req), id);
  }

  /** The end of the leg. Throttled: this is a code-verification endpoint. */
  @StrictThrottle()
  @Post(':id/handoff')
  handoff(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string, @Body(ZodBody(legHandoffSchema)) b: LegHandoffInput) {
    return this.jobs.completeHandoff(this.actor(u, req), id, b);
  }
}
