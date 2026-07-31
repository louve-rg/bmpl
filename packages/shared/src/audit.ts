/** Canonical audit action codes. Mirrors Prisma `AuditAction` enum. */
export const AUDIT_ACTIONS = [
  'USER_REGISTERED',
  'USER_LOGGED_IN',
  'USER_SUSPENDED',
  'USER_RESTORED',
  'EMAIL_VERIFIED',
  'PASSWORD_RESET',
  'ROLE_APPLICATION_SUBMITTED',
  'ROLE_APPLICATION_MORE_INFO_REQUESTED',
  'ROLE_APPLICATION_INFO_PROVIDED',
  'ROLE_APPROVED',
  'ROLE_REJECTED',
  'ROLE_SUSPENDED',
  'ROLE_RESTORED',
  'ROLE_REVOKED',
  'ROLE_SWITCHED',
  'ADMIN_PERMISSION_GRANTED',
  'ADMIN_PERMISSION_REVOKED',
  'NOTIFICATION_BROADCAST',
  // ---- Marketplace: Categories (Phase 2 · M1) ----
  'CATEGORY_CREATED',
  'CATEGORY_UPDATED',
  'CATEGORY_DELETED',
  // ---- Marketplace: Vendors (Phase 2 · M2) ----
  'VENDOR_PROFILE_SUBMITTED',
  'VENDOR_APPROVED',
  'VENDOR_REJECTED',
  'VENDOR_SUSPENDED',
  'VENDOR_RESTORED',
  // ---- Marketplace: Products (Phase 2 · M4) ----
  'PRODUCT_CREATED',
  'PRODUCT_SUBMITTED',
  'PRODUCT_APPROVED',
  'PRODUCT_REJECTED',
  'PRODUCT_SUSPENDED',
  'PRODUCT_ARCHIVED',
  'PRODUCT_DELETED',
  // ---- Marketplace: Inventory (Phase 2 · M6) ----
  'INVENTORY_ADJUSTED',
  // ---- Marketplace: Orders (Phase 3 · M10) ----
  'ORDER_CREATED',
  'ORDER_RESERVATION_RELEASED', // admin/maintenance release of an order's inventory reservations (M10.1)
  // ---- Marketplace: Payments (Phase 3 · M11 — foundation, no money movement) ----
  'PAYMENT_CREATED',
  'PAYMENT_STATE_CHANGED',
  'WALLET_HOLD_CREATED',
  'WALLET_HOLD_RELEASED',
  'IDEMPOTENCY_KEY_REPLAYED',
  // ---- Wallet authorization & escrow (Phase 3 · M12 — first real money movement) ----
  'PAYMENT_AUTHORIZED',
  'PAYMENT_AUTHORIZATION_FAILED',
  'WALLET_VALIDATION_FAILED',
  'ESCROW_FUNDS_HELD', // customer wallet → escrow (authorization)
  'ESCROW_FUNDS_RELEASED', // escrow → customer wallet (release/rollback)
  'WALLET_TRANSACTION_POSTED',
  // ---- Logistics: Driver Management (Phase 4 · M14) ----
  'DRIVER_PROFILE_UPSERTED',
  'DRIVER_AVAILABILITY_CHANGED',
  'DRIVER_VEHICLE_APPROVED',
  'DRIVER_VEHICLE_REJECTED',
  // ---- Logistics: Dispatch & Delivery Execution (Phase 4 · M15) ----
  'DELIVERY_ASSIGNED',
  'DELIVERY_REASSIGNED',
  'DELIVERY_ASSIGNMENT_CANCELLED',
  'DELIVERY_ACCEPTED',
  'DELIVERY_DECLINED',
  'DELIVERY_PICKUP_CONFIRMED',
  'DELIVERY_IN_TRANSIT',
  'DELIVERY_ARRIVING',
  'DELIVERY_COMPLETED',
  'DELIVERY_POD_UPLOADED',
  'DELIVERY_PICKUP_PIN_FAILED',
  'DELIVERY_DELIVERY_PIN_FAILED',
  'INVENTORY_FULFILLED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
