import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  passengerAffiliationDirectorySearchSchema,
  passengerAffiliationRequestSchema,
  type PassengerAffiliationDirectorySearchInput,
  type PassengerAffiliationRequestInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { PassengerAffiliationService } from './passenger-affiliation.service';

/**
 * The driver's half of fleet affiliation. APPROVED-role-gated like
 * the trips surface — joining a fleet is operational, not application data.
 * The driver can ASK (request) and can ANSWER an operator's ask (accept /
 * decline); the one thing no endpoint here can do is turn the driver's own
 * request into an active affiliation. That is the operator's consent to give.
 */
@Roles('PASSENGER_DRIVER')
@Controller('passenger/driver/affiliations')
export class PassengerDriverAffiliationsController {
  constructor(private readonly affiliations: PassengerAffiliationService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get()
  listMine(@CurrentUser() u: AuthContext, @Query('status') status?: string) {
    return this.affiliations.listForDriver(u.userId, status);
  }

  /**
   * Discovery — the front door onto `request` below. `q` is required (min 2
   * characters) so a driver cannot enumerate the whole operator roster with
   * an empty query; the result set is additionally capped in the service.
   */
  @Get('directory/providers')
  searchProviders(
    @CurrentUser() u: AuthContext,
    @Query(ZodBody(passengerAffiliationDirectorySearchSchema)) query: PassengerAffiliationDirectorySearchInput,
  ) {
    return this.affiliations.searchProvidersForDriver(u.userId, query.q);
  }

  @Post('request')
  request(@CurrentUser() u: AuthContext, @Req() req: Request, @Body(ZodBody(passengerAffiliationRequestSchema)) body: PassengerAffiliationRequestInput) {
    return this.affiliations.request(this.actor(u, req), body);
  }

  @Post(':id/accept')
  accept(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.affiliations.acceptAsDriver(this.actor(u, req), id);
  }

  @Post(':id/decline')
  decline(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.affiliations.decline(this.actor(u, req), id, 'DRIVER');
  }

  @Post(':id/withdraw')
  withdraw(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.affiliations.withdraw(this.actor(u, req), id, 'DRIVER');
  }

  @Post(':id/end')
  end(@CurrentUser() u: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.affiliations.end(this.actor(u, req), id, 'DRIVER');
  }
}
