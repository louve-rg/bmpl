import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  APPLICABLE_ROLE_CODES,
  isAllowedDocumentMime,
  MAX_DOCUMENT_BYTES,
  ROLE_DEFINITIONS,
  roleRequiresApproval,
  STORAGE_PREFIX,
  type RoleCode,
} from '@bmpl/shared';
import type { SubmitRoleApplicationInput } from '@bmpl/validation';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /** Catalog of roles a customer may apply for, with their current status. */
  async listApplicable(userId: string) {
    const held = await this.prisma.userRole.findMany({ where: { userId } });
    const heldByCode = new Map(held.map((r) => [r.roleCode, r]));
    return APPLICABLE_ROLE_CODES.map((code) => {
      const def = ROLE_DEFINITIONS[code];
      const current = heldByCode.get(code);
      return {
        roleCode: code,
        label: def.label,
        description: def.description,
        service: def.service,
        requiredDocuments: def.requiredDocuments,
        requiresApproval: def.requiresApproval,
        status: current?.status ?? null,
        canApply: !current || ['REJECTED', 'REVOKED'].includes(current.status),
      };
    });
  }

  async myApplications(userId: string) {
    return this.prisma.roleApplication.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        documents: { select: { id: true, label: true, uploadedAt: true } },
        reviews: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  /** Presign an application document upload (private storage). */
  async presignDocument(userId: string, roleCode: RoleCode, fileName: string, contentType: string) {
    const key = this.storage.buildKey(STORAGE_PREFIX.applicationDocs(userId, roleCode), fileName);
    return this.storage.presignUpload(key, contentType);
  }

  /**
   * Validate a set of uploaded document keys and return their REAL metadata.
   * For each key: (1) it must live in this user's application namespace, (2) the
   * object must actually exist in storage, (3) its true content type must be in
   * the allow-list, and (4) its true size must be within the limit. Client-
   * declared values are never trusted — everything comes from a HEAD request.
   */
  private async resolveDocuments(userId: string, roleCode: RoleCode, keys: string[]) {
    const prefix = STORAGE_PREFIX.applicationDocs(userId, roleCode);
    const resolved: Array<{ storageKey: string; contentType: string; sizeBytes: number }> = [];
    for (const key of keys) {
      this.storage.assertKeyInNamespace(key, prefix);
      const meta = await this.storage.headObject(key);
      if (!meta) {
        throw new BadRequestException('An uploaded document could not be found in storage.');
      }
      if (!isAllowedDocumentMime(meta.contentType)) {
        throw new BadRequestException(`Unsupported document type: ${meta.contentType}.`);
      }
      if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_DOCUMENT_BYTES) {
        throw new BadRequestException('A document exceeds the maximum allowed size.');
      }
      resolved.push({ storageKey: key, contentType: meta.contentType, sizeBytes: meta.sizeBytes });
    }
    return resolved;
  }

  async submitApplication(userId: string, input: SubmitRoleApplicationInput) {
    const roleCode = input.roleCode as RoleCode;

    const existingRole = await this.prisma.userRole.findUnique({
      where: { userId_roleCode: { userId, roleCode } },
    });
    if (existingRole && !['REJECTED', 'REVOKED'].includes(existingRole.status)) {
      throw new BadRequestException(
        `You already have a ${ROLE_DEFINITIONS[roleCode].label} role or a pending request.`,
      );
    }

    const needsApproval = roleRequiresApproval(roleCode);

    // Validate documents + capture their real metadata BEFORE opening the tx.
    const documents = await this.resolveDocuments(userId, roleCode, input.documentKeys);

    return this.prisma.$transaction(async (tx) => {
      const userRole = await tx.userRole.upsert({
        where: { userId_roleCode: { userId, roleCode } },
        update: {
          status: needsApproval ? 'PENDING' : 'APPROVED',
          approvedAt: needsApproval ? null : new Date(),
          statusReason: null,
        },
        create: {
          userId,
          roleCode,
          status: needsApproval ? 'PENDING' : 'APPROVED',
          approvedAt: needsApproval ? null : new Date(),
        },
      });

      // Auto-granted-on-request roles (e.g. JOB_SEEKER) need no admin review.
      if (!needsApproval) {
        await this.audit.record(
          { action: 'ROLE_APPROVED', actorId: userId, targetUserId: userId, targetRole: roleCode },
          tx,
        );
        return { autoApproved: true, roleCode };
      }

      const application = await tx.roleApplication.create({
        data: {
          userId,
          roleCode,
          userRoleId: userRole.id,
          status: 'PENDING',
          message: input.message ?? null,
          documents: { create: documents },
          reviews: { create: { action: 'SUBMITTED', toStatus: 'PENDING' } },
        },
      });

      await this.audit.record(
        {
          action: 'ROLE_APPLICATION_SUBMITTED',
          actorId: userId,
          targetUserId: userId,
          targetRole: roleCode,
          newValue: { applicationId: application.id },
        },
        tx,
      );

      return { autoApproved: false, applicationId: application.id, roleCode };
    });
  }

  /** Applicant responds to a MORE_INFO_REQUIRED request. */
  async provideMoreInfo(
    userId: string,
    applicationId: string,
    message: string,
    documentKeys: string[],
  ) {
    const application = await this.prisma.roleApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application || application.userId !== userId) {
      throw new NotFoundException('Application not found.');
    }
    if (application.status !== 'MORE_INFO_REQUIRED') {
      throw new BadRequestException('This application is not awaiting more information.');
    }

    const documents = await this.resolveDocuments(
      userId,
      application.roleCode as RoleCode,
      documentKeys,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.roleApplication.update({
        where: { id: applicationId },
        data: {
          status: 'PENDING',
          documents: { create: documents },
          reviews: {
            create: {
              action: 'INFO_PROVIDED',
              note: message,
              fromStatus: 'MORE_INFO_REQUIRED',
              toStatus: 'PENDING',
            },
          },
        },
      });
      await tx.userRole.update({
        where: { userId_roleCode: { userId, roleCode: application.roleCode } },
        data: { status: 'PENDING' },
      });
      await this.audit.record(
        {
          action: 'ROLE_APPLICATION_INFO_PROVIDED',
          actorId: userId,
          targetUserId: userId,
          targetRole: application.roleCode,
          newValue: { applicationId },
        },
        tx,
      );
      return { ok: true };
    });
  }

  /**
   * Switch the active role. Only APPROVED roles are selectable; pending,
   * rejected, suspended, or revoked roles are refused (backend-enforced — not
   * merely hidden in the UI).
   */
  async switchRole(userId: string, roleCode: RoleCode) {
    const userRole = await this.prisma.userRole.findUnique({
      where: { userId_roleCode: { userId, roleCode } },
    });
    if (!userRole) throw new NotFoundException('You do not hold that role.');
    if (userRole.status !== 'APPROVED') {
      throw new ForbiddenException('Only approved roles can be activated.');
    }

    const previous = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { activeRoleCode: true },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { activeRoleCode: roleCode },
    });
    await this.audit.record({
      action: 'ROLE_SWITCHED',
      actorId: userId,
      targetUserId: userId,
      targetRole: roleCode,
      previousValue: { activeRole: previous?.activeRoleCode },
      newValue: { activeRole: roleCode },
    });
    return { activeRole: roleCode };
  }
}
