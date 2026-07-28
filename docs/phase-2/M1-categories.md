# Phase 2 · M1 — Categories

Hierarchical, admin-managed marketplace taxonomy. First Phase 2 milestone with a
database model, migration, backend endpoints, and admin UI. Reuses the existing
permission guard, audit writer, Zod validation pipe, and admin app shell — nothing
duplicated.

## Database
- **`Category`** model (`categories` table): `id`, `name`, `slug @unique`,
  `description?`, `iconName?`, `imageKey?` (public-bucket key), `featured`,
  `isVisible`, `sortOrder`, self-referential `parentId` (`CategoryHierarchy`,
  `onDelete: Restrict`), timestamps. Indexes: `(parentId, sortOrder)`, `(isVisible)`.
- **`AuditAction`** enum + shared `AUDIT_ACTIONS` mirror gain `CATEGORY_CREATED`,
  `CATEGORY_UPDATED`, `CATEGORY_DELETED`.
- Migration: `20260728022523_add_categories` (enum `ADD VALUE` ×3, `categories`
  table, indexes, self-FK).

## Backend (`apps/api/src/categories/`)
- `CategoriesService` — public tree (visible-only; a hidden parent hides its whole
  subtree), admin flat list with child counts, create/update/delete with slug
  uniqueness (derive-from-name with `-2` suffixing, or 409 on explicit duplicate),
  parent existence + **no-cycle** enforcement, and delete-guard when children exist.
  Every mutation writes an audit row.
- `CategoriesController` — `GET /api/marketplace/categories` (`@Public`, visible tree).
- `AdminCategoriesController` — `GET/POST/PATCH/DELETE /api/admin/categories`, each
  `@RequirePermission('categories.manage')`.
- Registered `CategoriesModule` in `AppModule`. CSRF/auth/roles handled by the
  existing global guard chain.
- DTOs: `createCategorySchema` / `updateCategorySchema` in `@bmpl/validation`.

## Frontend (`apps/admin`)
- New **Categories** nav entry + `/dashboard/categories` manager: create form
  (name, parent, sort, featured), hierarchical table with indentation, inline edit
  (name/slug/parent/sort with self+descendant excluded from the parent picker),
  visible/featured toggles, and delete (blocked when subcategories exist).
- Extended the browser API client with `patch` / `del` (previously `get`/`post`).

## Authorization
- Public tree: unauthenticated OK.
- Admin CRUD: requires `categories.manage`. Verified a customer → 403, an admin
  without the permission → 403, unauthenticated mutation → 401.

## Tests
- **Integration** (`test/categories.integration.spec.ts`, real Postgres) — 15 tests:
  slug derive+suffix, explicit-duplicate 409, child under parent, missing parent 404,
  update + audit, self-parent 400, cycle 400, delete-with-children 409, leaf delete +
  audit, public visibility (hidden subtree omitted), and the full authz matrix.
- **Unit** — `@bmpl/validation` category DTO tests (+3).
- Results: full API integration suite **57 passed (6 files)**; `@bmpl/shared` 12,
  `@bmpl/validation` 10. api/admin build + typecheck clean.

## Migration & deployment
- Local dev DB: `prisma migrate dev` (applied). Test DB `bmpl_test`: applied by the
  integration global setup.
- Cloud: `prisma migrate deploy` against the Railway Postgres, then Railway (API) +
  Vercel (admin) redeploy. Verified `GET /api/marketplace/categories` returns `200`
  live, and the admin Categories page ships in the build.
