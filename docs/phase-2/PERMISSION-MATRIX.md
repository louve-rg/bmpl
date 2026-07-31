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

### Default bundles (`PERMISSION_BUNDLES`)
| Staff role | Marketplace permissions |
|---|---|
| `SUPPORT_AGENT` | read-only bundle incl. `vendors.read`, `products.read`, `drivers.read`, `deliveries.read`, `proof_of_delivery.read` |
| `ADMIN` | all marketplace + logistics permissions incl. all `deliveries.*` + `proof_of_delivery.read` |
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

## Ownership rule
Every vendor endpoint resolves ownership through `OwnershipService`
(`vendorProfileId` / `ownedProduct`): a vendor may only read or mutate resources
belonging to **their own** vendor profile. Accessing another vendor's product,
image, variant, or inventory returns `404` (not `403`, to avoid leaking existence).
Public surfaces only ever expose PUBLISHED products of APPROVED vendors.
