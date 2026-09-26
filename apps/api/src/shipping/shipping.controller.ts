import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  assignShipmentLegSchema,
  cancelShipmentSchema,
  collectShipmentSchema,
  createCourierLaneSchema,
  createHubSchema,
  createRouteSchema,
  createShipmentSchema,
  legDepartSchema,
  legExceptionSchema,
  legHandoffSchema,
  reassignShipmentLegSchema,
  addProviderMemberSchema,
  addRouteScheduleExceptionSchema,
  resolveLegExceptionSchema,
  setLegOperatorSchema,
  setRouteWeeklyScheduleSchema,
  shippingProviderProfileSchema,
  shippingProviderProfileUpdateSchema,
  shipmentListSchema,
  shipmentQuoteSchema,
  updateCourierLaneSchema,
  updateHubSchema,
  updateRouteSchema,
  type AssignShipmentLegInput,
  type CancelShipmentInput,
  type CollectShipmentInput,
  type CreateCourierLaneInput,
  type CreateHubInput,
  type CreateRouteInput,
  type CreateShipmentInput,
  type LegDepartInput,
  type LegExceptionInput,
  type LegHandoffInput,
  type ReassignShipmentLegInput,
  type AddProviderMemberInput,
  type AddRouteScheduleExceptionInput,
  type ResolveLegExceptionInput,
  type SetLegOperatorInput,
  type SetRouteWeeklyScheduleInput,
  type ShippingProviderProfileInput,
  type ShippingProviderProfileUpdateInput,
  type ShipmentListInput,
  type ShipmentQuoteInput,
  type UpdateCourierLaneInput,
  type UpdateHubInput,
  type UpdateRouteInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Public, RequirePermission, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { LogisticsNetworkService } from './logistics-network.service';
import { ShippingProviderService } from './shipping-provider.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';
import { ShipmentService } from './shipment.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The public terminal list.
 *
 * Its own controller on purpose: the class-level `@Roles('CUSTOMER')` below wins
 * over a method-level `@Public()`, so a route that really is public cannot live
 * inside a role-gated controller. Somebody comparing shipping options should not
 * have to sign up first.
 */
@Public()
@Controller('shipping/hubs')
export class ShippingHubsController {
  constructor(private readonly network: LogisticsNetworkService) {}

  @Get()
  list() {
    return this.network.publicHubs();
  }
}

/**
 * Which transport modes the network can actually offer.
 *
 * Public and separate from the hub list because the booking form needs it
 * before a customer has chosen anything.
 */
@Public()
@Controller('shipping/modes')
export class ShippingModesController {
  constructor(private readonly network: LogisticsNetworkService) {}

  @Get()
  list() {
    return this.network.availableModes();
  }
}

/**
 * The recipient's public tracking view (BML's "where is my parcel" link).
 *
 * Its own controller for the same reason the hub list has one: a genuinely
 * public route cannot live inside the role-gated customer controller. The
 * token in the path IS the authorisation — a high-entropy capability minted at
 * booking — so the guard here is the strict throttle plus the service's one
 * fixed 404 for every miss: rate-limited guessing that cannot distinguish
 * "wrong token" from "no such shipment" enumerates nothing.
 */
@Public()
@Controller('shipping/track')
export class ShippingTrackController {
  constructor(private readonly shipments: ShipmentService) {}

  @StrictThrottle()
  @Get(':token')
  track(@Param('token') token: string) {
    return this.shipments.trackPublic(token);
  }
}

/**
 * Claiming a shipment as its recipient (recipient account linking).
 *
 * A SEPARATE controller from `ShippingTrackController` above, on the same
 * `shipping/track` prefix, precisely so it does NOT inherit that controller's
 * `@Public()` — the pattern `ShippingProviderProfileController` /
 * `ShippingProviderLegsController` already use for two different guards on
 * one prefix. Holding the token proves you may read `trackPublic`; it must
 * never also mean you may attach an account to the shipment, so claiming
 * requires a genuine signed-in session. No `@Roles(...)` — the recipient is
 * whoever the parcel is going to, who may hold no BML role at all (a driver,
 * a vendor, someone who only ever signed up to receive one parcel), so any
 * authenticated account is the audience.
 */
@Controller('shipping/track')
export class ShippingClaimController {
  constructor(private readonly shipments: ShipmentService) {}

  @StrictThrottle()
  @Post(':token/claim')
  claim(@CurrentUser() u: AuthContext, @Param('token') token: string) {
    return this.shipments.claimAsRecipient(token, u.userId);
  }
}

/**
 * The recipient's own account view of an incoming shipment (recipient
 * account linking).
 *
 * Not gated on `@Roles('CUSTOMER')`, for the same reason the claim endpoint
 * above is not: the recipient is not necessarily the customer, and account
 * creation stays optional either way. Deliberately reuses the exact
 * allowlist `trackPublic` already returns — linking an account changes WHERE
 * the shipment can be read from, never WHAT is in it. Widening this to the
 * full sender-facing payload (money, parcel description, sender identity) is
 * a separate, larger decision this card does not make.
 */
@Controller('shipping/incoming')
export class ShipmentRecipientController {
  constructor(private readonly shipments: ShipmentService) {}

  @Get()
  mine(@CurrentUser() u: AuthContext) {
    return this.shipments.listIncoming(u.userId);
  }

  @Get(':reference')
  one(@CurrentUser() u: AuthContext, @Param('reference') reference: string) {
    return this.shipments.trackAsRecipient(reference, u.userId);
  }
}

/**
 * Customer-facing shipping.
 *
 * Quoting is deliberately a POST rather than a GET: the body carries two
 * addresses, and addresses do not belong in a URL that lands in an access log.
 */
@Roles('CUSTOMER')
@Controller('shipping')
export class ShippingController {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly network: LogisticsNetworkService,
    private readonly prisma: PrismaService,
  ) {}

  /** What the whole journey would cost and how it would go. Nothing is created. */
  @StrictThrottle()
  @Post('quote')
  async quote(@CurrentUser() u: AuthContext, @Body(ZodBody(shipmentQuoteSchema)) dto: ShipmentQuoteInput) {
    // Quoting uses the same simulation boundary booking does, so a test account
    // is quoted over the simulation network and priced by the simulation rate —
    // and a real customer never sees either.
    const me = await this.prisma.user.findUnique({ where: { id: u.userId }, select: { isTest: true } });
    return this.shipments.quote(dto, { isTest: me?.isTest ?? false });
  }

  @StrictThrottle()
  @Post()
  create(@CurrentUser() u: AuthContext, @Body(ZodBody(createShipmentSchema)) dto: CreateShipmentInput) {
    return this.shipments.create(u.userId, dto);
  }

  @Get()
  mine(@CurrentUser() u: AuthContext) {
    return this.shipments.listMine(u.userId);
  }

  /** Tracking by reference. A customer only ever resolves their own. */
  @Get(':reference')
  track(@CurrentUser() u: AuthContext, @Param('reference') reference: string) {
    return this.shipments.track(reference, { userId: u.userId, isStaff: false });
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(cancelShipmentSchema)) dto: CancelShipmentInput) {
    return this.shipments.cancel(id, dto, { userId: u.userId, isStaff: false });
  }
}

/**
 * Operating the network.
 *
 * Line-haul legs are flown and sailed by carriers BML does not employ, so there
 * is no driver app to transition them — an operator confirms what the carrier
 * did. Everything here is permission-gated and audited.
 */
@Controller('admin/logistics')
export class AdminLogisticsController {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly network: LogisticsNetworkService,
    private readonly legDispatch: ShipmentDispatchService,
    private readonly providers: ShippingProviderService,
  ) {}

  /* ---- carrier organizations (BMPL-137) ---- */

  /** The carrier directory: pick an operator for a route or leg, see its staff count. */
  @RequirePermission('logistics.read')
  @Get('providers')
  listProviders() {
    return this.providers.listProviders();
  }

  /**
   * Add (or reactivate) a member of a carrier organization. logistics.manage —
   * granting a person the ability to act for a carrier is network
   * configuration, the same job as deciding which carrier runs a route.
   */
  @RequirePermission('logistics.manage')
  @Post('providers/:id/members')
  addMember(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(addProviderMemberSchema)) dto: AddProviderMemberInput) {
    return this.providers.addMember(u.userId, id, dto);
  }

  @RequirePermission('logistics.manage')
  @Post('providers/:id/members/:userId/end')
  endMember(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('userId') userId: string) {
    return this.providers.endMember(u.userId, id, userId);
  }

  /**
   * Set (or clear, with null) the carrier organization operating a transport
   * leg. logistics.operate, same as working the leg by hand: choosing who runs
   * a leg and running it are the same operator's job. The service validates
   * the org (active, approved, simulation flag matching the shipment's).
   */
  @RequirePermission('logistics.operate')
  @Post('legs/:id/operator')
  setOperator(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(setLegOperatorSchema)) dto: SetLegOperatorInput) {
    return this.providers.setLegOperator(id, dto, u.userId);
  }

  /* ---- the network, as data ---- */

  @RequirePermission('logistics.read')
  @Get('hubs')
  listHubs() {
    return this.network.listHubs();
  }

  @RequirePermission('logistics.manage')
  @Post('hubs')
  createHub(@CurrentUser() u: AuthContext, @Body(ZodBody(createHubSchema)) dto: CreateHubInput) {
    return this.network.createHub(dto, u.userId);
  }

  @RequirePermission('logistics.manage')
  @Patch('hubs/:id')
  updateHub(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(updateHubSchema)) dto: UpdateHubInput) {
    return this.network.updateHub(id, dto, u.userId);
  }

  @RequirePermission('logistics.read')
  @Get('routes')
  listRoutes() {
    return this.network.listRoutes();
  }

  @RequirePermission('logistics.manage')
  @Post('routes')
  createRoute(@CurrentUser() u: AuthContext, @Body(ZodBody(createRouteSchema)) dto: CreateRouteInput) {
    return this.network.createRoute(dto, u.userId);
  }

  @RequirePermission('logistics.manage')
  @Patch('routes/:id')
  updateRoute(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(updateRouteSchema)) dto: UpdateRouteInput) {
    return this.network.updateRoute(id, dto, u.userId);
  }

  /**
   * Whether a route runs on a given day (BMPL-186) — admin acts on ANY route,
   * under the same permissions as the route CRUD immediately above (deciding
   * who runs a route and deciding when it runs are the same job). The
   * carrier's own equivalent is ShippingProviderRoutesController, scoped to
   * routes they operate; both call the SAME LogisticsNetworkService methods.
   */
  @RequirePermission('logistics.read')
  @Get('routes/:id/schedule')
  routeSchedule(@Param('id') id: string) {
    return this.network.routeSchedule(id);
  }

  @RequirePermission('logistics.manage')
  @Put('routes/:id/schedule')
  setRouteSchedule(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(setRouteWeeklyScheduleSchema)) dto: SetRouteWeeklyScheduleInput) {
    return this.network.setWeeklySchedule(id, dto, u.userId);
  }

  @RequirePermission('logistics.manage')
  @Post('routes/:id/schedule/exceptions')
  addRouteScheduleException(
    @CurrentUser() u: AuthContext,
    @Param('id') id: string,
    @Body(ZodBody(addRouteScheduleExceptionSchema)) dto: AddRouteScheduleExceptionInput,
  ) {
    return this.network.addScheduleException(id, dto, u.userId);
  }

  @RequirePermission('logistics.manage')
  @Delete('routes/:id/schedule/exceptions/:exceptionId')
  removeRouteScheduleException(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('exceptionId') exceptionId: string) {
    return this.network.removeScheduleException(id, exceptionId, u.userId);
  }

  /**
   * Courier lanes: two towns one courier can drive between.
   *
   * Under logistics.manage with hubs and routes, because it is the same job —
   * describing what the network can actually do — and the same person does it.
   * Deliberately NOT exposed publicly: a lane is not somewhere a customer goes,
   * it is a fact the planner uses, and listing lanes to customers would read as
   * a timetable we are not offering.
   */
  @RequirePermission('logistics.read')
  @Get('courier-lanes')
  listCourierLanes() {
    return this.network.listCourierLanes();
  }

  @RequirePermission('logistics.manage')
  @Post('courier-lanes')
  createCourierLane(
    @CurrentUser() u: AuthContext,
    @Body(ZodBody(createCourierLaneSchema)) dto: CreateCourierLaneInput,
  ) {
    return this.network.createCourierLane(dto, u.userId);
  }

  @RequirePermission('logistics.manage')
  @Patch('courier-lanes/:id')
  updateCourierLane(
    @CurrentUser() u: AuthContext,
    @Param('id') id: string,
    @Body(ZodBody(updateCourierLaneSchema)) dto: UpdateCourierLaneInput,
  ) {
    return this.network.updateCourierLane(id, dto, u.userId);
  }

  /* ---- shipments ---- */

  /** The operations board. Declared BEFORE `:reference` so it is not swallowed. */
  @RequirePermission('logistics.read')
  @Get('shipments')
  listShipments(@Query() query: Record<string, string>) {
    return this.shipments.listForOps(shipmentListSchema.parse(query) as ShipmentListInput);
  }

  /** What a terminal should be expecting, for the handoff desk. */
  @RequirePermission('logistics.read')
  @Get('hubs/:id/expected')
  expected(@Param('id') id: string) {
    return this.shipments.expectedAtHub(id);
  }

  @RequirePermission('logistics.read')
  @Get('shipments/:reference')
  track(@CurrentUser() u: AuthContext, @Param('reference') reference: string) {
    return this.shipments.track(reference, { userId: u.userId, isStaff: true });
  }

  /* ---- legs ---- */

  /**
   * Manual driver assignment — the production dispatch path while
   * `dispatchAutomatic` is off. Who may be chosen, and every refusal the
   * automatic engine enforces (payment, parcel location, the simulation
   * boundary, the sender never couriering their own parcel), is enforced again
   * in the service.
   */
  @RequirePermission('logistics.operate')
  @Get('legs/:id/eligible-drivers')
  eligibleDrivers(@Param('id') id: string) {
    return this.legDispatch.eligibleDriversForLeg(id);
  }

  @RequirePermission('logistics.operate')
  @Post('legs/:id/assign')
  assignLeg(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(assignShipmentLegSchema)) dto: AssignShipmentLegInput) {
    return this.legDispatch.adminAssign({ userId: u.userId }, id, dto);
  }

  @RequirePermission('logistics.operate')
  @Post('legs/:id/reassign')
  reassignLeg(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(reassignShipmentLegSchema)) dto: ReassignShipmentLegInput) {
    return this.legDispatch.adminReassign({ userId: u.userId }, id, dto);
  }

  @RequirePermission('logistics.operate')
  @Post('legs/:id/start')
  start(@CurrentUser() u: AuthContext, @Param('id') id: string, @Req() req: Request) {
    return this.shipments.startLeg(id, { userId: u.userId, label: this.label(req) });
  }

  @RequirePermission('logistics.operate')
  @Post('legs/:id/depart')
  depart(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(legDepartSchema)) dto: LegDepartInput) {
    return this.shipments.departLeg(id, dto, { userId: u.userId });
  }

  @RequirePermission('logistics.operate')
  @Post('legs/:id/arrive')
  arrive(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.shipments.arriveLeg(id, { userId: u.userId });
  }

  /**
   * Deliberate, audited reveal of a leg's handoff code for the receiving desk.
   *
   * logistics.verify, NOT logistics.operate — the catalog pre-provisioned it
   * for exactly this ("reveal a leg handoff PIN"), and the split mirrors the
   * delivery console, where deliveries.verify guards the PIN reveal separately
   * from working the delivery. Keeping them apart preserves the two-party
   * property: a pure operator completes a handoff only with a code somebody
   * else chose to give them.
   */
  @RequirePermission('logistics.verify')
  @StrictThrottle()
  @Get('legs/:id/handoff-pin')
  handoffPin(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.shipments.revealHandoffPin(id, { userId: u.userId });
  }

  /** Completing a leg means proving the handoff, not asserting it. */
  @RequirePermission('logistics.operate')
  @StrictThrottle()
  @Post('legs/:id/handoff')
  handoff(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(legHandoffSchema)) dto: LegHandoffInput) {
    return this.shipments.completeLeg(id, dto, { userId: u.userId });
  }

  @RequirePermission('logistics.operate')
  @Post('legs/:id/exception')
  exception(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(legExceptionSchema)) dto: LegExceptionInput) {
    return this.shipments.flagException(id, dto, { userId: u.userId });
  }

  /**
   * The way back out of an exception. `logistics.operate`, same as the way in:
   * flagging and resolving are the same operator's job. RESUME continues the
   * leg where it stood; RELEASE_DRIVER re-queues an uncollected leg. A parcel
   * already in a driver's hands cannot be released here — that needs a policy
   * nobody has written, and the service refuses rather than inventing one.
   */
  @RequirePermission('logistics.operate')
  @Post('legs/:id/resolve-exception')
  resolveException(
    @CurrentUser() u: AuthContext,
    @Param('id') id: string,
    @Body(ZodBody(resolveLegExceptionSchema)) dto: ResolveLegExceptionInput,
  ) {
    return this.shipments.resolveException(id, dto, { userId: u.userId });
  }

  /** The recipient walked in and picked it up. No leg moves, so nothing else can
   *  close out a hub-ending journey. */
  @RequirePermission('logistics.operate')
  @Post('shipments/:id/collect')
  collect(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(collectShipmentSchema)) dto: CollectShipmentInput) {
    return this.shipments.recordCollection(id, dto.collectedByName, { userId: u.userId });
  }

  @RequirePermission('logistics.manage')
  @Post('shipments/:id/cancel')
  cancel(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(cancelShipmentSchema)) dto: CancelShipmentInput) {
    return this.shipments.cancel(id, dto, { userId: u.userId, isStaff: true });
  }

  private label(req: Request): string | undefined {
    const header = req.get('x-operator-label');
    return header ? header.slice(0, 120) : undefined;
  }
}

/**
 * Carrier profile self-service (BMPL-137) — the passenger-provider mirror.
 *
 * @Roles('CUSTOMER') exactly as passenger/provider's profile surface: the
 * profile is how an applying account STARTS being a carrier, so it cannot sit
 * behind the role the application has not granted yet. Everything operational
 * lives on the SHIPPING_PROVIDER-gated controller below instead.
 */
@Roles('CUSTOMER')
@Controller('shipping/provider')
export class ShippingProviderProfileController {
  constructor(private readonly providers: ShippingProviderService) {}

  @Get('profile')
  profile(@CurrentUser() u: AuthContext) {
    return this.providers.getProfile(u.userId);
  }

  @Put('profile')
  upsert(@CurrentUser() u: AuthContext, @Body(ZodBody(shippingProviderProfileSchema)) dto: ShippingProviderProfileInput) {
    return this.providers.upsertProfile(u.userId, dto);
  }

  @Patch('profile')
  update(@CurrentUser() u: AuthContext, @Body(ZodBody(shippingProviderProfileUpdateSchema)) dto: ShippingProviderProfileUpdateInput) {
    return this.providers.updateProfile(u.userId, dto);
  }
}

/**
 * Carrier-operator self-service (BMPL-137).
 *
 * A transport leg is flown, sailed or driven by a carrier BML does not
 * employ. This is that carrier's own surface: two independent gates, both
 * deliberate — the APPROVED SHIPPING_PROVIDER role here, and an ACTIVE
 * membership in an ACTIVE organization resolved per request in the service.
 * A member sees exactly the legs linked to their organizations and confirms
 * what physically happened — departed, arrived. Every write funnels into the
 * SAME leg state machine the admin console uses; a cross-org id answers 404
 * exactly like a missing one.
 *
 * Handoff completion is deliberately NOT here: completing a leg means proving
 * the handoff with the code the RECEIVING side holds, and that stays with the
 * receiving desk (phase 2 is its own card). Generic across air, water taxi
 * and bus by construction — nothing in it knows a mode.
 */
@Roles('SHIPPING_PROVIDER')
@Controller('shipping/provider')
export class ShippingProviderLegsController {
  constructor(private readonly providers: ShippingProviderService) {}

  /** Every transport leg on my organizations, newest first. */
  @Get('legs')
  myLegs(@CurrentUser() u: AuthContext) {
    return this.providers.myLegs(u.userId);
  }

  @Get('legs/:id')
  leg(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.providers.myLeg(u.userId, id);
  }

  @Post('legs/:id/depart')
  depart(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(legDepartSchema)) dto: LegDepartInput) {
    return this.providers.depart(u.userId, id, dto);
  }

  @Post('legs/:id/arrive')
  arrive(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.providers.arrive(u.userId, id);
  }
}

/**
 * Carrier route-schedule self-service (BMPL-186).
 *
 * Whether a scheduled service actually runs on a given date — the
 * CONFIGURATION capability the owner authorized while the DATA stays gated
 * (no route is seeded with a real pattern anywhere in this change). Same two
 * gates as the legs surface above: the APPROVED SHIPPING_PROVIDER role, and
 * an ACTIVE membership in the organization that operates the route, resolved
 * fresh per request. A cross-org route id answers 404 exactly like a missing
 * one — assertMyRoute is the ONE place that boundary is enforced, and every
 * method here goes through it before touching a row.
 */
@Roles('SHIPPING_PROVIDER')
@Controller('shipping/provider')
export class ShippingProviderRoutesController {
  constructor(private readonly providers: ShippingProviderService) {}

  /** Every route my organizations operate — how a carrier finds the route id to configure. */
  @Get('routes')
  myRoutes(@CurrentUser() u: AuthContext) {
    return this.providers.myRoutes(u.userId);
  }

  @Get('routes/:id/schedule')
  schedule(@CurrentUser() u: AuthContext, @Param('id') id: string) {
    return this.providers.myRouteSchedule(u.userId, id);
  }

  /** Replaces the whole weekly pattern - see setRouteWeeklyScheduleSchema for why. */
  @Put('routes/:id/schedule')
  setSchedule(@CurrentUser() u: AuthContext, @Param('id') id: string, @Body(ZodBody(setRouteWeeklyScheduleSchema)) dto: SetRouteWeeklyScheduleInput) {
    return this.providers.setMyRouteWeeklySchedule(u.userId, id, dto);
  }

  @Post('routes/:id/schedule/exceptions')
  addScheduleException(
    @CurrentUser() u: AuthContext,
    @Param('id') id: string,
    @Body(ZodBody(addRouteScheduleExceptionSchema)) dto: AddRouteScheduleExceptionInput,
  ) {
    return this.providers.addMyRouteScheduleException(u.userId, id, dto);
  }

  @Delete('routes/:id/schedule/exceptions/:exceptionId')
  removeScheduleException(@CurrentUser() u: AuthContext, @Param('id') id: string, @Param('exceptionId') exceptionId: string) {
    return this.providers.removeMyRouteScheduleException(u.userId, id, exceptionId);
  }
}
