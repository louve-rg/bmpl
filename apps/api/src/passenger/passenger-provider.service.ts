import { Injectable, NotFoundException } from '@nestjs/common';
import { expiryStatus } from '@bmpl/shared';
import type {
  PassengerProviderProfileInput,
  PassengerProviderProfileUpdateInput,
  PassengerVehicleInput,
  PassengerVehicleUpdateInput,
} from '@bmpl/validation';
import type { PassengerProviderProfile, Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { PassengerDriverService } from './passenger-driver.service';

/**
 * Fleet-operator self-service: the operating profile behind an approved
 * PASSENGER_PROVIDER role (exactly as VendorProfile stands behind VENDOR), and
 * the fleet's vehicles. Vehicle rows created here set providerProfileId and
 * never ownerDriverProfileId — the other half of the exactly-one-owner rule.
 *
 * NOT here in S1: routes (now in PassengerNetworkService, S2), driver
 * affiliation management (now in PassengerAffiliationService —
 * mutual consent), and photo uploads (no passenger storage namespace yet).
 */
@Injectable()
export class PassengerProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drivers: PassengerDriverService,
  ) {}

  private async ownProfileOrThrow(userId: string): Promise<PassengerProviderProfile> {
    const p = await this.prisma.passengerProviderProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Start your transport-operator application first.');
    return p;
  }

  // ---- profile ------------------------------------------------------------

  async getProfile(userId: string) {
    const p = await this.prisma.passengerProviderProfile.findUnique({ where: { userId } });
    return p ? this.serializeProfile(p) : null;
  }

  async upsertProfile(userId: string, dto: PassengerProviderProfileInput) {
    const data = {
      businessName: dto.businessName,
      description: dto.description ?? null,
      contactEmail: dto.contactEmail,
      contactPhone: dto.contactPhone ?? null,
      district: dto.district ?? null,
      city: dto.city ?? null,
      addressLine1: dto.addressLine1 ?? null,
      operatingLicenceNumber: dto.operatingLicenceNumber ?? null,
      operatingLicenceExpiry: dto.operatingLicenceExpiry ?? null,
    };
    // isTest deliberately absent: admin-set only.
    const p = await this.prisma.passengerProviderProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return this.serializeProfile(p);
  }

  async updateProfile(userId: string, dto: PassengerProviderProfileUpdateInput) {
    await this.ownProfileOrThrow(userId);
    const data: Prisma.PassengerProviderProfileUpdateInput = {};
    if (dto.businessName !== undefined) data.businessName = dto.businessName;
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail;
    for (const k of ['description', 'contactPhone', 'district', 'city', 'addressLine1', 'operatingLicenceNumber'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k] ?? null;
    }
    if (dto.operatingLicenceExpiry !== undefined) data.operatingLicenceExpiry = dto.operatingLicenceExpiry ?? null;
    const p = await this.prisma.passengerProviderProfile.update({ where: { userId }, data });
    return this.serializeProfile(p);
  }

  // ---- fleet vehicles -----------------------------------------------------

  async listVehicles(userId: string) {
    const p = await this.ownProfileOrThrow(userId);
    const rows = await this.prisma.passengerVehicle.findMany({
      where: { providerProfileId: p.id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((v) => this.drivers.serializeVehicle(v));
  }

  async createVehicle(userId: string, dto: PassengerVehicleInput) {
    const p = await this.ownProfileOrThrow(userId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.passengerVehicle.updateMany({ where: { providerProfileId: p.id, isPrimary: true }, data: { isPrimary: false } });
      }
      const v = await tx.passengerVehicle.create({
        data: {
          providerProfileId: p.id,
          // Derived from the fleet's side of the simulation boundary.
          isTest: p.isTest,
          ...this.drivers.vehicleData(dto),
          isPrimary: dto.isPrimary ?? false,
          approvalStatus: 'PENDING',
        },
      });
      return this.drivers.serializeVehicle(v);
    });
  }

  async updateVehicle(userId: string, vehicleId: string, dto: PassengerVehicleUpdateInput) {
    const p = await this.ownProfileOrThrow(userId);
    const v = await this.prisma.passengerVehicle.findUnique({ where: { id: vehicleId }, select: { providerProfileId: true } });
    if (!v || v.providerProfileId !== p.id) throw new NotFoundException('Vehicle not found.');
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.passengerVehicle.updateMany({ where: { providerProfileId: p.id, isPrimary: true, id: { not: vehicleId } }, data: { isPrimary: false } });
      }
      const updated = await tx.passengerVehicle.update({ where: { id: vehicleId }, data: this.drivers.vehicleUpdateData(dto) });
      return this.drivers.serializeVehicle(updated);
    });
  }

  async deleteVehicle(userId: string, vehicleId: string) {
    const p = await this.ownProfileOrThrow(userId);
    const v = await this.prisma.passengerVehicle.findUnique({ where: { id: vehicleId }, select: { providerProfileId: true } });
    if (!v || v.providerProfileId !== p.id) throw new NotFoundException('Vehicle not found.');
    await this.prisma.passengerVehicle.delete({ where: { id: vehicleId } });
    return { ok: true };
  }

  // ---- shaping ------------------------------------------------------------

  serializeProfile(p: PassengerProviderProfile) {
    return {
      id: p.id,
      businessName: p.businessName,
      description: p.description,
      contactEmail: p.contactEmail,
      contactPhone: p.contactPhone,
      district: p.district,
      city: p.city,
      addressLine1: p.addressLine1,
      operatingLicenceNumber: p.operatingLicenceNumber,
      operatingLicenceExpiry: p.operatingLicenceExpiry,
      operatingLicenceExpiryStatus: expiryStatus(p.operatingLicenceExpiry),
      isActive: p.isActive,
      isTest: p.isTest,
      createdAt: p.createdAt,
    };
  }
}
