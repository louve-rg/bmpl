# Phase 2 · M3 — Vendor Storefront (+ public web goes live)

Public, unauthenticated storefront surface for approved vendors, and the first
deployment of the **web** app so public features are verifiable live. No database
changes (reads existing M2 data).

## Backend (`apps/api/src/vendor/`)
- `VendorService.publicList()` — APPROVED, non-vacation vendors for the directory
  (name, slug, logo URL, rating placeholder, pickup/delivery, store status).
- `VendorService.publicStorefront(slug)` — a single APPROVED storefront (branding,
  contact, socials, opening hours, locations, pickup/delivery, rating placeholder,
  `featuredProducts: []` + `categories: []` reserved for M4). Unknown / unapproved
  slug → `404`.
- `VendorPublicController` — `@Public` `GET /marketplace/vendors` and
  `GET /marketplace/vendors/:slug`.

## Frontend (`apps/web`)
- `/vendors` — public directory grid (logo, rating, pickup/delivery/status badges).
- `/store/[slug]` — storefront (banner, logo, ratings placeholder, description,
  contact, locations, opening hours, "products coming soon" until M4). Unknown slug
  → 404.
- Landing header "Marketplace" now links to `/vendors`.
- **Proxy hardening:** `next.config.mjs` + `lib/server-api.ts` now normalize
  `NEXT_PUBLIC_API_URL` (default to the production API, add scheme, strip trailing
  slash/`/api`) — the same fix applied to admin, so the web app deploys and proxies
  correctly on Vercel regardless of a manually-set env var.

## Authorization / visibility
Only `APPROVED` vendors are ever returned; DRAFT/PENDING/REJECTED/SUSPENDED are
invisible (404 even by exact slug). Vacation-mode vendors drop out of the directory
but keep a reachable storefront flagged `vacationMode: true`.

## Tests
- **Integration** (`storefront.integration.spec.ts`) — 4: directory lists approved
  only (draft hidden), storefront detail by slug, unknown slug 404, vacation-mode
  hidden-from-list-but-reachable. Web build clean with the two public routes.

## Migration & deployment
- **No migration** (M3 reads existing tables).
- API redeploys via Railway (CI-gated) — adds the two public endpoints.
- **Web deployed to Vercel** (`bmpl-web`) — first public web release. If the Vercel
  project is Git-connected, the push auto-builds; the hardened proxy makes it work
  without additional env configuration.
- Live verification of `/api/marketplace/vendors`, a storefront by slug, and the
  `/vendors` page recorded in the consolidated report.
