# BMPL Design System

The single visual language for the Belize Marketplace & Logistics platform —
web (`apps/web`), admin (`apps/admin`), and any future surface.

## 1. Visual source of truth

The **production landing page** (`apps/web/components/landing/*`) is the source of
truth. Every other screen is styled to belong to the same product family. The
tokens and components below were extracted from those landing sections (hero,
platform bento, why-choose-us, providers, wallet, mobile, closing CTA, footer).

## 2. Brand palette

Defined once in `@bmpl/shared` `BRAND.colors` and mirrored in both apps'
`tailwind.config.ts` under the `belize` color and in `:root` CSS variables.

| Token | Value | Tailwind | Use |
|-------|-------|----------|-----|
| Primary | `#1e40af` | `belize-blue` | primary buttons, links, active nav |
| Primary hover | `#1e3a8a` | `belize-deep` | primary button hover |
| Secondary | `#0f172a` | `belize-navy` | headings, dark shells, footer |
| Accent | `#0ea5e9` | `belize-accent` | eyebrows, highlights, focus ring |
| Accent soft | `#60a5fa` | `belize-light` | subtle accents, illuminated borders |
| Page background | `#f8fafc` / `#f1f5f9` | `slate-50` / `slate-100` | web / admin page bg |
| Surface | `#ffffff` | `white` | elevated cards |
| Muted surface | `#f1f5f9` | `slate-100` | inset panels |
| Text | `#0f172a` | `belize-navy` / `slate-900` | primary text |
| Text muted | `#64748b` | `slate-500` | secondary text |
| Border | `#e2e8f0` | `slate-200` | hairline borders |
| Success | `#059669` | `emerald-600` | positive states |
| Warning | `#d97706` | `amber-600` | caution states |
| Error | `#dc2626` | `red-600` | destructive / failed |
| Info | `#0284c7` | `sky-600` | informational |

CSS variables (`--bmpl-primary`, `--bmpl-surface`, `--bmpl-text-muted`, …) are
declared in each app's `app/globals.css` `:root` for documentation and ad-hoc
`bg-[var(--bmpl-…)]` use. Day-to-day styling uses the Tailwind `belize-*` +
`slate` utilities.

## 3. Typography

- Family: **Inter** (`--font-sans`), loaded in the root layout.
- Page title: `bmpl-page-title` → `text-2xl sm:text-3xl font-bold tracking-tight text-belize-navy`.
- Section headline (marketing): `text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight`.
- Eyebrow / label: `bmpl-eyebrow` → `text-xs font-semibold uppercase tracking-[0.22em] text-belize-accent`.
- Body: `text-sm`/`text-base text-slate-600`; muted `text-slate-500`.

## 4. Spacing rhythm

- Section padding: `py-20 sm:py-28` (marketing), `py-8`–`p-8` (app screens).
- Content container: `max-w-[1200px]` (marketing/app content) / `container-bmpl`
  (max-w-7xl) for legacy public pages; `container-admin` (max-w-6xl) for admin.
- Grid gaps: `gap-4`/`gap-5`/`gap-6`. Card padding: `p-5 sm:p-6`.

## 5. Radius scale

`rounded-bmpl-sm` 8px · `rounded-bmpl-md` 12px · `rounded-bmpl-lg` 16px ·
`rounded-bmpl-xl` 24px. Cards use `xl`; controls use `md`; chips use `full`.

## 6. Shadow (elevation) scale

`shadow-bmpl-sm` (resting cards) · `shadow-bmpl-md` (hover / popovers) ·
`shadow-bmpl-lg` (feature emphasis). All soft, low-spread, navy-tinted.

## 7. Global utility classes (`@layer components`)

`bmpl-card`, `bmpl-panel`, `bmpl-input`, `bmpl-label`, `bmpl-eyebrow`,
`bmpl-page-title` — defined in both apps' `globals.css` so raw screens stay
consistent without importing React components.

## 8. Shared components

Web: `apps/web/components/ui.tsx`. Admin: `apps/admin/components/ui.tsx`
(token-identical API; see the audit doc for the consolidation follow-up).

| Component | Purpose |
|-----------|---------|
| `Button` / `ButtonLink` | variants: `primary, accent, outline, ghost, ghostLight, destructive`; sizes `sm/md/lg`; built-in focus ring + disabled state |
| `Card` | elevated surface (`bmpl-card`) |
| `PageHeader` | eyebrow + title + description + actions row for app screens |
| `SectionHeading` | centered marketing section header (light/dark) |
| `Badge` | tones `neutral, brand, success, warning, error, info` |
| `StatusBadge` | maps a domain status string → dotted, tone-mapped badge (label always shown) |
| `Alert` | tone-mapped inline message (`role="alert"`) |
| `EmptyState` | icon + title + description + action for empty lists |
| `Skeleton` / `Spinner` | loading states |
| `Field` | label + control + hint/error wiring |
| `Input` / `Textarea` / `Select` / `Label` | themed form controls (`bmpl-input`) |

## 9. Page shells

- **Public web**: `landing/Header` (auth-aware: shows account when signed in) +
  `landing/Footer`.
- **Customer/vendor**: `dashboard/layout` → `dashboard/Sidebar` (white, grouped
  nav with active state + icons, role switcher, account footer).
- **Auth**: `auth/AuthShell` (gradient brand panel + form panel).
- **Admin**: `AdminShell` (navy sidebar, real brand logo, active-state nav with
  accent indicator + icons, sign-out).

## 10. Marketplace patterns

- Product card: square image tile (`rounded-bmpl-lg bg-slate-100`), navy name,
  muted vendor/category, bold price (sale price `belize-blue` + struck original),
  out-of-stock via badge. Subtle hover lift.
- Filters/search/sort use themed controls; empty → `EmptyState`; API failure →
  `Alert tone="warning"`.

## 11. Wallet patterns

- Balance shown on a gradient card; escrow/held funds and released transactions
  are visually distinguished; debit vs credit via sign + tone (never color alone).
- Statuses (`PENDING/AUTHORIZED/HELD/RELEASED/POSTED/VOID/FAILED`) via
  `StatusBadge`. **Read-only** — no top-up/transfer/withdraw/payout controls.

## 12. Admin patterns

- Denser than the customer app but same brand. Stat cards, branded tables
  (`bg-slate-50` header, hover rows, `overflow-x-auto`), filter chips, status
  badges. Admin wallet is a strictly read-only ledger view with a Balanced /
  Unbalanced net-zero indicator.

## 13. Accessibility rules

- WCAG AA contrast on text/controls. Visible `focus-visible` outlines
  (belize-accent). All form controls labelled; errors wired via `role="alert"`.
- Icon-only buttons carry `aria-label`. Status is never conveyed by color alone
  (dot + text). Reduced-motion respected globally (see `globals.css`).
- Minimum 40px touch targets on interactive controls.

## 14. Responsive rules

- Mobile-first; no horizontal page overflow. Tables scroll inside
  `overflow-x-auto`; grids collapse (`grid-cols-1 sm:2 lg:3+`); shells switch to
  stacked/hamburger on small screens. Verified at 360/390/768/1024/1280/1536.

## 15. Motion

Subtle only: button/card hover (`transition`, ≤`-translate-y-1`), dropdown/modal
fades. Governed by `prefers-reduced-motion`.

## 16. Known limitations

- Dark mode is **not** implemented (light-mode tokens only). The token layer is
  structured to add it later without component changes. Deliberately deferred to
  avoid shipping an incomplete dark mode.
- Shared components are currently duplicated across `apps/web` and `apps/admin`
  (token-identical). Consolidation into a compiled `@bmpl/ui` React package is
  the recommended follow-up (see `BMPL-THEME-AUDIT.md`).
