import type { Permission, RoleCode, RoleStatus } from '@bmpl/shared';

/** The authenticated principal attached to each request by JwtAuthGuard. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  status: string;
  activeRole: RoleCode | null;
  client: string;
  roles: Array<{ roleCode: RoleCode; status: RoleStatus }>;
  permissions: Permission[];
}

export interface RequestWithAuth extends Express.Request {
  auth?: AuthContext;
  ip?: string;
}
