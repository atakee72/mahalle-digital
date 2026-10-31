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
