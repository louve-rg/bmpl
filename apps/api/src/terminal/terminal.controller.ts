import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  acceptTerminalInviteSchema,
  addTerminalCompanyLocationSchema,
  collectShipmentSchema,
  createTerminalCompanySchema,
  grantTerminalCompanyMemberLocationSchema,
  inviteTerminalCompanyMemberSchema,
  legDepartSchema,
  legHandoffSchema,
  legReleaseToCourierSchema,
  updateTerminalCompanySchema,
  type AcceptTerminalInviteInput,
  type AddTerminalCompanyLocationInput,
  type CollectShipmentInput,
  type CreateTerminalCompanyInput,
  type GrantTerminalCompanyMemberLocationInput,
  type InviteTerminalCompanyMemberInput,
  type LegDepartInput,
  type LegHandoffInput,
  type LegReleaseToCourierInput,
  type UpdateTerminalCompanyInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Public, RequirePermission } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { ShipmentService } from '../shipping/shipment.service';
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

  /** TERM-6: slice 1 is not complete until a mistyped company name is
   *  correctable through the product — see TerminalService.updateCompany. */
  @RequirePermission('terminals.manage')
  @Patch('companies/:id')
  updateCompany(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(updateTerminalCompanySchema)) dto: UpdateTerminalCompanyInput) {
    return this.terminal.updateCompany(u.userId, id, dto);
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

  /** TERM-6: the direct door for an ended member — see
   *  TerminalService.reactivateMember for why it means the same thing
   *  re-inviting already did, and nothing more. */
  @RequirePermission('terminals.manage')
  @Post('companies/:id/members/:userId/reactivate')
  reactivateMember(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('userId') userId: string) {
    return this.terminal.reactivateMember(u.userId, id, userId);
  }

  /** TERM-6: grant/revoke one location for an already-ACTIVE member,
   *  without ending and re-inviting them. */
  @RequirePermission('terminals.manage')
  @Post('companies/:id/members/:userId/locations')
  grantMemberLocation(
    @CurrentUser() u: AuthContext,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body(ZodBody(grantTerminalCompanyMemberLocationSchema)) dto: GrantTerminalCompanyMemberLocationInput,
  ) {
    return this.terminal.grantMemberLocation(u.userId, id, userId, dto.locationId);
  }

  @RequirePermission('terminals.manage')
  @Delete('companies/:id/members/:userId/locations/:locationId')
  revokeMemberLocation(
    @CurrentUser() u: AuthContext,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.terminal.revokeMemberLocation(u.userId, id, userId, locationId);
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
  constructor(
    private readonly terminal: TerminalService,
    private readonly shipments: ShipmentService,
  ) {}

  @Get('me')
  myWorkspace(@CurrentUser() u: AuthContext) {
    return this.terminal.myWorkspace(u.userId);
  }

  /**
   * TERM-8: the work queue the owner found missing — everything waiting on
   * a terminal action at one of MY granted ACTIVE locations, across every
   * company I belong to. Scoped the same way `myWorkspace` is: re-read at
   * call time, never cached from grant time. `myActiveHubIds` is the ONLY
   * place that decides which hubs are mine; `ShipmentService.terminalQueue`
   * never sees a hub id this method did not hand it, so a leg at a location
   * I was not granted cannot appear in the list, not merely be refused if I
   * try to act on it.
   */
  @Get('queue')
  async queue(@CurrentUser() u: AuthContext) {
    const hubIds = await this.terminal.myActiveHubIds(u.userId);
    return this.shipments.terminalQueue(hubIds);
  }
}

/**
 * TERM-5: a terminal company's own staff submitting a courier's code —
 * the location-scoped alternative to `admin/logistics/legs/:id/handoff`
 * and `/release-to-courier` (`ShippingController`, `logistics.operate`,
 * unrestricted by location — BML's own ops staff, unchanged by this card).
 *
 * No `@RequirePermission`/`@Roles`, same reasoning as `TerminalController`
 * above: a terminal member holds neither axis. The ONE check that matters
 * is `TerminalService.assertStaffLocationAccess` against the SPECIFIC hub
 * this leg's handoff/pickup happens at — looked up from ShipmentService,
 * never assumed from the request. The underlying business logic (code
 * verification, custody, the lockout) is entirely ShipmentService's; this
 * controller adds authorization, nothing else.
 */
@Controller('terminal/legs')
export class TerminalLegsController {
  constructor(
    private readonly terminal: TerminalService,
    private readonly shipments: ShipmentService,
  ) {}

  @StrictThrottle()
  @Post(':id/handoff')
  async handoff(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(legHandoffSchema)) dto: LegHandoffInput) {
    const hubId = await this.shipments.legHubForLocationCheck(id, 'HANDOFF');
    await this.terminal.assertStaffLocationAccess(u.userId, hubId);
    return this.shipments.completeLeg(id, dto, { userId: u.userId });
  }

  @StrictThrottle()
  @Post(':id/release-to-courier')
  async releaseToCourier(
    @CurrentUser() u: AuthContext,
    @Param('id') id: string,
    @Body(ZodBody(legReleaseToCourierSchema)) dto: LegReleaseToCourierInput,
  ) {
    const hubId = await this.shipments.legHubForLocationCheck(id, 'RELEASE_TO_COURIER');
    await this.terminal.assertStaffLocationAccess(u.userId, hubId);
    return this.shipments.staffReleaseToCourier(id, dto, { userId: u.userId });
  }

  /**
   * TERM-8, part 1's first gap: departure from the origin terminal had no
   * terminal-scoped door at all. Mirrors `AdminLogisticsController.depart`
   * exactly (same schema, same service call) under the location-scoped gate
   * instead of `logistics.operate`. `departLeg` itself still refuses a
   * non-LINE_HAUL leg or one whose turn has not come — this controller adds
   * authorization only, never a second copy of that business logic.
   */
  @StrictThrottle()
  @Post(':id/depart')
  async depart(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(legDepartSchema)) dto: LegDepartInput) {
    const hubId = await this.shipments.legHubForLocationCheck(id, 'DEPART');
    await this.terminal.assertStaffLocationAccess(u.userId, hubId);
    return this.shipments.departLeg(id, dto, { userId: u.userId });
  }

  /**
   * TERM-8, part 1's second gap: arrival confirmation — distinct from
   * `handoff` above, same as `arriveLeg`'s own doc comment draws the line:
   * the leg has reached the far terminal but has not been handed over yet.
   */
  @StrictThrottle()
  @Post(':id/arrive')
  async arrive(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    const hubId = await this.shipments.legHubForLocationCheck(id, 'ARRIVE');
    await this.terminal.assertStaffLocationAccess(u.userId, hubId);
    return this.shipments.arriveLeg(id, { userId: u.userId });
  }
}

/**
 * TERM-8, part 1's third gap: collection at the destination terminal — a
 * SHIPMENT-level action (the recipient walked in; no leg moves), so it
 * cannot live on `TerminalLegsController` above. Same authorization shape:
 * one location-scoped gate before delegating to `ShipmentService`'s own
 * `recordCollection`, which still enforces everything it always did
 * (AWAITING_COLLECTION only, once).
 */
@Controller('terminal/shipments')
export class TerminalShipmentsController {
  constructor(
    private readonly terminal: TerminalService,
    private readonly shipments: ShipmentService,
  ) {}

  @StrictThrottle()
  @Post(':id/collect')
  async collect(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(collectShipmentSchema)) dto: CollectShipmentInput) {
    const hubId = await this.shipments.shipmentHubForLocationCheck(id);
    await this.terminal.assertStaffLocationAccess(u.userId, hubId);
    const result = await this.shipments.recordCollection(id, dto.collectedByName, { userId: u.userId });
    // Deliberately NOT `return result` as-is. `recordCollection` resolves
    // through `SHIPMENT_INCLUDE`, whose `legs` block is a bare Prisma
    // `include` (every column — `handoffPin`/`pickupPin` included, the
    // exact shape `RECIPIENT_VIEW_INCLUDE`'s own comment names as the
    // hazard it was built to avoid). `admin/logistics`'s `logistics.operate`
    // staff already see that whole graph; a terminal company's OWN staff
    // must not — this reversal is the entire point of TERM-5/TERM-8, and a
    // recipient's own collection code is their secret to present, never a
    // value staff can read off a response. Reshaped to the same minimal,
    // fact-only shape every other terminal write on this controller returns.
    return { collected: true, reference: result.reference, status: result.status };
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
