# Phase 4 · M14 — Driver Management Foundation

Approved delivery-driver **accounts, profiles, vehicles, documents, service areas,
availability, and driver/admin dashboards**. Foundation only — NO delivery
assignment, dispatch, matching, pickup/in-transit/completion, GPS/tracking, route
optimization, map ETA, driver earnings/wallets, payouts, or settlement.

Related: [M13 delivery](./M13-delivery-foundation.md) · [architecture](../ARCHITECTURE.md) ·
[permission matrix](../phase-2/PERMISSION-MATRIX.md) · [OpenAPI](../openapi/marketplace.yaml).

## 1. Architecture decisions
- **Reuse the role system.** The driver role is the existing `DELIVERY_DRIVER`
  (`requiresApproval`). Its application documents, submit/more-info/resubmit,
  admin approve/reject, and suspend/restore/revoke reuse the existing
  role-application + `admin/roles` endpoints and the M12.1 web UI (`/dashboard/roles`,
  admin Applications). No separate driver-auth system.
- **Approval source of truth = the `DELIVERY_DRIVER` UserRole status.** DriverProfile
  does not duplicate approval; eligibility reads the role status (APPROVED/SUSPENDED/…).
- **Structured driver data lives on `DriverProfile`** (captured with the application);
  documents live on the RoleApplication (private R2). Vehicles/service areas are
  normalized child tables (no JSON blobs for core fields).
- **No money / no assignment.** Earnings fields are placeholders (`ratingAverage`,
  `ratingCount`, `completedDeliveries`); nothing writes them and no wallet/OrderDelivery
  is created by driver actions.

## 2. Driver lifecycle / application workflow
1. A **Customer** fills their driver profile (`PUT /driver/profile`) and applies for
   the `DELIVERY_DRIVER` role via the existing role application, uploading the required
   documents (ID, driver's licence, vehicle registration, insurance, vehicle photo,
   profile photo) to private R2.
2. Admin reviews (Applications) → request more info / approve / reject (existing).
3. On approval the `DELIVERY_DRIVER` role becomes APPROVED (selectable via `switchRole`,
   which already refuses non-approved roles). Customer access is preserved throughout.
4. Admin can later suspend / restore / revoke the role (existing) — a suspended driver
   keeps Customer access and cannot go ONLINE.

Prevented (reused role-app guards + new checks): duplicate active applications, missing
required documents, cross-applicant document access, self-approval, role switching before
approval, direct-API role bypass.

## 3. DriverProfile
1:1 with the user. Fields: legalName, displayName, phone, homeDistrict, homeAddress,
lat/long, emergencyContactName/Phone, licenceNumber, licenceExpiry, vehicleOwnership,
termsAcceptedAt, applicantNotes, profilePhotoKey (private); operational: availability,
isActive; placeholders: ratingAverage, ratingCount, completedDeliveries.

## 4. Vehicle architecture (`DriverVehicle`, normalized)
type, make, model, year, color, licencePlate, registrationNumber/Expiry,
insuranceProvider/PolicyNumber/Expiry, photoKeys[] (private storage keys — photos, not
core data), isActive, isPrimary (exactly one active primary — enforced in the service),
approvalStatus (PENDING/APPROVED/REJECTED) + rejectionReason (admin-moderated). Editing a
regulated field (plate/registration/insurance) resets approval to PENDING.

## 5. Service areas (`DriverServiceArea`)
Per-district rows (unique per driver+district), active flag, admin-visible. District-based;
zone linkage is left future-ready (no routing/distance).

## 6. Availability state machine
Enum `DriverAvailability`: OFFLINE, ONLINE, UNAVAILABLE, SUSPENDED. The driver sets
OFFLINE/ONLINE/UNAVAILABLE; **ONLINE requires eligibility**: role APPROVED + profile active
+ licence not expired + ≥1 APPROVED active vehicle with valid registration + insurance.
SUSPENDED is effectively imposed by role suspension (ONLINE blocked). Changes are
owner-scoped, validated, audited, and persisted. **No delivery jobs are exposed.**

## 7. Document-expiry handling
`expiryStatus()` classifies licence + vehicle registration/insurance as VALID /
EXPIRING_SOON (≤30 days) / EXPIRED. Expired/missing licence, registration, or insurance
blocks ONLINE and surfaces in-app warnings (driver dashboard + admin). No scheduled
email/SMS alerts.

## 8. Applicant experience (web)
`/dashboard/roles` (existing) for documents + application status/more-info/resubmit;
`/dashboard/driver` for the driver profile, vehicles, service areas, availability, and
status. Mobile-first.

## 9. Driver dashboard (web `/dashboard/driver`)
Approval/application status + reviewer notes, profile editor, vehicle manager (+ expiry &
approval badges), service-area manager, availability control (disabled with reasons when
ineligible), and a future-jobs placeholder. No fake deliveries/earnings.

## 10. Admin experience
Reuse the Applications queue for driver-role review + suspend/restore/revoke. New:
`/dashboard/drivers` (list + filters) and `/dashboard/drivers/:id` (profile, vehicles with
approve/reject, expiry indicators, service areas, availability, audit). No dispatch.

## 11. API
Driver (CUSTOMER-gated so applicants can build/see their profile; ONLINE gated by
eligibility): `GET /driver/dashboard`, `GET/PUT/PATCH /driver/profile`,
`POST /driver/profile/photo/presign`, `GET /driver/profile/photo`,
`GET/POST/PATCH/DELETE /driver/vehicles[/:id]`, `POST /driver/vehicles/photo/presign`,
`PUT /driver/service-areas`, `PATCH /driver/availability`.
Admin (`drivers.read` / `drivers.moderate`): `GET /admin/drivers`, `GET /admin/drivers/:id`,
`POST /admin/drivers/vehicles/:id/approve|reject`. Role review/suspend/restore/revoke reuse
existing admin endpoints. All: Zod validation, ownership checks, role/permission guards,
private signed URLs, audit logging, notifications, rate-limited presign.

## 12. Permissions
Added `drivers.read`, `drivers.moderate` to the catalog + ADMIN bundle (SUPER_ADMIN spreads
all; SUPPORT_AGENT gets `drivers.read`). Synced to super-admins via the existing
`syncSuperAdminPermissions` on boot.

## 13. Phase 5 mobile handoff
The driver profile, vehicles, service areas, availability, and application status are exposed
through clean, documented, cookie-authed JSON APIs with shared `@bmpl/validation` /
`@bmpl/shared` types — ready for the Phase 5 driver mobile app. No background location,
navigation, job acceptance, or push in M14.

## 14. M15 dispatch boundary
M14 stops at approved, online-capable drivers. M15 (Dispatch) would add: assignment of an
`OrderDelivery` to a driver, the delivery status machine beyond `PENDING_ASSIGNMENT`
(ASSIGNED/PICKED_UP/EN_ROUTE/DELIVERED), driver job feed + accept/decline, and pickup/
in-transit/completion — none implemented here.

## 15. Migrations
`20260731140000_driver_management_foundation` (DriverProfile, DriverVehicle,
DriverServiceArea + enums) and `20260731141000_driver_audit_actions` (audit enum values).
Additive; applied via Railway preDeploy `prisma migrate deploy`.
