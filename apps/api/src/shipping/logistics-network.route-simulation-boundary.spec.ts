import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CreateRouteInput, UpdateRouteInput } from '@bmpl/validation';
import { LogisticsNetworkService } from './logistics-network.service';

/**
 * TERM-SIM-ROUTE-FORM-CREATES-REAL-ROUTE: the admin Routes form omits
 * isTest from its POST body, and nothing on the server compared
 * originHub.isTest to destinationHub.isTest or to input.isTest before this —
 * so "Add route" between two simulation hubs would silently create a REAL
 * route (the column defaults to false). These tests exercise the service
 * directly against a faked Prisma client, which is the only way to prove the
 * three new branches (and the one surviving happy path) without a database.
 */

type Hub = { id: string; name: string; modes: string[]; isTest: boolean };

function hub(overrides: Partial<Hub>): Hub {
  return { id: 'hub-id', name: 'Hub', modes: ['LAND'], isTest: false, ...overrides };
}

function makeService(hubs: Hub[]) {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  const existingRoute = {
    id: 'route-1',
    originHubId: 'origin',
    destinationHubId: 'destination',
    mode: 'LAND',
    isTest: false,
    isActive: true,
    priceMinor: 1000n,
    durationMinutes: 60,
  };
  const prisma = {
    logisticsHub: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => hubs.filter((h) => where.id.in.includes(h.id))),
    },
    logisticsRoute: {
      findUnique: vi.fn(async () => existingRoute),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'new-route', ...data };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updated.push(data);
        return { ...existingRoute, ...data };
      }),
    },
  };
  const audit = { record: vi.fn(async () => undefined) };
  const svc = new LogisticsNetworkService(prisma as never, audit as never, null as never);
  return { svc, created, updated };
}

const baseInput = (overrides: Partial<CreateRouteInput> = {}): CreateRouteInput =>
  ({
    originHubId: 'origin',
    destinationHubId: 'destination',
    mode: 'LAND',
    durationMinutes: 60,
    priceMinor: 1000,
    ...overrides,
  }) as CreateRouteInput;

describe('LogisticsNetworkService — route simulation boundary (TERM-SIM-ROUTE-FORM-CREATES-REAL-ROUTE)', () => {
  describe('createRoute', () => {
    it('HAPPY PATH: two real hubs, isTest omitted — creates a real route, unchanged from before', async () => {
      const { svc, created } = makeService([hub({ id: 'origin', isTest: false }), hub({ id: 'destination', isTest: false })]);
      await svc.createRoute(baseInput(), 'actor-1');
      expect(created).toHaveLength(1);
      expect((created[0] as { isTest: boolean }).isTest).toBe(false);
    });

    it('BRANCH 1 — REFUSE A MIXED PAIR: a real origin hub and a simulation destination hub is refused outright', async () => {
      const { svc, created } = makeService([hub({ id: 'origin', isTest: false }), hub({ id: 'destination', isTest: true })]);
      await expect(svc.createRoute(baseInput(), 'actor-1')).rejects.toThrow(BadRequestException);
      await expect(svc.createRoute(baseInput(), 'actor-1')).rejects.toThrow(/real hub.*simulation hub/i);
      expect(created).toHaveLength(0);
    });

    it('BRANCH 2 — DERIVE FROM HUBS: two simulation hubs, isTest omitted — creates a SIMULATION route, not a real one', async () => {
      const { svc, created } = makeService([hub({ id: 'origin', isTest: true }), hub({ id: 'destination', isTest: true })]);
      await svc.createRoute(baseInput(), 'actor-1');
      expect(created).toHaveLength(1);
      expect((created[0] as { isTest: boolean }).isTest).toBe(true);
    });

    it('BRANCH 3 — REFUSE A CONTRADICTION: two simulation hubs with isTest explicitly false is refused, not silently overridden', async () => {
      const { svc, created } = makeService([hub({ id: 'origin', isTest: true }), hub({ id: 'destination', isTest: true })]);
      await expect(svc.createRoute(baseInput({ isTest: false }), 'actor-1')).rejects.toThrow(BadRequestException);
      await expect(svc.createRoute(baseInput({ isTest: false }), 'actor-1')).rejects.toThrow(/simulation hubs/i);
      expect(created).toHaveLength(0);
    });

    it('an EXPLICIT isTest that matches the hubs is accepted (not every explicit value is a contradiction)', async () => {
      const { svc, created } = makeService([hub({ id: 'origin', isTest: true }), hub({ id: 'destination', isTest: true })]);
      await svc.createRoute(baseInput({ isTest: true }), 'actor-1');
      expect(created).toHaveLength(1);
      expect((created[0] as { isTest: boolean }).isTest).toBe(true);
    });

    it('the existing mode check still fires before the simulation-boundary check', async () => {
      const { svc } = makeService([hub({ id: 'origin', isTest: false, modes: ['AIR'] }), hub({ id: 'destination', isTest: false })]);
      await expect(svc.createRoute(baseInput({ mode: 'LAND' }), 'actor-1')).rejects.toThrow(/does not handle land transport/);
    });
  });

  describe('updateRoute — the same gap exists on the write path that can change a route\'s hubs after creation', () => {
    const updateInput = (overrides: Partial<UpdateRouteInput> = {}): UpdateRouteInput => overrides as UpdateRouteInput;

    it('HAPPY PATH: an unrelated field update (price) on an already-consistent real route succeeds', async () => {
      const { svc, updated } = makeService([hub({ id: 'origin', isTest: false }), hub({ id: 'destination', isTest: false })]);
      await svc.updateRoute('route-1', updateInput({ priceMinor: 2000 }), 'actor-1');
      expect(updated).toHaveLength(1);
      expect((updated[0] as { isTest: boolean }).isTest).toBe(false);
    });

    it('BRANCH 1 — REFUSE A MIXED PAIR: re-pointing a route at a mismatched destination hub is refused outright', async () => {
      const { svc, updated } = makeService([hub({ id: 'origin', isTest: false }), hub({ id: 'destination', isTest: true })]);
      await expect(svc.updateRoute('route-1', updateInput({ destinationHubId: 'destination' }), 'actor-1')).rejects.toThrow(
        /real hub.*simulation hub/i,
      );
      expect(updated).toHaveLength(0);
    });

    it('BRANCH 2 — DERIVE FROM HUBS: re-pointing both ends at simulation hubs with isTest omitted flips the route to simulation', async () => {
      const { svc, updated } = makeService([hub({ id: 'origin', isTest: true }), hub({ id: 'destination', isTest: true })]);
      await svc.updateRoute('route-1', updateInput({ originHubId: 'origin', destinationHubId: 'destination' }), 'actor-1');
      expect(updated).toHaveLength(1);
      expect((updated[0] as { isTest: boolean }).isTest).toBe(true);
    });

    it('BRANCH 3 — REFUSE A CONTRADICTION: re-pointing at two simulation hubs while asserting isTest: false is refused', async () => {
      const { svc, updated } = makeService([hub({ id: 'origin', isTest: true }), hub({ id: 'destination', isTest: true })]);
      await expect(
        svc.updateRoute('route-1', updateInput({ originHubId: 'origin', destinationHubId: 'destination', isTest: false }), 'actor-1'),
      ).rejects.toThrow(/simulation hubs/i);
      expect(updated).toHaveLength(0);
    });
  });
});
