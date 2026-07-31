# BMPL Theme Audit (M12.2)

Record of the platform-wide visual-consistency pass that aligned the whole
application to the production landing page.

## 1. Before-state inconsistencies

- **No formal token layer.** Colors came from the `belize` Tailwind palette but
  radius/shadow/spacing were ad-hoc; many components hardcoded `rounded-2xl`,
  one-off shadows, and inline hex-ish utility combos.
- **No shared component library in use.** `apps/web/components/ui.tsx` had only
  `Button`/`ButtonLink`/`SectionHeading`/`PlaceholderBadge`. `apps/admin` had **no**
  `ui` module at all — every admin screen was bespoke inline markup.
- **Duplicated / divergent primitives.** `StatusBadge` existed only in admin (flat
  pills, `green/amber/blue` ad-hoc); web screens (e.g. roles page, orders,
  payments) each defined their own status color maps.
- **Generic shells.** Admin sidebar used a `"BM"` placeholder chip instead of the
  brand logo; customer sidebar had no active-nav state; auth pages carried a
  "Made in Belize 🇧🇿" slogan and untokenised inputs.
- **Plain screens.** Wallet/marketplace/dashboard used flat white/blue layouts
  that didn't match the premium landing (cards, badges, empty states, spacing).

## 2. Tokens created (M1)

- `:root` CSS variables `--bmpl-*` (primary, secondary, accent, bg, surface,
  text, text-muted, border, success/warning/error/info, focus, radius scale,
  shadow scale) in **both** apps' `globals.css`.
- Tailwind `borderRadius` (`bmpl-sm/md/lg/xl`) and `boxShadow`
  (`bmpl-sm/md/lg`) scales in **both** `tailwind.config.ts`.
- `@layer components` utility classes: `bmpl-card`, `bmpl-panel`, `bmpl-input`,
  `bmpl-label`, `bmpl-eyebrow`, `bmpl-page-title` in **both** apps.

## 3. Components consolidated (M2)

- Expanded `apps/web/components/ui.tsx` and created `apps/admin/components/ui.tsx`
  (token-identical) with: `Card, PageHeader, Badge, StatusBadge, Alert,
  EmptyState, Skeleton, Spinner, Label, Input, Textarea, Select, Field`, plus new
  `ghost`/`destructive` Button variants.
- Unified `StatusBadge` into a single tone-mapped, dotted badge (label always
  shown — status never by color alone); admin's `StatusBadge.tsx` now delegates
  to the shared `Badge`. Web order/payment status badges refactored to the same
  tone system while keeping their exported names/props.

## 4. Shells (M3)

- **AdminShell**: real circular brand logo (logo copied to `apps/admin/public`),
  grouped nav with active-state accent indicator + icons, themed sign-out.
- **Customer Sidebar**: converted to active-aware nav (icons, grouped Vendor
  section, accent active state), branded header, account footer.
- **AuthShell**: gradient brand panel with dot pattern + glow, trust row,
  removed the "Made in Belize" slogan, tokenised `Field`/`FormError`/`FormSuccess`.

## 5. Hardcoded styles removed

- Ad-hoc status color maps across web pages → shared `StatusBadge`.
- One-off card/border/shadow combos → `bmpl-card` / `rounded-bmpl-*` /
  `shadow-bmpl-*`.
- Bespoke form inputs → `bmpl-input` / shared `Field`/`Input`/`Select`/`Textarea`.

## 6. Screens reviewed / restyled

Public: landing (source of truth), marketplace, product details, vendor
directory, storefront, cart, checkout. Auth: login, register, forgot/reset
password, verify email. Customer: dashboard, profile, roles (vendor application),
orders (list + detail), payments (list + detail). Vendor: store editor, product
list, product editor (form, image manager, variants/inventory), vendor orders.
Admin: login, dashboard, applications (+detail/review), users (+detail/roles),
vendors (+detail/moderation), products (+detail/moderation), orders (+detail),
payments (+detail), wallet (read-only ledger), categories, audit log.

## 7. Remaining exceptions / follow-ups

- **Shared component consolidation**: web + admin `ui.tsx` are duplicated
  (token-identical). Recommended follow-up: promote them into a compiled
  `@bmpl/ui` React package (add React peer dep + jsx build + add `@bmpl/ui` to
  both apps' `transpilePackages` and Tailwind `content`, verify the Vercel
  pipeline). Deferred here to avoid changing the live build mid-milestone.
- **Dark mode**: not implemented (light tokens only); structured for later.
- Any screens flagged during screenshot review are listed in the final report's
  "screens still needing polish" section.
