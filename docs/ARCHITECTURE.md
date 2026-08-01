# Architecture & Data Model (Phase 1)

> **Design system:** the platform's shared visual language (tokens, components,
> shells, patterns) is documented in
> [docs/design/BMPL-DESIGN-SYSTEM.md](design/BMPL-DESIGN-SYSTEM.md); the
> consolidation audit is in
> [docs/design/BMPL-THEME-AUDIT.md](design/BMPL-THEME-AUDIT.md).

## Data model

```
User 1───* UserRole *───1 Role            (one row per (user, role); each has its own status)
User 1───* RoleApplication 1───* RoleApplicationDocument
                         └────* RoleApplicationReview   (immutable decision trail)
User 1───* Session                        (revocable; hashed rotating refresh token)
User 1───* EmailVerificationToken / PasswordResetToken  (single-use, hashed, expiring)
User 1───* AdminPermissionGrant           (admin capability axis, separate from roles)
User 1───* Notification
AuditLog  *───1 actor(User) / targetUser(User)          (every privileged action)
User 1───* WalletAccount 1───* WalletLedgerEntry *───1 WalletTransaction
```

### Multi-role core

`UserRole` is the heart of the design: **one row per (user, role)** with a
`@@unique([userId, roleCode])` constraint and an **independent** `status`. The
same user can therefore be an approved Vendor, a pending Delivery Driver, a
rejected Real-Estate Agent, and an active Customer — simultaneously, on one
account. `User.activeRoleCode` records the currently-selected role for the
switcher and must always point at an `APPROVED` role (enforced by the API).

### Role application lifecycle

```
                 submit
   (none) ─────────────────► PENDING
                               │  admin: request more info
                               ▼
                        MORE_INFO_REQUIRED ──(applicant responds)──► PENDING
                               │
          ┌────────────────────┼────────────────────┐
     admin approve        admin reject          (applicant withdraws)
          ▼                    ▼                       ▼
      APPROVED             REJECTED               WITHDRAWN
          │
   admin suspend / restore / revoke  → UserRole.status SUSPENDED / APPROVED / REVOKED
```

Each transition writes a `RoleApplicationReview` row **and** an `AuditLog` row in
the same DB transaction, and notifies the applicant.

### Double-entry wallet (foundation only)

- `WalletAccount` — one per user (type `USER`) plus singleton system accounts
  (`SYSTEM_ESCROW`, `SYSTEM_PLATFORM_FEES`, `SYSTEM_TOPUP_CLEARING`,
  `SYSTEM_PAYOUTS_CLEARING`).
- `WalletTransaction` groups `WalletLedgerEntry` rows; every transaction's
  entries **must net to zero** (`assertBalanced` in `@bmpl/wallet`).
- Balances are **derived** by summing entries. `WalletAccount.cachedBalanceMinor`
  is only a cache, recomputed transactionally; reconciliation always trusts the
  ledger.
- Amounts are `BigInt` **minor units** (cents). Real-money movement is gated per-call
  by `assertMoneyMovementEnabled(enabled)` — passed `true` only for the sanctioned
  customer↔escrow (M12) and settlement (M18) operations.

### Settlement & earnings (M18)

- After a vendor-order's delivery is `DELIVERED`, `SettlementService.settleVendorOrder`
  distributes its escrow slice INTERNALLY in one balanced `ESCROW_RELEASE` transaction
  (via the sole `WalletService.postTransaction` path): DEBIT escrow, CREDIT vendor USER
  wallet (net) + driver USER wallet (earning) + `SYSTEM_PLATFORM_FEES` (platform
  revenue). **No external payout/withdrawal/refund.**
- The split is the pure `@bmpl/shared` `computeSettlement` (vendorNet + driver +
  platform ≡ gross, exact). Idempotent via the unique `settlement:<vo>:v1` ledger
  reference + unique `VendorSettlement`. A failure rolls back with no partial entries,
  records a FAILED exception, and alerts admins. Fee rates live in one server-side
  `PlatformFeeConfig`; each settlement snapshots the config so history is immutable.
  Reconciliation surfaces the global ledger net (must be zero).

### Dispatch & delivery execution (M15)

- The delivery lifecycle is a **strict state machine** whose single source of truth
  is `@bmpl/shared` `DELIVERY_ACTIONS` (legal `from→to` edges + the allowed actor).
  `PENDING_ASSIGNMENT → ASSIGNED → DRIVER_ACCEPTED → PICKUP_CONFIRMED → IN_TRANSIT →
  ARRIVING → DELIVERED`, plus `DRIVER_DECLINED` and pre-pickup `CANCELLED`.
- `OrderDelivery` denormalizes the **current** assignment; `DeliveryAssignment` and
  `DeliveryTimelineEvent` are **append-only** history. Every transition writes a
  timeline event + audit row + notification.
- Driver **assignment eligibility** reuses `DriverService` (M14 vehicle/licence checks
  + availability + service-district) and is re-checked at assignment time.
- Inventory is **finalized exactly once** at `PICKUP_CONFIRMED`
  (`InventoryService.finalizeReservation`, guarded by `inventoryFinalizedAt`).
- Pickup/delivery **PINs** are held by the vendor/customer and submitted by the
  driver; attempt-capped, throttled, revealed only via role-checked endpoints, never
  in general payloads or logs. Proof-of-delivery lives in the **private** bucket.
- **No money moves** in dispatch — see the wallet section; settlement/payouts/refunds
  are deferred.

### Notifications & event system (M16)

- One engine, one funnel: `NotificationsService` (`createInApp` for a single user,
  `notifyUsers` for fan-out, `notifyAdmins(permission, …)` for admin alerts). Every
  module routes events through it — no duplicated notification logic.
- **Normalized event → recipient:** a `Notification` is the event; a
  `NotificationRecipient` holds per-user read/dismiss state (so one event fans out to
  many recipients with independent read state). Per-category `NotificationPreference`
  gates future email/push; in-app is always stored.
- Taxonomy: legacy `NotificationType` (back-compat) + module-aligned
  `NotificationCategory` + a stable `event` key (`@bmpl/shared`). The notification
  center reads are strictly caller-scoped.

### Messaging & order communication (M17)

- **No arbitrary chat.** A `Conversation` is uniquely keyed by
  `(contextType, contextId, pairing)` — always bound to a vendor-order, delivery, or
  support case. Access is authorized against the caller's *live* relationship AND the
  conversation's pairing (a customer related to a delivery still can't read the
  vendor↔driver pickup thread); non-participants get `404`.
- **Dynamic driver send.** A DELIVERY driver may send only if they are the delivery's
  *current* `assignedDriverProfileId` — a reassigned driver keeps read/history but loses
  send automatically, with no dispatch coupling required for correctness.
- Fully **normalized** rows (`Message`, `ConversationParticipant`, `MessageAttachment`,
  `MessageReadReceipt`) — no JSON histories. SYSTEM messages mark events without
  duplicating business-state transitions; INTERNAL_NOTE messages are support-only and
  filtered from every non-support view. Attachments are private R2 (signed-URL view).
  New-message events use the **M16** notification engine (`MESSAGE` category).

## Request authorization pipeline (API)

```
Request
  → JwtAuthGuard        verify access JWT (cookie or Bearer) →
                        confirm Session row live (not revoked/expired) →
                        load roles + permissions FRESH from DB → attach req.auth
  → RolesGuard          @Roles(...)      → must hold one as APPROVED
  → PermissionsGuard    @RequirePermission(...) → must hold all (admin axis)
  → Controller          Zod-validate body → Service (transaction + audit + notify)
```

## Session strategy

| Client | Access token | Refresh token | Storage |
|--------|--------------|---------------|---------|
| Web / Admin | JWT (2h) | opaque, rotating | HTTP-only Secure SameSite=Strict cookies |
| Mobile | JWT (2h) | opaque, rotating | `expo-secure-store` (Keychain/Keystore), sent as Bearer |

Both call the same `/api/auth/refresh`, which validates the hashed refresh token,
rotates it, and issues a new pair.

## Why the packages are split this way

- `shared` has zero deps → safe to import from every app and package.
- `validation` depends only on `shared` + `zod` → one schema definition powers
  client forms, API validation, and inferred TS types.
- `authorization` is **pure functions** → unit-testable and reused by API guards
  without pulling in Nest.
- `authentication`, `wallet`, `notifications` isolate security-sensitive or
  financial logic behind small, testable surfaces.
