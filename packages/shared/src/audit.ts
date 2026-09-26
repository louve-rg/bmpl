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
  // Designating a storefront / driver profile as a simulation account. Security
  // relevant: the vendor flag is what makes an order a test order, and the driver
  // flag is what decides who may be offered one.
  'VENDOR_TEST_MODE_CHANGED',
  'DRIVER_TEST_MODE_CHANGED',
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
  // Customer-initiated whole-order cancellation (owner-approved scope): who
  // cancelled travels in actorId, reason + escrow return in newValue.
  'ORDER_CANCELLED',
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
  // The driver's own queue ordering. Recorded because it is a driver-initiated
  // write against delivery rows, even though it changes only display sequence.
  'DRIVER_QUEUE_REORDERED',
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
  // ---- Messaging & Order Communication (Phase 4 · M17) ----
  'CONVERSATION_CREATED',
  'CONVERSATION_CLOSED',
  'CONVERSATION_REOPENED',
  'MESSAGE_SENT',
  'MESSAGE_DELETED',
  'MESSAGE_ATTACHMENT_ADDED',
  'SUPPORT_JOINED',
  'INTERNAL_NOTE_ADDED',
  // ---- Settlement & Earnings (Phase 3 · M18) ----
  'SETTLEMENT_CALCULATED',
  'SETTLEMENT_POSTED',
  'SETTLEMENT_FAILED',
  'ESCROW_RELEASED_SETTLEMENT',
  'DRIVER_EARNING_POSTED',
  'VENDOR_SETTLEMENT_POSTED',
  'PLATFORM_FEE_POSTED',
  'PAYMENT_SETTLING',
  'PAYMENT_SETTLED',
  'PLATFORM_FEE_CONFIG_UPDATED',
  // ---- Pickup fulfilment (Phase 3 · M18.1) ----
  'VENDOR_ORDER_READY_FOR_PICKUP',
  'VENDOR_ORDER_PICKED_UP',
  'VENDOR_ORDER_PICKUP_PIN_FAILED',
  // ---- Reviews & Ratings (Phase 4 · M19) ----
  'REVIEW_CREATED',
  'REVIEW_EDITED',
  'REVIEW_MODERATED',
  'REVIEW_RESPONSE_ADDED',
  'REVIEW_RESPONSE_EDITED',
  'REVIEW_REPORTED',
  'REVIEW_REPORT_RESOLVED',
  // ---- Platform Operations (Phase 4 · M23) ----
  'PLATFORM_SETTING_UPDATED',
  // ---- Real Estate (Phase 6 · M25) ----
  'PROPERTY_OWNER_PROFILE_UPSERTED',
  'REAL_ESTATE_AGENT_PROFILE_UPSERTED',
  'AGENCY_PROFILE_UPSERTED',
  'PROPERTY_CREATED',
  'PROPERTY_UPDATED',
  'PROPERTY_SUBMITTED',
  'PROPERTY_MODERATED',
  'PROPERTY_PUBLISHED',
  'PROPERTY_STATUS_CHANGED',
  'PROPERTY_ASSIGNMENT_CHANGED',
  'PROPERTY_ENQUIRY_CREATED',
  'PROPERTY_ENQUIRY_UPDATED',
  'PROPERTY_VIEWING_REQUESTED',
  'PROPERTY_VIEWING_UPDATED',
  'PROPERTY_REPORTED',
  'PROPERTY_REPORT_RESOLVED',
  // ---- Belize Connect Jobs (Phase 5 · M24) ----
  'EMPLOYER_PROFILE_UPSERTED',
  'JOB_SEEKER_PROFILE_UPSERTED',
  'JOB_CATEGORY_MANAGED',
  'JOB_CREATED',
  'JOB_UPDATED',
  'JOB_SUBMITTED',
  'JOB_MODERATED',
  'JOB_PUBLISHED',
  'JOB_CLOSED',
  'JOB_ARCHIVED',
  'JOB_APPLICATION_SUBMITTED',
  'JOB_APPLICATION_STATUS_CHANGED',
  'JOB_APPLICATION_WITHDRAWN',
  'JOB_INTERVIEW_SCHEDULED',
  'JOB_INTERVIEW_UPDATED',
  'JOB_REPORTED',
  'JOB_REPORT_RESOLVED',
  // ---- Marketing & Business Promotion (Phase 6 · M26) ----
  'PROMOTION_CREATED',
  'PROMOTION_UPDATED',
  'PROMOTION_SUBMITTED',
  'PROMOTION_MODERATED',
  'PROMOTION_PUBLISHED',
  'PROMOTION_STATUS_CHANGED',
  'PROMOTION_REPORTED',
  'PROMOTION_REPORT_RESOLVED',
  'CAMPAIGN_CREATED',
  'CAMPAIGN_UPDATED',
  'CAMPAIGN_STATUS_CHANGED',
  'COUPON_CREATED',
  'COUPON_UPDATED',
  'COUPON_STATUS_CHANGED',
  'COUPON_REDEEMED',
  // ---- Vendor fulfilment + automatic dispatch (M26.3) ----
  'VENDOR_ORDER_PREPARING',
  'VENDOR_ORDER_READY_FOR_DISPATCH',
  'DELIVERY_AUTO_ASSIGNED',
  'DELIVERY_OFFER_EXPIRED',
  'DELIVERY_DISPATCH_EXHAUSTED',
  // ---- Multi-leg logistics ----
  'LOGISTICS_HUB_CREATED',
  'LOGISTICS_HUB_UPDATED',
  'LOGISTICS_ROUTE_CREATED',
  'LOGISTICS_ROUTE_UPDATED',
  'COURIER_LANE_CREATED',
  'COURIER_LANE_UPDATED',
  'SHIPMENT_CREATED',
  'SHIPMENT_CANCELLED',
  'SHIPMENT_LEG_STARTED',
  'SHIPMENT_LEG_DEPARTED',
  'SHIPMENT_LEG_ARRIVED',
  'SHIPMENT_LEG_HANDOFF',
  'SHIPMENT_LEG_HANDOFF_PIN_FAILED',
  'SHIPMENT_LEG_EXCEPTION',
  'SHIPMENT_HANDOFF_PIN_REVEALED',
  'SHIPMENT_LEG_OFFERED',
  'SHIPMENT_LEG_OFFER_EXPIRED',
  'SHIPMENT_LEG_DISPATCH_EXHAUSTED',
  'SHIPMENT_LEG_ACCEPTED',
  'SHIPMENT_LEG_DECLINED',
  'SHIPMENT_LEG_PICKED_UP',
  'SHIPMENT_LEG_IN_TRANSIT',
  'SHIPMENT_LEG_ARRIVING',
  'SHIPMENT_LEG_DRIVER_ASSIGNED',
  // Carrier organizations (BMPL-137). One value per decision surface; the verb
  // (set/clear, add/end) travels in previousValue/newValue — the
  // PASSENGER_AFFILIATION_CHANGED precedent.
  'SHIPMENT_LEG_OPERATOR_ASSIGNED',
  'SHIPPING_PROVIDER_MEMBER_CHANGED',
  // BMPL-186: route schedule surface (weekly pattern, date exceptions).
  'ROUTE_SCHEDULE_CHANGED',
  // ---- Wallet activation ----
  'WALLET_TOPUP_POSTED',
  // One action for the wallet lock/unlock fraud control — direction and
  // reason travel in previousValue/newValue (the status-changed precedent).
  'WALLET_ACCOUNT_STATUS_CHANGED',
  'WALLET_TEST_FUNDING_GRANTED',
  // Simulation money a person issued to their own wallet during UAT. Kept
  // distinct from WALLET_TEST_FUNDING_GRANTED (an administrator granting it to
  // somebody) so the two are never confused when reading the trail back.
  'WALLET_SELF_SERVICE_TEST_FUNDING_GRANTED',
  'USER_TEST_FLAG_CHANGED',
  // ---- Profile pictures ----
  'AVATAR_SUBMITTED',
  'AVATAR_AUTO_APPROVED',
  'AVATAR_AUTO_REJECTED',
  'AVATAR_APPROVED',
  'AVATAR_REJECTED',
  'AVATAR_REMOVED',
  // ---- Passenger transportation (admin oversight hooks) ----
  'PASSENGER_ROUTE_CREATED',
  'PASSENGER_ROUTE_UPDATED',
  'PASSENGER_VEHICLE_APPROVED',
  'PASSENGER_VEHICLE_REJECTED',
  'PASSENGER_TRIP_CANCELLED',
  // The admin-set-only simulation flags, security relevant exactly as the
  // vendor and delivery-driver equivalents above.
  'PASSENGER_DRIVER_TEST_MODE_CHANGED',
  'PASSENGER_PROVIDER_TEST_MODE_CHANGED',
  // Publishing a departure names who typed it in — an admin acting for an
  // operator must be distinguishable from the operator themselves.
  'PASSENGER_TRIP_CREATED',
  // The booking/movement lifecycle (S3): confirmation is when seats are held,
  // cancellation carries the party attribution a future policy will need,
  // assignment names the human who staffed the departure, completion closes it.
  'PASSENGER_BOOKING_CONFIRMED',
  'PASSENGER_BOOKING_CANCELLED',
  'PASSENGER_TRIP_ASSIGNED',
  'PASSENGER_TRIP_COMPLETED',
  // Fleet affiliation: one action for the whole consent lifecycle
  // (invited / requested / accepted / declined / withdrawn / ended, carried in
  // newValue.event) — the PROPERTY_ASSIGNMENT_CHANGED precedent.
  'PASSENGER_AFFILIATION_CHANGED',
  // The way back out of a leg EXCEPTION: one action for both resolutions
  // (resume in place / release the driver and re-queue), the chosen resolution
  // carried in newValue — the PASSENGER_AFFILIATION_CHANGED precedent of one
  // code per lifecycle rather than one per verb.
  'SHIPMENT_LEG_EXCEPTION_RESOLVED',
  // A recipient account deliberately claimed a shipment via its tracking
  // token. Holding the token only ever authorised reading trackPublic(); this
  // is the one action that turns that into an actual account link.
  'SHIPMENT_RECIPIENT_LINKED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
