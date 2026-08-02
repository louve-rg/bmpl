import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizeCouponCode } from '@bmpl/shared';
import type {
  CouponStatusInput,
  CreateCouponInput,
  CreatePlatformCouponInput,
  UpdateCouponInput,
  ValidateCouponInput,
} from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface Actor {
  userId: string;
  status?: string;
  permissions?: string[];
}

const n = (v: bigint | null | undefined) => (v == null ? null : Number(v));
const bi = (v: number | null | undefined) => (v == null ? null : BigInt(v));

export interface CouponValidationResult {
  valid: boolean;
  discountMinor: number;
  freeShipping: boolean;
  reason?: string;
  couponId?: string;
  code?: string;
}

/**
 * Coupons (M26). Vendor-scoped coupons are owned by a VendorProfile; a vendor can
 * create/update/activate ONLY their own VENDOR-scoped coupons (scope is forced). Platform
 * (scope PLATFORM) coupons are admin-only. `validate()` computes a discount WITHOUT
 * redeeming or touching the wallet; `redeem()` exists for future checkout integration and
 * is intentionally NOT wired into orders/wallet here (rule #5).
 */
@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  // Vendor ownership
  // ===========================================================================
  /** The acting user's vendor profile, or 404/403. Vendor coupons require one. */
  private async requireVendorProfile(userId: string) {
    const vp = await this.prisma.vendorProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!vp) throw new ForbiddenException('You need a vendor profile to manage coupons.');
    return vp;
  }

  private async requireOwnedVendorCoupon(actor: Actor, couponId: string) {
    const vp = await this.requireVendorProfile(actor.userId);
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon || coupon.scope !== 'VENDOR' || coupon.vendorProfileId !== vp.id) throw new NotFoundException('Coupon not found.');
    return coupon;
  }

  // ===========================================================================
  // Vendor CRUD
  // ===========================================================================
  async vendorCreate(actor: Actor, dto: CreateCouponInput) {
    const vp = await this.requireVendorProfile(actor.userId);
    if (dto.campaignId) await this.requireOwnedCampaign(actor, dto.campaignId);
    try {
      const coupon = await this.prisma.coupon.create({
        data: {
          code: normalizeCouponCode(dto.code),
          ownerUserId: actor.userId,
          vendorProfileId: vp.id,
          scope: 'VENDOR',
          campaignId: dto.campaignId ?? null,
          discountType: dto.discountType,
          percentOff: dto.percentOff ?? null,
          amountOffMinor: bi(dto.amountOffMinor),
          freeShipping: dto.freeShipping ?? false,
          minSpendMinor: bi(dto.minSpendMinor),
          maxDiscountMinor: bi(dto.maxDiscountMinor),
          maxUses: dto.maxUses ?? null,
          perUserLimit: dto.perUserLimit ?? null,
          stackable: dto.stackable ?? false,
          status: 'INACTIVE',
          startAt: dto.startAt ?? null,
          endAt: dto.endAt ?? null,
        },
      });
      await this.audit.record({ action: 'COUPON_CREATED', actorId: actor.userId, newValue: { couponId: coupon.id, scope: 'VENDOR' } });
      return this.serialize(coupon);
    } catch (e) {
      throw this.mapCreateError(e);
    }
  }

  async vendorUpdate(actor: Actor, couponId: string, dto: UpdateCouponInput) {
    await this.requireOwnedVendorCoupon(actor, couponId);
    const coupon = await this.prisma.coupon.update({ where: { id: couponId }, data: this.updateData(dto) });
    await this.audit.record({ action: 'COUPON_UPDATED', actorId: actor.userId, newValue: { couponId } });
    return this.serialize(coupon);
  }

  async vendorSetStatus(actor: Actor, couponId: string, dto: CouponStatusInput) {
    await this.requireOwnedVendorCoupon(actor, couponId);
    const coupon = await this.prisma.coupon.update({ where: { id: couponId }, data: { status: dto.status } });
    await this.audit.record({ action: 'COUPON_STATUS_CHANGED', actorId: actor.userId, newValue: { couponId, status: dto.status } });
    return this.serialize(coupon);
  }

  async vendorList(actor: Actor, status?: string) {
    const vp = await this.requireVendorProfile(actor.userId);
    const rows = await this.prisma.coupon.findMany({
      where: { scope: 'VENDOR', vendorProfileId: vp.id, ...(status ? { status: status as never } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return rows.map((c) => this.serialize(c));
  }

  async vendorDetail(actor: Actor, couponId: string) {
    const coupon = await this.requireOwnedVendorCoupon(actor, couponId);
    return this.serialize(coupon);
  }

  // ===========================================================================
  // Validation (no redemption, no wallet)
  // ===========================================================================
  async validate(dto: ValidateCouponInput): Promise<CouponValidationResult> {
    const code = normalizeCouponCode(dto.code);
    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    const fail = (reason: string): CouponValidationResult => ({ valid: false, discountMinor: 0, freeShipping: false, reason });
    if (!coupon) return fail('Coupon not found.');
    if (coupon.status !== 'ACTIVE') return fail('This coupon is not active.');
    const now = new Date();
    if (coupon.startAt && coupon.startAt > now) return fail('This coupon is not active yet.');
    if (coupon.endAt && coupon.endAt < now) return fail('This coupon has expired.');
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) return fail('This coupon has reached its usage limit.');
    if (coupon.scope === 'VENDOR' && (!dto.vendorProfileId || dto.vendorProfileId !== coupon.vendorProfileId)) {
      return fail('This coupon does not apply to these items.');
    }
    const minSpend = n(coupon.minSpendMinor);
    if (minSpend != null && dto.subtotalMinor < minSpend) return fail(`A minimum spend of ${minSpend} (minor units) is required.`);

    const discountMinor = this.computeDiscount(coupon, dto.subtotalMinor);
    return { valid: true, discountMinor, freeShipping: coupon.freeShipping, couponId: coupon.id, code: coupon.code };
  }

  /** Discount in minor units, capped at maxDiscountMinor and at the subtotal. */
  private computeDiscount(coupon: { discountType: string; percentOff: number | null; amountOffMinor: bigint | null; maxDiscountMinor: bigint | null }, subtotalMinor: number): number {
    let discount =
      coupon.discountType === 'PERCENTAGE'
        ? Math.floor((subtotalMinor * (coupon.percentOff ?? 0)) / 100)
        : Number(coupon.amountOffMinor ?? 0n);
    const cap = n(coupon.maxDiscountMinor);
    if (cap != null) discount = Math.min(discount, cap);
    return Math.max(0, Math.min(discount, subtotalMinor));
  }

  // ===========================================================================
  // Redemption (FUTURE — callable + testable, NOT wired to orders/wallet)
  // ===========================================================================
  /**
   * Record a coupon redemption for a user, enforcing maxUses (global) and perUserLimit
   * (per user) via CouponUsage counts. Deliberately not invoked by any order/wallet flow
   * yet — this is the future checkout hook (rule #5).
   */
  async redeem(couponId: string, userId: string, discountAppliedMinor: number, orderId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
      if (!coupon) throw new NotFoundException('Coupon not found.');
      if (coupon.status !== 'ACTIVE') throw new BadRequestException('This coupon is not active.');
      const now = new Date();
      if (coupon.startAt && coupon.startAt > now) throw new BadRequestException('This coupon is not active yet.');
      if (coupon.endAt && coupon.endAt < now) throw new BadRequestException('This coupon has expired.');
      if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) throw new BadRequestException('This coupon has reached its usage limit.');
      if (coupon.perUserLimit != null) {
        const usedByUser = await tx.couponUsage.count({ where: { couponId, userId } });
        if (usedByUser >= coupon.perUserLimit) throw new BadRequestException('You have already used this coupon the maximum number of times.');
      }
      const usage = await tx.couponUsage.create({
        data: { couponId, userId, orderId: orderId ?? null, discountAppliedMinor: BigInt(Math.max(0, Math.trunc(discountAppliedMinor))) },
      });
      await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
      await this.audit.record({ action: 'COUPON_REDEEMED', actorId: userId, newValue: { couponId, usageId: usage.id, orderId: orderId ?? null } }, tx);
      return { id: usage.id, couponId, discountAppliedMinor: Number(usage.discountAppliedMinor), redeemedAt: usage.redeemedAt };
    });
  }

  // ===========================================================================
  // Admin (coupons.manage) — platform + vendor oversight
  // ===========================================================================
  async adminList(filter: { scope?: string; status?: string; vendorProfileId?: string }) {
    const rows = await this.prisma.coupon.findMany({
      where: {
        ...(filter.scope ? { scope: filter.scope as never } : {}),
        ...(filter.status ? { status: filter.status as never } : {}),
        ...(filter.vendorProfileId ? { vendorProfileId: filter.vendorProfileId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { vendorProfile: { select: { businessName: true, slug: true } }, _count: { select: { usages: true } } },
    });
    return rows.map((c) => ({ ...this.serialize(c), vendor: c.vendorProfile ? { businessName: c.vendorProfile.businessName, slug: c.vendorProfile.slug } : null, usageCount: c._count.usages }));
  }

  async adminCreatePlatform(actor: Actor, dto: CreatePlatformCouponInput) {
    if (dto.campaignId) await this.requireCampaign(dto.campaignId);
    try {
      const coupon = await this.prisma.coupon.create({
        data: {
          code: normalizeCouponCode(dto.code),
          ownerUserId: actor.userId,
          scope: dto.scope ?? 'PLATFORM',
          campaignId: dto.campaignId ?? null,
          discountType: dto.discountType,
          percentOff: dto.percentOff ?? null,
          amountOffMinor: bi(dto.amountOffMinor),
          freeShipping: dto.freeShipping ?? false,
          minSpendMinor: bi(dto.minSpendMinor),
          maxDiscountMinor: bi(dto.maxDiscountMinor),
          maxUses: dto.maxUses ?? null,
          perUserLimit: dto.perUserLimit ?? null,
          stackable: dto.stackable ?? false,
          status: 'INACTIVE',
          startAt: dto.startAt ?? null,
          endAt: dto.endAt ?? null,
        },
      });
      await this.audit.record({ action: 'COUPON_CREATED', actorId: actor.userId, newValue: { couponId: coupon.id, scope: coupon.scope } });
      return this.serialize(coupon);
    } catch (e) {
      throw this.mapCreateError(e);
    }
  }

  async adminUpdate(actor: Actor, couponId: string, dto: UpdateCouponInput) {
    await this.requireCoupon(couponId);
    const coupon = await this.prisma.coupon.update({ where: { id: couponId }, data: this.updateData(dto) });
    await this.audit.record({ action: 'COUPON_UPDATED', actorId: actor.userId, newValue: { couponId } });
    return this.serialize(coupon);
  }

  async adminSetStatus(actor: Actor, couponId: string, dto: CouponStatusInput) {
    await this.requireCoupon(couponId);
    const coupon = await this.prisma.coupon.update({ where: { id: couponId }, data: { status: dto.status } });
    await this.audit.record({ action: 'COUPON_STATUS_CHANGED', actorId: actor.userId, newValue: { couponId, status: dto.status } });
    return this.serialize(coupon);
  }

  // ===========================================================================
  // helpers
  // ===========================================================================
  private updateData(dto: UpdateCouponInput): Prisma.CouponUpdateInput {
    return {
      percentOff: dto.percentOff === undefined ? undefined : dto.percentOff,
      amountOffMinor: dto.amountOffMinor === undefined ? undefined : bi(dto.amountOffMinor),
      freeShipping: dto.freeShipping ?? undefined,
      minSpendMinor: dto.minSpendMinor === undefined ? undefined : bi(dto.minSpendMinor),
      maxDiscountMinor: dto.maxDiscountMinor === undefined ? undefined : bi(dto.maxDiscountMinor),
      maxUses: dto.maxUses === undefined ? undefined : dto.maxUses,
      perUserLimit: dto.perUserLimit === undefined ? undefined : dto.perUserLimit,
      stackable: dto.stackable ?? undefined,
      startAt: dto.startAt === undefined ? undefined : dto.startAt,
      endAt: dto.endAt === undefined ? undefined : dto.endAt,
    };
  }

  private async requireCoupon(couponId: string) {
    const c = await this.prisma.coupon.findUnique({ where: { id: couponId }, select: { id: true } });
    if (!c) throw new NotFoundException('Coupon not found.');
    return c;
  }

  private async requireCampaign(campaignId: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
    if (!c) throw new BadRequestException('Campaign not found.');
  }

  private async requireOwnedCampaign(actor: Actor, campaignId: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { ownerUserId: true } });
    if (!c || c.ownerUserId !== actor.userId) throw new BadRequestException('Campaign not found.');
  }

  private mapCreateError(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return new BadRequestException('That coupon code is already in use.');
    return e as Error;
  }

  private serialize(c: {
    id: string; code: string; scope: string; campaignId: string | null; discountType: string; percentOff: number | null;
    amountOffMinor: bigint | null; freeShipping: boolean; minSpendMinor: bigint | null; maxDiscountMinor: bigint | null;
    maxUses: number | null; perUserLimit: number | null; usedCount: number; stackable: boolean; status: string;
    startAt: Date | null; endAt: Date | null; createdAt: Date; updatedAt: Date; vendorProfileId: string | null;
  }) {
    return {
      id: c.id,
      code: c.code,
      scope: c.scope,
      vendorProfileId: c.vendorProfileId,
      campaignId: c.campaignId,
      discountType: c.discountType,
      percentOff: c.percentOff,
      amountOffMinor: n(c.amountOffMinor),
      freeShipping: c.freeShipping,
      minSpendMinor: n(c.minSpendMinor),
      maxDiscountMinor: n(c.maxDiscountMinor),
      maxUses: c.maxUses,
      perUserLimit: c.perUserLimit,
      usedCount: c.usedCount,
      stackable: c.stackable,
      status: c.status,
      startAt: c.startAt,
      endAt: c.endAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
}
