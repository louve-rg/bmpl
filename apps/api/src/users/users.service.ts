import { BadRequestException, Injectable } from '@nestjs/common';
import type { UpdateProfileInput } from '@bmpl/validation';
import {
  isAllowedAvatarMime,
  MAX_AVATAR_BYTES,
  ROLE_DEFINITIONS,
  STORAGE_PREFIX,
  type RoleCode,
} from '@bmpl/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/** Serializable view of the signed-in user + their roles. */
export interface MeView {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  district: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  avatarUrl: string | null;
  status: string;
  emailVerified: boolean;
  activeRole: RoleCode | null;
  roles: Array<{
    roleCode: RoleCode;
    label: string;
    status: string;
    isSelectable: boolean;
  }>;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async getMe(userId: string): Promise<MeView> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: true },
    });

    const avatarUrl = user.avatarKey
      ? (await this.storage.presignDownload(user.avatarKey)).url
      : null;

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      district: user.district,
      addressLine1: user.addressLine1,
      addressLine2: user.addressLine2,
      city: user.city,
      avatarUrl,
      status: user.status,
      emailVerified: !!user.emailVerifiedAt,
      activeRole: user.activeRoleCode,
      roles: user.roles.map((r) => ({
        roleCode: r.roleCode as RoleCode,
        label: ROLE_DEFINITIONS[r.roleCode as RoleCode].label,
        status: r.status,
        isSelectable: r.status === 'APPROVED',
      })),
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<MeView> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone || null,
        district: input.district,
        addressLine1: input.addressLine1 || null,
        addressLine2: input.addressLine2 || null,
        city: input.city || null,
      },
    });
    return this.getMe(userId);
  }

  async presignAvatar(userId: string, fileName: string, contentType: string) {
    const key = this.storage.buildKey(STORAGE_PREFIX.avatar(userId), fileName);
    return this.storage.presignUpload(key, contentType);
  }

  /**
   * Confirm an avatar upload. The key must be in the user's own avatar namespace
   * and the actually-stored object must be an allowed image within the size
   * limit — verified via HEAD, never trusting client-supplied metadata.
   */
  async setAvatar(userId: string, key: string): Promise<void> {
    this.storage.assertKeyInNamespace(key, STORAGE_PREFIX.avatar(userId));
    const meta = await this.storage.headObject(key);
    if (!meta) throw new BadRequestException('Uploaded image could not be found in storage.');
    if (!isAllowedAvatarMime(meta.contentType)) {
      throw new BadRequestException('Unsupported image type.');
    }
    if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_AVATAR_BYTES) {
      throw new BadRequestException('Image exceeds the maximum allowed size.');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { avatarKey: key } });
  }
}
