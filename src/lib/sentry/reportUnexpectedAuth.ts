// Client-side sensor for the auth forms (register, login, forgot, reset): when the server's
// answer is one the form cannot understand — 404, 5xx, HTML instead of JSON, a failed request
// while online — report it to Sentry as ONE static message. Rules: `src/lib/auth/unexpectedResponse.ts`.
//
// Why a static message: Sentry groups messages by text, so every person who hits the same dead
// route lands in ONE issue (route and status ride in tags/extra), and the existing „new issue"
// alert → Telegram bridge pings the admin once. The client `beforeSend` noise filter inspects
// `event.exception` only, so a message passes it. With `PUBLIC_SENTRY_DSN` unset (dev, preview)
// the SDK is a no-op and this is too. Never throws.
//
// `@sentry/astro` resolves to its browser build in client bundles (package.json `browser`
// export) — the same module `sentry.client.config.ts` already initialises, one shared chunk.
import * as Sentry from '@sentry/astro';
import { isUnexpectedAuthResponse } from '../auth/unexpectedResponse';

export const UNEXPECTED_AUTH_MESSAGE = 'auth form: unexpected server response';

export function reportUnexpectedAuth(route: string, res: Response | null, err?: unknown): void {
  try {
    const status = res?.status ?? 0;
    const contentType = res?.headers?.get('content-type') ?? null;
    const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    if (!isUnexpectedAuthResponse({ status, contentType, online })) return;
    Sentry.captureMessage(UNEXPECTED_AUTH_MESSAGE, {
      level: 'error',
      tags: { route },
      extra: { status, contentType, error: err instanceof Error ? `${err.name}: ${err.message}` : err !== undefined ? String(err) : undefined },
    });
  } catch {
    /* a sensor never breaks the form */
  }
}
