import * as Sentry from '@sentry/node';
import type { Env } from '../config/env';

/**
 * Initialize Sentry ONLY when a DSN is configured. Without a DSN this is a
 * complete no-op, so nothing is sent in local/dev/CI unless explicitly enabled.
 * Sensitive fields (cookies, auth headers, tokens) are scrubbed before send.
 */
export function initSentry(env: Env): boolean {
  if (!env.SENTRY_DSN) return false;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: `bmpl-api@${env.APP_VERSION}`,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data) crumb.data = scrubObject(crumb.data);
      return crumb;
    },
  });
  return true;
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
]);
const SENSITIVE_KEY = /(password|token|secret|authorization|cookie|signature|x-amz)/i;

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : v;
  }
  return out;
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    if (event.request.headers) {
      for (const h of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADERS.has(h.toLowerCase())) event.request.headers[h] = '[redacted]';
      }
    }
    delete event.request.cookies;
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = event.request.query_string.replace(
        /(token|signature|X-Amz-[^=]+)=[^&]+/gi,
        '$1=[redacted]',
      );
    }
    if (event.request.data && typeof event.request.data === 'object') {
      event.request.data = scrubObject(event.request.data as Record<string, unknown>);
    }
  }
  return event;
}

export function captureException(err: unknown): void {
  Sentry.captureException(err);
}
