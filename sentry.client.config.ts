// Sentry browser SDK — errors only. Tracing and session replay are
// deliberately OFF (5k errors/mo free cap is the whole budget) and
// sendDefaultPii false suppresses IP + cookies (GDPR; EU-region org).
// With SENTRY_DSN unset, init is a documented no-op — the app runs
// with monitoring disabled until env vars land.
import * as Sentry from '@sentry/astro';
import { isClientNoise } from './src/lib/sentry/clientNoise';

Sentry.init({
  // PUBLIC_ prefix REQUIRED: Astro only exposes PUBLIC_*-prefixed env vars
  // to the client bundle — a bare SENTRY_DSN statically inlines to
  // undefined in the browser and client capture never works. The DSN is
  // a public ingest identifier, safe to expose. NEVER "fix" this with a
  // custom envPrefix covering SENTRY_ — that would leak SENTRY_AUTH_TOKEN
  // into the client bundle.
  dsn: import.meta.env.PUBLIC_SENTRY_DSN,
  // Client bundles inline at build time and Vercel does not auto-expose
  // a PUBLIC_-prefixed env name. Optionally set PUBLIC_VERCEL_ENV per
  // Vercel environment scope (production/preview) for accurate
  // client-event tagging; falls back to MODE (always 'production' in
  // builds) otherwise.
  environment: import.meta.env.PUBLIC_VERCEL_ENV || import.meta.env.MODE,
  tracesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,
  // Drop browser noise that can never point at a defect (cancelled view
  // transitions, React's hydrate-fallback notice, ClientRouter's null read on
  // a page that was open during a deploy) — they reopened issues and pinged
  // the admin after every deploy / backgrounded tab. Rules, reasons and the
  // exact strings: src/lib/sentry/clientNoise.ts (unit-tested). Twin of the
  // server config's TRANSIENT_PATTERNS.
  beforeSend(event) {
    const ex = event.exception?.values?.[0];
    const files = (ex?.stacktrace?.frames ?? []).map((f) => f.filename ?? '');
    return isClientNoise(ex?.type, ex?.value, files) ? null : event;
  },
});
