import { Injectable } from '@nestjs/common';
import type { Permission, RoleCode, RoleStatus } from '@bmpl/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../common/auth-context';

/**
 * Loads the authorization-relevant state for a user FRESH from the database.
 * Guards call this on every protected request — a stale token can never grant
 * access that was revoked in the DB (rule #1: authz enforced on the backend).
 */
@Injectable()
export class AuthContextService {
  constructor(private readonly prisma: PrismaService) {}

  async build(params: {
    userId: string;
    sessionId: string;
    client: string;
  }): Promise<AuthContext | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        email: true,
        status: true,
        activeRoleCode: true,
        roles: { select: { roleCode: true, status: true } },
        adminPermissions: { select: { permission: true } },
      },
    });
    if (!user) return null;

    return {
      userId: user.id,
      sessionId: params.sessionId,
      email: user.email,
      status: user.status,
      activeRole: user.activeRoleCode,
      client: params.client,
      roles: user.roles.map((r) => ({
        roleCode: r.roleCode as RoleCode,
        status: r.status as RoleStatus,
      })),
      permissions: user.adminPermissions.map((p) => p.permission as Permission),
    };
  }
}
