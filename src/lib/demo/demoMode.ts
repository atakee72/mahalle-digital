// SERVER-ONLY. Read-only demo deployment switch (spec 2026-10-26, §7.1).
//
// - DEMO_MODE is read at CALL time from process.env (run-time on Vercel; the probe
//   sets it on the server command).
// - The database name comes from import.meta.env.MONGODB_URI — the same inlined value
//   connectDB() uses, so this check can never disagree with the database in use.
// Without DEMO_MODE=1 AND a dev-named database the whole demo layer is inert (fail closed).
import { dbNameFromUri, isDemoEnabled, DEMO_REFUSAL_BODY } from './demoRules';

export function isDemoDeployment(): boolean {
  return isDemoEnabled({
    demoMode: process.env.DEMO_MODE,
    dbName: dbNameFromUri(import.meta.env.MONGODB_URI),
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
