/**
 * Real Estate (Phase 6 · M25) — shared vocabulary. Single source of truth for enum
 * values + human labels + lifecycle transitions so API, web, and admin never drift.
 * Framework-free. Deterministic, no AI.
 */

export const LISTING_PURPOSES = ['FOR_SALE', 'FOR_RENT'] as const;
export type ListingPurpose = (typeof LISTING_PURPOSES)[number];
export const LISTING_PURPOSE_LABELS: Record<ListingPurpose, string> = { FOR_SALE: 'For sale', FOR_RENT: 'For rent' };

export const PROPERTY_TYPES = ['HOUSE', 'APARTMENT', 'CONDO', 'TOWNHOUSE', 'DUPLEX', 'COMMERCIAL', 'OFFICE', 'RETAIL', 'WAREHOUSE', 'INDUSTRIAL', 'LAND', 'FARM', 'RESORT', 'HOTEL', 'OTHER'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  HOUSE: 'House', APARTMENT: 'Apartment', CONDO: 'Condo', TOWNHOUSE: 'Townhouse', DUPLEX: 'Duplex', COMMERCIAL: 'Commercial',
  OFFICE: 'Office', RETAIL: 'Retail', WAREHOUSE: 'Warehouse', INDUSTRIAL: 'Industrial', LAND: 'Land', FARM: 'Farm', RESORT: 'Resort', HOTEL: 'Hotel', OTHER: 'Other',
};

export const PROPERTY_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'UNDER_OFFER', 'SOLD', 'RENTED', 'WITHDRAWN', 'ARCHIVED'] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];
export const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
  DRAFT: 'Draft', SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review', MORE_INFO_REQUIRED: 'More info needed', APPROVED: 'Approved',
  PUBLISHED: 'Published', REJECTED: 'Rejected', SUSPENDED: 'Suspended', UNDER_OFFER: 'Under offer', SOLD: 'Sold', RENTED: 'Rented', WITHDRAWN: 'Withdrawn', ARCHIVED: 'Archived',
};
/** Statuses shown on public surfaces. UNDER_OFFER stays visible; SOLD/RENTED excluded from search by default. */
export const PUBLIC_PROPERTY_STATUSES: readonly PropertyStatus[] = ['PUBLISHED', 'UNDER_OFFER'];

export const FURNISHINGS = ['FURNISHED', 'SEMI_FURNISHED', 'UNFURNISHED', 'NOT_APPLICABLE'] as const;
export type Furnishing = (typeof FURNISHINGS)[number];
export const FURNISHING_LABELS: Record<Furnishing, string> = { FURNISHED: 'Furnished', SEMI_FURNISHED: 'Semi-furnished', UNFURNISHED: 'Unfurnished', NOT_APPLICABLE: 'N/A' };

export const TENURES = ['FREEHOLD', 'LEASEHOLD', 'OTHER', 'UNKNOWN'] as const;
export type Tenure = (typeof TENURES)[number];

export const LOCATION_VISIBILITIES = ['DISTRICT_ONLY', 'LOCALITY_ONLY', 'APPROXIMATE_MAP', 'EXACT_ADDRESS'] as const;
export type LocationVisibility = (typeof LOCATION_VISIBILITIES)[number];
/** Conservative default: only the district is public until the owner/agent widens it. */
export const DEFAULT_LOCATION_VISIBILITY: LocationVisibility = 'DISTRICT_ONLY';

export const RENTAL_PERIODS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
export type RentalPeriod = (typeof RENTAL_PERIODS)[number];
export const RENTAL_PERIOD_LABELS: Record<RentalPeriod, string> = { DAY: 'per day', WEEK: 'per week', MONTH: 'per month', YEAR: 'per year' };

export const AREA_UNITS = ['SQ_FT', 'SQ_M', 'ACRE', 'HECTARE'] as const;
export type AreaUnit = (typeof AREA_UNITS)[number];
export const AREA_UNIT_LABELS: Record<AreaUnit, string> = { SQ_FT: 'sq ft', SQ_M: 'sq m', ACRE: 'acre', HECTARE: 'ha' };

export const AGENT_SPECIALTIES = ['RESIDENTIAL_SALES', 'RESIDENTIAL_RENTALS', 'COMMERCIAL', 'LAND', 'PROPERTY_MANAGEMENT', 'LUXURY', 'AGRICULTURAL', 'INVESTMENT'] as const;
export type AgentSpecialty = (typeof AGENT_SPECIALTIES)[number];
export const AGENT_SPECIALTY_LABELS: Record<AgentSpecialty, string> = {
  RESIDENTIAL_SALES: 'Residential sales', RESIDENTIAL_RENTALS: 'Residential rentals', COMMERCIAL: 'Commercial', LAND: 'Land',
  PROPERTY_MANAGEMENT: 'Property management', LUXURY: 'Luxury', AGRICULTURAL: 'Agricultural', INVESTMENT: 'Investment',
};

export const PROPERTY_DOCUMENT_KINDS = ['PROOF_OF_OWNERSHIP', 'TITLE_DEED', 'OWNER_AUTHORIZATION', 'AGENT_MANDATE', 'SURVEY_PLAN', 'DISCLOSURE', 'LEASE', 'OTHER'] as const;
export type PropertyDocumentKind = (typeof PROPERTY_DOCUMENT_KINDS)[number];

export const LISTING_ASSIGNMENT_STATUSES = ['PENDING', 'ACCEPTED', 'ENDED', 'DECLINED'] as const;
export type ListingAssignmentStatus = (typeof LISTING_ASSIGNMENT_STATUSES)[number];

export const PROPERTY_ENQUIRY_TYPES = ['GENERAL', 'PRICE', 'AVAILABILITY', 'FINANCING', 'RENTAL_TERMS', 'PROPERTY_DETAILS', 'OTHER'] as const;
export type PropertyEnquiryType = (typeof PROPERTY_ENQUIRY_TYPES)[number];
export const PROPERTY_ENQUIRY_STATUSES = ['OPEN', 'RESPONDED', 'CLOSED'] as const;
export type PropertyEnquiryStatus = (typeof PROPERTY_ENQUIRY_STATUSES)[number];

export const VIEWING_REQUEST_STATUSES = ['REQUESTED', 'PROPOSED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED', 'DECLINED', 'NO_SHOW'] as const;
export type ViewingRequestStatus = (typeof VIEWING_REQUEST_STATUSES)[number];
export const VIEWING_REQUEST_STATUS_LABELS: Record<ViewingRequestStatus, string> = {
  REQUESTED: 'Requested', PROPOSED: 'Time proposed', CONFIRMED: 'Confirmed', RESCHEDULED: 'Rescheduled', COMPLETED: 'Completed', CANCELLED: 'Cancelled', DECLINED: 'Declined', NO_SHOW: 'No-show',
};
/**
 * Legal viewing-request transitions. Owner/agent drive PROPOSED/CONFIRMED/DECLINED/
 * COMPLETED/NO_SHOW; either party can CANCEL; RESCHEDULED loops back. Enforced server-side.
 */
export const VIEWING_TRANSITIONS: Record<ViewingRequestStatus, ViewingRequestStatus[]> = {
  REQUESTED: ['PROPOSED', 'CONFIRMED', 'DECLINED', 'CANCELLED'],
  PROPOSED: ['CONFIRMED', 'RESCHEDULED', 'DECLINED', 'CANCELLED'],
  CONFIRMED: ['RESCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  RESCHEDULED: ['CONFIRMED', 'DECLINED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  DECLINED: [],
  NO_SHOW: [],
};
export const TERMINAL_VIEWING_STATUSES: readonly ViewingRequestStatus[] = ['COMPLETED', 'CANCELLED', 'DECLINED', 'NO_SHOW'];
export const canTransitionViewing = (from: ViewingRequestStatus, to: ViewingRequestStatus): boolean => (VIEWING_TRANSITIONS[from] ?? []).includes(to);

export const PROPERTY_REPORT_REASONS = ['SCAM', 'INCORRECT_INFO', 'DUPLICATE', 'PROHIBITED', 'MISLEADING_PRICE', 'PRIVACY', 'DISCRIMINATION', 'ALREADY_SOLD', 'ILLEGAL', 'OTHER'] as const;
export type PropertyReportReason = (typeof PROPERTY_REPORT_REASONS)[number];
export const PROPERTY_REPORT_STATUSES = ['OPEN', 'ACTIONED', 'DISMISSED'] as const;
export type PropertyReportStatus = (typeof PROPERTY_REPORT_STATUSES)[number];

export const PROPERTY_IMAGE_AREAS = ['Exterior', 'Living room', 'Kitchen', 'Bedroom', 'Bathroom', 'Yard', 'Land', 'Floor plan', 'Amenities', 'Other'] as const;

export const PROPERTIES_PAGE_SIZE = 20;
export const SAVED_PROPERTIES_PAGE_SIZE = 24;
export const RECENTLY_VIEWED_PROPERTIES_MAX = 50;
export const MAX_PROPERTY_IMAGES = 30;

/** Sorts offered on the public property search. */
export const PROPERTY_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'property_size', 'land_size', 'most_viewed'] as const;
export type PropertySort = (typeof PROPERTY_SORTS)[number];
