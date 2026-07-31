# Phase 4 · M16 — Notifications & Event System

A centralized, normalized notification engine used by every module (marketplace,
orders, payments, delivery, drivers, vendors, admin). Every major event flows
through one reusable service; users get an in-app notification center (bell, unread
badge, filtering, pagination, preferences) and admins get system/moderation alerts.

**Out of scope (deferred):** messaging/chat, reviews, refunds, driver earnings,
vendor payouts, settlement, GPS/live tracking, mobile apps.

Related: [architecture](../ARCHITECTURE.md) · [database schema/ERD](../phase-2/DATABASE-SCHEMA.md) ·
[OpenAPI](../openapi/marketplace.yaml).

## 1. Architecture
- **One engine, one funnel.** `NotificationsService` is the single entry point every
  module already used (`createInApp`). M16 keeps that signature (no caller churn) and
  adds `notifyUsers` (fan-out), `notifyAdmins(permission, …)` (alert every admin
  holding a permission), reads (`listForUser`, `unreadCount`), state
  (`markRead`/`markAllRead`/`remove`), and `getPreferences`/`setPreference`.
- **Normalized event → recipient.** A `Notification` is the **event** (type, category,
  event key, title, body, data); a `NotificationRecipient` is the **per-user delivery +
  read/dismiss state**. One event fans out to many recipients (admin alerts) without
  duplicating copy, and each recipient's read state is independent.
- **Taxonomy.** Legacy `NotificationType` (back-compat) + a module-aligned
  `NotificationCategory` (ORDER, PAYMENT, DELIVERY, DRIVER, VENDOR, ACCOUNT,
  ROLE_APPLICATION, ADMIN_ALERT, SECURITY, SYSTEM) + a stable machine `event` key
  (`@bmpl/shared` `NOTIFICATION_EVENTS`) for client deep-linking/icons.
- **Extensible channels.** `NotificationChannel` (IN_APP/EMAIL/PUSH) + per-category
  `NotificationPreference`. In-app is always stored; email/push are gated by preferences
  when those transports are wired (email transport already exists via `EmailService`).

## 2. Database
`Notification` (event; `@@index([category, createdAt])`), `NotificationRecipient`
(`notificationId`, `userId`, `channel`, `readAt`, `deletedAt`; `@@unique([notificationId,
userId])`, indexed by `(userId, readAt)` and `(userId, deletedAt)`),
`NotificationPreference` (`userId`, `category`, `inApp`, `email`, `push`;
`@@unique([userId, category])`), enum `NotificationCategory`. Migration
`20260802120000_notification_event_system` creates the types/tables and **migrates the
existing per-user `notifications` rows** into one recipient each (backfilling category
from the legacy type) **before** dropping the moved columns — no data loss.

## 3. API
All routes cookie-authed and **scoped to the caller** (`/notifications`):
`GET /` (filter `category`, `unread`; cursor + `limit` pagination; returns
`{ items, nextCursor, unreadCount }`), `GET /unread-count`, `PATCH /:id/read`,
`PATCH /read-all`, `DELETE /:id` (soft dismiss), `GET /preferences`,
`PUT /preferences` (`{ category, inApp?, email?, push? }`). `:id` is the recipient id.
Validation via `@bmpl/validation` `notificationPreferenceSchema`.

## 4. Events wired through the engine
- **Customer:** order placed (ORDER), payment authorized (PAYMENT), driver assigned /
  accepted / pickup confirmed / in-transit / arriving / delivered / cancelled (DELIVERY).
- **Vendor:** new order (VENDOR), order/delivery updates, driver assigned, pickup
  confirmed, delivery completed, vendor approve/reject, product moderation.
- **Driver:** new assignment, assignment cancelled, reassigned, delivery completed,
  vehicle moderation (DELIVERY/DRIVER).
- **Admin (fan-out via `notifyAdmins`):** new vendor application (`vendors.read`), new
  role/driver application (`role_applications.read`), failed-delivery / verification lock
  (`deliveries.read`, SECURITY), i.e. order exceptions + security alerts.

## 5. Security
Every read/mutation is filtered by `userId`; a user can only list, read, dismiss, or set
preferences for their own recipient rows (cross-user read/delete is a no-op). PIN/POD and
other sensitive payloads are never embedded — notifications carry only ids in `data`.
Admin alerts reach only users holding the relevant permission.

## 6. Web / admin UI
Web: a notification **bell** with unread badge in the dashboard shell (polls
`unread-count`), a dropdown of recent items, and a **notification center** page (category
filter chips, unread toggle, cursor "load more", mark-read/dismiss/mark-all-read) plus a
**preferences** panel. Admin: the same bell + an admin notification center defaulting to
ADMIN_ALERT/SECURITY (vendor/role applications, order exceptions, failed deliveries,
security), with the same read/dismiss/preferences controls.

## 7. Tests
`notifications.integration.spec.ts` (+9): per-user scoping, list + unread count,
mark-read / mark-all-read, soft delete, category + unread filters, cursor pagination,
preferences get/set, event→recipient fan-out with independent read state, and cross-user
no-op. Existing module specs (orders/dispatch/vendor/workflows) assert their events emit.
Suite: 271 integration, 30 unit, 12 shared.

## 8. Migration & deployment
Single additive migration with in-place data backfill; applied via Railway preDeploy
`prisma migrate deploy`. Web + admin deploy on Vercel.
