export * from './roles';
export * from './districts';
export * from './permissions';
export * from './audit';
export * from './notifications';
export * from './wallet';
export * from './user';
export * from './storage';
export * from './marketplace';
export * from './payments';
export * from './settlement';
export * from './reviews';
export * from './driver';
export * from './dispatch';
export * from './messaging';
export * from './engagement';
export * from './slug';

/** Shared, framework-agnostic branding tokens (mirrored in the UI package). */
export const BRAND = {
  name: 'Belize Marketplace & Logistics',
  shortName: 'Belize Marketplace',
  tagline: 'Your Complete Commerce Solution',
  colors: {
    blue: '#1e40af',
    deep: '#1e3a8a',
    card: '#3b82f6',
    light: '#60a5fa',
    accent: '#0ea5e9',
    navy: '#0f172a',
  },
} as const;
