/**
 * Real Estate (M25) — single source of truth for the customer-facing property UI.
 * Types mirror the API contract, `realEstateApi` wraps every endpoint, and the helpers
 * (price formatting respecting purpose/period, location respecting visibility) are shared
 * by all property surfaces so nothing drifts. Money is always in MINOR units (cents).
 *
 * The public API NEVER returns a listing's exact address — no helper or type here reads
 * `exactAddress`, and no UI surfaces it (public or lister).
 */
import {
  DISTRICT_LABELS,
  LISTING_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  PROPERTY_STATUS_LABELS,
  FURNISHING_LABELS,
  RENTAL_PERIOD_LABELS,
  AREA_UNIT_LABELS,
  AGENT_SPECIALTY_LABELS,
  VIEWING_REQUEST_STATUS_LABELS,
  type District,
  type ListingPurpose,
  type PropertyType,
  type PropertyStatus,
  type Furnishing,
  type Tenure,
  type LocationVisibility,
  type RentalPeriod,
  type AreaUnit,
  type AgentSpecialty,
  type PropertyDocumentKind,
  type ListingAssignmentStatus,
  type PropertyEnquiryType,
  type PropertyEnquiryStatus,
  type ViewingRequestStatus,
  type PropertyReportReason,
  type PropertySort,
} from '@bmpl/shared';
import { api } from './api';
import { uploadFile } from './uploads';

/* ------------------------------------------------------------------ types */

export type ContactPreference = 'EMAIL' | 'PHONE' | 'MESSAGE';
export type OwnerStatusAction = 'WITHDRAW' | 'UNDER_OFFER' | 'SOLD' | 'RENTED' | 'ARCHIVE';

/** Location fields respecting the listing's visibility. Exact address is never present. */
export interface PropertyLocation {
  visibility: LocationVisibility;
  district: District | null;
  locality?: string | null;
  generalAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface AgentRef {
  displayName: string;
  slug: string;
}
export interface AgencyRef {
  name: string;
  slug: string;
}

/** Compact property representation used by search results, related rows, saved lists. */
export interface PropertyCard {
  id: string;
  title: string;
  slug: string;
  reference: string;
  purpose: ListingPurpose;
  propertyType: PropertyType;
  priceMinor: number;
  currency: string;
  rentalPeriod: RentalPeriod | null;
  negotiable: boolean;
  bedrooms: number | null;
  bathrooms: number | null;
  propertySize: number | null;
  landSize: number | null;
  areaUnit: AreaUnit | null;
  furnishing: Furnishing | null;
  status: PropertyStatus;
  location: PropertyLocation;
  primaryImageUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  viewCount?: number;
  /** Present only on lister (owner/agent) lists. */
  enquiryCount?: number;
  viewingCount?: number;
  /** Present only on public cards. */
  agent?: AgentRef | null;
  agency?: AgencyRef | null;
}

export interface PropertyList {
  total: number;
  page: number;
  pageSize: number;
  items: PropertyCard[];
}

export interface SavedProperty extends PropertyCard {
  savedAt: string;
  closed: boolean;
}

export interface RecentlyViewedProperty extends PropertyCard {
  viewedAt: string;
}

export interface PropertyImage {
  id: string;
  url: string | null;
  altText: string | null;
  caption: string | null;
  areaLabel: string | null;
  isPrimary: boolean;
  /** Present on the managed (owner/agent) detail only. */
  position?: number;
}

export interface PublicAgentContact {
  displayName: string;
  slug: string;
  phone: string | null;
  email: string | null;
  photoUrl: string | null;
}
export interface PublicAgencyContact {
  name: string;
  slug: string;
  logoUrl: string | null;
}

/** Full public property detail (GET /properties/:slug). */
export interface PropertyDetail {
  id: string;
  title: string;
  slug: string;
  reference: string;
  status: PropertyStatus;
  purpose: ListingPurpose;
  propertyType: PropertyType;
  description: string;
  priceMinor: number;
  currency: string;
  rentalPeriod: RentalPeriod | null;
  negotiable: boolean;
  bedrooms: number | null;
  bathrooms: number | null;
  halfBathrooms: number | null;
  parkingSpaces: number | null;
  propertySize: number | null;
  landSize: number | null;
  areaUnit: AreaUnit | null;
  yearBuilt: number | null;
  furnishing: Furnishing | null;
  tenure: Tenure | null;
  petPolicy: string | null;
  availabilityDate: string | null;
  leaseTerm: string | null;
  condition: string | null;
  videoUrl: string | null;
  authorityVerified: boolean;
  viewCount: number;
  publishedAt: string | null;
  location: PropertyLocation;
  amenities: string[];
  utilities: string[];
  images: PropertyImage[];
  agent: PublicAgentContact | null;
  agency: PublicAgencyContact | null;
  related: PropertyCard[];
  moreFromAgent: PropertyCard[];
}

/* --- public agent / agency pages --- */

export interface PublicAgent {
  displayName: string;
  slug: string;
  bio: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  serviceDistricts: District[];
  specialties: AgentSpecialty[];
  yearsExperience: number | null;
  ratingAverage: number | null;
  ratingCount: number;
  agency: AgencyRef | null;
  /** Agent headshot; falls back server-side to the agent's approved account picture. */
  photoUrl: string | null;
  initials: string;
  activeListings: number;
}
export interface AgentPage {
  agent: PublicAgent;
  listings: PropertyCard[];
}

export interface PublicAgency {
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  district: District | null;
  city: string | null;
  contactEmail: string;
  contactPhone: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  activeListings: number;
  agents: Array<{ displayName: string; slug: string; photoUrl: string | null }>;
}
export interface AgencyPage {
  agency: PublicAgency;
  listings: PropertyCard[];
}

/* --- managed (owner / agent) listing detail --- */

export interface PropertyDocument {
  id: string;
  kind: PropertyDocumentKind;
  label: string | null;
  mimeType: string;
  fileSizeBytes: number;
  scanStatus: string;
  createdAt: string;
}

export interface StatusHistoryEntry {
  from: PropertyStatus | null;
  to: PropertyStatus;
  note: string | null;
  at: string;
}
export interface PriceHistoryEntry {
  priceMinor: number;
  currency: string;
  at: string;
}
export interface ListingAssignment {
  id: string;
  status: ListingAssignmentStatus;
  agent: { id: string; displayName: string; slug: string } | null;
  assignedAt: string;
  acceptedAt: string | null;
  endedAt: string | null;
}

/** Full owner/agent management view (GET /{lister}/listings/:id). */
export interface ManagedProperty {
  id: string;
  title: string;
  slug: string;
  reference: string;
  status: PropertyStatus;
  purpose: ListingPurpose;
  propertyType: PropertyType;
  description: string;
  priceMinor: number;
  currency: string;
  rentalPeriod: RentalPeriod | null;
  negotiable: boolean;
  district: District | null;
  locality: string | null;
  generalAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  locationVisibility: LocationVisibility;
  bedrooms: number | null;
  bathrooms: number | null;
  halfBathrooms: number | null;
  parkingSpaces: number | null;
  propertySize: number | null;
  landSize: number | null;
  areaUnit: AreaUnit | null;
  yearBuilt: number | null;
  furnishing: Furnishing | null;
  tenure: Tenure | null;
  petPolicy: string | null;
  availabilityDate: string | null;
  leaseTerm: string | null;
  condition: string | null;
  videoUrl: string | null;
  authorityVerified: boolean;
  moderationReason: string | null;
  viewCount: number;
  publishedAt: string | null;
  soldAt: string | null;
  rentedAt: string | null;
  createdAt: string;
  updatedAt: string;
  amenities: string[];
  utilities: string[];
  images: PropertyImage[];
  documents: PropertyDocument[];
  statusHistory: StatusHistoryEntry[];
  priceHistory: PriceHistoryEntry[];
  assignments: ListingAssignment[];
  owner: { id: string; name: string | null; phone: string | null; email: string | null };
  agent: { id: string; displayName: string; slug: string } | null;
  agency: { id: string; name: string; slug: string } | null;
}

/* --- enquiries / viewings --- */

export interface EnquiryListingRef {
  title: string;
  slug: string;
  reference: string;
  status: PropertyStatus;
}
export interface EnquiryCard {
  id: string;
  listingId: string;
  listing: EnquiryListingRef;
  type: PropertyEnquiryType;
  status: PropertyEnquiryStatus;
  createdAt: string;
  respondedAt: string | null;
  /** Present only on the lister list. */
  enquirer?: string;
}
export interface EnquiryDetail extends EnquiryCard {
  message: string;
  preferredContact: ContactPreference | null;
  contactPhone: string | null;
  closedAt: string | null;
  /** Present only on the lister detail. */
  enquirer?: string;
}
/** Lister enquiry detail carries the enquirer as an object. */
export interface ListerEnquiryDetail extends Omit<EnquiryDetail, 'enquirer'> {
  enquirer: { name: string; email: string };
}

export interface ViewingListingRef {
  title: string;
  slug: string;
  reference: string;
}
export interface ViewingTimelineEntry {
  from: ViewingRequestStatus | null;
  to: ViewingRequestStatus;
  note: string | null;
  at: string;
}
export interface ViewingCard {
  id: string;
  listingId: string;
  listing: ViewingListingRef;
  status: ViewingRequestStatus;
  requestedDate: string;
  requestedTime: string | null;
  confirmedDate: string | null;
  confirmedTime: string | null;
  createdAt: string;
  /** Present only on the lister list. */
  requester?: string;
}
export interface ViewingDetail extends ViewingCard {
  message: string | null;
  timezone: string | null;
  alternateDate: string | null;
  alternateTime: string | null;
  cancellationReason: string | null;
  timeline: ViewingTimelineEntry[];
  requester?: string;
}

/* --- profiles --- */

export interface OwnerProfile {
  id: string;
  userId: string;
  legalName: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  district: District | null;
  contactPreference: ContactPreference | null;
  approvalStatus: string;
}
export interface OwnerProfileInput {
  legalName: string;
  displayName?: string | null;
  phone?: string | null;
  email?: string | null;
  district?: District | null;
  contactPreference?: ContactPreference | null;
}

export interface AgentProfile {
  id: string;
  userId: string;
  slug: string;
  displayName: string;
  legalName: string | null;
  bio: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  serviceDistricts: District[];
  specialties: AgentSpecialty[];
  yearsExperience: number | null;
  ratingAverage: number | null;
  ratingCount: number;
  isActive: boolean;
  approvalStatus: string;
  agencyId: string | null;
  photoUrl: string | null;
  agency: AgencyRef | null;
}
export interface AgentProfileInput {
  displayName: string;
  legalName?: string | null;
  bio?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  serviceDistricts?: District[];
  specialties?: AgentSpecialty[];
  yearsExperience?: number | null;
}

export interface AgencyProfile {
  id: string;
  managerUserId: string;
  slug: string;
  name: string;
  legalName: string | null;
  description: string | null;
  contactEmail: string;
  contactPhone: string | null;
  website: string | null;
  district: District | null;
  addressLine1: string | null;
  city: string | null;
  approvalStatus: string;
  logoUrl: string | null;
  bannerUrl: string | null;
}
export interface AgencyProfileInput {
  name: string;
  legalName?: string | null;
  description?: string | null;
  contactEmail: string;
  contactPhone?: string | null;
  website?: string | null;
  district?: District | null;
  addressLine1?: string | null;
  city?: string | null;
}

/* --- listing / enquiry / viewing inputs --- */

export interface PropertyInput {
  purpose: ListingPurpose;
  propertyType: PropertyType;
  title: string;
  description: string;
  priceMinor: number;
  rentalPeriod?: RentalPeriod | null;
  negotiable?: boolean;
  district?: District | null;
  locality?: string | null;
  generalAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationVisibility?: LocationVisibility;
  bedrooms?: number | null;
  bathrooms?: number | null;
  halfBathrooms?: number | null;
  parkingSpaces?: number | null;
  propertySize?: number | null;
  landSize?: number | null;
  areaUnit?: AreaUnit | null;
  yearBuilt?: number | null;
  furnishing?: Furnishing | null;
  tenure?: Tenure | null;
  petPolicy?: string | null;
  availabilityDate?: string | null;
  leaseTerm?: string | null;
  condition?: string | null;
  videoUrl?: string | null;
  amenities?: string[];
  utilities?: string[];
}

export interface CreateEnquiryInput {
  listingId: string;
  type?: PropertyEnquiryType;
  message: string;
  preferredContact?: ContactPreference | null;
  contactPhone?: string | null;
}
export interface CreateViewingInput {
  listingId: string;
  requestedDate: string;
  requestedTime?: string | null;
  timezone?: string;
  alternateDate?: string | null;
  alternateTime?: string | null;
  message?: string | null;
}
export interface ViewingTransitionInput {
  status: ViewingRequestStatus;
  confirmedDate?: string | null;
  confirmedTime?: string | null;
  note?: string | null;
  cancellationReason?: string | null;
}
export interface AssignAgentInput {
  agentProfileId: string;
  authorizationDocId?: string | null;
}
export interface ImageConfirmInput {
  storageKey: string;
  altText?: string | null;
  caption?: string | null;
  areaLabel?: string | null;
}
export interface DocumentConfirmInput {
  storageKey: string;
  kind: PropertyDocumentKind;
  label?: string | null;
}

export interface OwnerAnalytics {
  totalListings: number;
  activeListings: number;
  totalViews: number;
  saves: number;
  enquiries: number;
  viewingRequests: number;
  byStatus: Array<{ status: PropertyStatus; count: number }>;
}
export interface AgentAnalytics {
  assignedListings: number;
  activeListings: number;
  totalViews: number;
  enquiries: number;
  viewingRequests: number;
  pendingAssignments: number;
  byStatus: Array<{ status: PropertyStatus; count: number }>;
}

export interface AgentAssignment {
  id: string;
  status: ListingAssignmentStatus;
  assignedAt: string;
  acceptedAt: string | null;
  listing: { id: string; title: string; slug: string; reference: string; status: PropertyStatus };
}

export interface Conversation {
  id: string;
}
interface Presign {
  uploadUrl: string;
  key: string;
}

/* ---------------------------------------------------------- extra labels */
/* These label maps are not exported by @bmpl/shared; defined here for UI use. */

export const TENURE_LABELS: Record<Tenure, string> = {
  FREEHOLD: 'Freehold',
  LEASEHOLD: 'Leasehold',
  OTHER: 'Other',
  UNKNOWN: 'Unknown',
};

export const LOCATION_VISIBILITY_LABELS: Record<LocationVisibility, string> = {
  DISTRICT_ONLY: 'District only',
  LOCALITY_ONLY: 'Locality & district',
  APPROXIMATE_MAP: 'Approximate map',
  EXACT_ADDRESS: 'General address',
};

export const PROPERTY_ENQUIRY_TYPE_LABELS: Record<PropertyEnquiryType, string> = {
  GENERAL: 'General enquiry',
  PRICE: 'Price',
  AVAILABILITY: 'Availability',
  FINANCING: 'Financing',
  RENTAL_TERMS: 'Rental terms',
  PROPERTY_DETAILS: 'Property details',
  OTHER: 'Other',
};

export const PROPERTY_ENQUIRY_STATUS_LABELS: Record<PropertyEnquiryStatus, string> = {
  OPEN: 'Open',
  RESPONDED: 'Responded',
  CLOSED: 'Closed',
};

export const PROPERTY_DOCUMENT_KIND_LABELS: Record<PropertyDocumentKind, string> = {
  PROOF_OF_OWNERSHIP: 'Proof of ownership',
  TITLE_DEED: 'Title deed',
  OWNER_AUTHORIZATION: 'Owner authorization',
  AGENT_MANDATE: 'Agent mandate',
  SURVEY_PLAN: 'Survey plan',
  DISCLOSURE: 'Disclosure',
  LEASE: 'Lease',
  OTHER: 'Other',
};

export const LISTING_ASSIGNMENT_STATUS_LABELS: Record<ListingAssignmentStatus, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  ENDED: 'Ended',
  DECLINED: 'Declined',
};

export const PROPERTY_REPORT_REASON_LABELS: Record<PropertyReportReason, string> = {
  SCAM: 'Scam or fraud',
  INCORRECT_INFO: 'Incorrect information',
  DUPLICATE: 'Duplicate listing',
  PROHIBITED: 'Prohibited content',
  MISLEADING_PRICE: 'Misleading price',
  PRIVACY: 'Privacy concern',
  DISCRIMINATION: 'Discrimination',
  ALREADY_SOLD: 'Already sold / rented',
  ILLEGAL: 'Illegal activity',
  OTHER: 'Other',
};

export const PROPERTY_SORT_LABELS: Record<PropertySort, string> = {
  relevance: 'Relevance',
  newest: 'Newest',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  property_size: 'Largest property',
  land_size: 'Largest land',
  most_viewed: 'Most viewed',
};

/* --------------------------------------------------------------- helpers */

export const districtLabel = (d: District | null | undefined): string =>
  d ? DISTRICT_LABELS[d] : '';

export const purposeLabel = (p: ListingPurpose): string => LISTING_PURPOSE_LABELS[p];
export const propertyTypeLabel = (t: PropertyType): string => PROPERTY_TYPE_LABELS[t];
export const propertyStatusLabel = (s: PropertyStatus): string => PROPERTY_STATUS_LABELS[s];
export const furnishingLabel = (f: Furnishing | null | undefined): string =>
  f ? FURNISHING_LABELS[f] : '';
export const tenureLabel = (t: Tenure | null | undefined): string => (t ? TENURE_LABELS[t] : '');
export const areaUnitLabel = (u: AreaUnit | null | undefined): string =>
  u ? AREA_UNIT_LABELS[u] : '';
export const specialtyLabel = (s: AgentSpecialty): string => AGENT_SPECIALTY_LABELS[s];
export const viewingStatusLabel = (s: ViewingRequestStatus): string =>
  VIEWING_REQUEST_STATUS_LABELS[s];
export const enquiryTypeLabel = (t: PropertyEnquiryType): string => PROPERTY_ENQUIRY_TYPE_LABELS[t];
export const enquiryStatusLabel = (s: PropertyEnquiryStatus): string =>
  PROPERTY_ENQUIRY_STATUS_LABELS[s];

const RENTAL_PERIOD_SUFFIX: Record<RentalPeriod, string> = {
  DAY: '/day',
  WEEK: '/wk',
  MONTH: '/mo',
  YEAR: '/yr',
};

/**
 * Price for display. Money is in MINOR units. Sale → "BZ$250,000"; rent →
 * "BZ$1,200/mo" (period suffix from the rentalPeriod). Whole amounts drop cents.
 */
export function formatPrice(
  minor: number | null | undefined,
  opts: { purpose: ListingPurpose; rentalPeriod?: RentalPeriod | null },
): string {
  if (minor == null) return 'Price on request';
  const dollars = minor / 100;
  const amount = dollars.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: dollars % 1 === 0 ? 0 : 2,
  });
  const base = `BZ$${amount}`;
  if (opts.purpose === 'FOR_RENT' && opts.rentalPeriod) {
    return `${base}${RENTAL_PERIOD_SUFFIX[opts.rentalPeriod]}`;
  }
  return base;
}

/**
 * Location string respecting visibility. DISTRICT_ONLY → district; LOCALITY_ONLY →
 * "locality, district"; APPROXIMATE_MAP/EXACT_ADDRESS → generalAddress when present,
 * otherwise "locality, district". The exact address is NEVER returned by the API.
 */
export function locationLabel(location: PropertyLocation | null | undefined): string {
  if (!location) return 'Belize';
  const districtName = location.district ? DISTRICT_LABELS[location.district] : null;
  if (location.visibility === 'DISTRICT_ONLY') {
    return districtName ?? 'Belize';
  }
  if (
    (location.visibility === 'APPROXIMATE_MAP' || location.visibility === 'EXACT_ADDRESS') &&
    location.generalAddress
  ) {
    return location.generalAddress;
  }
  const parts = [location.locality, districtName].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Belize';
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** Human-readable file size, e.g. "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/* --------------------------------------------------------------- uploads */

export type ListerBase = 'property-owner' | 'real-estate-agent';

/** Listing image upload → confirm. Returns the updated managed listing. */
export async function uploadPropertyImage(
  base: ListerBase,
  listingId: string,
  file: File,
  meta: { altText?: string; caption?: string; areaLabel?: string } = {},
): Promise<ManagedProperty> {
  const storageKey = await uploadFile(`/${base}/listings/${listingId}/images/upload`, file);
  return api.post<ManagedProperty>(`/${base}/listings/${listingId}/images`, {
    storageKey,
    altText: meta.altText || undefined,
    caption: meta.caption || undefined,
    areaLabel: meta.areaLabel || undefined,
  });
}

/** Listing document upload → confirm. Returns the updated managed listing. */
export async function uploadPropertyDocument(
  base: ListerBase,
  listingId: string,
  file: File,
  kind: PropertyDocumentKind,
  label?: string,
): Promise<ManagedProperty> {
  const storageKey = await uploadFile(`/${base}/listings/${listingId}/documents/upload`, file);
  return api.post<ManagedProperty>(`/${base}/listings/${listingId}/documents`, {
    storageKey,
    kind,
    label: label?.trim() || undefined,
  });
}

/** Agent profile photo upload → confirm. Returns the updated agent profile. */
export async function uploadAgentPhoto(file: File): Promise<AgentProfile> {
  const storageKey = await uploadFile('/real-estate-agent/profile/photo/upload', file);
  return api.post<AgentProfile>('/real-estate-agent/profile/photo', { storageKey });
}

/** Agency logo/banner upload → confirm. Returns the updated agency profile. */
export async function uploadAgencyAsset(
  kind: 'logo' | 'banner',
  file: File,
): Promise<AgencyProfile> {
  const storageKey = await uploadFile(`/real-estate-agent/agency/${kind}/upload`, file);
  return api.post<AgencyProfile>(`/real-estate-agent/agency/${kind}/confirm`, { storageKey });
}

/* ------------------------------------------------------------------- api */

function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Management endpoints shared by the owner and agent surfaces. Both expose the same
 * sub-paths under their own base (`/property-owner` vs `/real-estate-agent`).
 */
function listerListingApi(base: ListerBase) {
  return {
    base,
    listings: (status?: string) =>
      api.get<PropertyCard[]>(`/${base}/listings${toQuery({ status })}`),
    listing: (id: string) => api.get<ManagedProperty>(`/${base}/listings/${id}`),
    updateListing: (id: string, body: Partial<PropertyInput>) =>
      api.patch<ManagedProperty>(`/${base}/listings/${id}`, body),
    submitListing: (id: string) => api.post<ManagedProperty>(`/${base}/listings/${id}/submit`),
    setStatus: (id: string, action: OwnerStatusAction) =>
      api.post<ManagedProperty>(`/${base}/listings/${id}/status`, { action }),

    // images
    uploadImage: (
      id: string,
      file: File,
      meta?: { altText?: string; caption?: string; areaLabel?: string },
    ) => uploadPropertyImage(base, id, file, meta),
    setPrimaryImage: (id: string, imageId: string) =>
      api.post<ManagedProperty>(`/${base}/listings/${id}/images/${imageId}/primary`),
    reorderImages: (id: string, imageIds: string[]) =>
      api.post<ManagedProperty>(`/${base}/listings/${id}/images/reorder`, { imageIds }),
    deleteImage: (id: string, imageId: string) =>
      api.del<ManagedProperty>(`/${base}/listings/${id}/images/${imageId}`),

    // documents
    uploadDocument: (id: string, file: File, kind: PropertyDocumentKind, label?: string) =>
      uploadPropertyDocument(base, id, file, kind, label),
    documents: (id: string) => api.get<PropertyDocument[]>(`/${base}/listings/${id}/documents`),
    documentUrl: (id: string, documentId: string) =>
      api.get<{ url: string }>(`/${base}/listings/${id}/documents/${documentId}/url`),

    // enquiries
    enquiries: (params: { listingId?: string; status?: string } = {}) =>
      api.get<EnquiryCard[]>(`/${base}/enquiries${toQuery(params)}`),
    enquiry: (id: string) => api.get<ListerEnquiryDetail>(`/${base}/enquiries/${id}`),
    replyEnquiry: (id: string, message: string) =>
      api.post<ListerEnquiryDetail>(`/${base}/enquiries/${id}/reply`, { message }),
    closeEnquiry: (id: string) => api.post<ListerEnquiryDetail>(`/${base}/enquiries/${id}/close`),

    // viewings
    viewings: (params: { listingId?: string; status?: string } = {}) =>
      api.get<ViewingCard[]>(`/${base}/viewings${toQuery(params)}`),
    viewing: (id: string) => api.get<ViewingDetail>(`/${base}/viewings/${id}`),
    transitionViewing: (id: string, body: ViewingTransitionInput) =>
      api.post<ViewingDetail>(`/${base}/viewings/${id}/transition`, body),
  };
}

export const realEstateApi = {
  /* ---- public ---- */
  list: (query: string) => api.get<PropertyList>(`/properties${query}`),
  detail: (slug: string) => api.get<PropertyDetail>(`/properties/${encodeURIComponent(slug)}`),
  agent: (slug: string) => api.get<AgentPage>(`/properties/agents/${encodeURIComponent(slug)}`),
  agency: (slug: string) => api.get<AgencyPage>(`/properties/agencies/${encodeURIComponent(slug)}`),

  /* ---- property seeker (CUSTOMER) ---- */
  seeker: {
    saved: () => api.get<{ items: SavedProperty[] }>('/property-seeker/saved'),
    savedIds: () => api.get<{ listingIds: string[] }>('/property-seeker/saved/ids'),
    save: (listingId: string) => api.post(`/property-seeker/saved/${listingId}`),
    unsave: (listingId: string) => api.del(`/property-seeker/saved/${listingId}`),

    recordView: (listingId: string) => api.post(`/property-seeker/recently-viewed/${listingId}`),
    recentlyViewed: () =>
      api.get<{ items: RecentlyViewedProperty[] }>('/property-seeker/recently-viewed'),

    createEnquiry: (body: CreateEnquiryInput) =>
      api.post<EnquiryDetail>('/property-seeker/enquiries', body),
    enquiries: () => api.get<EnquiryCard[]>('/property-seeker/enquiries'),
    enquiry: (id: string) => api.get<EnquiryDetail>(`/property-seeker/enquiries/${id}`),
    openEnquiryConversation: (id: string) =>
      api.post<Conversation>(`/property-seeker/enquiries/${id}/conversation`),

    createViewing: (body: CreateViewingInput) =>
      api.post<ViewingDetail>('/property-seeker/viewing-requests', body),
    viewings: () => api.get<ViewingCard[]>('/property-seeker/viewing-requests'),
    viewing: (id: string) => api.get<ViewingDetail>(`/property-seeker/viewing-requests/${id}`),
    cancelViewing: (id: string, cancellationReason?: string) =>
      api.post<ViewingDetail>(`/property-seeker/viewing-requests/${id}/cancel`, {
        cancellationReason: cancellationReason || undefined,
      }),

    report: (listingId: string, body: { reason: PropertyReportReason; note?: string }) =>
      api.post(`/property-seeker/report/${listingId}`, body),
  },

  /* ---- property owner (PROPERTY_OWNER) ---- */
  owner: {
    ...listerListingApi('property-owner'),
    getProfile: () => api.get<OwnerProfile | null>('/property-owner/profile'),
    updateProfile: (body: OwnerProfileInput) =>
      api.put<OwnerProfile>('/property-owner/profile', body),
    createListing: (body: PropertyInput) =>
      api.post<ManagedProperty>('/property-owner/listings', body),
    assignAgent: (id: string, body: AssignAgentInput) =>
      api.post<ManagedProperty>(`/property-owner/listings/${id}/assign-agent`, body),
    analytics: () => api.get<OwnerAnalytics>('/property-owner/analytics'),
  },

  /* ---- real estate agent (REAL_ESTATE_AGENT) ---- */
  agentDashboard: {
    ...listerListingApi('real-estate-agent'),
    getProfile: () => api.get<AgentProfile | null>('/real-estate-agent/profile'),
    updateProfile: (body: AgentProfileInput) =>
      api.put<AgentProfile>('/real-estate-agent/profile', body),
    uploadPhoto: uploadAgentPhoto,
    getAgency: () => api.get<AgencyProfile | null>('/real-estate-agent/agency'),
    updateAgency: (body: AgencyProfileInput) =>
      api.put<AgencyProfile>('/real-estate-agent/agency', body),
    uploadAgencyAsset,
    assignments: (status?: string) =>
      api.get<AgentAssignment[]>(`/real-estate-agent/assignments${toQuery({ status })}`),
    acceptAssignment: (id: string) =>
      api.post<ManagedProperty>(`/real-estate-agent/assignments/${id}/accept`),
    declineAssignment: (id: string) =>
      api.post<{ ok: boolean }>(`/real-estate-agent/assignments/${id}/decline`),
    analytics: () => api.get<AgentAnalytics>('/real-estate-agent/analytics'),
  },
};
