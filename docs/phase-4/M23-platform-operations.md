# Phase 4 · M23 — Platform Admin / Moderation / Operations

The final Phase-4 milestone ties the admin surface together with an **operations
console** — a single cross-domain view of everything needing action — plus an
admin-managed **announcement / maintenance banner** and an **audit-log CSV export**.
It builds on the moderation/admin capabilities already shipped (users, roles,
applications, vendors, products, categories, orders, payments, wallet, dispatch,
drivers, support, settlements, reviews, analytics) rather than duplicating them.

**Out of scope (deferred):** feature-flag frameworks, A/B testing, bulk destructive
operations, an in-app admin permission editor beyond the existing `admin.manage`
surface, and enforced maintenance mode (see §3 — the banner is display-only).

Related: [M22 analytics](./M22-analytics-reporting.md) · [permission matrix](../phase-2/PERMISSION-MATRIX.md) ·
[ERD](../phase-2/DATABASE-SCHEMA.md) · [OpenAPI](../openapi/marketplace.yaml).

## 1. Operations overview (`ops.read`)
`GET /admin/ops/overview` aggregates the actionable work-queues across every domain in
one call, so an operator sees the whole platform's pending work at a glance:

| Queue | Source |
|---|---|
| `pendingVendorApplications` | `VendorProfile` approvalStatus PENDING |
| `pendingProductModeration` | `Product` status PENDING_REVIEW |
| `pendingDriverVehicles` | `DriverVehicle` approvalStatus PENDING |
| `pendingRoleApplications` / `moreInfoRoleApplications` | `RoleApplication` PENDING / MORE_INFO_REQUIRED |
| `openReviewReports` | `ReviewReport` OPEN |
| `openSupportCases` | `Conversation` SUPPORT_CASE + OPEN |
| `failedSettlements` | `VendorSettlement` FAILED |
| `deliveriesPendingAssignment` | `OrderDelivery` PENDING_ASSIGNMENT |
| `awaitingPickupCollection` | `VendorOrder` READY_FOR_PICKUP |
| `suspendedUsers` / `suspendedRoles` | `User` / `UserRole` SUSPENDED (informational) |

`totalActionable` sums the actionable queues (excludes the informational suspended-*
counts). The admin console renders each queue as a card that deep-links to the
existing moderation page for that domain.

## 2. Announcement / maintenance banner
A single `PlatformSetting` row (created lazily on first read), managed by `ops.manage`
and surfaced publicly (display-only) to every visitor:
- `GET /admin/ops/settings` (`ops.read`) — full settings row.
- `PATCH /admin/ops/settings` (`ops.manage`) — partial update (announcement
  active/level/message, maintenance mode/message); validated (message 1–500 chars,
  level ∈ INFO/WARNING/CRITICAL); **audited** as `PLATFORM_SETTING_UPDATED`.
- `GET /marketplace/announcement` (**public**) — returns only *active* notices,
  stripped of internal metadata, for the web + admin banner components.

## 3. Maintenance mode is DISPLAY-ONLY
`maintenanceMode` renders an informational banner ("scheduled maintenance") — it does
**not** gate, block, or disable any API request or route. This is deliberate: an
enforced global kill-switch is a high-risk, easily-footgunned control, and nothing in
the approved scope requires it. The flag is purely a visitor-facing notice.

## 4. Audit export (`audit.read`)
`GET /admin/ops/audit.csv` streams the audit log as an RFC-4180-quoted CSV (columns:
createdAt, action, actorEmail, targetEmail, targetRole, reason, ipAddress), with
optional `action` / `actorId` / `from` / `to` filters — operational forensics on top
of the existing paginated `GET /admin/audit` view.

## 5. Permissions
New: `ops.read` (view the ops console + settings) and `ops.manage` (edit the banner),
both granted to `ADMIN` + `SUPER_ADMIN` (synced on boot; `SUPER_ADMIN` inherits all).
Audit export reuses `audit.read`. Support agents get neither ops permission.

## 6. Frontend
- **Admin `/dashboard/ops`** — action-queue cards (deep-linked, count-highlighted),
  the announcement/maintenance editor (with a display-only note + live preview; the
  form disables itself for admins lacking `ops.manage`), and an audit-CSV download.
- **Banners** — a public `AnnouncementBanner` (web `Header`) and an admin banner
  (`AdminShell`), both reading `GET /marketplace/announcement`, colored by level
  (INFO/WARNING/CRITICAL) with a maintenance strip; dismissible; render nothing when
  no notice is active.

## 7. Guarantees & invariants
- **Aggregation, not duplication** — the ops overview only counts existing domain
  queues; all actual moderation still happens on the existing per-domain pages.
- **Display-only maintenance** — the banner never blocks API access.
- **Least privilege** — ops console behind `ops.read`; banner edits behind
  `ops.manage`; audit export behind `audit.read`.
- **Audited writes** — every banner change records `PLATFORM_SETTING_UPDATED`.
- **Safe CSV** — RFC-4180 quoting prevents CSV injection.

## 8. Tests
`apps/api/test/ops.integration.spec.ts` (5 tests): overview aggregation reflecting
seeded pending work + all queue keys present; ops.read gating (customer 403 / guest
401 / admin-without-ops.read 403); banner edit via `ops.manage` + public active/
inactive surfacing + audit record; `ops.manage` required to edit (ops.read-only
refused) + input validation (empty body 400, bad level 400); audit CSV headers +
`audit.read` gating. Full suite: **332 API integration tests green**.
