import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  acceptTerminalInviteSchema,
  addTerminalCompanyLocationSchema,
  changeTerminalCompanyMemberRoleSchema,
  collectShipmentSchema,
  createTerminalCompanySchema,
  grantTerminalCompanyMemberLocationSchema,
  inviteTerminalCompanyMemberSchema,
  legDepartSchema,
  legHandoffSchema,
  legLookupByCodeSchema,
  legReleaseToCourierSchema,
  updateTerminalCompanySchema,
  type AcceptTerminalInviteInput,
  type AddTerminalCompanyLocationInput,
  type ChangeTerminalCompanyMemberRoleInput,
  type CollectShipmentInput,
  type CreateTerminalCompanyInput,
  type GrantTerminalCompanyMemberLocationInput,
  type InviteTerminalCompanyMemberInput,
  type LegDepartInput,
  type LegHandoffInput,
  type LegLookupByCodeInput,
  type LegReleaseToCourierInput,
  type UpdateTerminalCompanyInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Public, RequirePermission } from '../common/decorators';
import { StrictThrottle, TerminalLookupThrottle } from '../throttling/throttle.decorators';
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

  /** Re-send a pending invitation after a failed delivery. Same permission as
   *  issuing one, because it rotates that invite's token. */
  @RequirePermission('terminals.manage')
  @Post('companies/:id/invites/:inviteId/resend')
  resendInvite(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('inviteId') inviteId: string) {
    return this.terminal.resendInvite(u.userId, id, inviteId);
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
   * MDF-698: the one MANAGER-only read this card wires up. Same "no
   * `@RequirePermission`/`@Roles`" reasoning as this whole controller —
   * the check is `TerminalService.assertActiveMemberRole`, inside
   * `myStaff`, against the terminal-role axis, not either of the other
   * two. An OPERATOR gets a 403 from the service, not an empty list.
   */
  @Get('staff')
  staff(@CurrentUser() u: AuthContext) {
    return this.terminal.myStaff(u.userId);
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
   *
   * TERM-QUEUE-TRUNCATION: the body stays the exact flat array
   * `apps/web`'s shipped Terminal Workspace queue tab already reads —
   * `terminalQueue` itself is unchanged in shape to any caller that only
   * reads the body. The truth about completeness rides a response header
   * instead (`passthrough: true` so Nest still serializes `items` as the
   * JSON body): a caller that doesn't read the header loses nothing it had
   * before, and one that does can finally tell "this is everything" from
   * "there's more, narrow your query."
   */
  @Get('queue')
  async queue(@CurrentUser() u: AuthContext, @Res({ passthrough: true }) res: Response) {
    const hubIds = await this.terminal.myActiveHubIds(u.userId);
    const { items, hasMore } = await this.shipments.terminalQueue(hubIds);
    res.setHeader('X-BMPL-Queue-Has-More', String(hasMore));
    return items;
  }

  /**
   * MDF-700 (TERM-INBOUND): the manifest the actionable `queue` above
   * cannot show — a LINE_HAUL leg scheduled or in motion toward one of MY
   * hubs, not yet arrived. Same hub-scoping discipline as `queue`:
   * `myActiveHubIds` re-read at call time, never cached, and
   * `ShipmentService.terminalInbound` never sees a hub id this method did
   * not hand it.
   */
  @Get('inbound')
  async inbound(@CurrentUser() u: AuthContext) {
    const hubIds = await this.terminal.myActiveHubIds(u.userId);
    return this.shipments.terminalInbound(hubIds);
  }

  /** MDF-700 (TERM-INBOUND): the outbound counterpart to `inbound` above. */
  @Get('outbound')
  async outbound(@CurrentUser() u: AuthContext) {
    const hubIds = await this.terminal.myActiveHubIds(u.userId);
    return this.shipments.terminalOutbound(hubIds);
  }

  /**
   * MDF-700 (TERM-INBOUND): what this terminal physically holds right now,
   * derived from `CustodyEvent` rows — see `ShipmentService.terminalCustody`
   * for the two-step derivation.
   */
  @Get('custody')
  async custody(@CurrentUser() u: AuthContext) {
    const hubIds = await this.terminal.myActiveHubIds(u.userId);
    return this.shipments.terminalCustody(hubIds);
  }

  /**
   * MDF-701 (TERM-HISTORY): the owner's required "Shipment lookup,
   * tracking, and history" section has no placeholder allowed, and no
   * past-shipments list existed anywhere for a terminal. MANAGER-only,
   * same as `staff` above and for the same reason — `myStaff`'s own doc
   * comment already names "history/reporting" as one of the owner's
   * MANAGER-only capabilities, alongside staff view; this is the first of
   * those to get an endpoint. `assertActiveMemberRole` is checked FIRST,
   * before `myActiveHubIds`, so an OPERATOR (or a non-member) gets the
   * same two distinguishable 403s `staff` already gives, never a hub list
   * computed for a role that cannot use it.
   */
  @Get('history')
  async history(@CurrentUser() u: AuthContext, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    await this.terminal.assertActiveMemberRole(u.userId, ['MANAGER']);
    const hubIds = await this.terminal.myActiveHubIds(u.userId);
    return this.shipments.terminalHistory(hubIds, { cursor, limit: limit ? Number(limit) : undefined });
  }

  /**
   * TERM-STAFF-API: the owner-approved self-serve door onto the same six
   * primitives AdminTerminalController already exposes — see
   * TerminalService's "staff: manager-run staff management" section for
   * the authority model and the last-ACTIVE-MANAGER floor these six share.
   * MANAGER-only, enforced inside each service method via
   * `assertActiveMemberRole` — same reasoning as `staff`/`history` above,
   * never a decorator, and the company is always the CALLER's own, never
   * taken from the request.
   */
  @Post('staff/invite')
  staffInvite(@CurrentUser() u: AuthContext, @Body(ZodBody(inviteTerminalCompanyMemberSchema)) dto: InviteTerminalCompanyMemberInput) {
    return this.terminal.staffInvite(u.userId, dto);
  }

  /** god's own scope addition: undo a mistyped invite without an admin. */
  @Post('staff/invites/:inviteId/revoke')
  staffRevokeInvite(@CurrentUser() u: AuthContext, @Param('inviteId') inviteId: string) {
    return this.terminal.staffRevokeInvite(u.userId, inviteId);
  }

  @Post('staff/invites/:inviteId/resend')
  staffResendInvite(@CurrentUser() u: AuthContext, @Param('inviteId') inviteId: string) {
    return this.terminal.staffResendInvite(u.userId, inviteId);
  }

  @Patch('staff/:userId/role')
  staffChangeRole(
    @CurrentUser() u: AuthContext,
    @Param('userId') userId: string,
    @Body(ZodBody(changeTerminalCompanyMemberRoleSchema)) dto: ChangeTerminalCompanyMemberRoleInput,
  ) {
    return this.terminal.staffChangeRole(u.userId, userId, dto);
  }

  @Post('staff/:userId/locations')
  staffGrantLocation(
    @CurrentUser() u: AuthContext,
    @Param('userId') userId: string,
    @Body(ZodBody(grantTerminalCompanyMemberLocationSchema)) dto: GrantTerminalCompanyMemberLocationInput,
  ) {
    return this.terminal.staffGrantLocation(u.userId, userId, dto.locationId);
  }

  @Delete('staff/:userId/locations/:locationId')
  staffRevokeLocation(@CurrentUser() u: AuthContext, @Param('userId') userId: string, @Param('locationId') locationId: string) {
    return this.terminal.staffRevokeLocation(u.userId, userId, locationId);
  }

  @Post('staff/:userId/deactivate')
  staffDeactivateMember(@CurrentUser() u: AuthContext, @Param('userId') userId: string) {
    return this.terminal.staffDeactivateMember(u.userId, userId);
  }

  @Post('staff/:userId/reactivate')
  staffReactivateMember(@CurrentUser() u: AuthContext, @Param('userId') userId: string) {
    return this.terminal.staffReactivateMember(u.userId, userId);
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

  /**
   * EDW-P2 (MDF-1171): the "lead with the code" lookup — see
   * `ShipmentService.lookupByHandoffCode`'s own doc for the full settled
   * contract. POST only (the code never belongs in a URL/query string, and
   * this is a security-relevant read, not an idempotent GET). Hub scope is
   * `myActiveHubIds`, re-read at call time — the exact same discipline
   * `queue`/`inbound`/`outbound`/`custody`/`history` above already use, and
   * this method never sees a hub id it was not explicitly handed.
   * `@TerminalLookupThrottle()` (MDF-1184) is a per-IP brake distinct from
   * `@StrictThrottle()`'s auth-route number — see that decorator's own doc
   * for why this route needed its own number rather than the shared one.
   * It sits on top of `ShipmentService.checkLookupRate`'s own per-caller
   * limit; the two are independent and keyed differently (IP vs. user id)
   * and deliberately complementary, not redundant.
   *
   * `@HttpCode(200)`: same reasoning as `WalletController.
   * lookupTransferRecipient`'s own precedent — this is a POST because the
   * code must stay out of a URL/query string, not because anything is
   * created, so the response code says "read", matching what it actually
   * is rather than NestJS's create-by-default 201.
   */
  @TerminalLookupThrottle()
  @HttpCode(200)
  @Post('lookup-by-code')
  async lookupByCode(@CurrentUser() u: AuthContext, @Body(ZodBody(legLookupByCodeSchema)) dto: LegLookupByCodeInput) {
    const hubIds = await this.terminal.myActiveHubIds(u.userId);
    return this.shipments.lookupByHandoffCode(dto.code, hubIds, { userId: u.userId });
  }

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
    const result = await this.shipments.recordCollection(id, dto.collectedByName, dto.code, { userId: u.userId });
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

  /**
   * MDF-699 (TERM-LOOKUP): a counter clerk's own search, by the
   * customer-facing reference — the thing a customer actually hands them,
   * as opposed to the primary-key `:id` the `collect` route above takes.
   * No new authorization axis: `ShipmentService.lookupForTerminal` does its
   * own hub-membership check against `myActiveHubIds`, mirroring the
   * location-scoping every other route on this controller already uses,
   * and refuses with a real 404 for a shipment the caller is not entitled
   * to — never a quiet empty 200.
   *
   * SEC-SHIPMENT-REF-DISCLOSURE (Stanley, superseding MDF-716's original
   * "404/403 split is designed" note below): the split WAS an existence
   * oracle, not merely a bounded one — a caller could tell a real
   * cross-company reference from a made-up one by the refusal alone.
   * `lookupForTerminal` now folds hub-membership into the lookup's own
   * query, so "not mine" and "doesn't exist" are one code path, one 404,
   * one message — the same principle `revokeInvite`/`resendInvite` already
   * apply. `@StrictThrottle()` stays regardless, as defense in depth.
   */
  @StrictThrottle()
  @Get(':reference')
  async lookup(@CurrentUser() u: AuthContext, @Param('reference') reference: string) {
    const hubIds = await this.terminal.myActiveHubIds(u.userId);
    return this.shipments.lookupForTerminal(reference, hubIds);
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
