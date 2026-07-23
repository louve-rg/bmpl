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
      },
    },
  },
  plugins: [],
};

export default config;
