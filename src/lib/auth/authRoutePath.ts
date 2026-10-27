// Mirror of auth-astro's own gate (node_modules/auth-astro/server.ts, `AstroAuthHandler`):
// its catch-all route answers only when the path is `<prefix>/<action>[/…]` with a known
// Auth.js action — for anything else it returns `undefined`, which Astro turns into a 500
// (`EndpointDidNotReturnAResponse`, Sentry MAHALLE-PROD-X, a scanner on the demo host 2026-10-27).
// The middleware answers such paths with a 404 before the route runs. Dependency-pure, tested.

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

/** True for a request under the Auth.js prefix that auth-astro would NOT answer. */
export function isUnknownAuthPath(pathname: string): boolean {
  if (pathname !== AUTH_ROUTE_PREFIX && !pathname.startsWith(AUTH_ROUTE_PREFIX + '/')) return false;
  if (!pathname.startsWith(AUTH_ROUTE_PREFIX + '/')) return true; // bare `/api/auth`
  const action = pathname.slice(AUTH_ROUTE_PREFIX.length + 1).split('/')[0];
  return !(AUTH_ACTIONS as readonly string[]).includes(action);
}
