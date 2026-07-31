import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DOCUMENT_EXPIRY_SOON_DAYS,
  expiryStatus,
  isAllowedProductImageMime,
  isExpiredOrMissing,
  MAX_PRODUCT_IMAGE_BYTES,
  STORAGE_PREFIX,
  type DriverAvailability,
} from '@bmpl/shared';
import type {
  DriverAvailabilityInput,
  DriverProfileInput,
  DriverProfileUpdateInput,
  DriverServiceAreasInput,
  DriverVehicleInput,
  DriverVehicleUpdateInput,
} from '@bmpl/validation';
import type { DriverProfile, DriverVehicle, Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

@Injectable()
export class DriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // ---- role approval (source of truth: the DELIVERY_DRIVER UserRole) ----
  private async roleStatus(userId: string): Promise<string | null> {
    const r = await this.prisma.userRole.findUnique({
      where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
      select: { status: true },
    });
    return r?.status ?? null;
  }

  private async ownProfileOrThrow(userId: string): Promise<DriverProfile> {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Start your driver application first.');
    return p;
  }

  // ===========================================================================
  // Profile / application data
  // ===========================================================================
  async getProfile(userId: string) {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId } });
    return p ? this.serializeProfile(p) : null;
  }

  /** Create or update the driver's profile/application data. Available to any
   *  customer (applying); operational status is gated separately. */
  async upsertProfile(userId: string, dto: DriverProfileInput) {
    const data = {
      legalName: dto.legalName,
      displayName: dto.displayName,
      phone: dto.phone,
      homeDistrict: dto.homeDistrict,
      homeAddress: dto.homeAddress ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      emergencyContactName: dto.emergencyContactName ?? null,
      emergencyContactPhone: dto.emergencyContactPhone ?? null,
      licenceNumber: dto.licenceNumber,
      licenceExpiry: dto.licenceExpiry,
      vehicleOwnership: dto.vehicleOwnership,
      termsAcceptedAt: dto.termsAccepted ? new Date() : null,
      applicantNotes: dto.applicantNotes ?? null,
      profilePhotoKey: dto.profilePhotoKey ?? undefined,
    };
    const p = await this.prisma.driverProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await this.audit.record({ action: 'DRIVER_PROFILE_UPSERTED', actorId: userId, targetUserId: userId });
    return this.serializeProfile(p);
  }

  async updateProfile(userId: string, dto: DriverProfileUpdateInput) {
    await this.ownProfileOrThrow(userId);
    const data: Prisma.DriverProfileUpdateInput = {};
    for (const k of ['legalName', 'displayName', 'phone', 'homeDistrict', 'licenceNumber', 'vehicleOwnership'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
    }
    for (const k of ['homeAddress', 'latitude', 'longitude', 'emergencyContactName', 'emergencyContactPhone', 'applicantNotes', 'profilePhotoKey'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k] ?? null;
    }
    if (dto.licenceExpiry !== undefined) data.licenceExpiry = dto.licenceExpiry;
    if (dto.termsAccepted !== undefined) data.termsAcceptedAt = dto.termsAccepted ? new Date() : null;
    const p = await this.prisma.driverProfile.update({ where: { userId }, data });
    return this.serializeProfile(p);
  }

  // ---- private photo uploads (profile + vehicle) ----
  async presignProfilePhoto(userId: string, fileName: string, contentType: string) {
    if (!isAllowedProductImageMime(contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    const key = this.storage.buildKey(STORAGE_PREFIX.driverPhoto(userId), fileName);
    return this.storage.presignUpload(key, contentType, 'private');
  }
  async presignVehiclePhoto(userId: string, fileName: string, contentType: string) {
    if (!isAllowedProductImageMime(contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    const key = this.storage.buildKey(STORAGE_PREFIX.driverVehiclePhoto(userId), fileName);
    return this.storage.presignUpload(key, contentType, 'private');
  }
  /** Validate uploaded keys live in this user's namespace + are real images. */
  private async resolveKeys(userId: string, keys: string[], namespace: string): Promise<string[]> {
    for (const key of keys) {
      this.storage.assertKeyInNamespace(key, namespace);
      const meta = await this.storage.headObject(key, 'private');
      if (!meta) throw new BadRequestException('An uploaded photo could not be found in storage.');
      if (!isAllowedProductImageMime(meta.contentType)) throw new BadRequestException('Unsupported image type.');
      if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_PRODUCT_IMAGE_BYTES) throw new BadRequestException('A photo exceeds the maximum allowed size.');
    }
    return keys;
  }

  // ===========================================================================
  // Vehicles
  // ===========================================================================
  async listVehicles(userId: string) {
    const p = await this.ownProfileOrThrow(userId);
    const rows = await this.prisma.driverVehicle.findMany({ where: { driverProfileId: p.id }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] });
    return Promise.all(rows.map((v) => this.serializeVehicle(v)));
  }

  async createVehicle(userId: string, dto: DriverVehicleInput) {
    const p = await this.ownProfileOrThrow(userId);
    const photoKeys = dto.photoKeys ? await this.resolveKeys(userId, dto.photoKeys, STORAGE_PREFIX.driverVehiclePhoto(userId)) : [];
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) await tx.driverVehicle.updateMany({ where: { driverProfileId: p.id, isPrimary: true }, data: { isPrimary: false } });
      const existing = await tx.driverVehicle.count({ where: { driverProfileId: p.id } });
      const v = await tx.driverVehicle.create({
        data: {
          driverProfileId: p.id,
          type: dto.type,
          make: dto.make,
          model: dto.model,
          year: dto.year ?? null,
          color: dto.color ?? null,
          licencePlate: dto.licencePlate,
          registrationNumber: dto.registrationNumber ?? null,
          registrationExpiry: dto.registrationExpiry ?? null,
          insuranceProvider: dto.insuranceProvider ?? null,
          insurancePolicyNumber: dto.insurancePolicyNumber ?? null,
          insuranceExpiry: dto.insuranceExpiry ?? null,
          photoKeys,
          isPrimary: dto.isPrimary ?? existing === 0, // first vehicle is primary
          approvalStatus: 'PENDING',
        },
      });
      return this.serializeVehicle(v);
    });
  }

  async updateVehicle(userId: string, vehicleId: string, dto: DriverVehicleUpdateInput) {
    const p = await this.ownProfileOrThrow(userId);
    await this.ownedVehicle(p.id, vehicleId);
    const photoKeys = dto.photoKeys ? await this.resolveKeys(userId, dto.photoKeys, STORAGE_PREFIX.driverVehiclePhoto(userId)) : undefined;
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) await tx.driverVehicle.updateMany({ where: { driverProfileId: p.id, isPrimary: true, id: { not: vehicleId } }, data: { isPrimary: false } });
      // Editing regulated fields resets moderation to PENDING (re-review required).
      const resets = dto.registrationNumber !== undefined || dto.registrationExpiry !== undefined || dto.insuranceExpiry !== undefined || dto.licencePlate !== undefined;
      const v = await tx.driverVehicle.update({
        where: { id: vehicleId },
        data: {
          type: dto.type ?? undefined,
          make: dto.make ?? undefined,
          model: dto.model ?? undefined,
          year: dto.year === undefined ? undefined : dto.year ?? null,
          color: dto.color === undefined ? undefined : dto.color ?? null,
          licencePlate: dto.licencePlate ?? undefined,
          registrationNumber: dto.registrationNumber === undefined ? undefined : dto.registrationNumber ?? null,
          registrationExpiry: dto.registrationExpiry === undefined ? undefined : dto.registrationExpiry ?? null,
          insuranceProvider: dto.insuranceProvider === undefined ? undefined : dto.insuranceProvider ?? null,
          insurancePolicyNumber: dto.insurancePolicyNumber === undefined ? undefined : dto.insurancePolicyNumber ?? null,
          insuranceExpiry: dto.insuranceExpiry === undefined ? undefined : dto.insuranceExpiry ?? null,
          photoKeys,
          isActive: dto.isActive ?? undefined,
          isPrimary: dto.isPrimary ?? undefined,
          ...(resets ? { approvalStatus: 'PENDING', rejectionReason: null } : {}),
        },
      });
      return this.serializeVehicle(v);
    });
  }

  async deleteVehicle(userId: string, vehicleId: string) {
    const p = await this.ownProfileOrThrow(userId);
    await this.ownedVehicle(p.id, vehicleId);
    await this.prisma.driverVehicle.delete({ where: { id: vehicleId } });
    return { ok: true };
  }

  private async ownedVehicle(driverProfileId: string, vehicleId: string) {
    const v = await this.prisma.driverVehicle.findUnique({ where: { id: vehicleId }, select: { driverProfileId: true } });
    if (!v || v.driverProfileId !== driverProfileId) throw new NotFoundException('Vehicle not found.');
    return v;
  }

  // ===========================================================================
  // Service areas
  // ===========================================================================
  async setServiceAreas(userId: string, dto: DriverServiceAreasInput) {
    const p = await this.ownProfileOrThrow(userId);
    const districts = [...new Set(dto.districts)];
    await this.prisma.$transaction([
      // Empty list clears all areas; a non-empty list removes anything not in it.
      // (Avoid `notIn: []`, which Prisma treats as "exclude nothing" — it would delete every row here anyway, but be explicit.)
      this.prisma.driverServiceArea.deleteMany({
        where: { driverProfileId: p.id, ...(districts.length ? { district: { notIn: districts } } : {}) },
      }),
      ...districts.map((d) =>
        this.prisma.driverServiceArea.upsert({
          where: { driverProfileId_district: { driverProfileId: p.id, district: d } },
          create: { driverProfileId: p.id, district: d, isActive: true },
          update: { isActive: true },
        }),
      ),
    ]);
    return this.serviceAreas(p.id);
  }
  private async serviceAreas(driverProfileId: string) {
    const rows = await this.prisma.driverServiceArea.findMany({ where: { driverProfileId }, orderBy: { district: 'asc' } });
    return rows.map((r) => ({ id: r.id, district: r.district, isActive: r.isActive }));
  }

  // ===========================================================================
  // Availability + eligibility
  // ===========================================================================
  async setAvailability(userId: string, dto: DriverAvailabilityInput, actor: Actor) {
    const p = await this.ownProfileOrThrow(userId);
    if (dto.availability === 'ONLINE') {
      const e = await this.eligibility(userId, p);
      if (!e.canGoOnline) throw new BadRequestException(`You can't go online yet: ${e.reasons.join('; ')}.`);
    }
    const updated = await this.prisma.driverProfile.update({ where: { userId }, data: { availability: dto.availability as DriverAvailability } });
    await this.audit.record({
      action: 'DRIVER_AVAILABILITY_CHANGED',
      actorId: actor.userId,
      targetUserId: userId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      newValue: { availability: dto.availability },
    });
    return this.serializeProfile(updated);
  }

  /** ONLINE eligibility: approved active role + valid licence + ≥1 approved active
   *  vehicle with valid registration + insurance. */
  private async eligibility(userId: string, profile?: DriverProfile) {
    const p = profile ?? (await this.prisma.driverProfile.findUnique({ where: { userId } }));
    const reasons: string[] = [];
    if (!p) return { canGoOnline: false, reasons: ['no driver profile'] };
    const status = await this.roleStatus(userId);
    if (status !== 'APPROVED') reasons.push(status === 'SUSPENDED' ? 'driver role suspended' : status === 'PENDING' ? 'application pending approval' : 'driver role not approved');
    if (!p.isActive) reasons.push('driver account inactive');
    if (isExpiredOrMissing(p.licenceExpiry)) reasons.push("driver's licence expired");
    const vehicles = await this.prisma.driverVehicle.findMany({ where: { driverProfileId: p.id } });
    const usable = vehicles.filter(
      (v) => v.approvalStatus === 'APPROVED' && v.isActive && !isExpiredOrMissing(v.registrationExpiry) && !isExpiredOrMissing(v.insuranceExpiry),
    );
    if (usable.length === 0) reasons.push('no approved active vehicle with valid registration + insurance');
    return { canGoOnline: reasons.length === 0, reasons };
  }

  // ===========================================================================
  // Assignment eligibility (M15 dispatch) — reuses the vehicle/licence checks and
  // ADDS availability (ONLINE) + service-district coverage. Centralized here so
  // dispatch never re-implements driver rules.
  // ===========================================================================

  /** Full eligibility for assigning `driverProfileId` to a delivery in `district`
   *  (optionally with a specific `vehicleId`). Never throws for ineligibility —
   *  returns reasons so the admin sees exactly why. */
  async assignmentEligibility(driverProfileId: string, district: string, vehicleId?: string) {
    const p = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      include: { vehicles: true, serviceAreas: true },
    });
    if (!p) throw new NotFoundException('Driver not found.');
    const status = await this.roleStatus(p.userId);
    const reasons: string[] = [];
    if (status !== 'APPROVED') reasons.push(status === 'SUSPENDED' ? 'driver role suspended' : status === 'REVOKED' ? 'driver role revoked' : 'driver role not approved');
    if (!p.isActive) reasons.push('driver account inactive');
    if (p.availability !== 'ONLINE') reasons.push('driver is not online');
    if (isExpiredOrMissing(p.licenceExpiry)) reasons.push("driver's licence expired");
    const servesDistrict = p.serviceAreas.some((s) => s.isActive && s.district === district);
    if (!servesDistrict) reasons.push(`driver does not serve ${String(district).replace('_', ' ')}`);
    const usableVehicles = p.vehicles.filter(
      (v) => v.approvalStatus === 'APPROVED' && v.isActive && !isExpiredOrMissing(v.registrationExpiry) && !isExpiredOrMissing(v.insuranceExpiry),
    );
    if (usableVehicles.length === 0) reasons.push('no approved active vehicle with valid registration + insurance');
    let vehicle: DriverVehicle | null = null;
    if (vehicleId) {
      vehicle = usableVehicles.find((v) => v.id === vehicleId) ?? null;
      if (!vehicle) reasons.push('selected vehicle is not an approved, valid, active vehicle for this driver');
    }
    return { eligible: reasons.length === 0, reasons, usableVehicles, vehicle, profile: p, roleStatus: status };
  }

  /** Approved, online, valid drivers who serve `district` — the admin dispatch pool. */
  async eligibleDriversForDistrict(district: string) {
    const candidates = await this.prisma.driverProfile.findMany({
      where: { availability: 'ONLINE', isActive: true, serviceAreas: { some: { district: district as never, isActive: true } } },
      include: {
        user: { select: { firstName: true, lastName: true } },
        vehicles: true,
        serviceAreas: { select: { district: true, isActive: true } },
      },
      take: 200,
    });
    const roles = await this.prisma.userRole.findMany({
      where: { userId: { in: candidates.map((c) => c.userId) }, roleCode: 'DELIVERY_DRIVER' },
      select: { userId: true, status: true },
    });
    const roleBy = new Map(roles.map((r) => [r.userId, r.status]));
    return candidates
      .map((p) => {
        const usable = p.vehicles.filter(
          (v) => v.approvalStatus === 'APPROVED' && v.isActive && !isExpiredOrMissing(v.registrationExpiry) && !isExpiredOrMissing(v.insuranceExpiry),
        );
        return {
          driverProfileId: p.id,
          displayName: p.displayName,
          name: `${p.user.firstName} ${p.user.lastName}`,
          homeDistrict: p.homeDistrict,
          availability: p.availability,
          roleStatus: roleBy.get(p.userId) ?? null,
          licenceExpired: isExpiredOrMissing(p.licenceExpiry),
          completedDeliveries: p.completedDeliveries,
          ratingAverage: p.ratingAverage,
          vehicles: usable.map((v) => ({ id: v.id, type: v.type, make: v.make, model: v.model, licencePlate: v.licencePlate, isPrimary: v.isPrimary })),
        };
      })
      // Only fully eligible drivers appear in the assignable pool.
      .filter((d) => d.roleStatus === 'APPROVED' && !d.licenceExpired && d.vehicles.length > 0);
  }

  // ===========================================================================
  // Dashboard (aggregate; safe for a pending applicant to view)
  // ===========================================================================
  async dashboard(userId: string) {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId } });
    const status = await this.roleStatus(userId);
    const application = await this.prisma.roleApplication.findFirst({
      where: { userId, roleCode: 'DELIVERY_DRIVER' },
      orderBy: { createdAt: 'desc' },
      include: { reviews: { orderBy: { createdAt: 'asc' } } },
    });
    if (!p) {
      return {
        hasProfile: false,
        roleStatus: status,
        application: application ? this.serializeApplication(application) : null,
        profile: null,
        vehicles: [],
        serviceAreas: [],
        eligibility: { canGoOnline: false, reasons: ['start your driver application'] },
      };
    }
    const [vehicles, serviceAreas, eligibility] = await Promise.all([
      this.listVehicles(userId),
      this.serviceAreas(p.id),
      this.eligibility(userId, p),
    ]);
    return {
      hasProfile: true,
      roleStatus: status,
      application: application ? this.serializeApplication(application) : null,
      profile: this.serializeProfile(p),
      vehicles,
      serviceAreas,
      eligibility,
    };
  }

  // ===========================================================================
  // serialization
  // ===========================================================================
  private serializeProfile(p: DriverProfile) {
    return {
      id: p.id,
      legalName: p.legalName,
      displayName: p.displayName,
      phone: p.phone,
      homeDistrict: p.homeDistrict,
      homeAddress: p.homeAddress,
      emergencyContactName: p.emergencyContactName,
      emergencyContactPhone: p.emergencyContactPhone,
      licenceNumber: p.licenceNumber,
      licenceExpiry: p.licenceExpiry,
      licenceExpiryStatus: expiryStatus(p.licenceExpiry),
      vehicleOwnership: p.vehicleOwnership,
      termsAccepted: !!p.termsAcceptedAt,
      applicantNotes: p.applicantNotes,
      profilePhotoUrl: null as string | null, // resolved on demand via a signed-URL endpoint
      hasProfilePhoto: !!p.profilePhotoKey,
      // A suspended/unapproved role forces effective availability to SUSPENDED.
      availability: p.availability,
      isActive: p.isActive,
      ratingAverage: p.ratingAverage,
      ratingCount: p.ratingCount,
      completedDeliveries: p.completedDeliveries,
      expiringSoonDays: DOCUMENT_EXPIRY_SOON_DAYS,
    };
  }

  private async serializeVehicle(v: DriverVehicle) {
    // Signed URLs for private vehicle photos (short-lived).
    const photos = await Promise.all(
      v.photoKeys.map(async (k) => {
        try {
          return (await this.storage.presignDownload(k, 'private')).url;
        } catch {
          return null;
        }
      }),
    );
    return {
      id: v.id,
      type: v.type,
      make: v.make,
      model: v.model,
      year: v.year,
      color: v.color,
      licencePlate: v.licencePlate,
      registrationNumber: v.registrationNumber,
      registrationExpiry: v.registrationExpiry,
      registrationExpiryStatus: expiryStatus(v.registrationExpiry),
      insuranceProvider: v.insuranceProvider,
      insurancePolicyNumber: v.insurancePolicyNumber,
      insuranceExpiry: v.insuranceExpiry,
      insuranceExpiryStatus: expiryStatus(v.insuranceExpiry),
      photoUrls: photos.filter((u): u is string => !!u),
      isActive: v.isActive,
      isPrimary: v.isPrimary,
      approvalStatus: v.approvalStatus,
      rejectionReason: v.rejectionReason,
    };
  }

  private serializeApplication(a: { id: string; status: string; message: string | null; createdAt: Date; reviews: Array<{ action: string; note: string | null; createdAt: Date }> }) {
    const lastNote = [...a.reviews].reverse().find((r) => r.note);
    return { id: a.id, status: a.status, message: a.message, createdAt: a.createdAt, reviewerNote: lastNote?.note ?? null };
  }

  // Owner signed-URL for their own profile photo.
  async profilePhotoUrl(userId: string) {
    const p = await this.ownProfileOrThrow(userId);
    if (!p.profilePhotoKey) throw new NotFoundException('No profile photo.');
    return this.storage.presignDownload(p.profilePhotoKey, 'private');
  }
}
