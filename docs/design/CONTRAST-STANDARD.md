# Foreground/background contrast — permanent design-system standard

**Source:** the product owner, **2026-10-16**. Stated as a permanent
design-system standard for the entire Belize Marketplace & Logistics
platform, **effective immediately**, applying to all future BML development.
The wording below is reproduced verbatim — it is the standard, not a
paraphrase of it.

> **DARK GLASS = LIGHT TEXT. LIGHT SURFACES = DARK TEXT.**
>
> This rule applies to every customer, vendor, driver, logistics, marketing, and admin interface.
>
> Requirements:
>
> 1. **Dark navy and blue glass surfaces:** Use white, off-white, or appropriately light
>    foreground tokens for headings, body text, labels, figures, icons, and secondary
>    information.
> 2. **Light surfaces:** Use dark navy or similarly dark foreground tokens to maintain
>    readable contrast.
> 3. **Nested components:** Determine foreground colors from the component's actual
>    background, not merely its parent. Badges, inputs, dropdowns, alerts, and other
>    self-contained components must retain their own correct color pairings.
> 4. **Muted text:** Secondary information must remain readable. Do not achieve a muted
>    appearance by making text nearly invisible.
> 5. **Accessibility:** Maintain at least WCAG AA contrast—4.5:1 for normal text, 3:1 for
>    large text and essential interface graphics—measured against the actual rendered
>    background.
> 6. **Design tokens:** Establish explicit semantic foreground/background pairings for dark
>    glass, light surfaces, inputs, tables, navigation, cards, and overlays. Avoid arbitrary
>    hardcoded colors that undermine those pairings.
> 7. **Enforcement:** Add automated contrast checks and component tests to CI. New or
>    modified components must be verified against their actual backgrounds before merging.
> 8. **Regression protection:** No global CSS override may blindly recolor nested
>    components. Every correction must preserve existing readable combinations.
> 9. **Production remediation:** Apply this rule to all existing pages, not only newly
>    developed screens. Correct the current dark-blue-on-blue failures and independently
>    verify the results.
> 10. **Visual identity:** Preserve the premium navy-and-blue Liquid Glass appearance.
>     Readability is a requirement of the design, not a compromise to it.
>
> **Acceptance criterion:** No production page should contain text, essential icons,
> controls, or financial figures that disappear into their background. Every affected route
> and interactive state must be checked, and unverified coverage must be reported honestly.

---

## Where this applies in the codebase today

`packages/ui/src/glass.css` is the single token-definition point for both the
flat/light BMPL theme and the Liquid Glass theme (requirement 6's home).
Glass scope (`[data-theme="glass"]`) is applied at exactly two places in the
whole platform: `apps/web/app/dashboard/layout.tsx` and
`apps/admin/components/AdminShell.tsx`.

**Precedent already recorded in `glass.css` itself and binding on any future
fix under requirement 8 and requirement 10:** an earlier prototype gave every
text run its own local scrim pill. It passed all 749 measured contrast
samples and was rejected on sight by the owner as "covered in sticky labels."
The accepted principle — **the material carries the contrast, not the
text** — is to raise a surface's own fill until plain text passes on the
surface alone, never to patch individual text runs. Any remediation work
under requirement 9 must follow this principle, not re-introduce per-text
scrims.

## Implementation state — honest, as of 2026-10-16

**The platform does not meet this standard yet.** The standard is effective
immediately; the gap below is being closed, not denied.

| Requirement | Owner | State |
|---|---|---|
| 6 — semantic token pairings | Oscar (`bmpl-web-mtmd0uea`) | Proposal requested, not yet implemented. |
| 7 — automated CI contrast checks | Jim (`jim-mv09alb5`) | Approach requested, not yet built. |
| 9 — remediation of existing pages | Unassigned | **Not started** — deliberately held until requirement 6's tokens exist, so remediation isn't built against a token set that's about to change. |
| 1–5, 8, 10 (the design rule itself) | This document | Recorded here as the standard; not independently re-verified page by page. |
| Acceptance criterion (independent verification on production) | — | **Blocked on MDF-13** (authenticated production access), unanswered 36 days as of this writing. |

### Known open violations at the time of adoption

- Admin "By revenue" badge — contrast ratio **1.85** (hardcoded `text-belize-blue` on glass).
- Vendor "Net revenue" KPI — contrast ratio **1.89** (same cause).
- `StorefrontView.tsx` Contact/Locations/Opening-Hours sidebar, on
  `/dashboard/store/preview` — contrast ratio **1.17–1.84**. Not previously on
  any fix list or skip list; nobody had checked it.
- `ReviewList.tsx` and `SaveJobButton.tsx` — both previously assumed
  public-only (light theme); both actually render under glass scope.
- **44 files** platform-wide with unchecked raw `<input>` / `<select>`
  elements.

This document makes no claim of compliance anywhere on the platform. The
acceptance criterion itself requires that unverified coverage be reported
honestly, and that applies to this document describing the rule as much as
to the pages it governs.

## Related documents

- [`docs/design/BMPL-DESIGN-SYSTEM.md`](./BMPL-DESIGN-SYSTEM.md) — the
  platform's general visual language; §13 Accessibility rules cross-links
  here for contrast specifically.
- [`packages/ui/src/glass.css`](../../packages/ui/src/glass.css) — the single
  token-definition point this standard governs.
