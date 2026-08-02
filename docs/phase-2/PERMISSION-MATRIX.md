# Marketplace — Permission Matrix

Two independent axes (Phase 1 design): **customer-facing roles** (`UserRole`, e.g.
`VENDOR`) and **admin permissions** (`AdminPermissionGrant`, held only by staff).
A customer role never grants an admin permission and vice-versa. Everything is
enforced server-side by the global guard chain, regardless of what any UI shows.

## Marketplace permissions (in `@bmpl/shared` `PERMISSIONS`)
| Permission | Grants |
|---|---|
| `vendors.read` | view vendor profiles in the admin console |
| `vendors.moderate` | approve / reject / suspend / restore vendor storefronts |
| `products.read` | view products in the admin console |
| `products.moderate` | approve / reject / suspend / restore products |
| `categories.manage` | create / edit / delete categories |
| `drivers.read` | view driver profiles / vehicles / service areas / availability (M14) |
| `drivers.moderate` | approve / reject driver vehicles (M14; driver-role approval reuses `role_applications.review`) |
| `deliveries.read` | view deliveries, timelines, assignment history in the dispatch console (M15) |
| `deliveries.assign` | assign / reassign a driver to a delivery (M15) |
| `deliveries.manage` | cancel an assignment; operational dispatch actions (M15) |
| `deliveries.verify` | reveal pickup/delivery PINs; admin override of verification (M15) |
| `proof_of_delivery.read` | view private proof-of-delivery files via signed URLs (M15) |
| `support.read` | list / view support conversations (and any conversation for moderation) (M17) |
| `support.respond` | join + reply to support threads, add internal notes, close/reopen (M17) |
| `settlements.read` | view settlements, driver earnings, escrow/internal balances, reconciliation (M18, read-only) |
| `settlements.manage` | update platform fee configuration; retry failed settlements (M18) |
| `reviews.read` | list/view reviews + report queue in the admin console (M19) |
| `reviews.moderate` | hide/unhide/reject reviews; resolve reports (M19) |
| `analytics.read` | view platform analytics dashboards + export reports (M22, read-only; ADMIN/SUPER_ADMIN only — excludes SUPPORT_AGENT) |
| `ops.read` | view the operations console (cross-domain action queues + audit export) (M23) |
| `ops.manage` | manage the platform announcement / maintenance banner (M23; display-only) |
| `employers.read` | view employer/company profiles (M24, Belize Connect) |
| `employers.moderate` | suspend/restore employer companies (M24; role approval reuses `role_applications.review`) |
| `jobs.read` | view job listings + moderation queue + job reports (M24, read-only) |
| `jobs.moderate` | approve/reject/more-info/unpublish/suspend/archive jobs; resolve job reports (M24) |
| `job_categories.manage` | manage the Belize Connect job-category lookup (M24) |
| `properties.read` | view property listings + moderation queue (M25, read-only) |
| `properties.moderate` | approve/reject/more-info/suspend/unpublish/archive listings; resolve property reports (M25) |
| `property_owners.read` / `.moderate` | view / suspend-restore property owners (M25) |
| `real_estate_agents.read` / `.moderate` | view / suspend-restore agents (M25) |
| `agencies.read` / `.moderate` | view / approve-suspend agencies (M25) |
| `property_reports.read` | view the property report queue (M25) |
| `property_documents.read` | **HIGHLY RESTRICTED** — view private ownership/authority documents (M25; SUPER_ADMIN only, excluded from ADMIN + SUPPORT bundles) |

### Default bundles (`PERMISSION_BUNDLES`)
| Staff role | Marketplace permissions |
|---|---|
| `SUPPORT_AGENT` | read-only bundle incl. `vendors.read`, `products.read`, `drivers.read`, `deliveries.read`, `proof_of_delivery.read`, `reviews.read`, `employers.read`, `jobs.read` (NO résumé access) |
| `ADMIN` | all marketplace + logistics permissions incl. all `deliveries.*` + `proof_of_delivery.read` + `reviews.read`/`reviews.moderate` + `analytics.read` + `ops.read`/`ops.manage` + `employers.*`/`jobs.*`/`job_categories.manage` + `properties.*`/`property_owners.*`/`real_estate_agents.*`/`agencies.*`/`property_reports.read` (**NOT** `property_documents.read`) |
| `SUPER_ADMIN` | all (inherits every permission) |

## Capability matrix
| Capability | Public | CUSTOMER | VENDOR (approved) | SUPPORT_AGENT | ADMIN / SUPER_ADMIN |
|---|:--:|:--:|:--:|:--:|:--:|
| Browse catalog / storefronts / categories | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create/manage **own** vendor profile & storefront | — | — | ✅ | — | — |
| Create/manage **own** products, images, variants, inventory | — | — | ✅ | — | — |
| Submit vendor profile / product for review | — | — | ✅ | — | — |
| View vendor/product moderation queues | — | — | — | ✅ | ✅ |
| Approve/reject/suspend/restore vendors | — | — | — | — | ✅ |
| Approve/reject/suspend/restore products | — | — | — | — | ✅ |
| Manage categories | — | — | — | — | ✅ |
| Read reviews / ratings (public) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Write verified review (after fulfilment) | — | ✅ | — | — | — |
| Respond to reviews of **own** product/store | — | — | ✅ | — | — |
| Report a review · vote helpful | — | ✅ | ✅ | ✅ | ✅ |
| Moderate reviews / resolve reports | — | — | — | read-only | ✅ |
| Save products (wishlist) · recently-viewed (own, private) | — | ✅ | — | — | — |
| View own-store analytics + export (M22) | — | — | ✅ | — | — |
| View platform analytics + reports (M22, `analytics.read`) | — | — | — | — | ✅ |
| Operations console + audit export (M23, `ops.read`) | — | — | — | — | ✅ |
| Manage announcement/maintenance banner (M23, `ops.manage`) | — | — | — | — | ✅ |
| Belize Connect: browse/search jobs (M24) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Belize Connect: job-seeker profile / résumé / apply (own) | — | ✅ | — | — | — |
| Belize Connect: publish jobs + manage applicants (own, APPROVED employer) | — | — | ✅¹ | — | — |
| Belize Connect: moderate jobs / employers / reports (M24) | — | — | — | read-only | ✅ |

¹ EMPLOYER is a separate approved role (not shown as a column); requires the EMPLOYER role application + approval.

## Ownership rule
Every vendor endpoint resolves ownership through `OwnershipService`
(`vendorProfileId` / `ownedProduct`): a vendor may only read or mutate resources
belonging to **their own** vendor profile. Accessing another vendor's product,
image, variant, or inventory returns `404` (not `403`, to avoid leaking existence).
Public surfaces only ever expose PUBLISHED products of APPROVED vendors.
