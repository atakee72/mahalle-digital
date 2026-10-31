// Drop the query string and fragment from a URL before it reaches Sentry. Pure, tested.
//
// Four pages carry SINGLE-USE tokens in their query (`/reset-password?token=`,
// `/verify-email?token=`, `/confirm-email-change?token=`, `/widerrufen?token=`), `/login`
// carries the redirect target and `/search` the query. The browser SDK stamps
// `event.request.url = location.href` on every event — found 2026-10-31 when the auth-form
// sensor (`reportUnexpectedAuth`) started reporting from the reset page. `sentry.client.config.ts`
// applies this in `beforeSend`; the path alone is all a defect report needs.
export function scrubUrl(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

// Shapes kept loose on purpose: Sentry's `Breadcrumb` / `RequestEventData` are interfaces (no
// implicit index signature), so the constraints name only the keys touched here.
const BREADCRUMB_URL_KEYS = ['url', 'from', 'to'] as const;

/** Navigation (`from`/`to`) and fetch/xhr (`url`) breadcrumbs keep the path only. */
export function scrubBreadcrumb<B extends { data?: Record<string, any> }>(b: B): B {
  if (!b.data) return b;
  const data: Record<string, any> = { ...b.data };
  for (const k of BREADCRUMB_URL_KEYS) if (typeof data[k] === 'string') data[k] = scrubUrl(data[k]);
  return { ...b, data };
}

/** Server events: url without query, no `query_string`, no `Referer` (it carries the previous page's query). */
export function scrubRequest<R extends { url?: string; query_string?: unknown; headers?: Record<string, string> } | undefined>(req: R): R {
  if (!req) return req;
  const { query_string: _q, headers, ...rest } = req;
  const out: Record<string, any> = { ...rest };
  if (typeof out.url === 'string') out.url = scrubUrl(out.url);
  if (headers) {
    const kept = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'referer'));
    if (Object.keys(kept).length) out.headers = kept;
  }
  return out as R;
}
