import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isExpiredOrMissing } from '@bmpl/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PassengerDriverService } from './passenger-driver.service';
import { PassengerProviderService } from './passenger-provider.service';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/**
 * Admin oversight of the passenger supply side: read, vehicle moderation, and
 * the admin-set-only simulation flags. Role approval / suspend / restore /
 * revoke reuse the existing role-application endpoints, exactly as they do for
 * delivery drivers. Every mutating action here writes one of the seven
 * PASSENGER_* audit codes the schema migration provisioned.
 */
@Injectable()
export class AdminPassengerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly drivers: PassengerDriverService,
    private readonly providers: PassengerProviderService,
  ) {}

  // ---- reads --------------------------------------------------------------

  async listDrivers(filter: { district?: string; availability?: string; roleStatus?: string }) {
    const profiles = await this.prisma.passengerDriverProfile.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        vehiclesOwned: { select: { approvalStatus: true, isActive: true, registrationExpiry: true, insuranceExpiry: true } },
      },
    });
    const roles = await this.prisma.userRole.findMany({
      where: { userId: { in: profiles.map((p) => p.userId) }, roleCode: 'PASSENGER_DRIVER' },
      select: { userId: true, status: true },
    });
    const roleBy = new Map(roles.map((r) => [r.userId, r.status]));
    return profiles
      .map((p) => ({
        id: p.id,
        userId: p.userId,
        name: `${p.user.firstName} ${p.user.lastName}`,
        email: p.user.email,
        displayName: p.displayName,
        homeDistrict: p.homeDistrict,
        availability: p.availability,
        roleStatus: roleBy.get(p.userId) ?? null,
        isActive: p.isActive,
        isTest: p.isTest,
        vehicleCount: p.vehiclesOwned.length,
        approvedVehicles: p.vehiclesOwned.filter((v) => v.approvalStatus === 'APPROVED').length,
        hasExpiredDocs:
          isExpiredOrMissing(p.licenceExpiry) ||
          p.vehiclesOwned.some((v) => v.registrationExpiry && isExpiredOrMissing(v.registrationExpiry)) ||
          p.vehiclesOwned.some((v) => v.insuranceExpiry && isExpiredOrMissing(v.insuranceExpiry)),
        createdAt: p.createdAt,
      }))
      .filter((d) => {
        if (filter.district && d.homeDistrict !== filter.district) return false;
        if (filter.availability && d.availability !== filter.availability) return false;
        if (filter.roleStatus && d.roleStatus !== filter.roleStatus) return false;
        return true;
      });
  }

  async getDriver(profileId: string) {
    const p = await this.prisma.passengerDriverProfile.findUnique({
      where: { id: profileId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        vehiclesOwned: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        providerProfile: { select: { id: true, businessName: true } },
      },
    });
    if (!p) throw new NotFoundException('Passenger driver not found.');
    const roleStatus =
      (await this.prisma.userRole.findUnique({ where: { userId_roleCode: { userId: p.userId, roleCode: 'PASSENGER_DRIVER' } }, select: { status: true } }))?.status ?? null;
    return {
      ...this.drivers.serializeProfile(p),
      user: { id: p.user.id, name: `${p.user.firstName} ${p.user.lastName}`, email: p.user.email },
      roleStatus,
      provider: p.providerProfile ? { id: p.providerProfile.id, businessName: p.providerProfile.businessName } : null,
      vehicles: p.vehiclesOwned.map((v) => this.drivers.serializeVehicle(v)),
    };
  }

  async listProviders() {
    const rows = await this.prisma.passengerProviderProfile.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        vehicles: { select: { approvalStatus: true } },
        drivers: { select: { id: true } },
      },
    });
    const roles = await this.prisma.userRole.findMany({
      where: { userId: { in: rows.map((p) => p.userId) }, roleCode: 'PASSENGER_PROVIDER' },
      select: { userId: true, status: true },
    });
    const roleBy = new Map(roles.map((r) => [r.userId, r.status]));
    return rows.map((p) => ({
      ...this.providers.serializeProfile(p),
      userId: p.userId,
      contactName: `${p.user.firstName} ${p.user.lastName}`,
      accountEmail: p.user.email,
      roleStatus: roleBy.get(p.userId) ?? null,
      vehicleCount: p.vehicles.length,
      approvedVehicles: p.vehicles.filter((v) => v.approvalStatus === 'APPROVED').length,
      driverCount: p.drivers.length,
    }));
  }

  // ---- vehicle moderation -------------------------------------------------

  async moderateVehicle(actor: Actor, vehicleId: string, decision: 'approve' | 'reject', reason?: string) {
    const v = await this.prisma.passengerVehicle.findUnique({
      where: { id: vehicleId },
      include: {
        ownerDriverProfile: { select: { userId: true } },
        providerProfile: { select: { userId: true } },
      },
    });
    if (!v) throw new NotFoundException('Vehicle not found.');
    const ownerUserId = v.ownerDriverProfile?.userId ?? v.providerProfile?.userId ?? null;
    const updated = await this.prisma.passengerVehicle.update({
      where: { id: vehicleId },
      data:
        decision === 'approve'
          ? { approvalStatus: 'APPROVED', rejectionReason: null }
          : { approvalStatus: 'REJECTED', rejectionReason: reason ?? null },
    });
    await this.audit.record({
      action: decision === 'approve' ? 'PASSENGER_VEHICLE_APPROVED' : 'PASSENGER_VEHICLE_REJECTED',
      actorId: actor.userId,
      targetUserId: ownerUserId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      newValue: { vehicleId, reason: reason ?? null },
    });
    if (ownerUserId) {
      await this.notifications.createInApp({
        userId: ownerUserId,
        type: 'ACCOUNT',
        title: decision === 'approve' ? 'Vehicle approved' : 'Vehicle needs attention',
        body:
          decision === 'approve'
            ? `Your ${updated.make} ${updated.model} was approved for passenger transport.`
            : `Your ${updated.make} ${updated.model} was rejected${reason ? `: ${reason}` : '.'}`,
        data: { vehicleId },
      });
    }
    return this.drivers.serializeVehicle(updated);
  }

  // ---- the simulation boundary (admin-set only) ---------------------------

  /**
   * Designate a passenger driver as a SIMULATION driver, or return them to a
   * real one. Refused while they hold live trips — flipping mid-trip would
   * leave work assigned across the boundary the flag exists to keep closed.
   * (Trips cannot exist before S3; the guard is here so S3 cannot forget it.)
   */
  async setDriverTestMode(actor: Actor, profileId: string, isTest: boolean, reason?: string) {
    const p = await this.prisma.passengerDriverProfile.findUnique({
      where: { id: profileId },
      select: { id: true, displayName: true, isTest: true, userId: true },
    });
    if (!p) throw new NotFoundException('Passenger driver not found.');
    if (p.isTest === isTest) return { id: p.id, displayName: p.displayName, isTest };
    const openTrips = await this.prisma.passengerTrip.count({
      where: { driverProfileId: profileId, status: { in: ['ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'IN_PROGRESS'] } },
    });
    if (openTrips > 0) {
      throw new BadRequestException(`This driver has ${openTrips} trip(s) in progress. Let them finish before changing test mode.`);
    }
    const updated = await this.prisma.passengerDriverProfile.update({ where: { id: profileId }, data: { isTest } });
    await this.audit.record({
      action: 'PASSENGER_DRIVER_TEST_MODE_CHANGED',
      actorId: actor.userId,
      targetUserId: p.userId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      newValue: { passengerDriverProfileId: profileId, isTest, reason: reason ?? null },
    });
    return { id: updated.id, displayName: updated.displayName, isTest: updated.isTest };
  }

  /** The fleet-side flag, same rules: everything a test operator runs is test. */
  async setProviderTestMode(actor: Actor, profileId: string, isTest: boolean, reason?: string) {
    const p = await this.prisma.passengerProviderProfile.findUnique({
      where: { id: profileId },
      select: { id: true, businessName: true, isTest: true, userId: true },
    });
    if (!p) throw new NotFoundException('Transport operator not found.');
    if (p.isTest === isTest) return { id: p.id, businessName: p.businessName, isTest };
    const openTrips = await this.prisma.passengerTrip.count({
      where: { providerProfileId: profileId, status: { in: ['SCHEDULED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'IN_PROGRESS'] } },
    });
    if (openTrips > 0) {
      throw new BadRequestException(`This operator has ${openTrips} trip(s) open. Close them before changing test mode.`);
    }
    const updated = await this.prisma.passengerProviderProfile.update({ where: { id: profileId }, data: { isTest } });
    await this.audit.record({
      action: 'PASSENGER_PROVIDER_TEST_MODE_CHANGED',
      actorId: actor.userId,
      targetUserId: p.userId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      newValue: { passengerProviderProfileId: profileId, isTest, reason: reason ?? null },
    });
    return { id: updated.id, businessName: updated.businessName, isTest: updated.isTest };
  }
}
