import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DISTRICTS,
  DOCUMENT_EXPIRY_SOON_DAYS,
  expiryStatus,
  isAllowedProductImageMime,
  isExpiredOrMissing,
  MAX_PRODUCT_IMAGE_BYTES,
  STORAGE_PREFIX,
  type District,
  type DriverAvailability,
} from '@bmpl/shared';
import type {
  DriverAvailabilityInput,
  DriverProfileInput,
  DriverProfileUpdateInput,
  DriverServiceAreasInput,
  DriverServiceCitiesInput,
  DriverVehicleInput,
  DriverVehicleUpdateInput,
} from '@bmpl/validation';
import type { DriverProfile, DriverVehicle, Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadIngestService } from '../storage/upload-ingest.service';
import { AuditService } from '../audit/audit.service';
import { DriverOperationsService } from './driver-operations.service';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/**
 * Same convention route-planner.ts already uses for comparing a free-text
 * place name against another (trim + case-fold) — reused here rather than
 * invented, so a driver's declared "San Pedro" and an address's "san pedro "
 * are the same place for BOTH the shipment planner and dispatch.
 *
 * KNOWN LIMITATION, stated rather than silently absorbed (BMPL-194): this is
 * exact-match-after-normalizing, not fuzzy matching. "San Pedro" and "San
 * Pedro Town" are two different strings and will NOT match each other, even
 * though a human reads them as the same place. Building fuzzy matching would
 * mean this code deciding which spellings count as "the same place" — that
 * is inventing geography by the back door, the exact thing root CLAUDE.md §5
 * forbids. The real fix is a driver and an address agreeing on one spelling,
 * which is a data-entry/UX question, not a matching-algorithm one. Until
 * then: a driver whose declared spelling drifts from how addresses are
 * typed silently stops being offered work there, and the system looks like
 * it is working the whole time. Nothing today surfaces that drift to anyone
 * — it is a real, open gap, not a false claim of correctness.
 */
function sameCity(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

@Injectable()
export class DriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: UploadIngestService,
    private readonly audit: AuditService,
    private readonly operations: DriverOperationsService,
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
      // Never trust a client-supplied storage key — see resolveProfilePhotoKey.
      profilePhotoKey: (await this.resolveProfilePhotoKey(userId, dto.profilePhotoKey)) ?? undefined,
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
    for (const k of ['homeAddress', 'latitude', 'longitude', 'emergencyContactName', 'emergencyContactPhone', 'applicantNotes'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k] ?? null;
    }
    // Handled separately from the plain passthrough fields above: a storage key
    // must be proven to belong to this driver before it is stored, because the
    // profile-photo endpoint will later sign it. See resolveProfilePhotoKey.
    if (dto.profilePhotoKey !== undefined) {
      data.profilePhotoKey = (await this.resolveProfilePhotoKey(userId, dto.profilePhotoKey)) ?? null;
    }
    if (dto.licenceExpiry !== undefined) data.licenceExpiry = dto.licenceExpiry;
    if (dto.termsAccepted !== undefined) data.termsAcceptedAt = dto.termsAccepted ? new Date() : null;
    const p = await this.prisma.driverProfile.update({ where: { userId }, data });
    return this.serializeProfile(p);
  }

  // ---- private photo uploads (profile + vehicle) ----
  /**
   * @deprecated Prefer {@link uploadProfilePhoto}. The presigned URL points at the R2
   * S3 endpoint, so the browser PUT is cross-origin; the bucket has no CORS policy for
   * the custom domain and it fails as "Load failed". Kept for API compatibility.
   */
  async presignProfilePhoto(userId: string, fileName: string, contentType: string) {
    if (!isAllowedProductImageMime(contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    const key = this.storage.buildKey(STORAGE_PREFIX.driverPhoto(userId), fileName);
    return this.storage.presignUpload(key, contentType, 'private');
  }
  /** @deprecated Prefer {@link uploadVehiclePhoto} — same reason as above. */
  async presignVehiclePhoto(userId: string, fileName: string, contentType: string) {
    if (!isAllowedProductImageMime(contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    const key = this.storage.buildKey(STORAGE_PREFIX.driverVehiclePhoto(userId), fileName);
    return this.storage.presignUpload(key, contentType, 'private');
  }

  /** Server-side profile-photo upload (browser → API → private storage). */
  async uploadProfilePhoto(userId: string, buffer: Buffer | undefined, fileName?: string) {
    return this.ingest.image(buffer, STORAGE_PREFIX.driverPhoto(userId), 'private', {
      fileName,
      fallbackName: 'profile',
    });
  }

  /** Server-side vehicle-photo upload (browser → API → private storage). */
  async uploadVehiclePhoto(userId: string, buffer: Buffer | undefined, fileName?: string) {
    return this.ingest.image(buffer, STORAGE_PREFIX.driverVehiclePhoto(userId), 'private', {
      fileName,
      fallbackName: 'vehicle',
    });
  }
  /**
   * Validate a client-supplied PROFILE-photo key before it is stored.
   *
   * This has to exist because `profilePhotoKey` arrives in the request body and is
   * later handed to `presignDownload` by {@link profilePhotoUrl}. Without an
   * ownership check the server would sign whatever private key it was given — a
   * driver could point their profile photo at another user's KYC document and read
   * it back through their own profile endpoint. Every other upload surface already
   * goes through assertKeyInNamespace; this one was the gap.
   */
  private async resolveProfilePhotoKey(
    userId: string,
    key: string | null | undefined,
  ): Promise<string | null | undefined> {
    // undefined = "field absent, leave alone"; null = "clear it". Neither names an object.
    if (key === undefined || key === null) return key;
    const [resolved] = await this.resolveKeys(userId, [key], STORAGE_PREFIX.driverPhoto(userId));
    return resolved;
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
    const rows = await this.prisma.driverServiceArea.findMany({
      where: { driverProfileId },
      orderBy: { district: 'asc' },
      include: { serviceCities: { orderBy: { city: 'asc' } } },
    });
    return rows.map((r) => ({
      id: r.id,
      district: r.district,
      isActive: r.isActive,
      // Empty => the driver serves the whole district (unchanged meaning).
      // Non-empty => coverage in this district is narrowed to just these.
      cities: r.serviceCities.map((c) => ({ id: c.id, city: c.city, isActive: c.isActive })),
    }));
  }

  /**
   * Every town a driver could reasonably declare for this district (BMPL-360):
   * every configured `LogisticsHub` city in it, UNION every town a
   * `CourierLane` actually connects FROM or TO it. Both are real, already
   * configured BML geography — this just stops hiding half of it from the
   * one audience who needs the full list to describe where they actually
   * work. Ladyville (no hub, reachable by lane from Belize City) is the
   * named real example this closes.
   *
   * Still driver-only, never a customer-facing or public surface — the
   * admin courier-lanes screen's own comment says a lane "is never shown to
   * customers as a service", on purpose, and that boundary is unchanged
   * here: an authenticated driver describing their own real work area is a
   * different audience from a customer being offered a lane as a bookable
   * service, not an exception carved into the same one.
   */
  async selectableCities(district: string): Promise<{ cities: string[] }> {
    if (!(DISTRICTS as readonly string[]).includes(district)) throw new BadRequestException('Unknown district.');
    const d = district as District;
    const [hubs, lanes] = await Promise.all([
      this.prisma.logisticsHub.findMany({ where: { district: d, isActive: true, isTest: false }, select: { city: true } }),
      this.prisma.courierLane.findMany({
        where: { isActive: true, isTest: false, OR: [{ originDistrict: d }, { destinationDistrict: d }] },
        select: { originDistrict: true, originCity: true, destinationDistrict: true, destinationCity: true },
      }),
    ]);
    const cities: string[] = hubs.map((h) => h.city);
    for (const l of lanes) {
      if (l.originDistrict === d) cities.push(l.originCity);
      if (l.destinationDistrict === d) cities.push(l.destinationCity);
    }
    // Same "is this the same place" convention as sameCity() above, case-fold
    // only — keeps the FIRST spelling seen, hubs first, so a hub's own
    // configured spelling wins over a lane's free text for the same place.
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const c of cities) {
      const key = c.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(c.trim());
    }
    return { cities: unique.sort((a, b) => a.localeCompare(b)) };
  }

  /** Narrow (or, given an empty list, widen back) a driver's coverage of one
   *  district they already declare in `serviceAreas`. Owner-scoped by `userId`,
   *  exactly like `setServiceAreas` — a driver can only ever touch their own
   *  rows, never another driver's, because the profile is looked up from the
   *  authenticated user, never from an id in the request. */
  async setServiceCities(userId: string, district: string, dto: DriverServiceCitiesInput) {
    if (!(DISTRICTS as readonly string[]).includes(district)) throw new BadRequestException('Unknown district.');
    const p = await this.ownProfileOrThrow(userId);
    const area = await this.prisma.driverServiceArea.findUnique({
      where: { driverProfileId_district: { driverProfileId: p.id, district: district as District } },
    });
    if (!area) throw new BadRequestException(`You must serve ${district.replace('_', ' ')} before narrowing it to specific cities.`);
    const cities = [...new Set(dto.cities)];
    await this.prisma.$transaction([
      // Same "empty clears, non-empty removes anything not listed" shape as
      // setServiceAreas — avoid `notIn: []`, which excludes nothing.
      this.prisma.driverServiceCity.deleteMany({
        where: { driverProfileId: p.id, district: district as District, ...(cities.length ? { city: { notIn: cities } } : {}) },
      }),
      ...cities.map((city) =>
        this.prisma.driverServiceCity.upsert({
          where: { driverProfileId_district_city: { driverProfileId: p.id, district: district as District, city } },
          create: { driverProfileId: p.id, district: district as District, city, isActive: true },
          update: { isActive: true },
        }),
      ),
    ]);
    return this.serviceAreas(p.id);
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

  /**
   * Public read of a driver's ONLINE eligibility.
   *
   * Exposed so admin actions that change an input to it — vehicle approval above
   * all — can report the RESULT rather than leaving the driver to work out
   * whether "vehicle approved" means they may now go online. Always computed
   * from live rows, never cached, so it cannot go stale.
   */
  async eligibilityFor(userId: string) {
    return this.eligibility(userId);
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
   *  returns reasons so the admin sees exactly why.
   *
   *  `isTestDelivery` enforces the simulation boundary. It lives here, in the one
   *  authority every assignment path already funnels through — the dispatch
   *  engine's `pickVehicle`, admin assign and admin reassign all call this — so
   *  there is no second place for the rule to drift to, and no path that can skip
   *  it. Frontend filtering and TEST labels are cosmetic; this is the boundary. */
  async assignmentEligibility(
    driverProfileId: string,
    district: string,
    vehicleId?: string,
    opts: { isTestDelivery?: boolean; city?: string | null } = {},
  ) {
    const p = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      include: { vehicles: true, serviceAreas: true, serviceCities: true },
    });
    if (!p) throw new NotFoundException('Driver not found.');
    const status = await this.roleStatus(p.userId);
    const reasons: string[] = [];
    // Symmetric, and deliberately so. A rehearsal must never reach a real driver
    // — that is the incident this prevents — and a real customer's order must
    // never land on a test account, where nobody is actually going to deliver it.
    const isTestDelivery = opts.isTestDelivery ?? false;
    if (isTestDelivery && !p.isTest) reasons.push('simulation deliveries are only offered to designated test drivers');
    if (!isTestDelivery && p.isTest) reasons.push('a test driver cannot be assigned a real customer delivery');
    if (status !== 'APPROVED') reasons.push(status === 'SUSPENDED' ? 'driver role suspended' : status === 'REVOKED' ? 'driver role revoked' : 'driver role not approved');
    if (!p.isActive) reasons.push('driver account inactive');
    if (p.availability !== 'ONLINE') reasons.push('driver is not online');
    if (isExpiredOrMissing(p.licenceExpiry)) reasons.push("driver's licence expired");
    const servesDistrict = p.serviceAreas.some((s) => s.isActive && s.district === district);
    if (!servesDistrict) reasons.push(`driver does not serve ${String(district).replace('_', ' ')}`);
    // BMPL-194: a district a driver serves may be NARROWED to specific
    // towns/cities (DriverServiceCity — BMPL-176, declared but never checked
    // here until now). No active narrowing rows for this district means the
    // old meaning still holds: the driver serves the whole district. Rows
    // present means ONLY those places, so a San Pedro-only courier is no
    // longer offered a Belize City job just because both share a district.
    //
    // DELIBERATE CHOICE: an ABSENT destination city (opts.city null/empty) is
    // treated as UNCONSTRAINED, not as a non-match — the narrowing check is
    // skipped entirely rather than failing every narrowed driver. The
    // alternative (no city means nothing can match) would silently shrink the
    // pool exactly for the drivers who bothered to configure their areas,
    // triggered by a missing field on the OTHER side of the match. Narrowing
    // exists to give a driver MORE targeted work, so it must never give them
    // LESS because of somebody else's incomplete data.
    //
    // THE SAME ANSWER, THREE PLACES: no configured hub hours means
    // unconstrained, not closed (the owner's own ruling,
    // shipment-dispatch.service.ts). No declared DriverServiceCity rows means
    // the whole district, not zero places (BMPL-176, above). No supplied
    // destination city means no narrowing, not a non-match (here). Absence
    // means unconstrained, every time — one principle applied three times,
    // not three separate rules that happen to agree today.
    const city = opts.city?.trim() || null;
    if (servesDistrict && city) {
      const narrowing = p.serviceCities.filter((c) => c.isActive && c.district === district);
      if (narrowing.length > 0 && !narrowing.some((c) => sameCity(c.city, city))) {
        reasons.push(`driver does not serve ${city} within ${String(district).replace('_', ' ')}`);
      }
    }
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

  /** Approved, online, valid drivers who serve `district` — the admin dispatch pool.
   *
   *  `isTest` narrows the pool to the matching side of the simulation boundary,
   *  in the QUERY rather than in a post-filter, so a test driver is never even a
   *  candidate for a real delivery (nor the reverse). `assignmentEligibility`
   *  re-checks it at assignment time regardless; this keeps the ranking honest. */
  /**
   * The drivers who could take a job in this district right now.
   *
   * `excludeUserId` is the person who asked for the job — the customer whose
   * order this is, or the sender who booked the shipment. They are removed here,
   * before ranking, so that they are never scored, never offered the job, never
   * notified about it and never listed to an administrator as a choice. A
   * multi-role account is perfectly legitimate: the same person may drive for
   * other people's orders all day. They may not drive their own, because the
   * whole point of the courier is that somebody else handles the goods, and
   * because a customer who is also the driver can mark their own parcel
   * delivered and pay themselves the fee.
   *
   * Filtering here is the courtesy; `DispatchService.assignInternal` is the
   * rule. Both exist deliberately — this one keeps the requester out of sight,
   * that one refuses the write no matter who asks.
   */
  async eligibleDriversForDistrict(
    district: string,
    opts: { isTest?: boolean; excludeUserId?: string | null; city?: string | null } = {},
  ) {
    // Trimmed, same as every free-text place comparison in this codebase
    // (route-planner.ts). An empty/whitespace-only value is the same as no
    // city at all — nothing to compare against.
    const city = opts.city?.trim() || null;
    const candidates = await this.prisma.driverProfile.findMany({
      where: {
        availability: 'ONLINE',
        isActive: true,
        isTest: opts.isTest ?? false,
        serviceAreas: { some: { district: district as never, isActive: true } },
        // BMPL-194: same narrowing rule as assignmentEligibility, applied to
        // the pool query instead of a single candidate — including the same
        // deliberate choice about an absent city (see the comment there):
        // unconstrained, not a non-match, so a missing destination city never
        // silently shrinks the pool of narrowed drivers.
        ...(city
          ? {
              OR: [
                { serviceCities: { none: { district: district as never, isActive: true } } },
                {
                  serviceCities: {
                    some: { district: district as never, isActive: true, city: { equals: city, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
        ...(opts.excludeUserId ? { userId: { not: opts.excludeUserId } } : {}),
      },
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
    // How many jobs each candidate is already carrying — across BOTH job
    // tables, the same rule ShipmentDispatchService.rankFor applies. A driver
    // holds one queue: marketplace deliveries AND shipment courier legs. When
    // this counted deliveries alone, a driver already carrying courier legs
    // showed "0 live jobs" to the operator, and manual shipping dispatch could
    // stack job after job onto them while the list swore they were free.
    const ids = candidates.map((c) => c.id);
    const liveStatuses = ['ASSIGNED', 'DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'] as const;
    const [deliveryLoad, legLoad] = await Promise.all([
      this.prisma.orderDelivery.groupBy({
        by: ['assignedDriverProfileId'],
        where: {
          assignedDriverProfileId: { in: ids },
          status: { in: [...liveStatuses] },
        },
        _count: { _all: true },
      }),
      this.prisma.shipmentLeg.groupBy({
        by: ['assignedDriverProfileId'],
        where: {
          assignedDriverProfileId: { in: ids },
          courierStatus: { in: [...liveStatuses] },
        },
        _count: { _all: true },
      }),
    ]);
    const activeBy = new Map<string, number>();
    for (const row of [...deliveryLoad, ...legLoad]) {
      if (!row.assignedDriverProfileId) continue;
      activeBy.set(row.assignedDriverProfileId, (activeBy.get(row.assignedDriverProfileId) ?? 0) + row._count._all);
    }
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
          activeJobs: activeBy.get(p.id) ?? 0,
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
    const [vehicles, serviceAreas, eligibility, operations] = await Promise.all([
      this.listVehicles(userId),
      this.serviceAreas(p.id),
      this.eligibility(userId, p),
      // Attached to the existing dashboard rather than exposed as a second
      // endpoint: the driver opens one screen, so it should be one request.
      this.operations.summary(p.id, userId),
    ]);
    return {
      hasProfile: true,
      roleStatus: status,
      application: application ? this.serializeApplication(application) : null,
      profile: await this.serializeProfile(p),
      vehicles,
      serviceAreas,
      eligibility,
      operations,
    };
  }

  // ===========================================================================
  // serialization
  // ===========================================================================
  private async serializeProfile(p: DriverProfile) {
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
      // Resolved eagerly. This used to be hardcoded null with a note that a
      // separate signed-URL endpoint would supply it — but nothing ever called
      // that endpoint, so a driver who had uploaded a photo saw "Photo on file"
      // next to a permanently empty frame. One signed URL on a page the driver
      // already loads costs a single HEAD-free presign; a boolean nobody can
      // render costs a support ticket.
      profilePhotoUrl: await this.signedOrNull(p.profilePhotoKey),
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

  /**
   * Signed URL for a private key, or null when storage is unavailable or the key
   * is unset. A missing photo must degrade to initials, never to a 500 on a page
   * that is mostly about licence dates and availability.
   */
  private async signedOrNull(key: string | null): Promise<string | null> {
    if (!key) return null;
    try {
      return (await this.storage.presignDownload(key, 'private')).url;
    } catch {
      return null;
    }
  }
}
