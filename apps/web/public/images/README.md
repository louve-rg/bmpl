# Web public images

## `hero-port.jpg` — landing hero background (REQUIRED)

The landing hero (`components/landing/Hero.tsx`) loads its background from
`/images/hero-port.jpg` via `next/image`.

Place the **supplied** hero background image (the cargo ship / port / water photo
with the large circular "Belize Marketplace and Logistics 50" logo baked in) at:

```
apps/web/public/images/hero-port.jpg
```

Notes:
- Use the supplied asset **exactly** — do not regenerate, redraw, or recolor it.
  The large circular logo is already part of this image; the hero deliberately
  does **not** overlay a second logo.
- Recommended: keep it as a reasonably optimized JPEG (~1820×920, quality ~80,
  under ~400 KB). `next/image` optimizes and serves responsive variants at
  runtime; the source should stay high-enough resolution for large desktops.
- Until this file is present the hero falls back to a solid navy background, so
  the build and layout stay intact.

## `logo.png` — brand logo badge (REQUIRED)

`components/Logo.tsx` renders the brand badge from `/images/logo.png`, clipped to
a circle (the square corners of the source canvas are masked off). Place the
official circular "Belize Marketplace and Logistics 50" logo at:

```
apps/web/public/images/logo.png
```

Notes:
- A square PNG works fine — it is clipped to a circle at render time, so the
  square/white corners never show. A transparent-background square is ideal.
- Used in the header, footer, auth screens, and dashboard sidebar (all on dark
  backgrounds). Until present, a navy circle placeholder shows.
