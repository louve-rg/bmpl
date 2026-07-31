import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DELIVERY_STATUS_LABELS, type DeliveryStatus } from '@bmpl/shared';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { OwnershipService } from '../products/ownership.service';
import { DeliveryCoreService } from './delivery-core.service';

/**
 * Customer + vendor delivery views, PIN reveal, and proof-of-delivery access.
 * Ownership is enforced per role: a customer only sees deliveries on their own
 * orders; a vendor only sees deliveries on their own vendor-orders. PINs are
 * revealed only to the party that must hold them (customer → delivery PIN,
 * vendor → pickup PIN) and never appear in general payloads.
 */
@Injectable()
export class DeliveryAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly core: DeliveryCoreService,
  ) {}

  // ---- customer ----------------------------------------------------------

  private async customerDeliveryOrThrow(userId: string, deliveryId: string) {
    const d = await this.core.loadOrThrow(deliveryId);
    if (d.vendorOrder.order.userId !== userId) throw new NotFoundException('Delivery not found.');
    return d;
  }

  async customerGet(userId: string, deliveryId: string) {
    const d = await this.customerDeliveryOrThrow(userId, deliveryId);
    return this.core.serialize(d, 'CUSTOMER');
  }

  /** The recipient's delivery PIN (the driver asks for it on arrival). */
  async customerDeliveryPin(userId: string, deliveryId: string) {
    await this.customerDeliveryOrThrow(userId, deliveryId);
    const row = await this.prisma.orderDelivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { deliveryPin: true, deliveryVerificationStatus: true, status: true } });
    return { deliveryPin: row.deliveryPin, verificationStatus: row.deliveryVerificationStatus, status: row.status };
  }

  async customerProof(userId: string, deliveryId: string) {
    const d = await this.customerDeliveryOrThrow(userId, deliveryId);
    const s = await this.core.serialize(d, 'CUSTOMER');
    return { recipientName: d.recipientName, deliveredAt: d.deliveredAt, podPhotoUrls: s.podPhotoUrls };
  }

  // ---- vendor ------------------------------------------------------------

  private async vendorDeliveryOrThrow(userId: string, deliveryId: string) {
    const vendorProfileId = await this.ownership.vendorProfileId(userId);
    const d = await this.core.loadOrThrow(deliveryId);
    if (d.vendorOrder.vendorProfile.id !== vendorProfileId) throw new NotFoundException('Delivery not found.');
    return d;
  }

  async vendorList(userId: string, scope?: string) {
    const vendorProfileId = await this.ownership.vendorProfileId(userId);
    const where: Prisma.OrderDeliveryWhereInput = { vendorOrder: { vendorProfileId } };
    if (scope === 'active') where.status = { in: ['PENDING_ASSIGNMENT', 'ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_DECLINED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'] as DeliveryStatus[] };
    const rows = await this.prisma.orderDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        vendorOrder: { select: { orderNumber: true, itemCount: true, order: { select: { orderNumber: true } } } },
        assignedDriver: { select: { displayName: true } },
      },
    });
    return rows.map((d) => ({
      id: d.id,
      status: d.status,
      statusLabel: DELIVERY_STATUS_LABELS[d.status],
      orderNumber: d.vendorOrder.order.orderNumber,
      vendorOrderNumber: d.vendorOrder.orderNumber,
      itemCount: d.vendorOrder.itemCount,
      driver: d.assignedDriver?.displayName ?? null,
      pickupConfirmed: !!d.pickupConfirmedAt,
      feeMinor: Number(d.feeMinor),
      createdAt: d.createdAt,
    }));
  }

  async vendorGet(userId: string, deliveryId: string) {
    const d = await this.vendorDeliveryOrThrow(userId, deliveryId);
    return this.core.serialize(d, 'VENDOR');
  }

  /** The pickup PIN the vendor gives the driver at hand-off. */
  async vendorPickupPin(userId: string, deliveryId: string) {
    await this.vendorDeliveryOrThrow(userId, deliveryId);
    const row = await this.prisma.orderDelivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { pickupPin: true, pickupVerificationStatus: true, status: true } });
    return { pickupPin: row.pickupPin, verificationStatus: row.pickupVerificationStatus, status: row.status };
  }

  async vendorProof(userId: string, deliveryId: string) {
    const d = await this.vendorDeliveryOrThrow(userId, deliveryId);
    const s = await this.core.serialize(d, 'VENDOR');
    return { recipientName: d.recipientName, deliveredAt: d.deliveredAt, podPhotoUrls: s.podPhotoUrls };
  }
}
