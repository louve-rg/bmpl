import type { Config } from 'tailwindcss';

/**
 * Brand palette mirrors the existing Belize Marketplace identity so the new
 * site reads as a polished evolution, not an unrelated redesign.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
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
      boxShadow: {
        glow: '0 0 24px rgba(96, 165, 250, 0.35)',
      },
    },
  },
  plugins: [],
};

export default config;
