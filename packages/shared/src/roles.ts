/**
 * Canonical role catalog for BMPL.
 *
 * A single user account can hold MANY of these roles simultaneously, each as an
 * independent `UserRole` record with its own status. These string codes are the
 * source of truth and mirror the Prisma `RoleCode` enum exactly.
 */
export const ROLE_CODES = [
  'CUSTOMER',
  'VENDOR',
  'DELIVERY_DRIVER',
  'SHIPPING_PROVIDER',
  'PASSENGER_DRIVER',
  'PASSENGER_PROVIDER',
  'JOB_SEEKER',
  'EMPLOYER',
  'REAL_ESTATE_AGENT',
  'PROPERTY_OWNER',
  'MARKETING_CLIENT',
  'SUPPORT_AGENT',
  'ADMIN',
  'SUPER_ADMIN',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

/** Independent lifecycle status for each individual UserRole. */
export const ROLE_STATUSES = [
  'PENDING',
  'MORE_INFO_REQUIRED',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
  'REVOKED',
] as const;

export type RoleStatus = (typeof ROLE_STATUSES)[number];

/** Only APPROVED roles may be activated in the role switcher. */
export const SELECTABLE_ROLE_STATUSES: readonly RoleStatus[] = ['APPROVED'];

export interface RoleDefinition {
  code: RoleCode;
  label: string;
  /** Short user-facing description shown on the role application screen. */
  description: string;
  /** Staff/admin role — governed by AdminPermission, never customer-facing. */
  isAdminRole: boolean;
  /** Requires admin approval before it can be activated. */
  requiresApproval: boolean;
  /** Granted automatically to every new account. */
  autoGranted: boolean;
  /** Documents the applicant is expected to upload (labels only). */
  requiredDocuments: string[];
  /** Which platform service this role belongs to (for grouping in UI). */
  service:
    | 'core'
    | 'marketplace'
    | 'shipping'
    | 'passenger'
    | 'employment'
    | 'realestate'
    | 'marketing'
    | 'staff';
}

export const ROLE_DEFINITIONS: Record<RoleCode, RoleDefinition> = {
  CUSTOMER: {
    code: 'CUSTOMER',
    label: 'Customer',
    description: 'Shop, book services, and use the platform. Granted to every account automatically.',
    isAdminRole: false,
    requiresApproval: false,
    autoGranted: true,
    requiredDocuments: [],
    service: 'core',
  },
  VENDOR: {
    code: 'VENDOR',
    label: 'Vendor',
    description: 'Sell products and manage a marketplace storefront.',
    isAdminRole: false,
    requiresApproval: true,
    autoGranted: false,
    requiredDocuments: ['Government-issued ID', 'Business registration or trade licence'],
    service: 'marketplace',
  },
  DELIVERY_DRIVER: {
    code: 'DELIVERY_DRIVER',
    label: 'Delivery Driver',
    description: 'Complete local deliveries for marketplace and shipping orders.',
    isAdminRole: false,
    requiresApproval: true,
    autoGranted: false,
    requiredDocuments: ["Driver's licence", 'Vehicle registration', 'Proof of insurance'],
    service: 'shipping',
  },
  SHIPPING_PROVIDER: {
    code: 'SHIPPING_PROVIDER',
    label: 'Shipping Provider',
    description: 'Offer land, air, or sea freight and nationwide logistics capacity.',
    isAdminRole: false,
    requiresApproval: true,
    autoGranted: false,
    requiredDocuments: ['Business registration', 'Operating/transport permit'],
    service: 'shipping',
  },
  PASSENGER_DRIVER: {
    code: 'PASSENGER_DRIVER',
    label: 'Passenger Driver',
    description: 'Drive passengers for the passenger service.',
    isAdminRole: false,
    requiresApproval: true,
    autoGranted: false,
    requiredDocuments: ["Driver's licence", 'Vehicle registration', 'Proof of insurance', 'Police record'],
    service: 'passenger',
  },
  PASSENGER_PROVIDER: {
    code: 'PASSENGER_PROVIDER',
    label: 'Passenger-Service Provider',
    description: 'Operate a fleet or company offering passenger transport.',
    isAdminRole: false,
    requiresApproval: true,
    autoGranted: false,
    requiredDocuments: ['Business registration', 'Public transport licence'],
    service: 'passenger',
  },
  JOB_SEEKER: {
    code: 'JOB_SEEKER',
    label: 'Job Seeker',
    description: 'Build a profile and apply to jobs on Belize Connect.',
    isAdminRole: false,
    requiresApproval: false,
    autoGranted: false,
    requiredDocuments: [],
    service: 'employment',
  },
  EMPLOYER: {
    code: 'EMPLOYER',
    label: 'Employer',
    description: 'Post jobs and hire talent through Belize Connect.',
    isAdminRole: false,
    requiresApproval: true,
    autoGranted: false,
    requiredDocuments: ['Business registration'],
    service: 'employment',
  },
  REAL_ESTATE_AGENT: {
    code: 'REAL_ESTATE_AGENT',
    label: 'Real-Estate Agent',
    description: 'List and manage properties on behalf of clients.',
    isAdminRole: false,
    requiresApproval: true,
    autoGranted: false,
    requiredDocuments: ['Government-issued ID', 'Real-estate licence or agency affiliation'],
    service: 'realestate',
  },
  PROPERTY_OWNER: {
    code: 'PROPERTY_OWNER',
    label: 'Property Owner',
    description: 'List your own property for sale or rent.',
    isAdminRole: false,
    requiresApproval: true,
    autoGranted: false,
    requiredDocuments: ['Government-issued ID', 'Proof of ownership'],
    service: 'realestate',
  },
  MARKETING_CLIENT: {
    code: 'MARKETING_CLIENT',
    label: 'Marketing Client',
    description: 'Run advertising campaigns and promote a business, product, or event.',
    isAdminRole: false,
    requiresApproval: true,
    autoGranted: false,
    requiredDocuments: ['Business registration'],
    service: 'marketing',
  },
  SUPPORT_AGENT: {
    code: 'SUPPORT_AGENT',
    label: 'Support Agent',
    description: 'Internal staff role for customer support operations.',
    isAdminRole: true,
    requiresApproval: true,
    autoGranted: false,
    requiredDocuments: [],
    service: 'staff',
  },
  ADMIN: {
    code: 'ADMIN',
    label: 'Administrator',
    description: 'Internal staff role for platform administration.',
    isAdminRole: true,
    requiresApproval: true,
    autoGranted: false,
    requiredDocuments: [],
    service: 'staff',
  },
  SUPER_ADMIN: {
    code: 'SUPER_ADMIN',
    label: 'Super Administrator',
    description: 'Highest-privilege internal role. Manages administrators and permissions.',
    isAdminRole: true,
    requiresApproval: true,
    autoGranted: false,
    requiredDocuments: [],
    service: 'staff',
  },
};

/** Roles a customer can apply for from the web/mobile app. */
export const APPLICABLE_ROLE_CODES: RoleCode[] = ROLE_CODES.filter(
  (code) => !ROLE_DEFINITIONS[code].autoGranted && !ROLE_DEFINITIONS[code].isAdminRole,
);

/** Staff/admin roles — assigned internally, never applied for by customers. */
export const ADMIN_ROLE_CODES: RoleCode[] = ROLE_CODES.filter(
  (code) => ROLE_DEFINITIONS[code].isAdminRole,
);

export const isAdminRole = (code: RoleCode): boolean => ROLE_DEFINITIONS[code].isAdminRole;

export const roleRequiresApproval = (code: RoleCode): boolean =>
  ROLE_DEFINITIONS[code].requiresApproval;
