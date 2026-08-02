# Marketplace — Frontend Route Inventory

## Web (`apps/web`) — public marketplace + vendor dashboard
| Route | Access | Purpose |
|---|---|---|
| `/` | public | landing + discovery rows (M21): featured / top-rated / new arrivals / popular / shop-by-category |
| `/products` | public | catalog: search, category sidebar, price/in-stock filters, sort, pagination, `vendorSlug` (single-store view) |
| `/products/[slug]` | public | product detail: gallery, variant list, availability, ratings & reviews (M19), related + more-from-vendor (M21) |
| `/products` | public | catalog + M7 search/filters + search typeahead (M21) |
| `/orders/[id]` | authed | customer order detail + delivery tracking (M15): timeline, driver, delivery-PIN reveal, proof of delivery |
| `/vendors` | public | vendor directory + name search |
| `/store/[slug]` | public | storefront: banner/logo, info, hours, locations, featured products, store rating + customer reviews (M19) |
| `/login` | public | sign in; honors same-origin `?next=` to return after an add-to-cart/checkout bounce |
| `/dashboard` | authed | overview + role switcher + "recommended for you" (M21) |
| `/dashboard/roles` | authed | request provider roles: upload required documents, view application status + reviewer notes, respond to MORE_INFO_REQUIRED and resubmit |
| `/dashboard/store` | VENDOR | "My Store": profile, settings, locations, hours, logo/banner, submit |
| `/dashboard/delivery` | VENDOR | delivery settings (M13): pickup/delivery, base fee, free threshold, zones + fees, estimate |
| `/dashboard/driver` | authed | driver (M14): profile, vehicles, service areas, availability, application/approval status |
| `/dashboard/driver/jobs` | DELIVERY_DRIVER | driver job feed (M15): assigned/active + completed jobs |
| `/dashboard/driver/jobs/[id]` | DELIVERY_DRIVER | job detail (M15): accept/decline, pickup PIN, in-transit/arriving, delivery PIN + POD upload |
| `/dashboard/notifications` | authed | notification center (M16): filter, mark read/dismiss, preferences |
| `/dashboard/messages` | authed | messaging center (M17): order/delivery/support conversations, composer, attachments |
| `/dashboard/settlements` | VENDOR | vendor earnings & settlements (M18): pending/posted totals, history, calculation breakdown |
| `/dashboard/analytics` | VENDOR | own-store analytics (M22): KPIs, sales chart, top products, orders CSV export |
| `/dashboard/driver/earnings` | DELIVERY_DRIVER | driver earnings (M18): pending/posted totals, earning history + detail |
| `/wishlist` | CUSTOMER | saved products (M20): wishlist grid + remove + recently-viewed strip |
| `/jobs` | public | Belize Connect (M24): job search/filters, job cards |
| `/jobs/[slug]` | public | job detail: description, requirements, salary (if visible), apply, save, report, company + related |
| `/companies/[slug]` | public | employer/company public page + open jobs (M24) |
| `/dashboard/jobs` (job-seeker) | CUSTOMER | Belize Connect job-seeker (M24): profile, résumé manager, saved jobs, applications + timeline/interviews, messaging |
| `/dashboard/employer` | EMPLOYER | employer (M24): company profile, job manager/editor, applicant pipeline, interviews, analytics |
| `/properties` | public | Real Estate (M25): property search/filters (purpose, type, district, price, beds/baths, furnishing, sort), cards |
| `/properties/[slug]` | public | property detail: gallery, key facts, amenities/utilities, location per visibility (never exact address), agent/agency card, save/enquiry/viewing/report |
| `/properties/agents/[slug]` | public | agent public profile + published listings (M25) |
| `/properties/agencies/[slug]` | public | agency public profile + listings (M25) |
| `/dashboard/properties` (seeker) | CUSTOMER | Real Estate seeker (M25): saved properties, enquiries + messaging, viewing requests |
| `/dashboard/property-owner` | PROPERTY_OWNER | owner (M25): profile, listing manager/editor, images/documents, assign agent, enquiries, viewings, analytics |
| `/dashboard/real-estate-agent` | REAL_ESTATE_AGENT | agent (M25): profile + photo, agency profile + logo/banner, assignments accept/decline, managed listings, enquiries, viewings, analytics |
| `/dashboard/business/marketing` | VENDOR / EMPLOYER / REAL_ESTATE_AGENT / PROPERTY_OWNER | Marketing (M26): campaigns + schedules, promotions (placements/targets/media), vendor coupons, own analytics; ownership-scoped |
| homepage promoted band (public) | public | Marketing (M26): additive "Sponsored/Featured" sections (hero + featured businesses/products/jobs/properties) served from `/marketing/homepage`; never reorders organic results |
| `/dashboard/products` | VENDOR | product list (submit/archive/delete) |
| `/dashboard/products/new` | VENDOR | create product |
| `/dashboard/products/[id]` | VENDOR | edit product + image manager + variants/inventory manager |

Public list pages (`/products`, `/vendors`) use `serverGetSafe` and render a
"temporarily unavailable" state on API error (never a Next 500). Detail/storefront
pages `notFound()` on missing/unapproved.

## Admin (`apps/admin`) — moderation console
| Route | Permission | Purpose |
|---|---|---|
| `/dashboard/vendors` | `vendors.read` | vendor queue (status filter) |
| `/dashboard/drivers` | `drivers.read` | driver list/detail (M14): profiles, vehicles + approve/reject, expiry, availability |
| `/dashboard/dispatch` | `deliveries.read` | dispatch console (M15): deliveries list/detail, assign/reassign/cancel, eligible drivers, timeline, assignment history, POD, PIN reveal |
| `/dashboard/notifications` | authed staff | admin notification center (M16): admin-alert/security feed + preferences |
| `/dashboard/support` | `support.read` | support console (M17): support conversations, join/reply, internal notes, close/reopen |
| `/dashboard/settlements` | `settlements.read` | settlements & escrow (M18): reconciliation, internal balances, settlements, exceptions/retry, fee config |
| `/dashboard/analytics` | `analytics.read` | platform analytics (M22): KPIs, sales chart, top products/vendors, orders CSV export |
| `/dashboard/ops` | `ops.read` | operations console (M23): cross-domain action queues, announcement/maintenance editor (`ops.manage`), audit CSV export (`audit.read`) |
| `/dashboard/jobs` (admin) | `jobs.read` | Belize Connect moderation (M24): job queue + detail + moderate (`jobs.moderate`), reports, employers suspend/restore (`employers.*`), categories (`job_categories.manage`), analytics |
| `/dashboard/properties` (admin) | `properties.read` | Real Estate moderation (M25): listing queue + detail + moderate (`properties.moderate`), reports resolve, owners/agents suspend/restore (`property_owners.*`/`real_estate_agents.*`), analytics; private documents gated by `property_documents.read` (super-admin only) |
| `/dashboard/marketing` (admin) | `promotions.read` | Marketing moderation (M26): promotion queue + moderate (`promotions.moderate`) + priority/feature (`promotions.manage`), campaigns (`campaigns.manage`), platform coupons (`coupons.manage`), homepage curation (`homepage.manage`), abuse reports, analytics (`marketing.analytics`) |
| `/dashboard/vendors/[id]` | `vendors.read`/`.moderate` | detail + approve/reject/suspend/restore |
| `/dashboard/products` | `products.read` | product queue (status filter) |
| `/dashboard/products/[id]` | `products.read`/`.moderate` | detail + images + moderation |
| `/dashboard/categories` | `categories.manage` | hierarchical category manager |
| `/dashboard/users` | `users.read` | user search; honors `?status=` (e.g. dashboard "suspended accounts" card) with a clearable filter chip |
| `/dashboard/applications` | `role_applications.review` | role-application queue: view documents, approve/reject/request more info |

> Client demo readiness (M12.1): see [../client-demo/MARKETPLACE-DEMO-READINESS.md](../client-demo/MARKETPLACE-DEMO-READINESS.md) and [../client-demo/DEMO-CHECKLIST.md](../client-demo/DEMO-CHECKLIST.md).

## Shared client behavior
- Same-origin `/api` proxy (Next `rewrites`) keeps HTTP-only auth cookies first-party.
- Browser API clients (`apps/*/lib/api.ts`) attach the double-submit CSRF token on
  mutations and transparently refresh once on `401`.
- Uploads go **directly** to object storage via a presigned PUT (never through the app
  server); the app only records the resulting storage key after a confirm call.
