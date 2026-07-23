/// <reference types="expo/types" />

/**
 * Expo inlines `process.env.EXPO_PUBLIC_*` values at build time via a Babel
 * transform, so the literal reference must remain in source. This ambient
 * declaration types it without importing the full Node type surface into RN.
 */
declare const process: {
  env: Record<string, string | undefined>;
};
