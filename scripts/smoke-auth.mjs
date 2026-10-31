#!/usr/bin/env node
// Auth smoke probe — fifteen requests against a running Mahalle, compared with fixed expectations.
//
// Born from the 2026-10-27 → 10-31 outage: a middleware 404 swallowed every own `/api/auth/*`
// route (register, password reset, e-mail confirmation …) for three days and nothing reported
// it — a 404 is no exception (Sentry empty), no handler ran (no DB write, no Telegram ping).
// Only a request from OUTSIDE sees that class of failure. `.github/workflows/smoke-auth.yml`
// runs this every 30 minutes against prod and pings the admin's Telegram when it fails twice.
//
// Writes nothing: empty-body POSTs are refused by validation BEFORE any rate-limit charge
// (verified 2026-10-31 in register.ts / forgot-password.ts), the rest refuse at the session gate.
//
// Local:   node scripts/smoke-auth.mjs http://127.0.0.1:4655      (the local prod build)
// Prod:    node scripts/smoke-auth.mjs https://mahalle.digital
// Exit 0 = every check OK, 1 = at least one FAIL, 2 = usage. No dependencies — Node ≥ 18.
import { pathToFileURL } from 'node:url';

// Every one of the app's OWN /api/auth/* routes (all nine were dead 10-27 → 10-31), the two
// Auth.js reads, the two public pages, the member-API gate, and the unknown-action 404.
// The expected statuses were read on the local prod build 2026-10-31 01:22 (POST `{}` to every
// own route); re-read them there whenever a route changes its empty-body answer.
// `src/lib/smoke/authSmoke.test.ts` fails when a file in src/pages/api/auth/ has no row here.
export const CHECKS = [
  { name: 'landing',             method: 'GET',  path: '/',                             expect: 200 },
  { name: 'login page',          method: 'GET',  path: '/login',                        expect: 200 },
  { name: 'auth session',        method: 'GET',  path: '/api/auth/session',             expect: 200, json: true },
  { name: 'auth csrf',           method: 'GET',  path: '/api/auth/csrf',                expect: 200, json: true },
  { name: 'register validates',  method: 'POST', path: '/api/auth/register',            expect: 400, json: true, body: {} },
  { name: 'forgot-password',     method: 'POST', path: '/api/auth/forgot-password',     expect: 200, json: true, body: {} },
  { name: 'reset-password',      method: 'POST', path: '/api/auth/reset-password',      expect: 400, json: true, body: {} },
  { name: 'verify-email',        method: 'POST', path: '/api/auth/verify-email',        expect: 400, json: true, body: {} },
  { name: 'login-status',        method: 'POST', path: '/api/auth/login-status',        expect: 200, json: true, body: {} },
  { name: 'cancel-deletion',     method: 'POST', path: '/api/auth/cancel-deletion',     expect: 400, json: true, body: {} },
  { name: 'resend-verification', method: 'POST', path: '/api/auth/resend-verification', expect: 401, json: true, body: {} },
  { name: 'verification-status', method: 'GET',  path: '/api/auth/verification-status', expect: 401, json: true },
  { name: 'account-status',      method: 'GET',  path: '/api/auth/account-status',      expect: 401, json: true },
  { name: 'member API gated',    method: 'GET',  path: '/api/topics',                   expect: 401, json: true },
  { name: 'unknown auth → 404',  method: 'GET',  path: '/api/auth/smoke-unknown',       expect: 404 },
];

const TIMEOUT_MS = 15_000;

/**
 * Compare one response with its check.
 * @param {{ expect: number, json?: boolean }} check
 * @param {{ status?: number, bodyText?: string, error?: string }} got
 * @returns {{ ok: boolean, detail: string }}
 */
export function judge(check, got) {
  if (got.error) return { ok: false, detail: `request failed: ${got.error}` };
  if (got.status !== check.expect) return { ok: false, detail: `expected ${check.expect}, got ${got.status}` };
  if (check.json) {
    try {
      JSON.parse(got.bodyText ?? '');
    } catch {
      return { ok: false, detail: `expected JSON body, got ${describeBody(got.bodyText)}` };
    }
  }
  return { ok: true, detail: String(got.status) };
}

function describeBody(text) {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t ? JSON.stringify(t.slice(0, 60)) : 'an empty body';
}

/**
 * Run every check against `base`. Never throws; one line per check.
 * @param {string} base e.g. https://mahalle.digital
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: boolean, lines: string[] }>}
 */
export async function runSmoke(base, fetchImpl = fetch) {
  const origin = base.replace(/\/+$/, '');
  const lines = [];
  let ok = true;
  for (const check of CHECKS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    /** @type {{ status?: number, bodyText?: string, error?: string }} */
    let got;
    try {
      const init = {
        method: check.method,
        headers: check.body !== undefined
          ? { 'Content-Type': 'application/json', Origin: origin, Accept: 'application/json' }
          : { Accept: check.json ? 'application/json' : 'text/html,application/json' },
        body: check.body !== undefined ? JSON.stringify(check.body) : undefined,
        // A redirect (e.g. the old *.vercel.app host's 308) is a failure to report, never followed.
        redirect: 'manual',
        signal: ctrl.signal,
      };
      const res = await fetchImpl(origin + check.path, init);
      got = { status: res.status, bodyText: await res.text() };
    } catch (e) {
      got = { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    } finally {
      clearTimeout(timer);
    }
    const verdict = judge(check, got);
    if (!verdict.ok) ok = false;
    lines.push(verdict.ok ? `OK   ${check.name} (${verdict.detail})` : `FAIL ${check.name}: ${check.method} ${check.path} — ${verdict.detail}`);
  }
  return { ok, lines };
}

const runDirectly = typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  const base = process.argv[2];
  if (!base || !/^https?:\/\//.test(base)) {
    console.error('usage: node scripts/smoke-auth.mjs <base-url>   e.g. https://mahalle.digital');
    process.exit(2);
  }
  const result = await runSmoke(base);
  for (const line of result.lines) console.log(line);
  console.log(result.ok ? `all ${CHECKS.length} checks OK — ${base}` : `${result.lines.filter((l) => l.startsWith('FAIL')).length} of ${CHECKS.length} checks FAILED — ${base}`);
  process.exit(result.ok ? 0 : 1);
}
