/**
 * Astro's built-in cross-site form check (`security.checkOrigin`), re-implemented so ONE route can
 * be exempt: the RFC 8058 one-click unsubscribe endpoint, which Gmail/Yahoo POST to as
 * `application/x-www-form-urlencoded` from their own servers — no Origin header, by design.
 * Everything else keeps the same rule Astro applied: a non-safe method with a form-like (or
 * missing) content type and an Origin that is not ours is refused with 403. Pure, tested.
 */
const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/** Paths that may receive cross-site form POSTs (exact match). */
export const CROSS_SITE_FORM_EXEMPT = ['/api/newsletter/unsubscribe'] as const;

export function isCrossSiteForm(input: {
  method: string;
  pathname: string;
  origin: string | null; // the request's Origin header
  contentType: string | null;
  siteOrigin: string; // url.origin of the request
}): boolean {
  if (SAFE_METHODS.includes(input.method.toUpperCase())) return false;
  if ((CROSS_SITE_FORM_EXEMPT as readonly string[]).includes(input.pathname)) return false;
  const sameOrigin = input.origin === input.siteOrigin;
  if (sameOrigin) return false;
  if (input.contentType === null) return true; // Astro: no content type + foreign origin → refused
  const ct = input.contentType.toLowerCase();
  return FORM_CONTENT_TYPES.some((t) => ct.includes(t));
}
