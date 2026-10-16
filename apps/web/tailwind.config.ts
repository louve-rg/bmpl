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
