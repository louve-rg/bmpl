import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
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
  ) {}

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
