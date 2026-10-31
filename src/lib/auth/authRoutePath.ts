// Mirror of auth-astro's own gate (node_modules/auth-astro/server.ts, `AstroAuthHandler`):
// its catch-all route answers only when the path is `<prefix>/<action>[/…]` with a known
// Auth.js action — for anything else it returns `undefined`, which Astro turns into a 500
// (`EndpointDidNotReturnAResponse`, Sentry MAHALLE-PROD-X, a scanner on the demo host 2026-10-27).
// The middleware answers such paths with a 404 before the route runs. Dependency-pure, tested.
//
// REGRESSION 2026-10-27 … 10-31 (fixed `shouldAnswerAuth404`): the path test alone also matched the
// project's OWN routes under the same prefix — `/api/auth/register`, `forgot-password`,
// `verify-email`, `verification-status`, … — and the middleware answered them with 404 for three
// days: nobody could register, reset a password or confirm an address, and nothing reached Sentry
// (a 404 is not an exception). The gate therefore also needs Astro's matched route: only a request
// that Astro routed to auth-astro's catch-all (`/api/auth/[...auth]`) can be one auth-astro would
// not answer; a request routed to one of our own files is never touched.

export const AUTH_ROUTE_PREFIX = '/api/auth';

export const AUTH_ACTIONS = [
  'providers',
  'session',
  'csrf',
  'signin',
  'signout',
  'callback',
  'verify-request',
  'error',
] as const;

/** The route pattern auth-astro injects (`${prefix}/[...auth]`, node_modules/auth-astro/src/integration.ts). */
export const AUTH_CATCHALL_PATTERN = AUTH_ROUTE_PREFIX + '/[...auth]';

/**
 * True when the middleware should answer 404: Astro routed the request to auth-astro's catch-all
 * (so none of our own `/api/auth/*` files matched) AND the action is not one auth-astro knows.
 * `routePattern` is `context.routePattern` (Astro ≥ 5.0).
 */
export function shouldAnswerAuth404(routePattern: string | undefined, pathname: string): boolean {
  return routePattern === AUTH_CATCHALL_PATTERN && isUnknownAuthPath(pathname);
}

/** True for a path under the Auth.js prefix whose first segment is not an Auth.js action (path test only). */
export function isUnknownAuthPath(pathname: string): boolean {
  if (pathname !== AUTH_ROUTE_PREFIX && !pathname.startsWith(AUTH_ROUTE_PREFIX + '/')) return false;
  if (!pathname.startsWith(AUTH_ROUTE_PREFIX + '/')) return true; // bare `/api/auth`
  const action = pathname.slice(AUTH_ROUTE_PREFIX.length + 1).split('/')[0];
  return !(AUTH_ACTIONS as readonly string[]).includes(action);
}
