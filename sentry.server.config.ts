// Sentry server SDK — errors only (see client config for the why).
// beforeSend drops known-transient upstream noise so a provider
// incident can't burn the monthly cap: the moderation pipeline calls
// OpenAI on every submission (topics/comments/events/announcements/
// recommendations/listings), so OpenAI rate-limits fan out fast.
import * as Sentry from '@sentry/astro';
import { scrubRequest, scrubBreadcrumb } from './src/lib/sentry/scrubUrl';

const TRANSIENT_PATTERNS = [
  /429|rate.?limit/i,        // OpenAI (and any upstream) rate limits
  /AbortError/,              // request cancellation, incl. our own 5s timeouts
  /MongoNetworkError.*timed out/i, // transient Mongo connection blips
];

Sentry.init({
  dsn: import.meta.env.SENTRY_DSN,
  // VERCEL_ENV distinguishes production/preview/development at runtime
  // (serverless Node); MODE alone is always 'production' in any build.
  // Runtime process.env read is deliberate here — this executes
  // server-side only.
  environment: process.env.VERCEL_ENV || import.meta.env.MODE,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend(event, hint) {
    // Local dev (pnpm dev) keeps SENTRY_DSN active for diagnostics, so its
    // server-side errors — including unhandled rejections from throwaway
    // worktree dev servers — otherwise land on the prod board and burn the
    // monthly cap. Drop them. Preview + production still report (preview is
    // where the silent-degradation tripwires legitimately fire).
    if (event.environment === 'development') return null;
    const msg = `${event.exception?.values?.[0]?.type ?? ''} ${event.exception?.values?.[0]?.value ?? ''} ${String((hint?.originalException as Error | undefined)?.message ?? '')}`;
    if (TRANSIENT_PATTERNS.some((re) => re.test(msg))) return null;
    // Never ship a query string or the Referer: the token pages (/reset-password, /verify-email,
    // /confirm-email-change, /widerrufen) carry single-use tokens there (2026-10-31, twin of the
    // client config's scrub).
    if (event.request) event.request = scrubRequest(event.request);
    if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
    return event;
  },
  // The SDK's outgoing-fetch instrumentation records request URLs as
  // breadcrumbs (path kept by getSanitizedUrlString). The admin-alerts
  // Telegram send hits api.telegram.org/bot<TOKEN>/sendMessage, so an
  // unredacted breadcrumb would ship the bot token to Sentry — and the
  // alert module's own captureMessage fires right after a non-2xx TG
  // response, attaching that breadcrumb. Redact the token before it lands.
  beforeBreadcrumb(breadcrumb) {
    const url = breadcrumb.data?.url;
    if (typeof url === 'string' && url.includes('api.telegram.org')) {
      breadcrumb.data!.url = url.replace(/\/bot[^/]+\//, '/bot[REDACTED]/');
    }
    return breadcrumb;
  },
});
