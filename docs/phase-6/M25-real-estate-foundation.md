# Phase 6 · M25 — Real Estate Foundation

A fully integrated property marketplace for Belize inside BMPL — property owners,
verified agents, agencies, listings for sale/rent (residential, commercial, land),
public browsing, saved properties, enquiries, viewing requests, agent↔customer
messaging, moderation, and analytics. Reuses the existing account, roles, approval,
permissions, notifications (M16), messaging (M17), R2 storage, search (M21 approach),
saved/recently-viewed (M20), analytics (M22), moderation/ops (M23), and audit. No
second login/admin/notification/messaging/storage/search/saved system was created.

**Out of scope (deferred, not started):** marketing/ads, paid featured listings,
property payments, rent collection, mortgage applications, sale escrow, legal
conveyancing, property-management accounting, passenger transport, mobile apps, AI
valuation/recommendations, paid map/geocoding, multi-country, and multi-user agency
teams.

## 1. Architecture decisions
- **One account, many roles.** `PROPERTY_OWNER` and `REAL_ESTATE_AGENT` already exist
  in the role catalog (`service: 'realestate'`, both `requiresApproval: true` with
  required documents). `CUSTOMER` stays available. Approval reuses the existing
  role-application/admin-review workflow entirely (no parallel approval engine); a
  role's `approvalStatus` on the profile mirrors the role status.
- **No `REAL_ESTATE_AGENCY_MANAGER` role exists**, so an approved agent manages **one**
  agency (`AgencyProfile.managerUserId` unique). Multi-user agency teams are deferred
  (documented; see Questions log).
- **Normalized throughout** (no JSON blobs) — child tables for amenities, utilities,
  images, private documents, price history, status history, listing assignments,
  enquiries, viewing requests (+ append-only events), reports.
- **Conservative reversible defaults** everywhere; blocked policy items isolated behind
  conservative defaults / flags (see Questions log), never exposed as complete.

## 2. Role model
`PROPERTY_OWNER` (approval + ID + proof-of-ownership docs) and `REAL_ESTATE_AGENT`
(approval + ID + licence/agency docs) via the role application flow. Statuses reuse the
established set (DRAFT/SUBMITTED/UNDER_REVIEW/MORE_INFO_REQUIRED/APPROVED/REJECTED/
SUSPENDED/RESTORED/REVOKED). Unapproved/suspended roles cannot publish (enforced by
`@Roles(APPROVED)` + profile checks). Customer access is retained.

## 3–5. Profiles
- **PropertyOwnerProfile** — legal name, display name, contacts, district, contact
  preference, identityVerified, approvalStatus.
- **RealEstateAgentProfile** — display/legal name, slug, photo (public), bio, contacts,
  website, agency link, service districts, specialties, years experience, isActive,
  rating placeholders (reuse M19 aggregates later), approvalStatus.
- **AgencyProfile** — name, legal name, slug, logo/banner (public), description,
  contacts, district/address, approvalStatus. One manager agent (teams deferred).

## 6. Approval workflows
Reuse `/roles/applications` (upload private docs → submit → admin review at
`/dashboard/applications`). Prevents self-approval, missing-doc submission, duplicate
active applications, cross-applicant document access, role switching before approval,
and publishing while suspended/revoked — all inherited from the existing workflow.

## 7. Listing model & lifecycle
`PropertyListing` (+ amenities/utilities/images/documents/priceHistory/statusHistory/
assignments). Strict lifecycle: `DRAFT → SUBMITTED → (admin) PUBLISHED | REJECTED |
MORE_INFO_REQUIRED`; owner/agent `WITHDRAWN`/`UNDER_OFFER`/`SOLD`/`RENTED`/`ARCHIVED`;
admin `UNPUBLISH`/`SUSPEND`/`RESTORE`/`ARCHIVE`. **Owners/agents cannot self-publish** —
admin approval publishes. Only PUBLISHED/UNDER_OFFER listings of approved, non-suspended
owners/agents are public. Editing limited to DRAFT/REJECTED/MORE_INFO_REQUIRED. Every
moderation/status transition writes `PropertyStatusHistory` + audit + notifications.

## 8. Ownership & authority
Every listing has a verified authority relationship: owner-managed by default, or
agent-managed via a `PropertyListingAssignment` the owner creates and the agent
accepts (evidence stored privately as a PropertyDocument). An agent can only manage a
listing with an ACCEPTED assignment (or `agentProfileId` pointing to them); cross-owner/
agent access returns 404. `authorityVerified` is an admin-set flag (see Questions log —
verification standard is a policy question; conservative default = false until an admin
confirms).

## 9. Location privacy
Exact address is stored in `exactAddress` (private) separately from public display
fields. `locationVisibility` policy: **DISTRICT_ONLY (default)** → district only;
LOCALITY_ONLY → +locality; APPROXIMATE_MAP → +locality +coordinates rounded to 2 dp;
EXACT_ADDRESS → +general address +exact coords. Public APIs return only the approved
precision; `exactAddress` and private documents are never public. No paid map provider —
coordinates are owner/agent-supplied; the UI uses a provider-free placeholder.

## 10. Image & media management
Property photos in the **public** R2 bucket (presign → PUT → confirm), primary image,
reorder, replace, alt text, captions, area labels (Exterior/Kitchen/Bedroom/Floor plan/
…), MAX 30 images, image MIME + size validated, ownership-checked. Optional single
external `videoUrl`. No executable uploads.

## 11. Private documents
Ownership/authority docs (proof of ownership, title/deed, owner authorization, agent
mandate, survey, disclosure, lease) in the **private** R2 bucket, PDF/image + size +
namespace + HEAD validated, scan-status placeholder, short-lived signed URLs to the
listing owner, the assigned+accepted agent, and admins holding **`property_documents.read`
(SUPER_ADMIN only by default)**. Never public.

## 12–13. Public experience & search
Public browse/search/filter/sort/detail + agent/agency pages; guests must log in to
save/enquire/request-viewing/message/report. Search (Postgres ILIKE + trigram, M21
approach — no AI) over title/locality/district/type/description/amenities/agent/agency
with the documented filters + sorts; excludes non-public statuses and suspended owners/
agents. Cards/detail respect the location-privacy policy and never expose private
address/docs/owner legal name/internal moderation status.

## 14. Saved & recently viewed
Reuse the M20 pattern (`SavedProperty`/`RecentlyViewedProperty`), private per user, with
sold/rented/unavailable indicators. No public shared collections.

## 15. Enquiries & viewing requests
`PropertyEnquiry` (type/message/preferred contact/status) and `PropertyViewingRequest`
(requested + alternate date/time, timezone, status machine REQUESTED→PROPOSED→CONFIRMED→
COMPLETED with RESCHEDULED/CANCELLED/DECLINED/NO_SHOW, append-only `PropertyViewingEvent`).
Visible only to the enquirer/requester and the listing's owner/assigned agent (+admin
where permitted). Transitions validated server-side; each writes event + audit +
notification + a system message on the messaging thread. No external calendar.

## 16. Messaging integration (M17)
New `PROPERTY_ENQUIRY` conversation context + `LISTER_ENQUIRER` pairing +
`LISTER`/`ENQUIRER` participant roles. Context-scoped customer↔lister (owner or assigned
agent) threads tied to an enquiry; system messages on enquiry/viewing/status events.
No arbitrary chat. (Agent↔owner direct chat deferred; they coordinate via the assignment
+ support — see Questions log.)

## 17. Notifications (M16)
New `PROPERTY` category. Customers, owners/agents, and admins are notified across
enquiry/viewing/moderation/report events per the spec, respecting preferences.

## 18. Reporting & safety
`PropertyReport` (10 reasons) reusing the M23 pattern — one per (listing, reporter);
a single report never auto-removes a listing (admin triage). Audit + history preserved.

## 19. Analytics (M22 approach, read-only, no fabricated market data)
Admin: active listings, by district/type, sale-vs-rent, submissions, approval backlog,
viewing requests, enquiries, reported, sold/rented. Owner/agent: own listing views,
saves, enquiries, viewings, status counts. No claimed sale prices unless recorded.

## 20. Permissions
`properties.read/moderate`, `property_owners.read/moderate`, `real_estate_agents.read/
moderate`, `agencies.read/moderate`, `property_reports.read`, and the **highly
restricted `property_documents.read`** (SUPER_ADMIN only — deliberately excluded from
the ADMIN bundle so support/ordinary admins cannot read private ownership documents).
Synced on boot via the existing permission-sync.

## 21. Ops integration (M23)
The operations console overview gains `pendingPropertyModeration` + `openProperty
Reports` queues.

## 22. API endpoint contract (authoritative surface)
All routes are prefixed `/api`. Guards run in order rate-limit → CSRF → auth → role →
permission. Uploads always follow presign → direct PUT to storage → confirm.

### Public — `@Public()` `properties`
| Method | Path | Purpose |
|---|---|---|
| GET | `/properties` | search/filter (purpose, type, district, price, beds, baths, furnishing, sort, page) |
| GET | `/properties/:slug` | public listing detail — location per `locationVisibility`, **never** exactAddress or documents |
| GET | `/properties/agents/:slug` | public agent profile + their published listings |
| GET | `/properties/agencies/:slug` | public agency profile + listings |

### Property owner — `@Roles('PROPERTY_OWNER')` `property-owner`
| Method | Path |
|---|---|
| GET / PUT | `/profile` |
| GET / POST | `/listings` (list / create) |
| GET / PATCH | `/listings/:id` |
| POST | `/listings/:id/submit` · `/status` · `/assign-agent` |
| POST | `/listings/:id/images/presign` · `/images` · `/images/:imageId/primary` · `/images/reorder` |
| DELETE | `/listings/:id/images/:imageId` |
| POST | `/listings/:id/documents/presign` · `/documents` |
| GET | `/listings/:id/documents` · `/listings/:id/documents/:documentId/url` |
| GET | `/enquiries` · `/enquiries/:id` |
| POST | `/enquiries/:id/reply` · `/enquiries/:id/close` |
| GET | `/viewings` · `/viewings/:id` |
| POST | `/viewings/:id/transition` |
| GET | `/analytics` |

### Real-estate agent — `@Roles('REAL_ESTATE_AGENT')` `real-estate-agent`
| Method | Path |
|---|---|
| GET / PUT | `/profile` ; POST `/profile/photo/presign` · `/profile/photo` |
| GET / PUT | `/agency` ; POST `/agency/:kind/presign` · `/agency/:kind/confirm` (kind ∈ logo\|banner) |
| GET | `/assignments` ; POST `/assignments/:id/accept` · `/assignments/:id/decline` |
| GET / PATCH | `/listings` · `/listings/:id` (+ same submit/status/images/documents sub-paths as owner) |
| GET | `/enquiries` · `/enquiries/:id` ; POST `/enquiries/:id/reply` · `/enquiries/:id/close` |
| GET | `/viewings` · `/viewings/:id` ; POST `/viewings/:id/transition` |
| GET | `/analytics` |

### Seeker — `@Roles('CUSTOMER')` `property-seeker`
| Method | Path |
|---|---|
| GET | `/saved` · `/saved/ids` ; POST `/saved/:listingId` ; DELETE `/saved/:listingId` |
| GET | `/recently-viewed` ; POST `/recently-viewed/:listingId` |
| POST | `/enquiries` ; GET `/enquiries` · `/enquiries/:id` ; POST `/enquiries/:id/conversation` |
| POST | `/viewing-requests` ; GET `/viewing-requests` · `/viewing-requests/:id` ; POST `/viewing-requests/:id/cancel` |
| POST | `/report/:listingId` |

### Admin — `admin/properties` (`@RequirePermission`)
| Method | Path | Permission |
|---|---|---|
| GET | `/admin/properties` · `/:id` | `properties.read` |
| POST | `/admin/properties/:id/moderate` | `properties.moderate` |
| GET | `/admin/properties/:id/documents` | `property_documents.read` (super-admin only) |
| GET | `/admin/properties/reports` | `property_reports.read` |
| POST | `/admin/properties/reports/:id/resolve` | `properties.moderate` |
| GET | `/admin/properties/analytics` | `properties.read` |
| GET | `/admin/properties/owners` · `/owners/:id` | `property_owners.read` |
| POST | `/admin/properties/owners/:id/suspend` · `/restore` | `property_owners.moderate` |
| GET | `/admin/properties/agents` · `/agents/:id` | `real_estate_agents.read` |
| POST | `/admin/properties/agents/:id/suspend` · `/restore` | `real_estate_agents.moderate` |

## Deferred scope / recommended M26
Multi-user agency teams; automated ownership/authority verification; paid map/geocoding;
featured listings & any property payment/rent/escrow (explicitly out of scope);
agent↔owner direct messaging; property valuation/AI. See the Questions log below.

---

## Questions Requiring Owner Verification
These policy decisions were left to the owner; each is isolated behind a conservative,
reversible default so the rest of the module ships safely.

1. **Ownership / authority verification standard (legal property policy).**
   *Decision needed:* what evidence + process legally suffices to mark a listing's
   ownership/authority as "verified" in Belize (and who may attest it).
   *Why it matters:* publishing a property implies the lister has the right to.
   *Current conservative behavior:* required documents are collected privately via the
   role application + per-listing `PropertyDocument`; `authorityVerified` defaults
   **false** and is only ever set true by an admin action; listings still require admin
   moderation before publishing. No automated verification.
   *Completed despite it:* full document capture, assignment model, moderation gating.
   *Deferred/disabled:* an "authority-verified" public badge is not shown until policy
   is set. *Recommended:* admin manually confirms documents during moderation and
   toggles `authorityVerified`; revisit automated checks later.

2. **Default public location precision (exact-address exposure / privacy).**
   *Decision needed:* the platform-wide default and whether EXACT_ADDRESS may ever be
   public for residences.
   *Why it matters:* exposing a private residence's exact address is a privacy risk.
   *Current conservative behavior:* default `locationVisibility = DISTRICT_ONLY`; exact
   address stored privately and never returned publicly unless the lister explicitly
   selects EXACT_ADDRESS; APPROXIMATE_MAP rounds coordinates to ~2 dp.
   *Recommended:* keep DISTRICT_ONLY default; allow EXACT_ADDRESS only with an explicit
   lister opt-in per listing (already the behavior).

3. **Multi-user agency ownership/teams.**
   *Decision needed:* whether agencies should support multiple agent members with roles.
   *Current conservative behavior:* one approved agent manages one agency
   (`managerUserId` unique); other agents may link via `agencyId` but no team
   permissions. *Deferred:* team management. *Recommended:* defer to a later milestone
   with a proper organization model.

4. **`property_documents.read` grant policy (sensitive documents).**
   *Decision needed:* which admin roles may view private ownership documents.
   *Current conservative behavior:* granted to **SUPER_ADMIN only**; excluded from the
   ADMIN and SUPPORT bundles. *Recommended:* keep restricted; grant case-by-case.

5. **Agent↔owner direct messaging.**
   *Current conservative behavior:* customer↔lister messaging ships; agent↔owner direct
   chat is deferred (they coordinate via the assignment flow / support).
   *Recommended:* add an OWNER_AGENT pairing in a follow-up if needed.

No question blocked schema/migration/auth/authorization/deployment/privacy/financial
integrity, so the milestone proceeded end-to-end.
