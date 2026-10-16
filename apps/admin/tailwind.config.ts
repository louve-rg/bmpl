import type { Config } from 'tailwindcss';
import bmplPreset from '@bmpl/ui/tailwind-preset';

/**
 * Theme comes from the shared `@bmpl/ui` preset -- see apps/web's
 * tailwind.config.ts for why (one definition instead of two that drift).
 */
const config: Config = {
  presets: [bmplPreset as Config],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  plugins: [],
};

export default config;
