import type { ExpoConfig } from 'expo/config';
import base from './app.json';

/**
 * Env-driven Expo config. The API URL comes from EXPO_PUBLIC_API_URL, which each
 * EAS build profile (development/preview/production) sets in eas.json. Secrets
 * are never embedded — only the public API URL and the EAS project id.
 */
export default (): ExpoConfig => ({
  ...(base.expo as ExpoConfig),
  extra: {
    ...(base.expo.extra ?? {}),
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? base.expo.extra?.apiUrl ?? 'http://localhost:4000',
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '' },
  },
});
