/** Account-level status (distinct from per-role status). Mirrors Prisma `UserStatus`. */
export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ROLE_APPLICATION_STATUSES = [
  'PENDING',
  'MORE_INFO_REQUIRED',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export type RoleApplicationStatus = (typeof ROLE_APPLICATION_STATUSES)[number];
