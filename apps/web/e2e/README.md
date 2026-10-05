# Browser-test gotchas (read before writing a new spec here)

Two tool facts, both discovered the expensive way during BMPL-208 (by trying
to test something, not by reasoning about it), and both worth restating
plainly: **these are false greens. Neither produces an error. A test written
the wrong way here will pass against genuinely broken code.**

That is the same failure shape this floor hit repeatedly on 2026-09-26 —
tooling that answers a question next to the one intended, and returns a PASS
either way. See root `CLAUDE.md` for the unrelated but same-shaped known-broken
CLI commands; this file is the browser-testing-specific list.

## 1. `element.click()` bypasses `inert` and real pointer hit-testing

**Wrong instrument:** `locator.click()` / `element.click()` for any assertion
of the form *"this cannot be clicked"* — `inert`, a full-viewport overlay,
`pointer-events: none`, a disabled region.

**Why it's wrong:** in real Chromium, `.click()` invokes the element's
activation behavior directly. It never goes through the pointer hit-testing
pipeline that `inert` (and overlays, and `pointer-events`) actually gate. So a
test that does `await hiddenButton.click()` and then asserts nothing happened
can pass even when `inert` is completely missing — the click still "worked" as
far as the DOM API is concerned; it just didn't have to survive hit-testing to
do it. In the case that found this, the wrong instrument didn't just give a
false pass — it opened a second, unwanted dialog and corrupted the rest of the
walk.

**Right instrument:** a real pointer click at screen coordinates —
`page.mouse.click(x, y)`, computed from the target's bounding box. Only a
genuine pointer event goes through hit-testing, so only it can actually prove
`inert` (or an overlay, or `pointer-events`) is doing its job.

**Working example:** `dialog-focus-trap.spec.ts:109-116` and `:180-185` — get
the element's `boundingBox()`, click its center with `page.mouse`, then assert
focus (or state) didn't change, rather than asserting the click "failed."

## 2. A free focus reset to `<body>` masks a missing fallback fix

**Wrong assertion:** open a dialog, let it focus something inside its own
content as usual, unmount the element that opened it (its "opener") while the
dialog stays open, close the dialog, then assert focus ends up on `<body>`.

**Why it's wrong:** closing the dialog unmounts the dialog's *own* content too
— including whatever was focused inside it. Removing the currently-focused
element resets focus to `<body>` for free, in both jsdom and real browsers,
with no help from any application code. So "focus is on `<body>` after close"
comes true regardless of whether the hook's own opener-disconnected fallback
logic ran at all — this exact sequence passes with **zero** fallback code
present.

**Right assertion:** before closing, deliberately move focus to a
**different, unrelated, still-connected element outside the dialog's own
content** (not the opener, not anything inside the dialog) once the opener is
gone. Now closing the dialog only unmounts content that does *not* include
the currently-focused element, so the browser's free "focused node removed"
reset cannot fire on its own. If focus still lands on `<body>` after close,
that can only be the hook's own explicit fallback actually running — not an
accident of the DOM.

**Working example:** `apps/web/lib/use-dialog-focus-trap.test.tsx:136-160`,
`"falls back to <body> instead of leaving focus wherever it drifted, when the
opener is unmounted before the dialog closes"` — focuses `#page-button`
(outside the dialog, still connected) before closing, with the isolation
reasoning stated inline at the point it matters. This one is jsdom, not
Playwright: `dialog-focus-trap.spec.ts` deliberately does not re-prove this
fallback in a real browser, since it's ordinary DOM-connectivity logic, not a
real-`inert`/real-hit-testing question — see that file's own scope note.

## Already documented once, deliberately not duplicated in source

Both facts are also stated inline as a doc comment at the top of
`dialog-focus-trap.spec.ts` (the file they were discovered writing), scoped to
that file's own tests. This README exists so the same two facts reach anyone
writing a *different* browser test in this directory — a new spec for an
overlay, a disabled control, a different focus trap — who would have no
reason to open that specific dialog spec first.

## 3. Running the browser suite locally (recipe)

Verified on Windows, 2026-10-05, in a scratch worktree of `origin/main`:

1. `pnpm install --frozen-lockfile` (frozen, so no dependency drift).
2. `pnpm --filter @bmpl/shared build`. The web app imports the built shared package and fails to resolve it otherwise.
3. `pnpm exec playwright install chromium` once per machine.
4. Set `NEXT_PUBLIC_API_URL=http://localhost:4000`. The dev server refuses to start without it (see `docs/ENVIRONMENT.md`).
5. `pnpm --filter @bmpl/web test:e2e e2e/<spec>.spec.ts`. Pass the spec path without a `--` separator.

Do not click a control to move the page to a known scroll position. Playwright scrolls to bring the target into view, so the page can move before the assertion runs. Use a real `page.mouse.wheel` from a known position instead.

When red-proving a fix, revert one change in a scratch copy, run the spec, check it goes red, then restore. Record the measured numbers (for example a panel height) in the PR, not just the test name.
