// SERVER-ONLY. Read-only demo deployment switch (spec 2026-10-26, §7.1).
//
// - DEMO_MODE is read at CALL time from process.env (run-time on Vercel; the probe
//   sets it on the server command).
// - The database name comes from import.meta.env.MONGODB_URI — the same value connectDB()
//   uses, so this check can never disagree with the database in use. (In the server bundle
//   that compiles to a run-time process.env read, verified 2026-10-26 — so a local probe sets
//   the URI on the SERVER command, and Vercel's branch-scoped var applies at request time.)
// Without DEMO_MODE=1 AND a dev-named database the whole demo layer is inert (fail closed).
import { dbNameFromUri, isDemoEnabled, DEMO_REFUSAL_BODY } from './demoRules';

export function isDemoDeployment(): boolean {
  return isDemoEnabled({
    demoMode: process.env.DEMO_MODE,
    dbName: dbNameFromUri(import.meta.env.MONGODB_URI),
  });
}

/** A blocked READ (today only the Sentry proxy) answers the route's own "off" shape, so the
 *  admin errors card shows its calm „nicht verfügbar" state instead of a warning-toned
 *  „nicht erreichbar" that a 403 would trigger. The route carries the same lock itself. */
export function demoBlockedRead(): Response {
  return new Response(JSON.stringify({ enabled: false, demo: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function demoRefusal(pathname: string): Response {
  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify(DEMO_REFUSAL_BODY), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  return new Response('Demo: read-only', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
