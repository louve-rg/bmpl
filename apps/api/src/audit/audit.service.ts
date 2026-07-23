import { Injectable } from '@nestjs/common';
import type { AuditAction, RoleCode } from '@bmpl/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@bmpl/database';

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  targetUserId?: string | null;
  targetRole?: RoleCode | null;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/**
 * Central audit writer. Every privileged action calls this (rule #11). Accepts
 * an optional transaction client so the audit row commits atomically with the
 * change it records.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        targetUserId: entry.targetUserId ?? null,
        targetRole: entry.targetRole ?? null,
        previousValue: (entry.previousValue ?? undefined) as Prisma.InputJsonValue | undefined,
        newValue: (entry.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
        reason: entry.reason ?? null,
        ipAddress: entry.ipAddress ?? null,
        sessionId: entry.sessionId ?? null,
      },
    });
  }
}
