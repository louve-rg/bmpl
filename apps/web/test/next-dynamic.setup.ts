import { createElement, useEffect, useState, type ComponentType } from 'react';
import { vi } from 'vitest';

/**
 * BMPL-380. `next/dynamic` depends on Next's own bundler/webpack chunk-
 * loading machinery to resolve its lazy import — machinery that simply
 * isn't present when Vite/Vitest transforms the module. Under the real
 * `next/dynamic`, the returned component's internal loader promise never
 * settles in this harness, so a component never renders and a test that
 * mounts it hangs forever (not a thrown error — nothing to catch, nothing
 * to mock-and-move-on from). Traced and proved during BMPL-350: a plain
 * `import('leaflet')` inside a `useEffect` (ExpandableRouteMap/
 * LocationPicker's own pattern) resolves fine under Vitest; wrapping that
 * exact same work in `next/dynamic()` (AddressField's LocationPicker) is
 * what hangs. The two use the same library — the difference is entirely
 * `next/dynamic` itself, not leaflet or dynamic import in general.
 *
 * This replaces `next/dynamic` globally, for every test file, with a
 * minimal stand-in that does what `next/dynamic` promises a caller without
 * depending on anything Next-bundler-specific: call the loader, render
 * `options.loading()` (if given) until it resolves, then render the real
 * component. `ssr` is ignored — there is no server render pass in this
 * harness, so "client only" is simply what always happens.
 *
 * A component wrapped in `dynamic()` now mounts like any other component;
 * callers do not need their own per-file mock for it, and do not need to
 * know this exists until a `dynamic()`-wrapped component still won't
 * mount — in which case the actual lazy-loaded module (leaflet, a chart
 * library, whatever it wraps) needs its own mock, the same way
 * LocationPicker.test.tsx mocks `leaflet` itself.
 */
vi.mock('next/dynamic', () => ({
  default: <P extends object>(
    loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
    options?: { loading?: () => React.ReactElement | null },
  ) => {
    function NextDynamicStub(props: P) {
      const [Loaded, setLoaded] = useState<ComponentType<P> | null>(null);
      useEffect(() => {
        let active = true;
        loader().then((mod) => {
          if (!active) return;
          const Component = ('default' in mod ? mod.default : mod) as ComponentType<P>;
          setLoaded(() => Component);
        });
        return () => {
          active = false;
        };
      }, []);
      if (!Loaded) return options?.loading ? options.loading() : null;
      return createElement(Loaded, props);
    }
    return NextDynamicStub;
  },
}));
