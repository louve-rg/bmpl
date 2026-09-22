import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@bmpl/database';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * May this carrier organization be handed work on this side of the simulation
 * boundary?
 *
 * A module-level function in its own file ON PURPOSE: LogisticsNetworkService
 * (route operator) and ShippingProviderService (leg operator) both need the
 * same rule, and putting it on either service would close an import cycle
 * through ShipmentService. One implementation, no cycle, no second copy to
 * drift.
 */
export async function assertOperableProvider(db: Db, providerProfileId: string, isTestWork: boolean) {
  const profile = await db.shippingProviderProfile.findUnique({
    where: { id: providerProfileId },
    select: {
      id: true,
      isActive: true,
      isTest: true,
      businessName: true,
      user: { select: { roles: { where: { roleCode: 'SHIPPING_PROVIDER' }, select: { status: true } } } },
    },
  });
  if (!profile) throw new NotFoundException('That carrier does not exist.');
  if (!profile.isActive) throw new BadRequestException('That carrier is deactivated.');
  if (profile.user.roles[0]?.status !== 'APPROVED') {
    throw new BadRequestException('That carrier is not an approved shipping provider.');
  }
  // Symmetric, deliberately — the same boundary driver assignment enforces.
  if (isTestWork && !profile.isTest) {
    throw new BadRequestException('Simulation work can only be operated by a designated test carrier.');
  }
  if (!isTestWork && profile.isTest) {
    throw new BadRequestException('A test carrier cannot operate a real customer shipment.');
  }
  return profile;
}
