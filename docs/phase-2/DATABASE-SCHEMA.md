# Marketplace — Database Schema Overview

Prisma schema: `packages/database/prisma/schema.prisma`. All money is `BigInt`
minor units (BZD). Phase 2 added the models below; Phase 1 models (`User`,
`UserRole`, `Role`, `AdminPermissionGrant`, `AuditLog`, `Notification`, wallet…)
are reused unchanged.

## Entity map
```
User 1─1 VendorProfile 1─1 VendorSettings
                       1─* VendorLocation
                       1─* VendorOpeningHours
                       1─* VendorModerationReview
                       1─* Product
Category ─┐ (self parent/children, Restrict)
          └─* Product
User 1─1 Cart 1─* CartItem *─1 Product / *─1 ProductVariant (Phase 3 · M9)
User 1─* Order 1─* VendorOrder 1─* OrderItem  (Phase 3 · M10)
              Order 1─* OrderAddress
              VendorOrder *─1 VendorProfile (Restrict)
Order 1─1 Payment 1─* WalletHold *─1 WalletAccount   (Phase 3 · M11, foundation)
             Payment 1─* LedgerReference *─1 WalletAccount (planned, unposted)
             Payment 1─* PaymentEvent / PaymentAttempt
             Payment *─1 PaymentMethod / IdempotencyKey
Product 1─* ProductImage
        1─* ProductModerationReview
        *─* Tag
        1─* ProductOption 1─* ProductOptionValue
        1─* ProductVariant *─* ProductOptionValue (via VariantOptionValue)
        1─* Inventory 1─* InventoryChange
VendorOrder 1─1 OrderDelivery (M13)                            (Phase 4)
OrderDelivery 1─* DeliveryAssignment (append-only history)     (M15)
              1─* DeliveryTimelineEvent (append-only)          (M15)
              *─1 DriverProfile (assignedDriver) / DriverVehicle (assignedVehicle)
User 1─1 DriverProfile 1─* DriverVehicle / DriverServiceArea   (M14)
Notification (event) 1─* NotificationRecipient *─1 User        (M16)
User 1─* NotificationPreference (per category)                 (M16)
Conversation 1─* ConversationParticipant *─1 User             (M17)
             1─* Message 1─* MessageAttachment                (M17)
                         1─* MessageReadReceipt *─1 User       (M17)
  context = (contextType ∈ {ORDER,VENDOR_ORDER,DELIVERY,SUPPORT_CASE}, contextId, pairing)
User 1─* Review (verified) 1─* ReviewMedia                     (M19)
                          1─1 ReviewResponse                   (M19)
                          1─* ReviewReport / ReviewHelpfulVote (M19)
  subject = (subjectType ∈ {PRODUCT,VENDOR,DRIVER}, subjectId)  context = fulfilled OrderItem/VendorOrder/OrderDelivery
User 1─* SavedProduct *─1 Product                             (M20)
User 1─* RecentlyViewedProduct *─1 Product                   (M20)  private, own-account only
```

## Models
| Model (table) | Key columns | Notes |
|---|---|---|
| `Category` (categories) | slug*, name, parentId→self, iconName, imageKey, featured, isVisible, sortOrder | hierarchical; `onDelete: Restrict` |
| `VendorProfile` (vendor_profiles) | userId*(1‑1), slug*, businessName, logoKey, bannerKey, approvalStatus, storeStatus, socialLinks(Json), rating* | approval separate from the VENDOR role |
| `VendorSettings` (vendor_settings) | vendorProfileId*(1‑1), pickup/delivery/vacation/taxes/autoAccept, minimumOrderMinor, deliveryRadiusKm | operational toggles, separate for scale |
| `VendorLocation` (vendor_locations) | vendorProfileId, address, city, district, lat/lng, isPrimary | |
| `VendorOpeningHours` (vendor_opening_hours) | vendorProfileId, dayOfWeek*, open/closeTime, isClosed | unique per (profile, day) |
| `VendorModerationReview` (vendor_moderation_reviews) | vendorProfileId, reviewerId, action, from/toStatus | immutable trail |
| `Product` (products) | vendorProfileId, categoryId, slug*, sku, price/salePriceMinor, status, featured, dims, SEO, searchKeywords[], searchVector(tsvector) | `@@unique(vendorProfileId, sku)` |
| `Tag` (tags) | slug*, name | implicit m2m with Product |
| `ProductImage` (product_images, +**isBrandImage** M6.2: brand/listing role, ≤1 per product, excluded from detail gallery) | productId, storageKey*, mimeType, fileSizeBytes, width/height, altText, caption, position, isPrimary | one primary/product (transactional) |
| `ProductModerationReview` (product_moderation_reviews) | productId, reviewerId, action, from/toStatus | immutable trail |
| `ProductOption` (product_options) | productId, name, position | unique (product, name) |
| `ProductOptionValue` (product_option_values) | productOptionId, value, position | unique (option, value) |
| `ProductVariant` (product_variants) | productId, **displayName** (M6.1), sku, price overrides, isActive | unique (product, sku); displayName = variant-specific marketplace title (precedence displayName → option label → product title) |
| `VariantOptionValue` (variant_option_values) | variantId, productOptionValueId | the variant↔value combination |
| `Inventory` (inventory) | productId, variantId?, quantity, reserved, lowStockThreshold, unlimited, allowBackorders | one product-level row (variantId NULL) via partial unique index; per-variant via `variantId` unique |
| `InventoryChange` (inventory_changes) | inventoryId, delta, reason, previous/newQty, actorId, note | append-only history |
| `Notification` (notifications) | type, category, event, title, body, data(Json) | **M16** the notification EVENT (fan-out capable); no per-user state |
| `NotificationRecipient` (notification_recipients) | notificationId, userId, channel, readAt, deletedAt | **M16** per-user read/dismiss state; unique (notification, user) |
| `NotificationPreference` (notification_preferences) | userId, category*, inApp, email, push | **M16** per-user per-category channel prefs; unique (user, category) |
| `Conversation` (conversations) | contextType, contextId, pairing, subject, status, createdById, closedAt | **M17** context-scoped; unique (contextType, contextId, pairing) — no arbitrary chat |
| `ConversationParticipant` (conversation_participants) | conversationId, userId, role, canSend, lastReadAt, leftAt | **M17** per-user membership + read state; unique (conversation, user) |
| `Message` (messages) | conversationId, senderId?, type (USER/SYSTEM/INTERNAL_NOTE), body, editedAt, deletedAt | **M17** plain text; soft-delete only; immutable SYSTEM/INTERNAL_NOTE |
| `MessageAttachment` (message_attachments) | messageId, storageKey*, mimeType, fileSizeBytes, scanStatus | **M17** private R2; images+PDF; scan placeholder |
| `MessageReadReceipt` (message_read_receipts) | messageId, userId, readAt | **M17** read receipt; unique (message, user) |
| `Review` (reviews) | reviewerId, subjectType, subjectId, contextType, contextId, rating, title?, body, status, verifiedPurchase, helpfulCount, productId?/variantId?/variantName?/sku?/optionsSnapshot?, moderatedById?/moderationReason?/moderatedAt?, editedAt? | **M19** verified review; unique (reviewerId, subjectType, contextId); subjectId is a plain indexed string (no polymorphic FK) |
| `ReviewMedia` (review_media) | reviewId, storageKey*, mimeType, fileSizeBytes, status (APPROVED/REJECTED) | **M19** ≤5 photos per review; private R2 under `reviews/<userId>` |
| `ReviewResponse` (review_responses) | reviewId*, responderId, body, editedAt? | **M19** one seller response per review (editable) |
| `ReviewReport` (review_reports) | reviewId, reporterId, reason, note?, status (OPEN/ACTIONED/DISMISSED), resolvedById?/resolutionNote?/resolvedAt? | **M19** abuse report; unique (review, reporter) |
| `ReviewHelpfulVote` (review_helpful_votes) | reviewId, userId | **M19** one helpful vote per user; unique (review, user) |
| `SavedProduct` (saved_products) | userId, productId, createdAt | **M20** wishlist entry; unique (user, product); cascade from user+product; no money/inventory |
| `RecentlyViewedProduct` (recently_viewed_products) | userId, productId, viewedAt | **M20** private view history; unique (user, product); upserted on view; capped to newest 50 |
| `PlatformSetting` (platform_settings) | announcementActive, announcementLevel, announcementMessage, maintenanceMode, maintenanceMessage, updatedById | **M23** singleton ops banner (created lazily); maintenanceMode is display-only, never an API gate |
| `JobSeekerProfile` (+ `JobSeekerSkill`/`Education`/`Experience`/`Certification`/`Language`/`Resume`) | userId*, preferredName, visibility, salary/preferences, normalized children; Resume storageKey* (private R2) | **M24** normalized job-seeker profile + private résumés; visibility PRIVATE/EMPLOYERS_ONLY/PUBLIC_SUMMARY |
| `EmployerProfile` (employer_profiles) | userId*, companyName, slug*, contacts, logoKey/bannerKey, approvalStatus | **M24** company profile (mirrors VendorProfile); approval via EMPLOYER role |
| `JobCategory` (job_categories) | name, slug*, isVisible, sortOrder | **M24** admin-managed job-category lookup |
| `JobListing` (+ `JobSkill`/`JobBenefit`/`JobApplicationQuestion`) | employerProfileId, title, slug*, employmentType, workArrangement, salary*, status, moderation, publishedAt/closedAt/archivedAt | **M24** normalized job listing + moderated lifecycle |
| `JobApplication` (+ `JobApplicationAnswer`/`JobApplicationEvent`/`JobInterview`) | jobId, applicantId, resumeId?, status, employerNotes (private), jobTitle/companySnapshot; answers snapshot prompt/type; events append-only | **M24** verified applications; validated pipeline; snapshots protect history |
| `SavedJob` / `RecentlyViewedJob` | unique (user, job) | **M24** M20-pattern saved + recently-viewed jobs |
| `JobReport` (job_reports) | jobId, reporterId, reason, status; unique (job, reporter) | **M24** job safety reports (M23 moderation pattern) |
| `PropertyOwnerProfile` / `RealEstateAgentProfile` / `AgencyProfile` | userId*/managerUserId*, approvalStatus, contacts, agent slug*/agency slug* | **M25** real-estate role profiles (approval via role application) |
| `PropertyListing` (+ `PropertyAmenity`/`PropertyUtility`/`PropertyImage`/`PropertyDocument`/`PropertyStatusHistory`/`PropertyPriceHistory`) | ownerProfileId, agentProfileId?, agencyId?, purpose, propertyType, slug*, reference*, priceMinor, locationVisibility, exactAddress (PRIVATE), status, moderation | **M25** normalized listing; exact address private; docs private; status/price history append-only |
| `PropertyListingAssignment` | listingId, ownerProfileId, agentProfileId?, status, authorizationDocId? | **M25** owner→agent listing authority (accepted before agent may manage) |
| `SavedProperty` / `RecentlyViewedProperty` | unique (user, listing) | **M25** M20-pattern saved + recently-viewed |
| `PropertyEnquiry` | listingId, enquirerId, type, message, status | **M25** enquiries (owner/assigned-agent + enquirer only) |
| `PropertyViewingRequest` (+ `PropertyViewingEvent`) | listingId, requesterId, dates/times, status; events append-only | **M25** viewing requests with validated status machine |
| `PropertyReport` (property_reports) | listingId, reporterId, reason, status; unique (listing, reporter) | **M25** listing safety reports |

\* = unique.

**M16 note:** the single per-user `notifications` table was normalized into a
`Notification` **event** + `NotificationRecipient` (per-user read/dismiss) so one
event can fan out to many recipients (e.g. an admin alert to every admin holding a
permission). Existing rows were migrated to one recipient each (no data loss).

## Enums (mirrored in `@bmpl/shared`)
`VendorApprovalStatus` (DRAFT/PENDING/APPROVED/REJECTED/SUSPENDED) · `StoreStatus`
(OPEN/CLOSED) · `ModerationAction` (SUBMITTED/APPROVED/REJECTED/SUSPENDED/RESTORED) ·
`ProductStatus` (DRAFT/PENDING_REVIEW/PUBLISHED/REJECTED/SUSPENDED/ARCHIVED) ·
`InventoryChangeReason` (INITIAL/MANUAL/RESTOCK/CORRECTION/RESERVE/RELEASE/BACKORDER).
`AuditAction` gained `CATEGORY_*`, `VENDOR_*`, `PRODUCT_*`, `INVENTORY_ADJUSTED`;
`NotificationType` gained `MARKETPLACE`.
**M19** added `ReviewSubjectType` (PRODUCT/VENDOR/DRIVER) · `ReviewContextType`
(ORDER_ITEM/VENDOR_ORDER/ORDER_DELIVERY) · `ReviewStatus` (PUBLISHED/HIDDEN/REJECTED) ·
`ReviewReportReason` (SPAM/HARASSMENT/IRRELEVANT/PROHIBITED/PRIVACY/FRAUDULENT) ·
`ReviewReportStatus` (OPEN/ACTIONED/DISMISSED) · `ReviewMediaStatus` (APPROVED/REJECTED);
`AuditAction` gained seven `REVIEW_*` actions. Cached aggregates reuse the existing
`ratingAverage`/`ratingCount` on `Product`, `VendorProfile`, and `DriverProfile`.
**M22** added the `analytics.read` permission only (no schema change — read-only BI).
**M23** added `AnnouncementLevel` (INFO/WARNING/CRITICAL) + the `PlatformSetting`
singleton + `AuditAction.PLATFORM_SETTING_UPDATED` + `ops.read`/`ops.manage` permissions.
**M24 (Belize Connect)** added 16 enums (`EmploymentType`, `WorkArrangement`,
`ExperienceLevel`, `EducationLevel`, `SalaryPeriod`, `SalaryVisibility`, `JobStatus`,
`JobApplicationMethod`, `JobApplicationStatus`, `JobQuestionType`, `JobSeekerVisibility`,
`SeekerEmploymentStatus`, `InterviewMode`, `InterviewStatus`, `JobReportReason`,
`JobReportStatus`), extended `AuditAction` (17 `JOB_*`/`EMPLOYER_*`),
`NotificationCategory` (`JOB`), `ConversationContext` (`JOB_APPLICATION`), and
`ConversationParticipantRole` (`EMPLOYER`/`APPLICANT`); reuses the `District` +
`VendorApprovalStatus` + `AttachmentScanStatus` enums. Permissions: `employers.read/
moderate`, `jobs.read/moderate`, `job_categories.manage`.
**M25 (Real Estate)** added enums `ListingPurpose`, `PropertyType`, `PropertyStatus`,
`Furnishing`, `Tenure`, `LocationVisibility`, `RentalPeriod`, `AreaUnit`,
`AgentSpecialty`, `PropertyDocumentKind`, `ListingAssignmentStatus`,
`PropertyEnquiryType/Status`, `ViewingRequestStatus`, `PropertyReportReason/Status`;
extended `AuditAction` (16 `PROPERTY_*`/profile actions), `NotificationCategory`
(`PROPERTY`), `ConversationContext` (`PROPERTY_ENQUIRY`), `ConversationParticipantRole`
(`LISTER`/`ENQUIRER`); reuses `District`/`VendorApprovalStatus`/`AttachmentScanStatus`/
`Currency`. Permissions: `properties.*`, `property_owners.*`, `real_estate_agents.*`,
`agencies.*`, `property_reports.read`, `property_documents.read` (SUPER_ADMIN only).

## Indexes (beyond primary/unique keys)
- Category: `(parentId, sortOrder)`, `(isVisible)`
- VendorProfile: `(approvalStatus)`, `(storeStatus)`
- Product: `(status, createdAt)`, `(categoryId)`, `(vendorProfileId, status)`, `(featured)`,
  **GIN `searchVector`** (`products_search_idx`), **GIN trigram title** (`products_title_trgm_idx`)
- ProductImage: `(productId, position)`, `(productId, isPrimary)`
- Inventory: `(productId)` + partial unique `(productId) WHERE variantId IS NULL`
- InventoryChange: `(inventoryId, createdAt)`
- Cart (Phase 3 · M9): unique `(userId)` — one active cart per customer
- CartItem (Phase 3 · M9): `(cartId)`, `(productId)`, `(vendorProfileId)`,
  unique `(cartId, variantId)` + partial unique `(cartId, productId) WHERE variantId IS NULL`
  (variant lines unique per variant; product-level lines unique per product → duplicate adds merge)
- Order (Phase 3 · M10): unique `(orderNumber)`, `(userId, createdAt)`, `(status)`
- VendorOrder (Phase 3 · M10): unique `(orderNumber)`, `(orderId)`, `(vendorProfileId, createdAt)`, `(status)`
- OrderItem (Phase 3 · M10): `(vendorOrderId)`, `(productId)`
- OrderAddress (Phase 3 · M10): `(orderId)`
- Payment (Phase 3 · M11): unique `(paymentNumber)`, `(orderId)`, `(idempotencyKeyId)`, `(userId, createdAt)`, `(status)`
- PaymentMethod (Phase 3 · M11): unique `(userId, type)`, `(userId)`
- WalletHold (Phase 3 · M11): `(paymentId)`, `(walletAccountId, status)`
- LedgerReference / PaymentAttempt / PaymentEvent (Phase 3 · M11): `(paymentId)` (+ `(paymentId, createdAt)` for events)
- IdempotencyKey (Phase 3 · M11): unique `(userId, scope, key)`, `(userId)`
- WalletAccount (M12): + `status` (ACTIVE/LOCKED/SUSPENDED); unique `(userId, type, currency)`
- WalletHold (M12): + `AUTHORIZED` status + `walletTransactionId` (escrow tx backing an authorized hold)
- Order/VendorOrder (M12): + `CANCELLED` status (authorization-failure rollback)
- WalletTransaction (now used, M12): unique `(reference)` → ledger-level idempotency; entries sum to zero
- Review (Phase 4 · M19): unique `(reviewerId, subjectType, contextId)`; `(subjectType, subjectId, status)`, `(reviewerId)`, `(status)`
- ReviewMedia (M19): unique `(storageKey)`; `(reviewId)`
- ReviewResponse (M19): unique `(reviewId)`
- ReviewReport (M19): unique `(reviewId, reporterId)`; `(status)`
- ReviewHelpfulVote (M19): unique `(reviewId, userId)`
- SavedProduct (Phase 4 · M20): unique `(userId, productId)`; `(userId, createdAt)`
- RecentlyViewedProduct (M20): unique `(userId, productId)`; `(userId, viewedAt)`

## Cascade rules
Vendor/product child rows `onDelete: Cascade`. Category parent + Product→Category
`Restrict` (cannot orphan/delete-in-use). Actor references (`reviewerId`,
`actorId`) `SetNull` so history survives account changes.

## Migrations (Phase 2, `packages/database/prisma/migrations`)
`add_categories` · `add_vendor_profiles` · `add_products` · `add_product_images` ·
`add_inventory_variants` · `add_product_search` (trigger + GIN + pg_trgm) ·
`add_marketplace_indexes`.

> **Note on the search indexes:** `searchVector` is declared `Unsupported("tsvector")`
> and its GIN/trigram indexes + maintenance trigger are managed by **raw SQL** in the
> migrations. Prisma's auto-diff cannot see them and will emit `DROP INDEX` for them
> in any future `migrate dev` — always re-add `CREATE INDEX IF NOT EXISTS` for
> `products_search_idx` / `products_title_trgm_idx` (see `add_marketplace_indexes`).
