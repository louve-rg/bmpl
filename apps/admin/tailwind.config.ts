import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
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
      backgroundImage: {
        'belize-hero': 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #3b82f6 100%)',
        'belize-accent': 'linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)',
      },
      borderRadius: {
        'bmpl-sm': '8px',
        'bmpl-md': '12px',
        'bmpl-lg': '16px',
        'bmpl-xl': '24px',
      },
      boxShadow: {
        'bmpl-sm': '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
        'bmpl-md': '0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 30px -18px rgba(15, 23, 42, 0.18)',
        'bmpl-lg': '0 1px 2px rgba(15, 23, 42, 0.06), 0 28px 50px -24px rgba(30, 64, 175, 0.28)',
      },
    },
  },
  plugins: [],
};

export default config;
