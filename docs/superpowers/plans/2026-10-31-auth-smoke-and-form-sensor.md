# Auth Smoke Probe + Form Sensor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner is told on Telegram, normally within the hour, when any of the app's own `/api/auth/*` routes or the member-API gate stops answering the way it should on mahalle.digital, and the auth forms report an unexpected server answer to Sentry. (GitHub schedules jitter by minutes and are sometimes hours late — the afternoon news fetch has fired 4–7 h late — so „within 30 minutes" is the cadence, not a guarantee; the alert repeats on every failing run until fixed.)

**Architecture:** One dependency-free Node script (`scripts/smoke-auth.mjs`) sends seven requests to a base URL and compares status/body against a fixed table; a GitHub Actions schedule runs it every 30 minutes, retries once after 60 s, and posts the failing lines to the admin's Telegram chat through the existing bot. Separately, a tiny client module reports a 404 / 5xx / non-JSON answer from the four auth forms as ONE static Sentry message (the Sentry → Telegram bridge already pings on a new issue).

**Tech Stack:** Node 24 (`fetch`, `AbortController`), GitHub Actions (`ubuntu-latest`, `curl`, `jq`), `@sentry/astro` browser SDK already initialised by `sentry.client.config.ts`, `node:test` via `pnpm test`.

**Spec:** No spec file. The design is the owner-accepted answer of 2026-10-31 01:49 (two pieces: outside probe every 30 min with Telegram on failure, after one retry; forms report unexpected answers to Sentry). Background: the 10-27 → 10-31 sign-up outage — root CLAUDE.md „Authentication Flow" and `src/components/auth/kiosk/CLAUDE.md` → „Unknown `/api/auth/<action>` answers 404".

## Global Constraints

- The probe must run WITHOUT `pnpm install` (checkout + `node`, like `kiez-air-logger.yml` runs plain `curl`): `scripts/smoke-auth.mjs` imports nothing but `node:` builtins.
- The probe never creates data: no account, no mail, no Telegram ping from the app, not even a rate-limit row — verified 2026-10-31: `register.ts` and `forgot-password.ts` validate the body BEFORE charging the IP bucket, `login-status` answers a bodiless `{}` without a lookup, the others refuse at the session/validation gate. Only empty-body POSTs and GETs.
- The probe targets `https://mahalle.digital` only (never the demo; its register route answers 403 by design).
- Secrets never printed: the workflow uses `${{ secrets.TELEGRAM_BOT_TOKEN }}` / `${{ secrets.TELEGRAM_ADMIN_CHAT_ID }}` in `env:` only, no `set -x`, the token appears in no `echo`.
- One Sentry issue, not one per person: the client message text is the constant `'auth form: unexpected server response'`; route and status go in `tags`/`extra`.
- Expected 4xx answers (400, 401, 403, 409, 429) are NOT reported by the sensor — they are the forms' normal vocabulary.
- Budgets stay exact: `pnpm type-check` 16 errors, `npx -y svelte-check@4` 81 errors, `pnpm test` 500 + the new tests.
- Commit messages plain, no signature, no co-author footer.
- POSTs carry `Content-Type: application/json` and `Origin: <base>` so the middleware's cross-site form check never trips.

## Review Focus

1. Vercel maintenance blip at 03:00 → the probe must NOT ping on a single failed run (retry after 60 s; pinned in Task 2 by the workflow's shell logic, tested by hand with `workflow_dispatch` against a wrong origin).
2. A route starts answering 200 with an HTML page instead of JSON (edge page, misrouted rewrite) → `judge()` fails a `json: true` check whose body does not parse (Task 1 test).
3. A network error / DNS failure → counted as a failed check with the error name, never an uncaught exception that hides the summary (Task 1 test with a throwing fetch).
4. The person is offline when submitting → the sensor must not report `status 0` noise (Task 3: `navigator.onLine === false` → no report; unit-tested in the pure rule as `status === 0 && !online → false`).
5. Secrets missing in the repo → the workflow must still fail visibly and say which secret is missing, never silently skip the alert (Task 2 shell: warning line + `exit 1`).

---

### Task 1: The probe script

**Files:**
- Create: `scripts/smoke-auth.mjs`
- Test: `src/lib/smoke/authSmoke.test.ts` (imports `../../../scripts/smoke-auth.mjs`; `tsconfig` has `allowJs` and includes `**/*`)

**Interfaces:**
- Produces:
  ```js
  // Every one of the app's OWN /api/auth/* routes (all nine were dead 10-27 → 10-31), the two
  // Auth.js reads, the two public pages, the member-API gate, and the unknown-action 404.
  export const CHECKS = [
    { name: 'landing',              method: 'GET',  path: '/',                              expect: 200 },
    { name: 'login page',           method: 'GET',  path: '/login',                         expect: 200 },
    { name: 'auth session',         method: 'GET',  path: '/api/auth/session',              expect: 200, json: true },
    { name: 'auth csrf',            method: 'GET',  path: '/api/auth/csrf',                 expect: 200, json: true },
    { name: 'register validates',   method: 'POST', path: '/api/auth/register',             expect: 400, json: true, body: {} },
    { name: 'forgot-password',      method: 'POST', path: '/api/auth/forgot-password',      expect: 200, json: true, body: {} },
    { name: 'reset-password',       method: 'POST', path: '/api/auth/reset-password',       expect: 400, json: true, body: {} },
    { name: 'verify-email',         method: 'POST', path: '/api/auth/verify-email',         expect: 400, json: true, body: {} },
    { name: 'login-status',         method: 'POST', path: '/api/auth/login-status',         expect: 200, json: true, body: {} },
    { name: 'cancel-deletion',      method: 'POST', path: '/api/auth/cancel-deletion',      expect: 400, json: true, body: {} },
    { name: 'resend-verification',  method: 'POST', path: '/api/auth/resend-verification',  expect: 401, json: true, body: {} },
    { name: 'verification-status',  method: 'GET',  path: '/api/auth/verification-status',  expect: 401, json: true },
    { name: 'account-status',       method: 'GET',  path: '/api/auth/account-status',       expect: 401, json: true },
    { name: 'member API gated',     method: 'GET',  path: '/api/topics',                    expect: 401, json: true },
    { name: 'unknown auth → 404',   method: 'GET',  path: '/api/auth/smoke-unknown',        expect: 404 },
  ];
  // The expected statuses were read on the local prod build 2026-10-31 01:22 (POST `{}` to every
  // own route); re-read them there whenever a route changes its empty-body answer.
  /** @returns {{ ok: boolean, detail: string }} */
  export function judge(check, { status, bodyText, error });
  /** @returns {Promise<{ ok: boolean, lines: string[] }>} one line per check: `OK  name (status)` or `FAIL name: detail` */
  export async function runSmoke(base, fetchImpl = fetch);
  ```
- `judge` rules: `error` set → `{ ok: false, detail: 'request failed: <error>' }`; `status !== expect` → `FAIL … expected <expect>, got <status>`; `json: true` and `JSON.parse(bodyText)` throws → `FAIL … expected JSON body`; otherwise ok with `detail: String(status)`.
- `runSmoke` sends every check with a 15 s `AbortController` timeout, headers `Content-Type: application/json` + `Origin: <base>` on POSTs, `redirect: 'manual'` (a 308 must show as a failure, not be followed — the air-logger lesson), and never throws.
- When run directly (`import.meta.url === pathToFileURL(process.argv[1]).href`): `node scripts/smoke-auth.mjs <base>` prints every line and exits 1 if any check failed, 0 otherwise; a missing `<base>` argument prints usage and exits 2.

- [ ] **Step 1: Write the failing tests** in `src/lib/smoke/authSmoke.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHECKS, judge, runSmoke } from '../../../scripts/smoke-auth.mjs';

test('the table covers every own /api/auth/* route, the member gate and the 404', () => {
  const dir = fileURLToPath(new URL('../../pages/api/auth/', import.meta.url));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const path = `/api/auth/${f.replace(/\.ts$/, '')}`;
    assert.ok(CHECKS.some((c) => c.path === path), `${path} has no smoke check`);
  }
  const reg = CHECKS.find((c) => c.path === '/api/auth/register');
  assert.deepEqual({ method: reg.method, expect: reg.expect, json: reg.json }, { method: 'POST', expect: 400, json: true });
  assert.ok(CHECKS.some((c) => c.path === '/api/topics' && c.expect === 401));
  assert.ok(CHECKS.some((c) => c.path.startsWith('/api/auth/') && c.expect === 404));
});

test('judge: status mismatch, non-JSON body, request error, pass', () => {
  const reg = CHECKS.find((c) => c.path === '/api/auth/register');
  assert.equal(judge(reg, { status: 404, bodyText: '<html>' }).ok, false);
  assert.match(judge(reg, { status: 404, bodyText: '<html>' }).detail, /expected 400, got 404/);
  assert.equal(judge(reg, { status: 400, bodyText: '<html>' }).ok, false);
  assert.match(judge(reg, { status: 400, bodyText: '<html>' }).detail, /JSON/);
  assert.equal(judge(reg, { status: 400, bodyText: '{"error":"x"}' }).ok, true);
  assert.match(judge(reg, { error: 'TypeError: fetch failed' }).detail, /request failed/);
});

test('runSmoke: one line per check, never throws, POSTs carry JSON + Origin', async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url: String(url), init });
    const path = new URL(url).pathname;
    const c = CHECKS.find((x) => x.path === path);
    if (path === '/api/auth/forgot-password') throw new Error('boom');
    return new Response(c?.json ? '{}' : 'x', { status: c?.expect ?? 500 });
  };
  const r = await runSmoke('https://example.test', fakeFetch);
  assert.equal(r.lines.length, CHECKS.length);
  assert.equal(r.ok, false);
  assert.equal(r.lines.filter((l) => l.startsWith('FAIL')).length, 1);
  const post = seen.find((s) => s.init?.method === 'POST');
  assert.equal(post.init.headers['Content-Type'], 'application/json');
  assert.equal(post.init.headers['Origin'], 'https://example.test');
  assert.equal(post.init.redirect, 'manual');
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx tsx --test src/lib/smoke/authSmoke.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `scripts/smoke-auth.mjs`** with the exports above and the direct-run block (`process.argv[2]` is the base; `node:url` `pathToFileURL`). Header comment: what it is for, the 2026-10-27 → 10-31 outage in one sentence, how to run it locally (`node scripts/smoke-auth.mjs http://127.0.0.1:4655`).

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/lib/smoke/authSmoke.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Run it against the local prod build and against prod**

Run: `pnpm exec astro build --config scratchpad/astro.config.preview.mjs`, serve on :4655 (`PORT=4655 HOST=127.0.0.1 nohup node --env-file=.env dist/server/entry.mjs &`, kill by PID afterwards), then `node scripts/smoke-auth.mjs http://127.0.0.1:4655` and `node scripts/smoke-auth.mjs https://mahalle.digital`.
Expected: 15 × `OK`, exit 0, both. Then `node scripts/smoke-auth.mjs https://mahalle-das-kiezgesichterbuch.vercel.app` → the two page checks FAIL with 308 (proves `redirect: 'manual'`).

- [ ] **Step 6: Budgets + commit**

Run: `pnpm test | grep -E "^ℹ (tests|pass|fail)"` → 503 / 503 / 0; `pnpm type-check 2>&1 | grep -c "error TS"` → 16.
```bash
git add scripts/smoke-auth.mjs src/lib/smoke/authSmoke.test.ts
git commit -m "feat: auth smoke probe script (seven requests, fixed expectations)"
```

### Task 2: The scheduled workflow with Telegram on failure

**Files:**
- Create: `.github/workflows/smoke-auth.yml`

**Interfaces:**
- Consumes: `node scripts/smoke-auth.mjs <base>` exit code + stdout (Task 1).
- Repo secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` (same values as the Vercel Production vars; the OWNER adds them, or I do on his explicit word with `gh secret set`).

- [ ] **Step 1: Write the workflow**

```yaml
name: Auth Smoke
# Every 30 min: fifteen requests against mahalle.digital (scripts/smoke-auth.mjs) — the sign-up,
# login and password routes must answer exactly as expected. Born from the 2026-10-27 → 10-31
# outage: a middleware 404 swallowed /api/auth/register for three days and nothing reported it
# (a 404 is no exception → Sentry empty, no DB write, no Telegram ping). Only a request from
# outside sees that class of failure. One retry after 60 s (no ping on a deploy blip), then a
# Telegram message to the admin. Requires repo secrets TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_CHAT_ID.
on:
  schedule:
    - cron: '22,52 * * * *'
  workflow_dispatch:
    inputs:
      origin:
        description: Base URL to probe (default prod; a wrong one tests the alert path)
        default: https://mahalle.digital

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 6
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - name: Probe, retry once, alert
        env:
          APP_ORIGIN: ${{ inputs.origin || 'https://mahalle.digital' }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_ADMIN_CHAT_ID: ${{ secrets.TELEGRAM_ADMIN_CHAT_ID }}
        run: |
          set +x
          run_once() { node scripts/smoke-auth.mjs "$APP_ORIGIN" > /tmp/smoke.txt 2>&1; }
          if run_once; then cat /tmp/smoke.txt; exit 0; fi
          cat /tmp/smoke.txt; echo "--- failed, retry in 60 s"; sleep 60
          if run_once; then cat /tmp/smoke.txt; echo "recovered on retry (blip, no alert)"; exit 0; fi
          cat /tmp/smoke.txt
          fails=$(grep '^FAIL' /tmp/smoke.txt | head -c 3000)
          text="🚨 Mahalle Smoke: Auth-Routen antworten falsch ($APP_ORIGIN)
          ${fails}
          Lauf: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
          if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_ADMIN_CHAT_ID" ]; then
            echo "::warning::TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID repo secret missing — no alert sent"
            exit 1
          fi
          code=$(jq -n --arg c "$TELEGRAM_ADMIN_CHAT_ID" --arg t "$text" \
                   '{chat_id:$c,text:$t,disable_web_page_preview:true}' \
                 | curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
                   --data-binary @- "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage")
          echo "telegram sendMessage → HTTP $code"
          exit 1
```

- [ ] **Step 2: Lint the YAML locally**

Run: `node -e "require('js-yaml')" 2>/dev/null || true; python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/smoke-auth.yml')); print('yaml ok')"`
Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/smoke-auth.yml
git commit -m "ci: auth smoke every 30 min, Telegram on failure after one retry"
```

- [ ] **Step 4 (after push, owner's secrets in place): prove both paths once**

Run: `gh workflow run smoke-auth.yml` → `gh run watch` → green, 15 × OK.
Run: `gh workflow run smoke-auth.yml -f origin=https://mahalle-das-kiezgesichterbuch.vercel.app` → red after ~70 s, log shows `telegram sendMessage → HTTP 200`, the owner confirms the message arrived. (The alert path must be exercised once; a monitor that has never alerted is unproven.)

### Task 3: The forms report an unexpected server answer to Sentry

**Files:**
- Create: `src/lib/auth/unexpectedResponse.ts` (pure, tested) + `src/lib/auth/unexpectedResponse.test.ts`
- Create: `src/lib/sentry/reportUnexpectedAuth.ts` (client module, imports `@sentry/astro`)
- Modify: `src/components/auth/kiosk/AuthRegisterInner.svelte` (after `const data = await res.json().catch(...)` and in the outer `catch`), `AuthLoginInner.svelte` (the `login-status` fetch + its `catch`), `AuthForgotInner.svelte` (the `fetch` result + `catch`), `AuthResetInner.svelte` (`if (!res.ok)` branch + `catch`)

**Interfaces:**
- Produces (pure):
  ```ts
  export const EXPECTED_AUTH_STATUSES: ReadonlySet<number>; // 200, 201, 400, 401, 403, 409, 429
  /** True when a form should report: 404, any 5xx, a 2xx/4xx without a JSON content type, or a failed request while online. */
  export function isUnexpectedAuthResponse(input: { status: number; contentType: string | null; online: boolean }): boolean;
  ```
  Rules: `status === 0` (request threw) → `online`; `status === 404 || status >= 500` → true; `EXPECTED_AUTH_STATUSES.has(status)` → true only when `contentType` does not include `application/json`; anything else (e.g. 302, 405) → true.
- Produces (client):
  ```ts
  /** Never throws. Reports ONE static Sentry message with tags { route } and extra { status, contentType }. */
  export function reportUnexpectedAuth(route: string, res: Response | null, err?: unknown): void;
  ```
  Builds `{ status: res?.status ?? 0, contentType: res?.headers.get('content-type') ?? null, online: typeof navigator === 'undefined' ? true : navigator.onLine !== false }`, returns when `isUnexpectedAuthResponse` is false, else `Sentry.captureMessage('auth form: unexpected server response', { level: 'error', tags: { route }, extra: { status, contentType, error: err ? String(err) : undefined } })`.

- [ ] **Step 1: Write the failing tests** in `src/lib/auth/unexpectedResponse.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnexpectedAuthResponse } from './unexpectedResponse';

const json = 'application/json; charset=utf-8';
test('expected form vocabulary is not reported', () => {
  for (const status of [200, 400, 401, 403, 409, 429]) assert.equal(isUnexpectedAuthResponse({ status, contentType: json, online: true }), false, String(status));
});
test('404, 5xx, HTML instead of JSON, odd statuses are reported', () => {
  assert.equal(isUnexpectedAuthResponse({ status: 404, contentType: 'text/html', online: true }), true);
  assert.equal(isUnexpectedAuthResponse({ status: 500, contentType: json, online: true }), true);
  assert.equal(isUnexpectedAuthResponse({ status: 400, contentType: 'text/html', online: true }), true);
  assert.equal(isUnexpectedAuthResponse({ status: 200, contentType: null, online: true }), true);
  assert.equal(isUnexpectedAuthResponse({ status: 405, contentType: json, online: true }), true);
});
test('a failed request is reported only while online', () => {
  assert.equal(isUnexpectedAuthResponse({ status: 0, contentType: null, online: true }), true);
  assert.equal(isUnexpectedAuthResponse({ status: 0, contentType: null, online: false }), false);
});
```

- [ ] **Step 2: Run to see them fail** — `npx tsx --test src/lib/auth/unexpectedResponse.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write `src/lib/auth/unexpectedResponse.ts`** (pure) and `src/lib/sentry/reportUnexpectedAuth.ts` (client; header comment: why a static message, why `beforeSend` lets it through — it inspects exceptions only; born from the 10-27 → 10-31 outage).

- [ ] **Step 4: Run the tests** — 3 pass.

- [ ] **Step 5: Wire the four forms**, each with one import and the minimal calls:
  - Register: after `const data = await res.json().catch(() => ({}));` add `if (!res.ok) reportUnexpectedAuth('register', res);` — the existing branches stay; in the outer `catch (e)` add `reportUnexpectedAuth('register', null, e);` before the generic message.
  - Login: `const res = await fetch('/api/auth/login-status', …)` → after it `reportUnexpectedAuth('login-status', res);`; in that inner `catch (e)` → `reportUnexpectedAuth('login-status', null, e);`. Capture the value `signIn()` returns: `const signInRes = await signIn(...)` and, when `signInRes instanceof Response`, `reportUnexpectedAuth('signin', signInRes)` (auth-astro resolves with the callback's raw Response; a 404/5xx there is the same class). The OUTER `catch (e)` (today only `credErr = true`) gets `reportUnexpectedAuth('signin', null, e);` — auth-astro's `signIn()` throws when its own csrf fetch fails, and that is exactly a dead front door.
  - Forgot: `const res = await fetch(...)` → `reportUnexpectedAuth('forgot-password', res);`; `catch (e)` → `reportUnexpectedAuth('forgot-password', null, e);` (the „sent" state stays unconditional).
  - Reset: inside `if (!res.ok)` first `reportUnexpectedAuth('reset-password', res);`; `catch (e)` → `reportUnexpectedAuth('reset-password', null, e);`.

- [ ] **Step 6: Prove it in a browser against the local prod build**, with a Playwright script in `scratchpad/auth-sensor/probe.cjs` (NODE_PATH to the CLI's playwright): route `**/api/auth/register` to a 404 HTML page, intercept `**/*.ingest.*sentry.io/**` (or the DSN host) requests, submit the register form with valid fields → exactly ONE envelope whose payload contains `auth form: unexpected server response` and `"route":"register"`; then submit with a taken e-mail (real 409 from the server) → ZERO envelopes. The build needs `PUBLIC_SENTRY_DSN` set at BUILD time (it is inlined) — build once with `PUBLIC_SENTRY_DSN=https://abc@o1.ingest.de.sentry.io/1` for this probe only.
  Expected: `envelopes after 404: 1`, `envelopes after 409: 0`.

- [ ] **Step 7: No second Sentry SDK copy in the client bundle**

Run (on the build from Step 6): `grep -l "sentry.javascript.browser" dist/client/_astro/*.js | wc -l`
Expected: `1` — `@sentry/astro`'s `browser` export resolves to the same module the layout's client config already loads, so Vite emits one shared chunk; a `2` means the import landed in a separate copy and the module must be loaded another way (e.g. via the SDK's `getClient()` from the one chunk) before shipping.

- [ ] **Step 8: Budgets + commit**

Run: `pnpm test` → 506 pass; `pnpm type-check 2>&1 | grep -c "error TS"` → 16; `npx -y svelte-check@4 2>&1 | grep -iE "svelte-check found|errors" | tail -1` → `81 ERRORS`.
```bash
git add src/lib/auth/unexpectedResponse.ts src/lib/auth/unexpectedResponse.test.ts src/lib/sentry/reportUnexpectedAuth.ts src/components/auth/kiosk/Auth{Register,Login,Forgot,Reset}Inner.svelte
git commit -m "feat: auth forms report an unexpected server answer to Sentry (one static message)"
```

### Task 4: Docs

**Files:**
- Modify: `CLAUDE.md` (Error Monitoring → the „Sentry's blind spot" bullet: add the auth smoke + sensor as the worked example for status-code regressions; Development Commands: one line `node scripts/smoke-auth.mjs <base>`), `src/components/auth/kiosk/CLAUDE.md` (new pointer section „Auth smoke probe + form sensor (2026-10-31)"), `docs/runbooks/debut-event-readiness.md` (the external-monitor line: UptimeRobot + the Actions smoke).

- [ ] **Step 1: Write the three pointers** (dated, one paragraph each; the rule in one sentence: after any change to `middleware.ts` or `src/pages/api/auth/`, run the smoke script against the local prod build before pushing).
- [ ] **Step 2: Commit** — `git commit -m "docs: auth smoke probe and form sensor"`.

---

## Self-review

- Spec coverage: outside probe every 30 min (Task 1 + 2), one retry (Task 2), Telegram on failure (Task 2), forms report unexpected answers to Sentry as one issue (Task 3), docs (Task 4). The owner's secrets step is named in Task 2.
- Steps: each names the file, signature and assertion; bodies appear only where the shell logic or the check table IS the decision.
- Types: `judge(check, { status, bodyText, error })` and `runSmoke(base, fetchImpl)` used identically in Task 1's test and interface; `reportUnexpectedAuth(route, res, err?)` identical across Task 3's steps.
- Review Focus: 1 → Task 2 Step 4 (wrong origin run); 2 → Task 1 test `judge` non-JSON; 3 → Task 1 `runSmoke` throwing fetch; 4 → Task 3 test offline; 5 → Task 2 shell warning + exit 1.
- Proportion: four tasks, ~170 lines of code, the plan is about the same length — acceptable for a monitor whose whole value is exactness.

## Audit 2026-10-31 02:15 (owner: „audit the plan")
- The table covered 2 of the 9 own auth routes; the outage hit all 9 → every own route is in the table and a test reads the directory so a new route without a check fails CI. Added the member-API gate (`/api/topics` → 401): the same middleware going the OTHER way (letting anonymous reads through) is a privacy leak nothing else watches.
- Verified the probe writes nothing: validation precedes the rate-limit charge in `register.ts` and `forgot-password.ts`.
- Login's outer `catch` was not instrumented; a thrown `signIn()` (csrf fetch dead) is the front door failing → added.
- Added the one-chunk check for the Sentry import in the island (Step 7); `@sentry/astro` exports `browser: index.client.js`, confirmed in its package.json.
- Timing claim softened: GitHub schedules jitter; alerts repeat every failing run (by design, no dedupe state).
- Kept out on purpose: a deploy-triggered run, UptimeRobot, a real synthetic sign-up, alert de-duplication.
