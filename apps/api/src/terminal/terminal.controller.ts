import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  acceptTerminalInviteSchema,
  addTerminalCompanyLocationSchema,
  createTerminalCompanySchema,
  inviteTerminalCompanyMemberSchema,
  type AcceptTerminalInviteInput,
  type AddTerminalCompanyLocationInput,
  type CreateTerminalCompanyInput,
  type InviteTerminalCompanyMemberInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Public, RequirePermission } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { TerminalService } from './terminal.service';

/** The admin console's side: create companies/locations, drive invites, end members. */
@Controller('admin/terminal')
export class AdminTerminalController {
  constructor(private readonly terminal: TerminalService) {}

  @RequirePermission('terminals.manage')
  @Post('companies')
  createCompany(@CurrentUser() u: AuthContext, @Body(ZodBody(createTerminalCompanySchema)) dto: CreateTerminalCompanyInput) {
    return this.terminal.createCompany(u.userId, dto);
  }

  @RequirePermission('terminals.read')
  @Get('companies')
  listCompanies() {
    return this.terminal.listCompanies();
  }

  @RequirePermission('terminals.read')
  @Get('companies/:id')
  getCompany(@Param('id') id: string) {
    return this.terminal.getCompany(id);
  }

  @RequirePermission('terminals.manage')
  @Post('companies/:id/locations')
  addLocation(
    @CurrentUser() u: AuthContext,
    @Param('id') id: string,
    @Body(ZodBody(addTerminalCompanyLocationSchema)) dto: AddTerminalCompanyLocationInput,
  ) {
    return this.terminal.addLocation(u.userId, id, dto);
  }

  @RequirePermission('terminals.manage')
  @Delete('companies/:id/locations/:locationId')
  removeLocation(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('locationId') locationId: string) {
    return this.terminal.removeLocation(u.userId, id, locationId);
  }

  @RequirePermission('terminals.manage')
  @Post('companies/:id/invites')
  inviteMember(
    @CurrentUser() u: AuthContext,
    @Param('id') id: string,
    @Body(ZodBody(inviteTerminalCompanyMemberSchema)) dto: InviteTerminalCompanyMemberInput,
  ) {
    return this.terminal.inviteMember(u.userId, id, dto);
  }

  @RequirePermission('terminals.manage')
  @Post('companies/:id/invites/:inviteId/revoke')
  revokeInvite(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('inviteId') inviteId: string) {
    return this.terminal.revokeInvite(u.userId, id, inviteId);
  }

  @RequirePermission('terminals.manage')
  @Delete('companies/:id/members/:userId')
  endMember(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('userId') userId: string) {
    return this.terminal.endMember(u.userId, id, userId);
  }
}

/**
 * Terminal staff's own side. Ordinary authentication only — no
 * `@RequirePermission`/`@Roles`: a terminal member holds neither an admin
 * permission nor a RoleCode for this (TERM-3's explicit ruling: the scoped
 * terminal role is its own thing, not retrofitted onto either axis). The
 * service itself is what returns nothing for someone with no active
 * membership.
 */
@Controller('terminal')
export class TerminalController {
  constructor(private readonly terminal: TerminalService) {}

  @Get('me')
  myWorkspace(@CurrentUser() u: AuthContext) {
    return this.terminal.myWorkspace(u.userId);
  }
}

/**
 * A SEPARATE controller from `TerminalController` above, same reason
 * `ShippingTrackController`/`ShippingDeliveryCodeController` are split from
 * their role-gated siblings: a route that really is public cannot live
 * inside a controller whose class carries an authenticated guard.
 */
@Public()
@Controller('terminal/invites')
export class TerminalInviteController {
  constructor(private readonly terminal: TerminalService) {}

  @StrictThrottle()
  @Post('accept')
  acceptInvite(@Body(ZodBody(acceptTerminalInviteSchema)) dto: AcceptTerminalInviteInput) {
    return this.terminal.acceptInvite(dto);
  }
}
