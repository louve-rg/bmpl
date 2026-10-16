import type { Config } from 'tailwindcss';
import bmplPreset from '@bmpl/ui/tailwind-preset';

/**
 * Brand palette mirrors the existing Belize Marketplace identity so the new
 * site reads as a polished evolution, not an unrelated redesign.
 *
 * Theme (colors/radius/shadow/font) now comes from the shared
 * `@bmpl/ui` preset -- the single definition apps/web and apps/admin both
 * extend, instead of two hand-copied blocks that had already drifted
 * (admin's own config was missing `glow` and `fontFamily.sans` entirely).
 *
 * `@bmpl/ui/tailwind-preset` is published via TypeScript `export =`, not
 * `export default` -- see that file's own comment for why: a real
 * production build loads this config through Tailwind's `jiti`-based
 * loader, which carried an unwanted `{ default: ... }` wrapper from a
 * plain `export default` straight into `presets`, silently emptying it
 * (every custom utility this preset defines, `rounded-bmpl-xl` included,
 * failed to exist) in a way `next dev` never surfaced. `export =` removes
 * the ambiguity at the source instead of unwrapping it here.
 */
const config: Config = {
  presets: [bmplPreset as Config],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  plugins: [],
};

export default config;
