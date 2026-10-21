// jsdom (the DOM environment opted into per-file via `@vitest-environment
// jsdom`) implements no `ResizeObserver` -- any component that constructs one
// at mount (StickyActionBar, MDF-376) throws in every test that renders it.
// Real browsers all have ResizeObserver; this stub exists for the test
// environment only, same convention as the per-file `window.matchMedia`
// stubs elsewhere in this app (e.g. app/checkout/page.test.tsx).
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
