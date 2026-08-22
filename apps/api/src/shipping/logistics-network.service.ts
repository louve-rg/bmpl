import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PlannerHub, PlannerRoute } from '@bmpl/shared';
import type { CreateHubInput, CreateRouteInput, UpdateHubInput, UpdateRouteInput } from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Minor units leave this service as numbers, matching the rest of the API. The
 * BigInt JSON patch lives in main.ts, which the test harness does not load, so a
 * raw BigInt in a response is a 500 in tests and a landmine in production.
 */
const money = (v: bigint) => Number(v);

/**
 * The logistics network: hubs and the transport services between them.
 *
 * This is the whole reason the route planner has no place names in it. Opening
 * Corozal, grounding a flight for the season, or adding a second carrier on a
 * route is an admin edit here — never a code change and never a deploy.
 */
@Injectable()
export class LogisticsNetworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------ planning */

  /**
   * Everything the planner needs, in the shape it wants.
   *
   * Loaded per plan rather than cached: the network is a few dozen rows, and an
   * operator who has just grounded a flight must not have it quoted to the next
   * customer because a cache had not expired.
   */
  /**
   * The network the planner may route over.
   *
   * Scoped to one side of the simulation boundary. A real customer is never
   * routed through a TEST terminal, and a simulated shipment never consumes a
   * real lane — which is what makes it safe to configure a fake air route
   * between two invented terminals in order to prove the multimodal engine.
   */
  async plannerInputs(opts: { isTest?: boolean } = {}): Promise<{ hubs: PlannerHub[]; routes: PlannerRoute[] }> {
    const isTest = opts.isTest ?? false;
    const [hubs, routes] = await Promise.all([
      this.prisma.logisticsHub.findMany({ where: { isTest }, orderBy: { code: 'asc' } }),
      this.prisma.logisticsRoute.findMany({ where: { isTest }, orderBy: { id: 'asc' } }),
    ]);
    return {
      hubs: hubs.map((h) => ({
        id: h.id,
        code: h.code,
        name: h.name,
        district: h.district,
        city: h.city,
        modes: h.modes,
        isActive: h.isActive,
      })),
      routes: routes.map((r) => ({
        id: r.id,
        originHubId: r.originHubId,
        destinationHubId: r.destinationHubId,
        mode: r.mode,
        durationMinutes: r.durationMinutes,
        priceMinor: Number(r.priceMinor),
        isActive: r.isActive,
      })),
    };
  }

  /* --------------------------------------------------------------- hubs */

  /** The terminals a customer can pick, with nothing operational in the payload. */
  async publicHubs() {
    const hubs = await this.prisma.logisticsHub.findMany({
      where: { isActive: true },
      orderBy: [{ district: 'asc' }, { name: 'asc' }],
    });
    return hubs.map((h) => ({
      id: h.id,
      code: h.code,
      name: h.name,
      type: h.type,
      district: h.district,
      city: h.city,
      address: h.addressLine1,
      latitude: h.latitude,
      longitude: h.longitude,
      modes: h.modes,
      instructions: h.instructions,
    }));
  }

  /**
   * Which ways a parcel can actually travel right now.
   *
   * Derived from ACTIVE routes, not from the enum. Offering "Flight" when no
   * flight is configured produces a quote that always fails, and a customer who
   * concludes the site is broken rather than that the service does not exist.
   */
  async availableModes(opts: { isTest?: boolean } = {}): Promise<Array<'LAND' | 'AIR' | 'SEA'>> {
    const rows = await this.prisma.logisticsRoute.groupBy({
      by: ['mode'],
      where: {
        isActive: true,
        isTest: opts.isTest ?? false,
        originHub: { isActive: true },
        destinationHub: { isActive: true },
      },
    });
    const order = ['LAND', 'AIR', 'SEA'] as const;
    return order.filter((m) => rows.some((r) => r.mode === m));
  }

  async listHubs() {
    const hubs = await this.prisma.logisticsHub.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }] });
    return hubs.map((h) => this.hubOut(h));
  }

  private hubOut<T extends { courierFeeMinor: bigint }>(h: T) {
    return { ...h, courierFeeMinor: money(h.courierFeeMinor) };
  }

  private routeOut<T extends { priceMinor: bigint }>(r: T) {
    return { ...r, priceMinor: money(r.priceMinor) };
  }

  async createHub(input: CreateHubInput, actorId: string) {
    const hub = await this.prisma.logisticsHub
      .create({ data: { ...input, isActive: input.isActive ?? true } })
      .catch((e: unknown) => {
        throw this.hubCodeConflict(e, input.code);
      });
    await this.audit.record({ action: 'LOGISTICS_HUB_CREATED', actorId, newValue: { hubId: hub.id, code: hub.code } });
    return this.hubOut(hub);
  }

  async updateHub(id: string, input: UpdateHubInput, actorId: string) {
    const before = await this.prisma.logisticsHub.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Hub not found.');
    const hub = await this.prisma.logisticsHub.update({ where: { id }, data: input }).catch((e: unknown) => {
      throw this.hubCodeConflict(e, input.code ?? before.code);
    });
    await this.audit.record({
      action: 'LOGISTICS_HUB_UPDATED',
      actorId,
      previousValue: { code: before.code, isActive: before.isActive, modes: before.modes },
      newValue: { hubId: hub.id, code: hub.code, isActive: hub.isActive, modes: hub.modes },
    });
    return this.hubOut(hub);
  }

  private hubCodeConflict(e: unknown, code: string): Error {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException(`A hub with the code "${code}" already exists.`);
    }
    return e as Error;
  }

  /* -------------------------------------------------------------- routes */

  async listRoutes() {
    const routes = await this.prisma.logisticsRoute.findMany({
      orderBy: [{ isActive: 'desc' }, { id: 'asc' }],
      include: {
        originHub: { select: { id: true, code: true, name: true, modes: true } },
        destinationHub: { select: { id: true, code: true, name: true, modes: true } },
      },
    });
    return routes.map((r) => this.routeOut(r));
  }

  async createRoute(input: CreateRouteInput, actorId: string) {
    await this.assertRouteIsPossible(input.originHubId, input.destinationHubId, input.mode);
    const route = await this.prisma.logisticsRoute.create({
      data: { ...input, priceMinor: BigInt(input.priceMinor), isActive: input.isActive ?? true },
    });
    await this.audit.record({
      action: 'LOGISTICS_ROUTE_CREATED',
      actorId,
      newValue: { routeId: route.id, mode: route.mode, originHubId: route.originHubId, destinationHubId: route.destinationHubId },
    });
    return this.routeOut(route);
  }

  async updateRoute(id: string, input: UpdateRouteInput, actorId: string) {
    const before = await this.prisma.logisticsRoute.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Route not found.');
    const originHubId = input.originHubId ?? before.originHubId;
    const destinationHubId = input.destinationHubId ?? before.destinationHubId;
    const mode = input.mode ?? before.mode;
    if (originHubId === destinationHubId) throw new BadRequestException('A route has to go between two different hubs.');
    await this.assertRouteIsPossible(originHubId, destinationHubId, mode);

    const route = await this.prisma.logisticsRoute.update({
      where: { id },
      data: { ...input, ...(input.priceMinor != null ? { priceMinor: BigInt(input.priceMinor) } : {}) },
    });
    await this.audit.record({
      action: 'LOGISTICS_ROUTE_UPDATED',
      actorId,
      previousValue: { isActive: before.isActive, priceMinor: before.priceMinor.toString(), durationMinutes: before.durationMinutes },
      newValue: { routeId: route.id, isActive: route.isActive, priceMinor: route.priceMinor.toString(), durationMinutes: route.durationMinutes },
    });
    return this.routeOut(route);
  }

  /**
   * Both hubs must exist and both must handle the mode.
   *
   * Caught here rather than at plan time because a route an airstrip cannot
   * service is a configuration mistake, and the person who can fix it is the one
   * making it right now — not the customer who gets a strange quote next week.
   */
  private async assertRouteIsPossible(originHubId: string, destinationHubId: string, mode: 'LAND' | 'AIR' | 'SEA') {
    const hubs = await this.prisma.logisticsHub.findMany({
      where: { id: { in: [originHubId, destinationHubId] } },
      select: { id: true, name: true, modes: true },
    });
    for (const id of [originHubId, destinationHubId]) {
      const hub = hubs.find((h) => h.id === id);
      if (!hub) throw new NotFoundException('One of those hubs does not exist.');
      if (!hub.modes.includes(mode)) {
        throw new BadRequestException(`${hub.name} does not handle ${mode.toLowerCase()} transport.`);
      }
    }
  }
}
