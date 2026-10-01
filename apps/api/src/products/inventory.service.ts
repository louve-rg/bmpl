import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { InventoryAdjustInput, InventorySettingsInput } from '@bmpl/validation';
import type { Inventory, InventoryLocation, Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OwnershipService } from './ownership.service';
import { BackInStockService } from './back-in-stock.service';

/** A checkout-time choice of which vendor location fulfils a line (BMPL-175). */
export interface LocationChoice {
  inventoryLocationId: string;
  locationId: string;
}

/**
 * `adopted: false` — the product has no InventoryLocation child rows at all;
 * the caller's existing single-bucket path applies, byte-for-byte unchanged.
 * `adopted: true, choice: null` — child rows exist but none can cover the
 * requested quantity. `adopted: true, choice: {...}` — the chosen row.
 */
export type LocationPick = { adopted: false } | { adopted: true; choice: LocationChoice | null };

type LocRow = Pick<InventoryLocation, 'inventoryId' | 'quantity' | 'reserved'>;

export interface ActorContext {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

export interface Availability {
  quantity: number;
  reserved: number;
  available: number | null; // null = unlimited
  unlimited: boolean;
  allowBackorders: boolean;
  lowStockThreshold: number;
  inStock: boolean;
  lowStock: boolean;
  outOfStock: boolean;
}

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ownership: OwnershipService,
    private readonly backInStock: BackInStockService,
  ) {}

  /** Pure derivation of stock state from an inventory row. */
  availability(inv: Inventory): Availability {
    const net = inv.quantity - inv.reserved;
    const available = inv.unlimited ? null : net;
    const inStock = inv.unlimited || net > 0 || inv.allowBackorders;
    const outOfStock = !inv.unlimited && !inv.allowBackorders && net <= 0;
    const lowStock = !inv.unlimited && net > 0 && net <= inv.lowStockThreshold;
    return {
      quantity: inv.quantity,
      reserved: inv.reserved,
      available,
      unlimited: inv.unlimited,
      allowBackorders: inv.allowBackorders,
      lowStockThreshold: inv.lowStockThreshold,
      inStock,
      lowStock,
      outOfStock,
    };
  }

  /** Get-or-create the product-level inventory row (variantId = null). */
  async ensureProductInventory(productId: string, tx: Tx = this.prisma): Promise<Inventory> {
    const existing = await tx.inventory.findFirst({ where: { productId, variantId: null } });
    if (existing) return existing;
    const inv = await tx.inventory.create({ data: { productId, variantId: null, quantity: 0 } });
    await tx.inventoryChange.create({
      data: { inventoryId: inv.id, delta: 0, reason: 'INITIAL', previousQty: 0, newQty: 0 },
    });
    return inv;
  }

  /** Create inventory for a new variant with opening quantity. */
  async ensureVariantInventory(
    productId: string,
    variantId: string,
    quantity: number,
    tx: Tx,
  ): Promise<Inventory> {
    const inv = await tx.inventory.create({ data: { productId, variantId, quantity } });
    await tx.inventoryChange.create({
      data: { inventoryId: inv.id, delta: quantity, reason: 'INITIAL', previousQty: 0, newQty: quantity },
    });
    return inv;
  }

  // ---- Vendor (owner) ----

  async getForProduct(userId: string, productId: string) {
    await this.ownership.ownedProduct(userId, productId);
    const productInv = await this.ensureProductInventory(productId);
    const variantRows = await this.prisma.inventory.findMany({
      where: { productId, variantId: { not: null } },
      include: { variant: { select: { id: true, sku: true } } },
    });
    // BMPL-175: a row that has adopted per-location tracking reports the SUM
    // across its locations here, not its own (stale once adopted) columns —
    // see effectiveFromMap's own comment.
    const locMap = await this.locationMapFor([productInv.id, ...variantRows.map((r) => r.id)]);
    // BMPL-372: `hasLocations` is the SAME "any child rows at all" check
    // adjust() now refuses on and chooseLocation() already branches on — one
    // fact, read the same way everywhere, so the vendor UI can gate the
    // legacy control before the vendor ever submits and hits the refusal.
    const hasLocations = (id: string) => (locMap.get(id)?.length ?? 0) > 0;
    return {
      product: { inventoryId: productInv.id, hasLocations: hasLocations(productInv.id), ...this.effectiveFromMap(productInv, locMap) },
      variants: variantRows.map((r) => ({
        inventoryId: r.id,
        variantId: r.variantId,
        sku: r.variant?.sku ?? null,
        hasLocations: hasLocations(r.id),
        ...this.effectiveFromMap(r, locMap),
      })),
    };
  }

  async updateSettings(
    userId: string,
    productId: string,
    variantId: string | null,
    dto: InventorySettingsInput,
  ) {
    await this.ownership.ownedProduct(userId, productId);
    const inv = await this.resolveTarget(productId, variantId);
    await this.prisma.inventory.update({
      where: { id: inv.id },
      data: {
        lowStockThreshold: dto.lowStockThreshold ?? undefined,
        unlimited: dto.unlimited ?? undefined,
        allowBackorders: dto.allowBackorders ?? undefined,
      },
    });
    return this.getForProduct(userId, productId);
  }

  /** Transactional on-hand adjustment with an append-only history entry + audit. */
  async adjust(actor: ActorContext, productId: string, variantId: string | null, dto: InventoryAdjustInput) {
    await this.ownership.ownedProduct(actor.userId, productId);
    const inv = await this.resolveTarget(productId, variantId);

    // BMPL-372: once a product has adopted per-location tracking (ANY
    // InventoryLocation child row exists, even one still at zero stock),
    // those rows are the real stock of record — chooseLocation() and every
    // read through effectiveFromMap() already sum THEM, not this row's own
    // quantity (see effectiveFromMap's own comment). Letting this endpoint
    // keep writing the parent column directly would make it a second,
    // unreconciled inventory system: the owner's own instruction when this
    // batch was reopened ("do not create a second inventory system",
    // "preserve all existing reservation/oversell protections"). There is no
    // well-defined way to reconcile a flat delta against a multi-location
    // split — which location absorbs it is a business decision this system
    // has never been told — so this refuses rather than guesses.
    const hasLocations = await this.prisma.inventoryLocation.findFirst({
      where: { inventoryId: inv.id },
      select: { id: true },
    });
    if (hasLocations) {
      throw new BadRequestException('This product tracks stock per location — adjust it there.');
    }

    // Detect an out-of-stock → in-stock crossing so we can fire back-in-stock alerts.
    let becameInStock = false;
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.inventory.findUniqueOrThrow({ where: { id: inv.id } });
      const newQty = current.quantity + dto.delta;
      if (newQty < 0) {
        throw new BadRequestException('Adjustment would drive on-hand quantity below zero.');
      }
      becameInStock =
        this.availability(current).outOfStock && this.availability({ ...current, quantity: newQty }).inStock;
      await tx.inventory.update({ where: { id: inv.id }, data: { quantity: newQty } });
      await tx.inventoryChange.create({
        data: {
          inventoryId: inv.id,
          delta: dto.delta,
          reason: dto.reason,
          previousQty: current.quantity,
          newQty,
          actorId: actor.userId,
          note: dto.note ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'INVENTORY_ADJUSTED',
          actorId: actor.userId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          previousValue: { quantity: current.quantity },
          newValue: { quantity: newQty, reason: dto.reason },
        },
        tx,
      );
    });
    // After the restock commits, notify + clear "back in stock" subscribers (one-shot).
    if (becameInStock) {
      await this.backInStock.notifyRestock(productId, inv.variantId);
    }
    return this.getForProduct(actor.userId, productId);
  }

  async history(userId: string, productId: string, variantId: string | null) {
    await this.ownership.ownedProduct(userId, productId);
    const inv = await this.resolveTarget(productId, variantId);
    const rows = await this.prisma.inventoryChange.findMany({
      where: { inventoryId: inv.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { actor: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((r) => ({
      delta: r.delta,
      reason: r.reason,
      previousQty: r.previousQty,
      newQty: r.newQty,
      note: r.note,
      createdAt: r.createdAt,
      actor: r.actor ? `${r.actor.firstName} ${r.actor.lastName}` : null,
    }));
  }

  // ---- Reservations (Phase 3 · wired by checkout/M10; transactional) ----

  /** The inventory row backing a purchasable (product-level or a variant); null if untracked. */
  async rowFor(productId: string, variantId: string | null, tx: Tx = this.prisma): Promise<Inventory | null> {
    return tx.inventory.findFirst({ where: { productId, variantId: variantId ?? null } });
  }

  /**
   * Serialises concurrent reservations against the same row (BMPL-256): the
   * lock is taken BEFORE the availability check is read, matching
   * wallet.service.ts's selfServiceTestCredit and passenger-operations.
   * service.ts's confirmBooking — a plain "read, check, write" is
   * check-then-act, and a concurrent writer committing between the read and
   * the write is invisible to it, so the read cannot be trusted without the
   * lock. Two customers racing for the last unit could otherwise both pass
   * the check and both have their reservation accepted.
   *
   * Meaningful only when `tx` is already inside a transaction the caller
   * controls — true for every call site except orders.service.ts's
   * reconcileTerminalReservations (maintenance tooling, not concurrency-
   * sensitive; see its own comment for why that's safe without one).
   */
  async reserve(inventoryId: string, qty: number, tx: Tx = this.prisma): Promise<void> {
    await tx.$queryRaw`SELECT id FROM inventory WHERE id = ${inventoryId} FOR UPDATE`;
    const inv = await tx.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    if (!inv.unlimited && !inv.allowBackorders && inv.quantity - inv.reserved < qty) {
      throw new BadRequestException('Insufficient stock to reserve.');
    }
    await tx.inventory.update({ where: { id: inventoryId }, data: { reserved: inv.reserved + qty } });
  }

  /** Same lock as reserve() above. The `Math.max(0, ...)` floor guard stays
   *  exactly as it was — once the row is locked for the whole read-then-write,
   *  a plain literal is exactly as safe as an atomic decrement, and swapping
   *  to `{ decrement: qty }` would silently drop the clamp (a release larger
   *  than the outstanding reservation would drive `reserved` negative). */
  async release(inventoryId: string, qty: number, tx: Tx = this.prisma): Promise<void> {
    await tx.$queryRaw`SELECT id FROM inventory WHERE id = ${inventoryId} FOR UPDATE`;
    const inv = await tx.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    await tx.inventory.update({
      where: { id: inventoryId },
      data: { reserved: Math.max(0, inv.reserved - qty) },
    });
  }

  /**
   * Finalize a reservation into a real stock deduction (M15, at pickup confirmation):
   * decrement BOTH on-hand `quantity` and `reserved` by `qty` and write an
   * append-only FULFILLED history row. Unlimited rows are untracked (no-op). The
   * caller guards exactly-once via `OrderDelivery.inventoryFinalizedAt`, so this is
   * never double-applied. `reserved` is clamped at 0; `quantity` may go negative
   * only under prior backorder oversell (an accepted "owed stock" state).
   */
  async finalizeReservation(inventoryId: string, qty: number, actorId: string | null, tx: Tx = this.prisma): Promise<void> {
    // Same lock as reserve()/release() above — this decrements both
    // `quantity` and `reserved` and has the identical exposure (BMPL-256).
    await tx.$queryRaw`SELECT id FROM inventory WHERE id = ${inventoryId} FOR UPDATE`;
    const inv = await tx.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    if (inv.unlimited) return; // nothing was reserved for an unlimited row
    const newQty = inv.quantity - qty;
    await tx.inventory.update({
      where: { id: inventoryId },
      data: { quantity: newQty, reserved: Math.max(0, inv.reserved - qty) },
    });
    await tx.inventoryChange.create({
      data: {
        inventoryId,
        delta: -qty,
        reason: 'FULFILLED',
        previousQty: inv.quantity,
        newQty,
        actorId: actorId ?? undefined,
        note: 'Delivery pickup confirmed',
      },
    });
  }

  // ---- Per-location inventory (BMPL-175 · Edward req 1) --------------------
  //
  // A product that never adopts per-location tracking has ZERO rows in
  // inventory_locations and every method above behaves exactly as it did
  // before this section existed. Everything below is additive: a SECOND
  // table the same lock-check-write discipline (BMPL-256) is mirrored onto,
  // never a second way to reserve against the SAME row. Exactly one
  // reservation decision is made per checkout line, against exactly one row
  // — chosen by chooseLocation() BEFORE reserving, never both.

  /**
   * Pick which location fulfils one checkout line, by AVAILABILITY ONLY,
   * VendorLocation.isPrimary then createdAt as the tie-break — the same
   * order vendor.service.ts's STOREFRONT_INCLUDE already lists locations in.
   * DeliveryPricingService.quote() carries no locationId and does no
   * routing, so "most efficient origin" is not a capability this system
   * has; availability is the only honest signal. Never splits one line's
   * quantity across two locations — a line is reserved whole, against
   * whichever single location can cover it, or refused.
   */
  async chooseLocation(inv: Inventory, qty: number, tx: Tx = this.prisma): Promise<LocationPick> {
    const rows = await tx.inventoryLocation.findMany({
      where: { inventoryId: inv.id },
      include: { location: { select: { isPrimary: true, createdAt: true } } },
    });
    if (rows.length === 0) return { adopted: false };
    const eligible = rows.filter((r) => {
      const a = this.availability({ ...inv, quantity: r.quantity, reserved: r.reserved });
      return a.allowBackorders || (a.available !== null && a.available >= qty);
    });
    if (eligible.length === 0) return { adopted: true, choice: null };
    eligible.sort((a, b) => {
      if (a.location.isPrimary !== b.location.isPrimary) return a.location.isPrimary ? -1 : 1;
      return a.location.createdAt.getTime() - b.location.createdAt.getTime();
    });
    const chosen = eligible[0]!;
    return { adopted: true, choice: { inventoryLocationId: chosen.id, locationId: chosen.locationId } };
  }

  /**
   * Same lock discipline as reserve() above (BMPL-256): the lock is taken
   * before the availability check is read. `inv` is the PARENT row, passed
   * in by the caller (who already has it from chooseLocation) rather than
   * re-queried here, since settings (unlimited/allowBackorders) live there,
   * not on the child row being locked.
   */
  async reserveAtLocation(inv: Inventory, inventoryLocationId: string, qty: number, tx: Tx = this.prisma): Promise<void> {
    await tx.$queryRaw`SELECT id FROM inventory_locations WHERE id = ${inventoryLocationId} FOR UPDATE`;
    const row = await tx.inventoryLocation.findUniqueOrThrow({ where: { id: inventoryLocationId } });
    if (!inv.unlimited && !inv.allowBackorders && row.quantity - row.reserved < qty) {
      throw new BadRequestException('Insufficient stock to reserve.');
    }
    await tx.inventoryLocation.update({ where: { id: inventoryLocationId }, data: { reserved: row.reserved + qty } });
  }

  /** Same lock and floor-clamp reasoning as release() above — no parent-row
   *  settings dependency, so no `inv` parameter needed. */
  async releaseAtLocation(inventoryLocationId: string, qty: number, tx: Tx = this.prisma): Promise<void> {
    await tx.$queryRaw`SELECT id FROM inventory_locations WHERE id = ${inventoryLocationId} FOR UPDATE`;
    const row = await tx.inventoryLocation.findUniqueOrThrow({ where: { id: inventoryLocationId } });
    await tx.inventoryLocation.update({
      where: { id: inventoryLocationId },
      data: { reserved: Math.max(0, row.reserved - qty) },
    });
  }

  /** Same lock/shape as finalizeReservation() above, against the child row;
   *  `inv.unlimited` (parent setting) still short-circuits identically. */
  async finalizeLocationReservation(
    inv: Inventory,
    inventoryLocationId: string,
    qty: number,
    actorId: string | null,
    tx: Tx = this.prisma,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM inventory_locations WHERE id = ${inventoryLocationId} FOR UPDATE`;
    const row = await tx.inventoryLocation.findUniqueOrThrow({ where: { id: inventoryLocationId } });
    if (inv.unlimited) return;
    const newQty = row.quantity - qty;
    await tx.inventoryLocation.update({
      where: { id: inventoryLocationId },
      data: { quantity: newQty, reserved: Math.max(0, row.reserved - qty) },
    });
    await tx.inventoryChange.create({
      data: {
        inventoryId: row.inventoryId,
        locationId: row.locationId,
        delta: -qty,
        reason: 'FULFILLED',
        previousQty: row.quantity,
        newQty,
        actorId: actorId ?? undefined,
        note: 'Delivery pickup confirmed',
      },
    });
  }

  /** The per-location child row for one inventory row + location, or null if
   *  that product has no stock recorded at that specific location. */
  async rowForLocation(inventoryId: string, locationId: string, tx: Tx = this.prisma): Promise<InventoryLocation | null> {
    return tx.inventoryLocation.findUnique({ where: { inventoryId_locationId: { inventoryId, locationId } } });
  }

  /** Get-or-create the child row for one inventory row + location. The first
   *  stock write at a location "adopts" per-location tracking for THAT
   *  product only — every other product at the vendor is untouched. */
  private async ensureLocationInventory(inventoryId: string, locationId: string, tx: Tx): Promise<InventoryLocation> {
    const existing = await this.rowForLocation(inventoryId, locationId, tx);
    if (existing) return existing;
    return tx.inventoryLocation.create({ data: { inventoryId, locationId, quantity: 0 } });
  }

  /**
   * The availability one Inventory row + its InventoryLocation children (if
   * any) resolve to. A row with children reports their SUM as quantity/
   * reserved (children are the source of truth once adopted); settings
   * (unlimited/allowBackorders/lowStockThreshold) always come from the
   * PARENT row, which stays the identity/settings anchor regardless of
   * adoption. A row with zero children reports its own columns, unchanged —
   * this is the SAME sum-across-rows shape publicAvailability/summaryFor/
   * inStockMap already use one level up (across sibling Inventory rows per
   * productId), extended to the new level.
   *
   * Public: every OTHER caller of availability(inv) on a raw Inventory row
   * outside this class (cart.service.ts's stock checks, variants.service.ts's
   * public variant listing) has the exact same staleness exposure once a
   * product adopts per-location tracking, and must route through this (or
   * effectiveAvailability/locationMapFor below) instead — see their own call
   * sites for why each one batches.
   */
  effectiveFromMap(row: Inventory, locByInv: Map<string, LocRow[]>): Availability {
    if (row.unlimited) return this.availability(row);
    const locs = locByInv.get(row.id);
    if (!locs || locs.length === 0) return this.availability(row);
    const quantity = locs.reduce((s, x) => s + x.quantity, 0);
    const reserved = locs.reduce((s, x) => s + x.reserved, 0);
    return this.availability({ ...row, quantity, reserved });
  }

  /** Batch-fetch InventoryLocation rows for several Inventory ids at once —
   *  one query, grouped by inventoryId — so callers over many products never
   *  reintroduce the N+1 publicAvailability/summaryFor/inStockMap already
   *  avoid at the sibling-row level. Public for the same reason as
   *  effectiveFromMap above. */
  async locationMapFor(inventoryIds: string[], tx: Tx = this.prisma): Promise<Map<string, LocRow[]>> {
    const out = new Map<string, LocRow[]>();
    if (!inventoryIds.length) return out;
    const rows = await tx.inventoryLocation.findMany({ where: { inventoryId: { in: inventoryIds } } });
    for (const r of rows) {
      const list = out.get(r.inventoryId) ?? [];
      list.push(r);
      out.set(r.inventoryId, list);
    }
    return out;
  }

  /** Single-row convenience wrapper — see locationMapFor/effectiveFromMap. */
  async effectiveAvailability(inv: Inventory, tx: Tx = this.prisma): Promise<Availability> {
    return this.effectiveFromMap(inv, await this.locationMapFor([inv.id], tx));
  }

  /** Vendor: per-location stock for one product/variant — one row per
   *  vendor location, present even if never adjusted there (reads as zero,
   *  matching a never-adjusted product-level row's own convention). */
  async getLocationsForProduct(userId: string, productId: string, variantId: string | null) {
    const product = await this.ownership.ownedProduct(userId, productId);
    const inv = await this.resolveTarget(productId, variantId);
    const [locations, rows] = await Promise.all([
      this.prisma.vendorLocation.findMany({
        where: { vendorProfileId: product.vendorProfileId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.inventoryLocation.findMany({ where: { inventoryId: inv.id } }),
    ]);
    const byLocation = new Map(rows.map((r) => [r.locationId, r]));
    return locations.map((loc) => {
      const row = byLocation.get(loc.id);
      const quantity = row?.quantity ?? 0;
      const reserved = row?.reserved ?? 0;
      return {
        locationId: loc.id,
        label: loc.label,
        isPrimary: loc.isPrimary,
        adopted: row != null,
        inventoryLocationId: row?.id ?? null,
        ...this.availability({ ...inv, quantity, reserved }),
      };
    });
  }

  /**
   * Vendor: adjust on-hand quantity AT ONE LOCATION by a signed delta — the
   * location-scoped sibling of adjust() above. Same validated input shape
   * (delta/reason/note), same append-only InventoryChange history (with
   * locationId set) and audit action, same back-in-stock crossing detection
   * — now evaluated on the product's AGGREGATE availability across all its
   * locations (what a customer sees), not this one location in isolation.
   * No row lock (`FOR UPDATE`): matches adjust()'s own precedent — a vendor
   * manually correcting stock is not the concurrent-customer race BMPL-256
   * exists for.
   */
  async adjustAtLocation(
    actor: ActorContext,
    productId: string,
    variantId: string | null,
    locationId: string,
    dto: InventoryAdjustInput,
  ) {
    const product = await this.ownership.ownedProduct(actor.userId, productId);
    await this.ownLocationOrThrow(product.vendorProfileId, locationId);
    const inv = await this.resolveTarget(productId, variantId);

    let becameInStock = false;
    await this.prisma.$transaction(async (tx) => {
      const row = await this.ensureLocationInventory(inv.id, locationId, tx);
      const current = await tx.inventoryLocation.findUniqueOrThrow({ where: { id: row.id } });
      const newQty = current.quantity + dto.delta;
      if (newQty < 0) {
        throw new BadRequestException('Adjustment would drive on-hand quantity below zero.');
      }

      const before = await this.effectiveAvailability(inv, tx);
      await tx.inventoryLocation.update({ where: { id: row.id }, data: { quantity: newQty } });
      const after = await this.effectiveAvailability(inv, tx);
      becameInStock = before.outOfStock && after.inStock;

      await tx.inventoryChange.create({
        data: {
          inventoryId: inv.id,
          locationId,
          delta: dto.delta,
          reason: dto.reason,
          previousQty: current.quantity,
          newQty,
          actorId: actor.userId,
          note: dto.note ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'INVENTORY_ADJUSTED',
          actorId: actor.userId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          previousValue: { quantity: current.quantity, locationId },
          newValue: { quantity: newQty, reason: dto.reason, locationId },
        },
        tx,
      );
    });
    if (becameInStock) {
      await this.backInStock.notifyRestock(productId, inv.variantId);
    }
    return this.getLocationsForProduct(actor.userId, productId, variantId);
  }

  private async ownLocationOrThrow(vendorProfileId: string, locationId: string) {
    const loc = await this.prisma.vendorLocation.findUnique({ where: { id: locationId } });
    if (!loc || loc.vendorProfileId !== vendorProfileId) throw new NotFoundException('Location not found.');
    return loc;
  }

  // ---- Public availability (used by ProductsService) ----

  /** Aggregate availability for a product: product-level row, else any variant in stock. */
  async publicAvailability(productId: string): Promise<{
    inStock: boolean;
    lowStock: boolean;
    outOfStock: boolean;
    available: number | null;
    unlimited: boolean;
    allowBackorders: boolean;
  }> {
    const rows = await this.prisma.inventory.findMany({ where: { productId } });
    // No inventory tracked yet → purchasable, no cap.
    if (rows.length === 0) {
      return { inStock: true, lowStock: false, outOfStock: false, available: null, unlimited: false, allowBackorders: false };
    }
    // BMPL-175: a row that has adopted per-location tracking reports the SUM
    // across its locations, not its own (stale once adopted) columns.
    const locMap = await this.locationMapFor(rows.map((r) => r.id));
    const avails = rows.map((r) => this.effectiveFromMap(r, locMap));
    const unlimited = avails.some((a) => a.unlimited);
    return {
      inStock: avails.some((a) => a.inStock),
      lowStock: avails.every((a) => a.lowStock || a.outOfStock) && avails.some((a) => a.lowStock),
      outOfStock: avails.every((a) => a.outOfStock),
      unlimited,
      allowBackorders: avails.some((a) => a.allowBackorders),
      // Aggregate purchasable units across the product's inventory rows (null = unlimited).
      available: unlimited ? null : avails.reduce((sum, a) => sum + Math.max(0, a.available ?? 0), 0),
    };
  }

  /**
   * Batch stock summary per product id for owner listings (F3): total available
   * units and a coarse status. Single query; safe on the empty set.
   */
  async summaryFor(
    productIds: string[],
  ): Promise<Map<string, { available: number | null; unlimited: boolean; status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'UNTRACKED' }>> {
    const out = new Map<string, { available: number | null; unlimited: boolean; status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'UNTRACKED' }>();
    if (!productIds.length) return out;
    const rows = await this.prisma.inventory.findMany({ where: { productId: { in: productIds } } });
    // BMPL-175: batched once for every row here, same reasoning as publicAvailability.
    const locMap = await this.locationMapFor(rows.map((r) => r.id));
    const byProduct = new Map<string, ReturnType<InventoryService['availability']>[]>();
    for (const r of rows) {
      const list = byProduct.get(r.productId) ?? [];
      list.push(this.effectiveFromMap(r, locMap));
      byProduct.set(r.productId, list);
    }
    for (const id of productIds) {
      const avails = byProduct.get(id);
      if (!avails || avails.length === 0) {
        out.set(id, { available: null, unlimited: false, status: 'UNTRACKED' });
        continue;
      }
      const unlimited = avails.some((a) => a.unlimited);
      const available = unlimited ? null : avails.reduce((s, a) => s + Math.max(0, a.available ?? 0), 0);
      const status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'UNTRACKED' = unlimited
        ? 'IN_STOCK'
        : avails.every((a) => a.outOfStock)
          ? 'OUT_OF_STOCK'
          : avails.some((a) => a.lowStock) && avails.every((a) => a.lowStock || a.outOfStock)
            ? 'LOW_STOCK'
            : 'IN_STOCK';
      out.set(id, { available, unlimited, status });
    }
    return out;
  }

  /** Batched in-stock map for listings (avoids N+1). */
  async inStockMap(productIds: string[]): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    if (!productIds.length) return out;
    const rows = await this.prisma.inventory.findMany({ where: { productId: { in: productIds } } });
    // BMPL-175: batched once for every row here, same reasoning as publicAvailability.
    const locMap = await this.locationMapFor(rows.map((r) => r.id));
    const byProduct = new Map<string, Inventory[]>();
    for (const r of rows) {
      const list = byProduct.get(r.productId) ?? [];
      list.push(r);
      byProduct.set(r.productId, list);
    }
    for (const id of productIds) {
      const list = byProduct.get(id);
      out.set(id, !list || list.length === 0 ? true : list.some((r) => this.effectiveFromMap(r, locMap).inStock));
    }
    return out;
  }

  // ---- helpers ----

  private async resolveTarget(productId: string, variantId: string | null): Promise<Inventory> {
    if (variantId) {
      const inv = await this.prisma.inventory.findFirst({ where: { productId, variantId } });
      if (!inv) throw new NotFoundException('Variant inventory not found.');
      return inv;
    }
    return this.ensureProductInventory(productId);
  }
}
