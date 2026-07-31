# Marketplace — Frontend Route Inventory

## Web (`apps/web`) — public marketplace + vendor dashboard
| Route | Access | Purpose |
|---|---|---|
| `/` | public | landing (nav: Shop → `/products`, Vendors → `/vendors`) |
| `/products` | public | catalog: search, category sidebar, price/in-stock filters, sort, pagination, `vendorSlug` (single-store view) |
| `/products/[slug]` | public | product detail: gallery, variant list, availability |
| `/vendors` | public | vendor directory + name search |
| `/store/[slug]` | public | storefront: banner/logo, info, hours, locations, featured products |
| `/login` | public | sign in; honors same-origin `?next=` to return after an add-to-cart/checkout bounce |
| `/dashboard` | authed | overview + role switcher |
| `/dashboard/roles` | authed | request provider roles: upload required documents, view application status + reviewer notes, respond to MORE_INFO_REQUIRED and resubmit |
| `/dashboard/store` | VENDOR | "My Store": profile, settings, locations, hours, logo/banner, submit |
| `/dashboard/delivery` | VENDOR | delivery settings (M13): pickup/delivery, base fee, free threshold, zones + fees, estimate |
| `/dashboard/driver` | authed | driver (M14): profile, vehicles, service areas, availability, application/approval status |
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
