import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { expiryStatus, isExpiredOrMissing, type DriverAvailability } from '@bmpl/shared';
import type {
  PassengerAvailabilityInput,
  PassengerDriverProfileInput,
  PassengerDriverProfileUpdateInput,
  PassengerVehicleInput,
  PassengerVehicleUpdateInput,
} from '@bmpl/validation';
import type { PassengerDriverProfile, PassengerVehicle, Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Passenger-driver self-service: profile, own vehicles, availability.
 *
 * Mirrors DriverService's shape without touching it — carrying passengers is a
 * different job from carrying parcels, possibly held by the same human, which
 * is why both profiles hang off one User and neither module imports the other.
 * Role approval is NOT here: PASSENGER_DRIVER goes through the same
 * RoleApplication machinery as every other role, and this profile is the
 * domain data that stands behind an approved role.
 *
 * Deliberately absent in S1, so nobody mistakes omissions for oversights:
 * photo uploads (no passenger storage namespace exists yet, so no storage keys
 * are accepted anywhere); and every audit code not among the seven
 * PASSENGER_* actions already in the enum. Provider affiliation, deferred
 * here since S1, now lives in PassengerAffiliationService: mutual
 * consent, and the ONLY writer of providerProfileId — nothing in this service
 * touches that column.
 */
@Injectable()
export class PassengerDriverService {
  constructor(private readonly prisma: PrismaService) {}

  private async roleStatus(userId: string): Promise<string | null> {
    const r = await this.prisma.userRole.findUnique({
      where: { userId_roleCode: { userId, roleCode: 'PASSENGER_DRIVER' } },
      select: { status: true },
    });
    return r?.status ?? null;
  }

  private async ownProfileOrThrow(userId: string): Promise<PassengerDriverProfile> {
    const p = await this.prisma.passengerDriverProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Start your passenger-driver application first.');
    return p;
  }

  // ---- profile ------------------------------------------------------------

  /** The fleet identity a driver needs to RECOGNISE, not just an id — loaded
   *  at every serialize site so a driver always sees who they drive for. */
  private static readonly PROVIDER_IDENTITY = { providerProfile: { select: { id: true, businessName: true } } } as const;

  async getProfile(userId: string) {
    const p = await this.prisma.passengerDriverProfile.findUnique({ where: { userId }, include: PassengerDriverService.PROVIDER_IDENTITY });
    return p ? this.serializeProfile(p) : null;
  }

  /** Create or update the profile/application data. Open to any customer (an
   *  applicant builds this before approval); operations are gated separately. */
  async upsertProfile(userId: string, dto: PassengerDriverProfileInput) {
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
      termsAcceptedAt: dto.termsAccepted ? new Date() : null,
      applicantNotes: dto.applicantNotes ?? null,
    };
    // isTest is not in `data` and never will be: the simulation flag is
    // admin-set only, exactly as on DriverProfile and VendorProfile.
    const p = await this.prisma.passengerDriverProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      include: PassengerDriverService.PROVIDER_IDENTITY,
    });
    return this.serializeProfile(p);
  }

  async updateProfile(userId: string, dto: PassengerDriverProfileUpdateInput) {
    await this.ownProfileOrThrow(userId);
    const data: Prisma.PassengerDriverProfileUpdateInput = {};
    for (const k of ['legalName', 'displayName', 'phone', 'homeDistrict', 'licenceNumber'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
    }
    for (const k of ['homeAddress', 'latitude', 'longitude', 'emergencyContactName', 'emergencyContactPhone', 'applicantNotes'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k] ?? null;
    }
    if (dto.licenceExpiry !== undefined) data.licenceExpiry = dto.licenceExpiry;
    if (dto.termsAccepted !== undefined) data.termsAcceptedAt = dto.termsAccepted ? new Date() : null;
    const p = await this.prisma.passengerDriverProfile.update({ where: { userId }, data, include: PassengerDriverService.PROVIDER_IDENTITY });
    return this.serializeProfile(p);
  }

  // ---- vehicles -----------------------------------------------------------

  async listVehicles(userId: string) {
    const p = await this.ownProfileOrThrow(userId);
    const rows = await this.prisma.passengerVehicle.findMany({
      where: { ownerDriverProfileId: p.id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((v) => this.serializeVehicle(v));
  }

  /** Register an owner-driver's vehicle. Exactly ONE owner: this path sets
   *  ownerDriverProfileId and never providerProfileId — the schema's
   *  exactly-one-owner rule is enforced by construction here, not by a CHECK. */
  async createVehicle(userId: string, dto: PassengerVehicleInput) {
    const p = await this.ownProfileOrThrow(userId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.passengerVehicle.updateMany({ where: { ownerDriverProfileId: p.id, isPrimary: true }, data: { isPrimary: false } });
      }
      const existing = await tx.passengerVehicle.count({ where: { ownerDriverProfileId: p.id } });
      const v = await tx.passengerVehicle.create({
        data: {
          ownerDriverProfileId: p.id,
          // A vehicle inherits its owner's side of the simulation boundary —
          // derived, never from the request.
          isTest: p.isTest,
          ...this.vehicleData(dto),
          isPrimary: dto.isPrimary ?? existing === 0, // first vehicle is primary
          approvalStatus: 'PENDING',
        },
      });
      return this.serializeVehicle(v);
    });
  }

  async updateVehicle(userId: string, vehicleId: string, dto: PassengerVehicleUpdateInput) {
    const p = await this.ownProfileOrThrow(userId);
    await this.ownedVehicle(p.id, vehicleId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.passengerVehicle.updateMany({ where: { ownerDriverProfileId: p.id, isPrimary: true, id: { not: vehicleId } }, data: { isPrimary: false } });
      }
      const v = await tx.passengerVehicle.update({
        where: { id: vehicleId },
        data: this.vehicleUpdateData(dto),
      });
      return this.serializeVehicle(v);
    });
  }

  async deleteVehicle(userId: string, vehicleId: string) {
    const p = await this.ownProfileOrThrow(userId);
    await this.ownedVehicle(p.id, vehicleId);
    await this.prisma.passengerVehicle.delete({ where: { id: vehicleId } });
    return { ok: true };
  }

  private async ownedVehicle(ownerDriverProfileId: string, vehicleId: string) {
    const v = await this.prisma.passengerVehicle.findUnique({ where: { id: vehicleId }, select: { ownerDriverProfileId: true } });
    if (!v || v.ownerDriverProfileId !== ownerDriverProfileId) throw new NotFoundException('Vehicle not found.');
  }

  /** Shared between the driver and provider services (identical column set). */
  vehicleData(dto: PassengerVehicleInput) {
    return {
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
      seatCapacity: dto.seatCapacity,
    };
  }

  /** Editing regulated fields resets moderation to PENDING (re-review). */
  vehicleUpdateData(dto: PassengerVehicleUpdateInput): Prisma.PassengerVehicleUpdateInput {
    const resets =
      dto.registrationNumber !== undefined ||
      dto.registrationExpiry !== undefined ||
      dto.insuranceExpiry !== undefined ||
      dto.licencePlate !== undefined ||
      dto.seatCapacity !== undefined;
    return {
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
      seatCapacity: dto.seatCapacity ?? undefined,
      isActive: dto.isActive ?? undefined,
      isPrimary: dto.isPrimary ?? undefined,
      ...(resets ? { approvalStatus: 'PENDING', rejectionReason: null } : {}),
    };
  }

  // ---- availability + eligibility ----------------------------------------

  async setAvailability(userId: string, dto: PassengerAvailabilityInput) {
    const p = await this.ownProfileOrThrow(userId);
    if (dto.availability === 'ONLINE') {
      const e = await this.eligibility(userId, p);
      if (!e.canGoOnline) throw new BadRequestException(`You can't go online yet: ${e.reasons.join('; ')}.`);
    }
    const updated = await this.prisma.passengerDriverProfile.update({
      where: { userId },
      data: { availability: dto.availability as DriverAvailability },
      include: PassengerDriverService.PROVIDER_IDENTITY,
    });
    // NOTE: unaudited in S1 — no PASSENGER availability audit code exists among
    // the seven provisioned actions, and audit codes are additive migrations.
    return this.serializeProfile(updated);
  }

  async eligibilityFor(userId: string) {
    return this.eligibility(userId);
  }

  /**
   * ONLINE eligibility: approved PASSENGER_DRIVER role + active + valid licence
   * + at least one usable vehicle. A usable vehicle is APPROVED, active, with
   * valid registration + insurance, and either the driver's OWN or — for an
   * affiliated fleet driver — one of their provider's. That reach into the
   * fleet is read off the schema's ownership model, not invented: a fleet
   * driver's whole point is driving the operator's vehicles.
   */
  private async eligibility(userId: string, profile?: PassengerDriverProfile) {
    const p = profile ?? (await this.prisma.passengerDriverProfile.findUnique({ where: { userId } }));
    const reasons: string[] = [];
    if (!p) return { canGoOnline: false, reasons: ['no passenger-driver profile'] };
    const status = await this.roleStatus(userId);
    if (status !== 'APPROVED') {
      reasons.push(status === 'SUSPENDED' ? 'passenger-driver role suspended' : status === 'PENDING' ? 'application pending approval' : 'passenger-driver role not approved');
    }
    if (!p.isActive) reasons.push('driver account inactive');
    if (isExpiredOrMissing(p.licenceExpiry)) reasons.push("driver's licence expired");
    const vehicles = await this.prisma.passengerVehicle.findMany({
      where: {
        OR: [
          { ownerDriverProfileId: p.id },
          ...(p.providerProfileId ? [{ providerProfileId: p.providerProfileId }] : []),
        ],
      },
    });
    const usable = vehicles.filter(
      (v) => v.approvalStatus === 'APPROVED' && v.isActive && !isExpiredOrMissing(v.registrationExpiry) && !isExpiredOrMissing(v.insuranceExpiry),
    );
    if (usable.length === 0) reasons.push('no approved active vehicle with valid registration + insurance');
    return { canGoOnline: reasons.length === 0, reasons };
  }

  // ---- shaping ------------------------------------------------------------

  serializeProfile(p: PassengerDriverProfile & { providerProfile?: { id: string; businessName: string } | null }) {
    return {
      id: p.id,
      legalName: p.legalName,
      displayName: p.displayName,
      phone: p.phone,
      homeDistrict: p.homeDistrict,
      homeAddress: p.homeAddress,
      // The driver's OWN affiliation, on their own profile: both parties must
      // be able to SEE what they consented to (and a person who cannot see
      // their fleet cannot meaningfully leave it). Identity only, no roster,
      // no commercial fields.
      providerProfileId: p.providerProfileId,
      provider: p.providerProfile ? { id: p.providerProfile.id, businessName: p.providerProfile.businessName } : null,
      emergencyContactName: p.emergencyContactName,
      emergencyContactPhone: p.emergencyContactPhone,
      licenceNumber: p.licenceNumber,
      licenceExpiry: p.licenceExpiry,
      licenceExpiryStatus: expiryStatus(p.licenceExpiry),
      availability: p.availability,
      isActive: p.isActive,
      isTest: p.isTest,
      ratingAverage: p.ratingAverage,
      completedTrips: p.completedTrips,
      createdAt: p.createdAt,
    };
  }

  serializeVehicle(v: PassengerVehicle) {
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
      insuranceExpiry: v.insuranceExpiry,
      insuranceExpiryStatus: expiryStatus(v.insuranceExpiry),
      seatCapacity: v.seatCapacity,
      isActive: v.isActive,
      isPrimary: v.isPrimary,
      approvalStatus: v.approvalStatus,
      rejectionReason: v.rejectionReason,
    };
  }
}
