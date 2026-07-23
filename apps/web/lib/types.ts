import type { RoleCode } from '@bmpl/shared';

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
  roles: Array<{ roleCode: RoleCode; label: string; status: string; isSelectable: boolean }>;
}

export interface ApplicableRole {
  roleCode: RoleCode;
  label: string;
  description: string;
  service: string;
  requiredDocuments: string[];
  requiresApproval: boolean;
  status: string | null;
  canApply: boolean;
}
