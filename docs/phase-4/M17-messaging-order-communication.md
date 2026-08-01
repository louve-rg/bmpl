# Phase 4 · M17 — Messaging & Order Communication Foundation

Secure, **context-scoped** communication tied to marketplace orders and deliveries.
There is **no arbitrary user-to-user chat** — every conversation is bound to a
business context the participant has a live relationship to.

**Out of scope (deferred):** open/public chat, social messaging, voice/video calls,
live GPS, driver earnings, vendor payouts, settlement, refund execution, wallet
expansion, reviews, jobs, real estate, marketing, passenger transport, mobile apps,
and real-time transport (SSE/WebSocket) — see §12.

Related: [M16 notifications](./M16-notifications-event-system.md) ·
[architecture](../ARCHITECTURE.md) · [ERD](../phase-2/DATABASE-SCHEMA.md) ·
[permission matrix](../phase-2/PERMISSION-MATRIX.md) · [OpenAPI](../openapi/marketplace.yaml).

## 1. Conversation architecture
A `Conversation` is uniquely identified by **(contextType, contextId, pairing)** — the
business context plus the participant grouping. The pairing lets a single delivery
have a separate customer↔driver thread and vendor↔driver pickup thread so pickup
coordination never leaks to the customer. Messages, participants, attachments, and
read receipts are fully **normalized relational rows** (no JSON message history).

## 2. Context rules
Contexts: `ORDER`, `VENDOR_ORDER`, `DELIVERY`, `SUPPORT_CASE`. A conversation is
created only when the requester has a valid relationship: the customer owns the order,
the vendor owns the vendor-order, the driver is **currently assigned** to the delivery,
or the requester opens a support case (support joins via permission). Contexts dedupe
by the unique triple (support cases use a distinct generated id, so a user may open
multiple). Users cannot search for arbitrary people to message — they can only open a
conversation from a context they're party to.

## 3. Participant matrix
| Opener | May converse with | Context · pairing |
|---|---|---|
| Customer | Vendor of their vendor-order | VENDOR_ORDER · CUSTOMER_VENDOR |
| Customer | Assigned driver | DELIVERY · CUSTOMER_DRIVER |
| Vendor | Customer of their vendor-order | VENDOR_ORDER · CUSTOMER_VENDOR |
| Vendor | Assigned driver (pickup) | DELIVERY · VENDOR_DRIVER |
| Driver | Customer / vendor of the assigned delivery | DELIVERY · CUSTOMER_DRIVER / VENDOR_DRIVER |
| Any user | Support | SUPPORT_CASE · USER_SUPPORT |

Access is authorized against the caller's **live** relationship AND the conversation's
pairing (a customer related to a delivery still cannot read the vendor↔driver thread).
Non-participants get `404` (existence not leaked). Admin/support access is
permission-gated (`support.read`).

## 4. Reassignment behavior
Driver **send** access is evaluated **dynamically** against the delivery's *current*
`assignedDriverProfileId`. On reassignment the previous driver keeps read access to the
historical conversation but **cannot send** (403); the new assigned driver participates
(added on access, and a best-effort dispatch hook swaps the active driver participant +
posts a "Delivery reassigned" SYSTEM message). All history and audit are preserved.

## 5. Message model
Plain-text `Message` rows: sender (null for SYSTEM), `type` (USER / SYSTEM /
INTERNAL_NOTE), body, `createdAt`, `editedAt`, soft `deletedAt`. **Immutable SYSTEM
messages** mark events (conversation started, driver assigned/reassigned, picked up,
delivered, support joined, closed) without duplicating the business-state transition
(the source of truth stays in orders/dispatch). Financial/support/safety messages are
never hard-deleted. No disappearing messages.

## 6. Attachments
Private R2 via presigned PUT under the owner namespace `messages/<userId>`. Allowlist:
images (jpeg/png/webp/heic) + PDF — **no executables**; max 10 MB, max 5 per message.
Post-upload the server HEAD-validates the real MIME + size and confirms the key is in
the sender's namespace before persisting. View is a short-lived signed URL for
conversation participants only. `scanStatus` is a malware-scan placeholder (PENDING) —
no scanner is wired yet. No public URLs.

## 7. Read / unread
`ConversationParticipant.lastReadAt` drives unread counts (messages after last-read,
excluding own + internal notes for non-support). Per-conversation unread is returned in
the list; a total is exposed at `/conversations/unread-count`. Mark-read stamps
`lastReadAt` and upserts a `MessageReadReceipt` on the latest message. Read activity is
not exposed beyond participants.

## 8. Notification integration
Uses the **M16 engine** (`NotificationsService.notifyUsers`) — a new-message / new-
attachment event notifies the other participants under the `MESSAGE` category
(`MESSAGE_RECEIVED` / `MESSAGE_ATTACHMENT`); support-join notifies the case owner
(`SUPPORT_RESPONSE`). No second notification subsystem; preferences apply as in M16.

## 9. Internal-note privacy
`INTERNAL_NOTE` messages are created only by `support.respond` holders, are filtered out
of every non-support serialization (list + detail + unread), are audited
(`INTERNAL_NOTE_ADDED`), and are never hard-deleted. The customer/vendor/driver never
see them.

## 10. Permissions
Added `support.read` (list/view support conversations; view any for moderation) and
`support.respond` (join, reply, internal notes, close/reopen). SUPPORT_AGENT + ADMIN +
SUPER_ADMIN hold both; support agents get **no** financial/account-admin powers. Synced
on boot via `syncSuperAdminPermissions`.

## 11. API inventory
User (`/conversations`): `GET /`, `GET /unread-count`, `POST /vendor-order/:id`,
`POST /delivery/:id?with=`, `POST /support`, `GET /:id`, `POST /:id/messages`,
`POST /:id/read`, `POST /:id/close`, `POST /:id/reopen`,
`POST /attachments/presign`. Admin/support (`/admin/support`): `GET /` (filter),
`GET /:id`, `POST /:id/join`, `POST /:id/messages`, `POST /:id/notes`,
`POST /:id/close`, `POST /:id/reopen`. All: Zod validation (body trimmed, length-capped,
control-chars stripped), context/ownership authorization, role/permission guards,
transactions, StrictThrottle on send + presign, audit, notifications, private signed URLs.

## 12. Security model
No arbitrary chat (context-bound only); cross-tenant access → `404`; reassigned driver
loses send; attachments private (namespace + MIME + size validated, signed-URL view);
internal notes never leak; message payloads carry only ids (no PINs/POD/financial
secrets); StrictThrottle limits spam; bodies are plain text rendered as text (React
auto-escaping) with control chars stripped; direct conversation-id manipulation →
404/403; suspended users cannot send; closed conversations reject sends; no secrets
logged. Verified by the integration suite. Messaging changes **no** order/delivery/
payment/wallet/inventory state.

## 13. Mobile handoff
All conversation + message APIs use shared `@bmpl/validation` schemas + shared enums
(`@bmpl/shared`), are cookie-authed with mobile-friendly JSON, and idempotent where safe
(context dedupe). This is the Phase 5 driver/customer messaging contract.

## 14. Deferred real-time scope
Delivery is request/response (poll on open + on send). Real-time push (SSE/WebSocket),
typing indicators, presence, and read-receipt fan-out are deferred — the normalized
model + notification events are the substrate a future real-time layer plugs into.

## 15. Migrations
`20260803120000_messaging_enums` (enum `ADD VALUE`s: `AuditAction` ×8,
`NotificationCategory` MESSAGE — isolated) and `20260803121000_messaging` (new enums
`ConversationContext`/`ConversationStatus`/`ConversationParticipantRole`/`MessageType`/
`AttachmentScanStatus`; tables `conversations`, `conversation_participants`, `messages`,
`message_attachments`, `message_read_receipts`; indexes + FKs). Additive; applied via
Railway preDeploy.
