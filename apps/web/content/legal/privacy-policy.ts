// Verbatim content from Angela's draft, cleared by the owner for placeholder-visible
// publication (MDF-109, 2026-10-11). Do not edit this text here -- a content change
// goes back through Angela/the owner and lands as a new copy of the source draft.
// Source: angela--mv08t0fp/drafts/privacy-policy.md
export const PRIVACY_POLICY_CONTENT = `# Privacy Policy — DRAFT for owner review

**Status:** Draft. Not published. Not legal advice. Contains placeholders marked \`[OWNER DECISION: ...]\`. See the companion cover list.

**Grounding note:** the data inventory below is taken from the live Prisma schema and related source on \`origin/main\` as of 2026-10-11 (\`packages/database/prisma/schema.prisma\`, \`.env.example\`, \`apps/api/src/observability/sentry.ts\`). Where I could not verify whether something is actually active in production versus merely built, I say so rather than assuming either way.

---

## 1. Who controls this data

[OWNER DECISION: legal entity name and contact — same as the Terms of Service placeholder. A privacy policy needs this filled in before publication.]
[OWNER DECISION: is there a Data Protection Officer or equivalent contact? If none exists, say so rather than inventing one.]

## 2. What we collect, and why

### Account basics
Name, email, password (stored as a one-way hash, never in plain text), phone number, and — if you provide them — district, city, and street address. Used to create and secure your account and to let other users and the platform identify you (e.g., a vendor seeing who placed an order).

### Profile photo
If you upload one, it's stored privately and served back only through your account. For driver/vendor-type roles, the photo goes through an identity-review step before it's shown publicly; for a plain customer account it's shown without that review. [OWNER DECISION: the review can optionally run an automated face-detection check through a third-party vision provider (currently configured to use none by default, with Google Cloud Vision as an optional provider) — confirm whether that automated check is actually turned on in production, since this document should only describe what's actually running, not what's merely available.]

### Role-application data (vendor, driver, employer, agent/agency, passenger provider/driver, shipping provider)
Applying for one of these roles means submitting role-specific details and supporting documents for review — for a delivery driver, for example, that includes legal name, phone, home address/area, an emergency contact, driver's licence number and expiry, and vehicle details; for a vendor, business name, contact details, and store information. Supporting documents are stored in private file storage and linked only to the application. [OWNER DECISION: retention period for rejected applications and their documents.]

### Messages and attachments
Messages you send to other users through the platform (e.g., customer–vendor, customer–driver) are stored so both sides can see the conversation. You can attach files. [OWNER DECISION: attachments currently carry a scan-status field but no malware scanning is actually wired up — this document should say that plainly rather than imply protection that isn't there yet, unless scanning ships before this page is published.]

### Location
The platform stores locations you give it directly — a delivery address, a dropped pin, a vendor's or hub's location, a passenger pickup/drop point. **There is no continuous or live location tracking of you, a driver, or a vehicle.** A pin is a single point you placed, not a feed.

### Orders, shipments, and the internal wallet ledger
Purchase and delivery history, shipment and courier-leg records, and entries in your account's internal ledger. **This ledger does not represent real money** — see the Terms of Service. [OWNER DECISION: if/when real payments are added, this section must be rewritten; it is not written to anticipate that today.]

### Notifications
In-app and (if enabled in your preferences) email notifications about orders, deliveries, messages, and account/security events. [OWNER DECISION: the platform has a push-notification channel defined and an Expo access-token slot in configuration, but the mobile app is a skeleton that hasn't shipped — confirm push is not actually active before this page claims or denies it either way.] The platform does not use SMS/text messaging — there's no SMS channel in the system to describe.

### Reviews, saved items, and recently-viewed lists
Reviews and ratings you post, and (for your own convenience) which products/jobs/properties you've saved or recently looked at. [OWNER DECISION: confirm these lists are private to your own account and not shown to or used by anyone else — that's what the code shows, but it's worth the owner's explicit sign-off since it's a privacy-relevant claim.]

### Session and device information
When you log in, the platform records your session's IP address, user agent (browser/device string), which client you used (web/admin/mobile), and login/last-used timestamps, plus a login cookie that keeps you signed in. This is used for account security (e.g., detecting unusual logins) and keeping you logged in — not for advertising.

### Admin and moderation actions
Actions admins take (approvals, rejections, suspensions, content moderation decisions) are logged with who did what and when, so the platform has an audit trail. This log is about admin actions, not a record built for or shown to other users.

### Error monitoring
If configured, the platform sends crash/error reports to Sentry, a third-party error-monitoring service. This only happens when the service is actually configured with a key in a given environment; cookies, authorization headers, and other sensitive fields are stripped before anything is sent, and the service is not told your IP/PII by default. [OWNER DECISION: confirm this is in fact configured (has a live key) in production — I can see the code path exists and is designed to be opt-in, but cannot confirm from here whether it is switched on today.]

## 3. What we do not collect

No analytics or advertising tracker (e.g., no Google Analytics, no ad pixel, no behavioral ad targeting) was found anywhere in the web or admin source as of this draft. The platform does not currently have a live GPS feed, a reverse-geocoding step that infers your location from a pin, or an SMS channel.

## 4. Who else sees this data

- **Other users**, in the ordinary course of a transaction or conversation (e.g., a vendor sees a customer's delivery address; a driver sees a pickup pin).
- **File storage** — uploaded images and documents are held in S3-compatible object storage. [OWNER DECISION: confirm which concrete provider is live in production — the codebase supports MinIO (dev-only), and lists Cloudflare R2, AWS S3, or Supabase as options for production, but does not itself tell me which one is actually in use today.]
- **Email delivery**, if/when the platform sends you an email. [OWNER DECISION: confirm which provider is actually live — the code supports a console/log-only mode (dev) and lists SMTP, Resend, or Amazon SES as production options, but doesn't itself say which is configured today.]
- **Sentry** (error monitoring), only if and when a production key is configured — see above.
- **Maps.** [OWNER DECISION: a maps provider is wired into configuration but the API key field is an empty placeholder in the example configuration — confirm whether a live maps provider is actually in use in production before this document describes one.]

We do not sell personal data, and did not find any data broker or ad-network integration in the code to disclose.

## 5. How long we keep it

[OWNER DECISION: this entire section needs real retention periods — account data after account closure, rejected-application documents, message history, audit logs, session records. I have not invented any of these; they're product/legal decisions.]

## 6. Your rights

[OWNER DECISION: this depends on which jurisdiction's law applies (Belize, and/or any other jurisdiction the owner wants to follow, e.g., GDPR-style rights if EU users are in scope) — needs legal input, not a drafted guess.]

## 7. Children

[OWNER DECISION: minimum age to use the platform, and what happens if an underage account is found.]

## 8. International transfer

[OWNER DECISION: if any vendor above (storage/email/Sentry) stores or processes data outside Belize, this needs a statement — depends on the answers to the OWNER DECISIONs in section 4.]

## 9. Security

Passwords are hashed (never stored or logged in plain text); the API enforces authentication and role/permission checks on every request by default; session tokens are stored hashed server-side; error reports have sensitive headers, cookies, and tokens stripped before they leave the system. [OWNER DECISION: any additional security practice the owner wants stated — this list is only what I could verify in code, not a complete security program description.]

## 10. Changes to this policy

[OWNER DECISION: how changes are communicated and how much notice is given.]

## 11. Contact

[OWNER DECISION: a real contact method.]

---

🤖 Drafted by Angela (Claude Code) for owner review via god/Michael. Not published. Not legal advice.`;
