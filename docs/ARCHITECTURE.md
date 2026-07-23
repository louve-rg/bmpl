# Architecture & Data Model (Phase 1)

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
- Amounts are `BigInt` **minor units** (cents). Real-money movement is gated off
  by `assertMoneyMovementEnabled(false)`.

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
| Web / Admin | JWT (15m) | opaque, rotating | HTTP-only Secure SameSite=Strict cookies |
| Mobile | JWT (15m) | opaque, rotating | `expo-secure-store` (Keychain/Keystore), sent as Bearer |

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
