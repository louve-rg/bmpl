import { Injectable, NotFoundException } from '@nestjs/common';
import type { SavedAddressInput } from '@bmpl/validation';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The customer's own address book.
 *
 * Every read and write is scoped to the signed-in user; there is no route here
 * that takes somebody else's id. A missing row and somebody else's row both
 * return 404, so the endpoint cannot be used to discover which ids exist.
 */
@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.savedAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async create(userId: string, input: SavedAddressInput) {
    return this.prisma.$transaction(async (tx) => {
      // One default at a time, or "the default" stops meaning anything.
      if (input.isDefault) {
        await tx.savedAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }
      const count = await tx.savedAddress.count({ where: { userId } });
      return tx.savedAddress.create({
        data: {
          ...input,
          userId,
          // The first address a customer saves is their default, whether or not
          // they thought to say so.
          isDefault: input.isDefault || count === 0,
        },
      });
    });
  }

  async update(userId: string, id: string, input: Partial<SavedAddressInput>) {
    await this.ownedOrThrow(userId, id);
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.savedAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.savedAddress.update({ where: { id }, data: input });
    });
  }

  async remove(userId: string, id: string) {
    const existing = await this.ownedOrThrow(userId, id);
    await this.prisma.savedAddress.delete({ where: { id } });

    // Deleting the default promotes the next one rather than leaving the
    // customer with an address book that has no default in it.
    if (existing.isDefault) {
      const next = await this.prisma.savedAddress.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } });
      if (next) await this.prisma.savedAddress.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return { deleted: true };
  }

  private async ownedOrThrow(userId: string, id: string) {
    const row = await this.prisma.savedAddress.findFirst({ where: { id, userId } });
    // 404 rather than 403: somebody else's address should not be distinguishable
    // from one that does not exist.
    if (!row) throw new NotFoundException('Address not found.');
    return row;
  }
}
