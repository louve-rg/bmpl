import type { Config } from 'tailwindcss';

/**
 * Shared Tailwind preset for apps/web and apps/admin. Dwight's inventory
 * found the two apps' tailwind.config.ts had already drifted (admin was
 * missing web's `glow` shadow token and `fontFamily.sans` entirely) --
 * both configs now do `presets: [bmplTailwindPreset]` instead of
 * hand-copying this block, so there is exactly one definition of it.
 */
const bmplTailwindPreset: Pick<Config, 'theme'> = {
  theme: {
    extend: {
      colors: {
        belize: {
          blue: '#1e40af',
          deep: '#1e3a8a',
          card: '#3b82f6',
          light: '#60a5fa',
          accent: '#0ea5e9',
          navy: '#0f172a',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'belize-hero': 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #3b82f6 100%)',
        'belize-accent': 'linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)',
      },
      // BML radius scale (source of truth: landing cards use 16-24px).
      borderRadius: {
        'bmpl-sm': '8px',
        'bmpl-md': '12px',
        'bmpl-lg': '16px',
        'bmpl-xl': '24px',
      },
      // BML elevation scale -- soft, premium, low-spread shadows.
      boxShadow: {
        glow: '0 0 24px rgba(96, 165, 250, 0.35)',
        'bmpl-sm': '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
        'bmpl-md': '0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 30px -18px rgba(15, 23, 42, 0.18)',
        'bmpl-lg': '0 1px 2px rgba(15, 23, 42, 0.06), 0 28px 50px -24px rgba(30, 64, 175, 0.28)',
        // Liquid Glass elevation -- a soft colored lift so a floating glass
        // surface reads as an object above the page, not a flat cutout.
        'glass-sm': '0 8px 24px -12px rgba(2, 8, 20, 0.55), 0 0 20px rgba(96, 165, 250, 0.14)',
        glass: '0 18px 50px -20px rgba(2, 8, 20, 0.65), 0 2px 10px -4px rgba(2, 8, 20, 0.4), 0 0 32px rgba(96, 165, 250, 0.22)',
      },
    },
  },
};

export default bmplTailwindPreset;
