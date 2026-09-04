# Archived documentation

**Nothing in this directory describes the current state of BML.** These files
are kept because they record decisions, verification evidence and reasoning that
are still useful when asking "why is it like this?" — not because they are true
today.

**Do not cite anything here as current. Do not plan work from it.**

For where the project actually stands:

- [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md) — the current status authority
- [`../../CLAUDE.md`](../../CLAUDE.md) — the engineering rules
- The code itself — which outranks all of the above

## What is here, and why it is wrong

Archived 2026-09-03.

| File | Written | Why it is archived |
| --- | --- | --- |
| `REMAINING_WORK.md` | Jul 2026 (Phase 1.5) | Lists Marketplace, Shipping & Delivery, Belize Connect, Real Estate and Marketing as "deliberately not started". **All five have since shipped.** Its Phase-1.5 follow-up list is also largely superseded — rate limiting, CSRF double-submit, the email provider abstraction, structured logging, Sentry and CI were all delivered. |
| `PHASE-1.5A-VERIFICATION.md` | Jul 2026 | Verification report for local integration work, when the integration suite was 36 tests. It is now 691 across 55 spec files. |
| `PHASE-1.5C-STATUS.md` | Jul 2026 | Status of a cloud-deployment preparation phase that has since completed and been superseded many times over. |
| `CHANGED_FILES.md` | Jul 2026 | A file-by-file changelog of one phase. `git log` is the live version of this. |

Some items in `REMAINING_WORK.md` **are** still genuinely outstanding — ESLint
configuration, a nonce-based CSP, push notifications, antivirus scanning,
refresh-token family revocation, `timestamptz`. Those are tracked as current
work, not read out of this file.
