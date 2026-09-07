import type { AvatarStatus, RoleCode } from '@bmpl/shared';

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
  /** Stable public URL of the APPROVED picture, or null while there isn't one. */
  avatarUrl: string | null;
  avatarStatus: AvatarStatus;
  /** Short-lived signed URL for a picture still awaiting review (owner only). */
  avatarPendingUrl: string | null;
  /** Plain-language explanation when avatarStatus is REJECTED. */
  avatarRejectedReason: string | null;
  /** True when one of this user's approved roles makes a picture mandatory. */
  avatarRequired: boolean;
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
  /** Provider-type roles need a verified email to apply (BMPL-40); the API
   *  surfaces this per role so the UI can say so BEFORE the refusal. */
  requiresVerifiedEmail: boolean;
  status: string | null;
  canApply: boolean;
}
