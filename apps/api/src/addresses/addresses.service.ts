import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isLocatable, type SavedAddressInput } from '@bmpl/validation';
import { UNLOCATABLE_ADDRESS_MESSAGE } from '@bmpl/shared';
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
          // There is no geocode-and-autofill write path for this field yet -
          // coordinates only ever arrive here because the customer placed and
          // confirmed a pin on the map. Never taken from the request itself
          // (MDF-485), same rule as `isTest`.
          pinConfirmedAt: input.latitude != null ? new Date() : null,
        },
      });
    });
  }

  async update(userId: string, id: string, input: Partial<SavedAddressInput>) {
    const existing = await this.ownedOrThrow(userId, id);

    // A PATCH only carries the fields that changed, so `savedAddressUpdateSchema`
    // cannot check locatability on its own — it has to be checked against what
    // the row will actually look like once the patch lands.
    const merged = { ...existing, ...input };
    if (!isLocatable({ street: merged.addressLine1, latitude: merged.latitude, longitude: merged.longitude })) {
      throw new BadRequestException(UNLOCATABLE_ADDRESS_MESSAGE);
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.savedAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }
      // Un-defaulting the current default must not leave the account with none.
      // Same successor rule as remove(): the most recently updated other address.
      if (input.isDefault === false && existing.isDefault) {
        const next = await tx.savedAddress.findFirst({ where: { userId, id: { not: id } }, orderBy: { updatedAt: 'desc' } });
        if (!next) throw new BadRequestException('This is your only address, so it has to stay your default.');
        await tx.savedAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      const data: Omit<Partial<SavedAddressInput>, 'addressLine1'> & { addressLine1?: string | null; pinConfirmedAt?: Date | null } = {
        ...input,
      };
      // `savedAddressUpdateSchema` normalises a blank or null addressLine1 to
      // `undefined` (MDF-533) so `isLocatable` above reads it correctly - but
      // Prisma's `update()` treats an explicit `undefined` field as "do not
      // touch", not "clear it". Left alone, a patch that was SENT with a
      // blank street (present key, normalised value) would silently fail to
      // clear the stored one, same bug Jim found in reverse. A key that was
      // genuinely never sent stays genuinely absent here, so this only fires
      // when the client actually touched the field.
      if ('addressLine1' in input && input.addressLine1 === undefined) {
        data.addressLine1 = null;
      }
      // Only touch provenance when the patch actually touches the pin -
      // leaving it alone otherwise keeps an untouched, previously confirmed
      // pin confirmed.
      if ('latitude' in input || 'longitude' in input) {
        data.pinConfirmedAt = merged.latitude != null ? new Date() : null;
      }
      return tx.savedAddress.update({ where: { id }, data });
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
