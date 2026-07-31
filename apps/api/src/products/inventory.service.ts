import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { InventoryAdjustInput, InventorySettingsInput } from '@bmpl/validation';
import type { Inventory, Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OwnershipService } from './ownership.service';

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
    return {
      product: { inventoryId: productInv.id, ...this.availability(productInv) },
      variants: variantRows.map((r) => ({
        inventoryId: r.id,
        variantId: r.variantId,
        sku: r.variant?.sku ?? null,
        ...this.availability(r),
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

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.inventory.findUniqueOrThrow({ where: { id: inv.id } });
      const newQty = current.quantity + dto.delta;
      if (newQty < 0) {
        throw new BadRequestException('Adjustment would drive on-hand quantity below zero.');
      }
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

  async reserve(inventoryId: string, qty: number, tx: Tx = this.prisma): Promise<void> {
    const inv = await tx.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    if (!inv.unlimited && !inv.allowBackorders && inv.quantity - inv.reserved < qty) {
      throw new BadRequestException('Insufficient stock to reserve.');
    }
    await tx.inventory.update({ where: { id: inventoryId }, data: { reserved: inv.reserved + qty } });
  }

  async release(inventoryId: string, qty: number, tx: Tx = this.prisma): Promise<void> {
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
    const avails = rows.map((r) => this.availability(r));
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
    const byProduct = new Map<string, ReturnType<InventoryService['availability']>[]>();
    for (const r of rows) {
      const list = byProduct.get(r.productId) ?? [];
      list.push(this.availability(r));
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
    const byProduct = new Map<string, Inventory[]>();
    for (const r of rows) {
      const list = byProduct.get(r.productId) ?? [];
      list.push(r);
      byProduct.set(r.productId, list);
    }
    for (const id of productIds) {
      const list = byProduct.get(id);
      out.set(id, !list || list.length === 0 ? true : list.some((r) => this.availability(r).inStock));
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
