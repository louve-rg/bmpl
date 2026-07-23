import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PERMISSION_BUNDLES,
  ROLE_DEFINITIONS,
  type Permission,
  type RoleCode,
} from '@bmpl/shared';
import { templates } from '@bmpl/notifications';
import { isSelfAction } from '@bmpl/authorization';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

interface Actor {
  userId: string;
  ipAddress?: string;
  sessionId?: string;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  async dashboardSummary() {
    const [totalUsers, pendingApplications, moreInfoApplications, suspendedUsers, suspendedRoles] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.roleApplication.count({ where: { status: 'PENDING' } }),
        this.prisma.roleApplication.count({ where: { status: 'MORE_INFO_REQUIRED' } }),
        this.prisma.user.count({ where: { status: 'SUSPENDED' } }),
        this.prisma.userRole.count({ where: { status: 'SUSPENDED' } }),
      ]);
    return {
      totalUsers,
      pendingApplications,
      moreInfoApplications,
      suspendedUsers,
      suspendedRoles,
    };
  }

  async searchUsers(params: {
    query?: string;
    status?: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.UserWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.query
        ? {
            OR: [
              { email: { contains: params.query, mode: 'insensitive' } },
              { firstName: { contains: params.query, mode: 'insensitive' } },
              { lastName: { contains: params.query, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          district: true,
          createdAt: true,
          roles: { select: { roleCode: true, status: true } },
        },
      }),
    ]);
    return { total, page: params.page, pageSize: params.pageSize, items };
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: true,
        adminPermissions: true,
        roleApplications: {
          orderBy: { createdAt: 'desc' },
          include: { reviews: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found.');
    const { passwordHash, ...safe } = user;
    void passwordHash;
    return safe;
  }

  async applicationQueue(status?: 'PENDING' | 'MORE_INFO_REQUIRED') {
    return this.prisma.roleApplication.findMany({
      where: { status: status ?? { in: ['PENDING', 'MORE_INFO_REQUIRED'] } },
      orderBy: { submittedAt: 'asc' },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        documents: { select: { id: true, label: true } },
      },
    });
  }

  async getApplication(applicationId: string) {
    const application = await this.prisma.roleApplication.findUnique({
      where: { id: applicationId },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, district: true },
        },
        documents: true,
        reviews: {
          orderBy: { createdAt: 'asc' },
          include: { reviewer: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!application) throw new NotFoundException('Application not found.');
    return application;
  }

  /** Short-lived signed URL to view ONE private document (rule #6). */
  async getDocumentUrl(documentId: string) {
    const doc = await this.prisma.roleApplicationDocument.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('Document not found.');
    return this.storage.presignDownload(doc.storageKey);
  }

  // ---- Review actions -------------------------------------------------------

  private roleLabel(code: RoleCode): string {
    return ROLE_DEFINITIONS[code].label;
  }

  private async loadDecidableApplication(applicationId: string, actor: Actor) {
    const application = await this.prisma.roleApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException('Application not found.');
    // Rule #3: a user must never review/approve their OWN application.
    if (isSelfAction(actor.userId, application.userId)) {
      throw new ForbiddenException('You cannot review your own role application.');
    }
    if (!['PENDING', 'MORE_INFO_REQUIRED'].includes(application.status)) {
      throw new BadRequestException('This application has already been decided.');
    }
    return application;
  }

  async approve(applicationId: string, actor: Actor, note?: string) {
    const application = await this.loadDecidableApplication(applicationId, actor);
    const roleCode = application.roleCode as RoleCode;

    await this.prisma.$transaction(async (tx) => {
      await tx.roleApplication.update({
        where: { id: applicationId },
        data: {
          status: 'APPROVED',
          decidedAt: new Date(),
          reviews: {
            create: {
              action: 'APPROVED',
              reviewerId: actor.userId,
              note: note ?? null,
              fromStatus: application.status,
              toStatus: 'APPROVED',
            },
          },
        },
      });
      await tx.userRole.update({
        where: { userId_roleCode: { userId: application.userId, roleCode } },
        data: { status: 'APPROVED', approvedAt: new Date(), statusReason: null },
      });
      await this.audit.record(
        {
          action: 'ROLE_APPROVED',
          actorId: actor.userId,
          targetUserId: application.userId,
          targetRole: roleCode,
          previousValue: { status: application.status },
          newValue: { status: 'APPROVED' },
          reason: note ?? null,
          ipAddress: actor.ipAddress,
          sessionId: actor.sessionId,
        },
        tx,
      );
      const tpl = templates.roleApproved(this.roleLabel(roleCode));
      await this.notifications.createInApp(
        {
          userId: application.userId,
          type: 'ROLE_STATUS',
          title: tpl.title,
          body: tpl.body,
          data: { roleCode, applicationId },
        },
        tx,
      );
    });
    return { ok: true };
  }

  async reject(applicationId: string, actor: Actor, reason: string) {
    const application = await this.loadDecidableApplication(applicationId, actor);
    const roleCode = application.roleCode as RoleCode;

    await this.prisma.$transaction(async (tx) => {
      await tx.roleApplication.update({
        where: { id: applicationId },
        data: {
          status: 'REJECTED',
          decidedAt: new Date(),
          reviews: {
            create: {
              action: 'REJECTED',
              reviewerId: actor.userId,
              note: reason,
              fromStatus: application.status,
              toStatus: 'REJECTED',
            },
          },
        },
      });
      await tx.userRole.update({
        where: { userId_roleCode: { userId: application.userId, roleCode } },
        data: { status: 'REJECTED', statusReason: reason },
      });
      await this.audit.record(
        {
          action: 'ROLE_REJECTED',
          actorId: actor.userId,
          targetUserId: application.userId,
          targetRole: roleCode,
          previousValue: { status: application.status },
          newValue: { status: 'REJECTED' },
          reason,
          ipAddress: actor.ipAddress,
          sessionId: actor.sessionId,
        },
        tx,
      );
      const tpl = templates.roleRejected(this.roleLabel(roleCode), reason);
      await this.notifications.createInApp(
        {
          userId: application.userId,
          type: 'ROLE_STATUS',
          title: tpl.title,
          body: tpl.body,
          data: { roleCode, applicationId },
        },
        tx,
      );
    });
    return { ok: true };
  }

  async requestMoreInfo(applicationId: string, actor: Actor, message: string) {
    const application = await this.loadDecidableApplication(applicationId, actor);
    const roleCode = application.roleCode as RoleCode;

    await this.prisma.$transaction(async (tx) => {
      await tx.roleApplication.update({
        where: { id: applicationId },
        data: {
          status: 'MORE_INFO_REQUIRED',
          reviews: {
            create: {
              action: 'MORE_INFO_REQUESTED',
              reviewerId: actor.userId,
              note: message,
              fromStatus: application.status,
              toStatus: 'MORE_INFO_REQUIRED',
            },
          },
        },
      });
      await tx.userRole.update({
        where: { userId_roleCode: { userId: application.userId, roleCode } },
        data: { status: 'MORE_INFO_REQUIRED', statusReason: message },
      });
      await this.audit.record(
        {
          action: 'ROLE_APPLICATION_MORE_INFO_REQUESTED',
          actorId: actor.userId,
          targetUserId: application.userId,
          targetRole: roleCode,
          newValue: { status: 'MORE_INFO_REQUIRED' },
          reason: message,
          ipAddress: actor.ipAddress,
          sessionId: actor.sessionId,
        },
        tx,
      );
      const tpl = templates.roleMoreInfo(this.roleLabel(roleCode), message);
      await this.notifications.createInApp(
        {
          userId: application.userId,
          type: 'ROLE_APPLICATION',
          title: tpl.title,
          body: tpl.body,
          data: { roleCode, applicationId },
        },
        tx,
      );
    });
    return { ok: true };
  }

  // ---- Role status management (independent of the application) --------------

  private async changeRoleStatus(
    actor: Actor,
    userId: string,
    roleCode: RoleCode,
    to: 'SUSPENDED' | 'APPROVED' | 'REVOKED',
    reason: string | undefined,
    auditAction: 'ROLE_SUSPENDED' | 'ROLE_RESTORED' | 'ROLE_REVOKED',
  ) {
    if (isSelfAction(actor.userId, userId)) {
      throw new ForbiddenException('You cannot change the status of your own role.');
    }
    const userRole = await this.prisma.userRole.findUnique({
      where: { userId_roleCode: { userId, roleCode } },
    });
    if (!userRole) throw new NotFoundException('The user does not hold that role.');

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.update({
        where: { userId_roleCode: { userId, roleCode } },
        data: {
          status: to,
          statusReason: reason ?? null,
          suspendedAt: to === 'SUSPENDED' ? new Date() : null,
          revokedAt: to === 'REVOKED' ? new Date() : null,
          approvedAt: to === 'APPROVED' ? new Date() : userRole.approvedAt,
        },
      });
      await this.audit.record(
        {
          action: auditAction,
          actorId: actor.userId,
          targetUserId: userId,
          targetRole: roleCode,
          previousValue: { status: userRole.status },
          newValue: { status: to },
          reason: reason ?? null,
          ipAddress: actor.ipAddress,
          sessionId: actor.sessionId,
        },
        tx,
      );
      if (to === 'SUSPENDED') {
        const tpl = templates.roleSuspended(this.roleLabel(roleCode), reason ?? '');
        await this.notifications.createInApp(
          { userId, type: 'ROLE_STATUS', title: tpl.title, body: tpl.body, data: { roleCode } },
          tx,
        );
      }
    });

    // If the suspended/revoked role was the user's active role, fall back to CUSTOMER.
    if (to !== 'APPROVED') {
      await this.prisma.user.updateMany({
        where: { id: userId, activeRoleCode: roleCode },
        data: { activeRoleCode: 'CUSTOMER' },
      });
    }
    return { ok: true };
  }

  suspendRole(actor: Actor, userId: string, roleCode: RoleCode, reason: string) {
    return this.changeRoleStatus(actor, userId, roleCode, 'SUSPENDED', reason, 'ROLE_SUSPENDED');
  }

  restoreRole(actor: Actor, userId: string, roleCode: RoleCode, note?: string) {
    return this.changeRoleStatus(actor, userId, roleCode, 'APPROVED', note, 'ROLE_RESTORED');
  }

  revokeRole(actor: Actor, userId: string, roleCode: RoleCode, reason: string) {
    return this.changeRoleStatus(actor, userId, roleCode, 'REVOKED', reason, 'ROLE_REVOKED');
  }

  // ---- Account status -------------------------------------------------------

  async suspendUser(actor: Actor, userId: string, reason: string) {
    if (isSelfAction(actor.userId, userId)) {
      throw new ForbiddenException('You cannot suspend your own account.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendedReason: reason },
      });
      await this.audit.record(
        {
          action: 'USER_SUSPENDED',
          actorId: actor.userId,
          targetUserId: userId,
          previousValue: { status: user.status },
          newValue: { status: 'SUSPENDED' },
          reason,
          ipAddress: actor.ipAddress,
          sessionId: actor.sessionId,
        },
        tx,
      );
    });
    // Revoke all sessions so suspension takes effect immediately (rule #8).
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async restoreUser(actor: Actor, userId: string) {
    if (isSelfAction(actor.userId, userId)) {
      throw new ForbiddenException('You cannot restore your own account.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'ACTIVE', suspendedAt: null, suspendedReason: null },
      });
      await this.audit.record(
        {
          action: 'USER_RESTORED',
          actorId: actor.userId,
          targetUserId: userId,
          previousValue: { status: user.status },
          newValue: { status: 'ACTIVE' },
          ipAddress: actor.ipAddress,
          sessionId: actor.sessionId,
        },
        tx,
      );
    });
    return { ok: true };
  }

  // ---- Audit + permissions --------------------------------------------------

  async listAudit(params: { targetUserId?: string; page: number; pageSize: number }) {
    const where: Prisma.AuditLogWhereInput = params.targetUserId
      ? { targetUserId: params.targetUserId }
      : {};
    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, email: true } },
          targetUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
    ]);
    return { total, page: params.page, pageSize: params.pageSize, items };
  }

  async getPermissions(userId: string): Promise<Permission[]> {
    const grants = await this.prisma.adminPermissionGrant.findMany({ where: { userId } });
    return grants.map((g) => g.permission as Permission);
  }

  /** Set a user's admin permissions (SUPER_ADMIN only). Fully audited. */
  async setPermissions(actor: Actor, userId: string, permissions: Permission[]) {
    const previous = await this.getPermissions(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.adminPermissionGrant.deleteMany({ where: { userId } });
      if (permissions.length > 0) {
        await tx.adminPermissionGrant.createMany({
          data: permissions.map((permission) => ({
            userId,
            permission,
            grantedById: actor.userId,
          })),
        });
      }
      await this.audit.record(
        {
          action: 'ADMIN_PERMISSION_GRANTED',
          actorId: actor.userId,
          targetUserId: userId,
          previousValue: { permissions: previous },
          newValue: { permissions },
          ipAddress: actor.ipAddress,
          sessionId: actor.sessionId,
        },
        tx,
      );
    });
    return { permissions };
  }

  /** Convenience for seeding/tests: apply a named permission bundle. */
  bundle(name: keyof typeof PERMISSION_BUNDLES): Permission[] {
    return PERMISSION_BUNDLES[name] ?? [];
  }
}
