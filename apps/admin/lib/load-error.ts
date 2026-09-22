import type { ApiError } from './api';

/**
 * The one sentence a failed client-side load shows — BMPL-144.
 *
 * Seven list screens used try/finally with no catch, so a refusal (or any
 * failure) left an empty table and an unhandled rejection — "no users
 * exist" as a lie of omission. The house pattern (logistics, dispatch,
 * reviews…) is to render the server's own sentence in an Alert; this is
 * that pattern's message half, stated once: the API's message verbatim
 * when it sent one, otherwise a plain fallback naming what failed to load.
 */
export function loadErrorMessage(e: unknown, what: string): string {
  const message = (e as ApiError | null)?.message;
  return message && message.trim() !== '' ? message : `Could not load ${what}.`;
}
