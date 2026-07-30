# Marketplace — API Inventory

All routes are under the `/api` prefix. Auth column: **Public** (no auth),
**VENDOR** (`@Roles('VENDOR')`, owner-scoped), or a **permission** name
(`@RequirePermission`). See the machine-readable [OpenAPI spec](../openapi/marketplace.yaml).

## Standard conventions
- **Validation error** (`400`): `{ "message": "Validation failed", "errors": [{ "path", "message" }] }`.
- **Other errors**: Nest default `{ "statusCode", "message", "error" }` — `401` unauth,
  `403` forbidden, `404` not found/not owned, `409` conflict.
- **Paginated list** (public products): `{ total, page, pageSize, items: [...] }`.
  Query: `page` (≥1, default 1), `pageSize` (1–48, default 24).
- **Mutations** require the CSRF token (browser) — handled by the web/admin API clients.
- Money fields are integer **minor units** (cents).

## Public — `@Public()`
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/marketplace/categories` | visible category tree |
| GET | `/api/marketplace/vendors` | approved vendor directory · `?q=&district=` |
| GET | `/api/marketplace/vendors/:slug` | storefront (info, hours, locations, featured products, categories) |
| GET | `/api/marketplace/products` | catalog search · `?q=&categoryId=&vendorSlug=&featured=&inStock=&priceMin=&priceMax=&sort=&page=&pageSize=` |
| GET | `/api/marketplace/products/:slug` | product detail (gallery, options, variants, availability) |

`sort` ∈ `relevance | newest | price_asc | price_desc | featured`. `categoryId`
filters the whole subtree. Prices in the query are **cents**.

## Vendor — `@Roles('VENDOR')` (owner-scoped)
**Profile & storefront**
| Method | Path |
|---|---|
| GET/POST/PATCH | `/api/vendor/profile` |
| POST | `/api/vendor/profile/submit` |
| PATCH | `/api/vendor/settings` |
| POST | `/api/vendor/profile/locations` · PATCH/DELETE `…/locations/:id` |
| PUT | `/api/vendor/profile/hours` (replace-all) |
| POST | `/api/vendor/profile/logo/presign` ⛨ · `/logo/confirm` |
| POST | `/api/vendor/profile/banner/presign` ⛨ · `/banner/confirm` |

**Products**
| Method | Path |
|---|---|
| GET/POST | `/api/vendor/products` (POST creates a **PUBLISHED** product — no review step) |
| GET/PATCH/DELETE | `/api/vendor/products/:id` |
| POST | `/api/vendor/products/:id/archive` · `/unarchive` |

**Images** (`/api/vendor/products/:productId/images`)
| Method | Path |
|---|---|
| GET | `` (list) |
| POST | `/presign` ⛨ · `/confirm` · `/reorder` · `/:imageId/primary` |
| PATCH/DELETE | `/:imageId` |

**Options & variants** (`/api/vendor/products/:productId`)
| Method | Path |
|---|---|
| GET | `/variants` (options + variants view) |
| POST | `/options` · `/options/:optionId/values` · `/variants` |
| PATCH | `/variants/:variantId` |
| DELETE | `/options/:optionId` · `/option-values/:valueId` · `/variants/:variantId` |

**Inventory** (`/api/vendor/products/:productId/inventory`, `?variantId=` targets a variant)
| Method | Path |
|---|---|
| GET | `` · `/history` |
| PATCH | `` (settings: threshold/unlimited/backorders) |
| POST | `/adjust` (delta + reason, writes history + audit) |

⛨ = stricter per-IP rate limit (`@StrictThrottle`).

## Cart — `@Roles('CUSTOMER')` (self-scoped, Phase 3 · M9)
Every authenticated customer has one active cart. All routes act on the caller's
own cart only — there is **no admin or vendor surface** onto customer carts and
**no approval/moderation** anywhere in the flow. Prices are recomputed server-side
on every call; no inventory is reserved.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cart` | active cart, grouped by vendor (prices + availability re-validated) |
| POST | `/api/cart/items` | add `{ productId, variantId?, quantity }` (merges onto an identical line) |
| PATCH | `/api/cart/items/:itemId` | set a line's quantity (≥1) |
| DELETE | `/api/cart/items/:itemId` | remove a line |
| DELETE | `/api/cart` | clear the cart |

Add/update reject an unpublished product or inactive storefront (`409`), a
required/invalid variant (`400`), and insufficient stock (`409`). `GET` never
throws for a stale cart — each line carries `issues[]` / `purchasable` /
`priceChanged` flags instead. Response is the full `Cart` (see OpenAPI `Cart`).

## Orders & checkout (Phase 3 · M10)
**Customer** — `@Roles('CUSTOMER')`, self-scoped:
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/checkout` | cart → PENDING order (transactional; reserves inventory; clears cart). Body: `{ vendors:[{vendorProfileId, deliveryMethod, customerNotes?}], deliveryAddress? }` |
| GET | `/api/orders` | own order history |
| GET | `/api/orders/:id` | own order detail |

**Vendor** — `@Roles('VENDOR')`, owner-scoped:
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/vendor/orders` | the vendor's own vendor orders |
| GET | `/api/vendor/orders/:id` | vendor order detail (+ customer name / delivery address) |

Checkout rejects an empty cart (`400`), an unpublished product / inactive storefront / disabled variant (`409`), and insufficient stock (`409`) — any failure rolls the whole transaction back (no order, no reservation, cart intact). Prices are recomputed + **snapshotted**; the client sends no prices. No payment/tax/shipping/fees.

## Admin — `@RequirePermission(...)`
| Method | Path | Permission |
|---|---|---|
| GET | `/api/admin/orders` · `/:id` | `orders.read` (read-only; no editing) |
| GET/POST | `/api/admin/categories` | `categories.manage` |
| PATCH/DELETE | `/api/admin/categories/:id` | `categories.manage` |
| GET | `/api/admin/vendors` `?status=` · `/:id` | `vendors.read` |
| POST | `/api/admin/vendors/:id/approve\|reject\|suspend\|restore` | `vendors.moderate` |
| GET | `/api/admin/products` `?status=` · `/:id` | `products.read` |
| POST | `/api/admin/products/:id/approve\|reject\|suspend\|restore` | `products.moderate` |

Reject requires a reason (`note`); moderation writes a review-trail row + audit +
a vendor notification.
