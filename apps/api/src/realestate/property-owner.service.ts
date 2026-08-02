import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { UpsertPropertyOwnerProfileInput } from '@bmpl/validation';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface Actor {
  userId: string;
  status?: string;
}

/**
 * Property-owner profile (M25). Approval is via the PROPERTY_OWNER role-application
 * workflow (proof-of-ownership/identity document, admin review) — this profile mirrors
 * that (approvalStatus). All owner endpoints are @Roles('PROPERTY_OWNER') so only an
 * APPROVED owner reaches them; publishing additionally requires the profile is not
 * SUSPENDED. The role is NEVER auto-granted here (owners require approval).
 */
@Injectable()
export class PropertyOwnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Resolve the caller's owner profile id, or 404 (used by listing scoping). */
  async requireOwnerProfile(userId: string) {
    const p = await this.prisma.propertyOwnerProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Create your property-owner profile first.');
    return p;
  }

  /** Assert the owner may publish/manage listings (approved role + not suspended). */
  async requirePublishableOwner(userId: string) {
    const p = await this.requireOwnerProfile(userId);
    if (p.approvalStatus === 'SUSPENDED') throw new ForbiddenException('Your property-owner account is suspended.');
    return p;
  }

  async upsertProfile(actor: Actor, dto: UpsertPropertyOwnerProfileInput) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot manage a property-owner profile.');
    const existing = await this.prisma.propertyOwnerProfile.findUnique({ where: { userId: actor.userId } });
    const data = {
      legalName: dto.legalName,
      displayName: dto.displayName ?? undefined,
      phone: dto.phone ?? undefined,
      email: dto.email ?? undefined,
      district: dto.district ?? undefined,
      contactPreference: dto.contactPreference ?? undefined,
    };
    const profile = existing
      ? await this.prisma.propertyOwnerProfile.update({ where: { userId: actor.userId }, data })
      : await this.prisma.propertyOwnerProfile.create({
          // Mirrors the already-APPROVED PROPERTY_OWNER role that gated this endpoint.
          data: { userId: actor.userId, approvalStatus: 'APPROVED', ...data },
        });
    await this.audit.record({ action: 'PROPERTY_OWNER_PROFILE_UPSERTED', actorId: actor.userId, newValue: { propertyOwnerProfileId: profile.id } });
    return this.getOwn(actor.userId);
  }

  async getOwn(userId: string) {
    const p = await this.prisma.propertyOwnerProfile.findUnique({ where: { userId } });
    if (!p) return null;
    return p;
  }
}
