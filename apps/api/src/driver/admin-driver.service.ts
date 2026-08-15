import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { expiryStatus, isExpiredOrMissing } from '@bmpl/shared';
import type { DriverProfile, DriverVehicle } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DriverService } from './driver.service';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/** Admin (read-only + vehicle moderation) view of drivers. Driver-ROLE approval,
 *  more-info, suspend/restore/revoke reuse the existing admin role-application
 *  endpoints; this covers driver profiles, vehicles, and expiry. */
@Injectable()
export class AdminDriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly drivers: DriverService,
  ) {}

  async list(filter: { district?: string; availability?: string; roleStatus?: string }) {
    const profiles = await this.prisma.driverProfile.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        vehicles: { select: { approvalStatus: true, isActive: true, registrationExpiry: true, insuranceExpiry: true } },
        serviceAreas: { select: { district: true } },
      },
    });
    const roles = await this.prisma.userRole.findMany({
      where: { userId: { in: profiles.map((p) => p.userId) }, roleCode: 'DELIVERY_DRIVER' },
      select: { userId: true, status: true },
    });
    const roleBy = new Map(roles.map((r) => [r.userId, r.status]));
    return profiles
      .map((p) => {
        const anyExpired =
          isExpiredOrMissing(p.licenceExpiry) ||
          p.vehicles.some((v) => v.registrationExpiry && isExpiredOrMissing(v.registrationExpiry)) ||
          p.vehicles.some((v) => v.insuranceExpiry && isExpiredOrMissing(v.insuranceExpiry));
        return {
          id: p.id,
          userId: p.userId,
          name: `${p.user.firstName} ${p.user.lastName}`,
          email: p.user.email,
          displayName: p.displayName,
          homeDistrict: p.homeDistrict,
          availability: p.availability,
          roleStatus: roleBy.get(p.userId) ?? null,
          isActive: p.isActive,
          vehicleCount: p.vehicles.length,
          approvedVehicles: p.vehicles.filter((v) => v.approvalStatus === 'APPROVED').length,
          serviceDistricts: p.serviceAreas.map((s) => s.district),
          hasExpiredDocs: anyExpired,
          createdAt: p.createdAt,
        };
      })
      .filter((d) => {
        if (filter.district && d.homeDistrict !== filter.district && !(d.serviceDistricts as string[]).includes(filter.district)) return false;
        if (filter.availability && d.availability !== filter.availability) return false;
        if (filter.roleStatus && d.roleStatus !== filter.roleStatus) return false;
        return true;
      });
  }

  async get(driverProfileId: string) {
    const p = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        vehicles: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        serviceAreas: { orderBy: { district: 'asc' } },
      },
    });
    if (!p) throw new NotFoundException('Driver not found.');
    const roleStatus =
      (await this.prisma.userRole.findUnique({ where: { userId_roleCode: { userId: p.userId, roleCode: 'DELIVERY_DRIVER' } }, select: { status: true } }))?.status ?? null;
    const audit = await this.prisma.auditLog.findMany({
      where: { targetUserId: p.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { action: true, createdAt: true, actorId: true },
    });
    return {
      ...this.serializeProfile(p),
      user: { id: p.user.id, name: `${p.user.firstName} ${p.user.lastName}`, email: p.user.email },
      roleStatus,
      vehicles: await Promise.all(p.vehicles.map((v) => this.serializeVehicle(v))),
      serviceAreas: p.serviceAreas.map((s) => ({ district: s.district, isActive: s.isActive })),
      recentActivity: audit,
    };
  }

  /**
   * Designate a driver profile as a SIMULATION driver, or return it to a real one.
   *
   * Refused while the driver holds open work on the other side of the boundary:
   * flipping mid-delivery would leave a job assigned to a driver the eligibility
   * rules say may not have it, which is precisely the inconsistency the flag
   * exists to prevent.
   */
  async setTestMode(actor: Actor, driverProfileId: string, isTest: boolean, reason?: string) {
    const p = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      select: { id: true, displayName: true, isTest: true, userId: true },
    });
    if (!p) throw new NotFoundException('Driver not found.');
    if (p.isTest === isTest) return { id: p.id, displayName: p.displayName, isTest };

    const openWork = await this.prisma.orderDelivery.count({
      where: {
        assignedDriverProfileId: driverProfileId,
        status: { in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'] },
      },
    });
    if (openWork > 0) {
      throw new BadRequestException(
        `This driver has ${openWork} delivery(ies) in progress. Let them finish before changing test mode.`,
      );
    }

    const updated = await this.prisma.driverProfile.update({ where: { id: driverProfileId }, data: { isTest } });
    await this.audit.record({
      action: 'DRIVER_TEST_MODE_CHANGED',
      actorId: actor.userId,
      targetUserId: p.userId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      newValue: { driverProfileId, isTest, reason: reason ?? null },
    });
    return { id: updated.id, displayName: updated.displayName, isTest: updated.isTest };
  }

  async moderateVehicle(actor: Actor, vehicleId: string, decision: 'approve' | 'reject', reason?: string) {
    const v = await this.prisma.driverVehicle.findUnique({ where: { id: vehicleId }, include: { driverProfile: { select: { userId: true } } } });
    if (!v) throw new NotFoundException('Vehicle not found.');
    const updated = await this.prisma.driverVehicle.update({
      where: { id: vehicleId },
      data: decision === 'approve' ? { approvalStatus: 'APPROVED', rejectionReason: null } : { approvalStatus: 'REJECTED', rejectionReason: reason ?? null },
    });
    await this.audit.record({
      action: decision === 'approve' ? 'DRIVER_VEHICLE_APPROVED' : 'DRIVER_VEHICLE_REJECTED',
      actorId: actor.userId,
      targetUserId: v.driverProfile.userId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      newValue: { vehicleId, reason: reason ?? null },
    });
    // Recompute eligibility right now and say what actually changed for them.
    // Driver eligibility is derived live from the vehicle/licence/role rows on
    // every read, so there is no server-side cache to invalidate — approving the
    // vehicle IS the state change. What was missing is telling the driver, who
    // otherwise sees "vehicle approved" and has to guess whether they may now
    // work. Deliveries waiting on a driver are picked up by the dispatch sweeper
    // within a tick, so a newly-eligible driver needs no admin follow-up either.
    const eligibility = await this.drivers.eligibilityFor(v.driverProfile.userId);
    const canWorkNow = decision === 'approve' && eligibility.canGoOnline;
    await this.notifications.createInApp({
      userId: v.driverProfile.userId,
      type: 'ACCOUNT',
      title: decision === 'approve' ? 'Vehicle approved' : 'Vehicle needs attention',
      body:
        decision === 'approve'
          ? canWorkNow
            ? `Your ${updated.make} ${updated.model} was approved. You can go online and start accepting deliveries.`
            : `Your ${updated.make} ${updated.model} was approved. Before you can go online: ${eligibility.reasons.join('; ')}.`
          : `Your ${updated.make} ${updated.model} was rejected${reason ? `: ${reason}` : '.'}`,
      data: { vehicleId, canGoOnline: eligibility.canGoOnline },
    });
    return { ...(await this.serializeVehicle(updated)), driverEligibility: eligibility };
  }

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
      availability: p.availability,
      isActive: p.isActive,
      ratingAverage: p.ratingAverage,
      completedDeliveries: p.completedDeliveries,
      createdAt: p.createdAt,
    };
  }

  private async serializeVehicle(v: DriverVehicle) {
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
      insuranceExpiry: v.insuranceExpiry,
      insuranceExpiryStatus: expiryStatus(v.insuranceExpiry),
      photoUrls: photos.filter((u): u is string => !!u),
      isActive: v.isActive,
      isPrimary: v.isPrimary,
      approvalStatus: v.approvalStatus,
      rejectionReason: v.rejectionReason,
    };
  }
}
