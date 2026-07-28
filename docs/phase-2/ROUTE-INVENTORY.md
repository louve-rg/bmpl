# Marketplace — Frontend Route Inventory

## Web (`apps/web`) — public marketplace + vendor dashboard
| Route | Access | Purpose |
|---|---|---|
| `/` | public | landing (nav: Shop → `/products`, Vendors → `/vendors`) |
| `/products` | public | catalog: search, category sidebar, price/in-stock filters, sort, pagination |
| `/products/[slug]` | public | product detail: gallery, variant list, availability |
| `/vendors` | public | vendor directory + name search |
| `/store/[slug]` | public | storefront: banner/logo, info, hours, locations, featured products |
| `/dashboard` | authed | overview + role switcher |
| `/dashboard/store` | VENDOR | "My Store": profile, settings, locations, hours, logo/banner, submit |
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
| `/dashboard/vendors/[id]` | `vendors.read`/`.moderate` | detail + approve/reject/suspend/restore |
| `/dashboard/products` | `products.read` | product queue (status filter) |
| `/dashboard/products/[id]` | `products.read`/`.moderate` | detail + images + moderation |
| `/dashboard/categories` | `categories.manage` | hierarchical category manager |

## Shared client behavior
- Same-origin `/api` proxy (Next `rewrites`) keeps HTTP-only auth cookies first-party.
- Browser API clients (`apps/*/lib/api.ts`) attach the double-submit CSRF token on
  mutations and transparently refresh once on `401`.
- Uploads go **directly** to object storage via a presigned PUT (never through the app
  server); the app only records the resulting storage key after a confirm call.
