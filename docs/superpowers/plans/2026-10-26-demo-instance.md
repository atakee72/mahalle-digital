# Demo Instance + Engineering Tour — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only, passwordless demo of Mahalle on `demo.mahalle.digital` (branch preview, own database, fictional content) plus a 10-minute engineering reading path in the public repo.

**Architecture:** All code lives in `main` behind `DEMO_MODE=1` + a dev-named database (fail closed). A pure rules module decides what a demo deployment allows; the middleware refuses every other state change; a second Auth.js Credentials provider `demo` signs a visitor in as one of two fixed users; the landing, login and register pages show two buttons instead of forms; a banner says „nur lesen". A seed script fills `mahalle-dev-demo`, a nightly GitHub Action reseeds it, copies the public Kiez statistics from prod and rings the demo's own news fetch.

**Tech Stack:** Astro 5 SSR, Svelte 5, `@auth/core` Credentials via auth-astro, MongoDB driver, node:test via tsx, GitHub Actions, Vercel branch domain.

**Spec:** `docs/superpowers/specs/2026-10-26-demo-instance-and-engineering-tour-design.md`

## Global Constraints

- Budgets EXACTLY: `pnpm type-check` 16 errors, `npx -y svelte-check@4` 81 errors — neither may grow. `pnpm test` = 486 today + the new tests.
- Nothing observable changes without the flag (spec §7.5). Prod never sets `DEMO_MODE`.
- `isDemoEnabled` is true only when `DEMO_MODE === '1'` AND the database name matches `/dev/i`.
- Allowed writes on a demo deployment, exact paths, nothing else: `/api/auth/csrf`, `/api/auth/callback/demo`, `/api/auth/signout`. Blocked reads with a demo session: `/api/admin/errors`.
- Refusal shape: `403`, JSON `{ "error": "demo_read_only" }` under `/api/`, plain text `Demo: read-only` elsewhere.
- Demo users: handles `demo_member` and `demo_admin`, `demo: true`, `password: null`, `emailVerified: true`.
- A component imported only through another island must not carry a `<style>` block (prod build orphans it, root CLAUDE.md) — put such styles in `src/styles/global.css` or reuse existing classes.
- i18n: every new string in `src/lib/kiosk-i18n.ts`, DE and EN, marked `// DRAFT` until the owner reads it.
- Commit messages plain and concise, no signature lines, no Co-Authored-By.
- Seed interlock: the database name must contain BOTH `dev` AND `demo`; dry-run unless `--write`.
- Never print an env value; never commit a URI or secret.

## Review Focus

1. A demo session on `GET /api/admin/errors` must get 403, not the owner's Sentry board → Task 1 test `blocked reads need a demo session`.
2. A password login on the demo (`POST /api/auth/callback/credentials`) must be refused, so no real account can ever be used there → Task 1 test `only the three auth writes pass`.
3. `DEMO_MODE=1` on a build whose database is `mahalle` must change nothing → Task 1 test `prod database name disables the flag` + Task 6 probe run C.
4. A logged-out deep link (`/login?redirect=/calendar`) on the demo must land on `/calendar` after „Als Mitglied ansehen", and `?redirect=https://evil.example` must land on `/forum` → Task 6 probe items 7–8.
5. A user document with `password: null` must never produce a 500 from the normal login → Task 2 step 4 guard (not unit-testable: `authorize` needs the DB; reviewer reads the guard).

---

### Task 1: Pure demo rules

**Files:**
- Create: `src/lib/demo/demoRules.ts`
- Test: `src/lib/demo/demoRules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DEMO_ALLOWED_WRITES: readonly ['/api/auth/csrf', '/api/auth/callback/demo', '/api/auth/signout'];
  export const DEMO_BLOCKED_READS: readonly ['/api/admin/errors'];
  export const DEMO_REFUSAL_BODY = { error: 'demo_read_only' } as const;
  export function dbNameFromUri(uri: string | undefined): string;            // '' when undefined or unparsable
  export function isDemoEnabled(a: { demoMode: string | undefined; dbName: string }): boolean;
  export function decideDemoRequest(a: { method: string; pathname: string; demoSession: boolean }): 'allow' | 'refuse';
  ```
  No imports in this file.

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbNameFromUri, isDemoEnabled, decideDemoRequest } from './demoRules';

test('db name comes from the URI path', () => {
  assert.equal(dbNameFromUri('mongodb+srv://u:p@host/mahalle-dev-demo?retryWrites=true'), 'mahalle-dev-demo');
  assert.equal(dbNameFromUri(undefined), '');
  assert.equal(dbNameFromUri('not a uri'), '');
});
test('flag + dev-named database enables', () => {
  assert.equal(isDemoEnabled({ demoMode: '1', dbName: 'mahalle-dev-demo' }), true);
});
test('prod database name disables the flag', () => {
  assert.equal(isDemoEnabled({ demoMode: '1', dbName: 'mahalle' }), false);
});
test('no flag disables', () => {
  assert.equal(isDemoEnabled({ demoMode: undefined, dbName: 'mahalle-dev-demo' }), false);
  assert.equal(isDemoEnabled({ demoMode: 'true', dbName: 'mahalle-dev-demo' }), false);
});
test('safe methods pass everywhere', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(decideDemoRequest({ method, pathname: '/api/topics', demoSession: true }), 'allow');
    assert.equal(decideDemoRequest({ method, pathname: '/forum', demoSession: false }), 'allow');
  }
});
test('only the three auth writes pass', () => {
  for (const p of ['/api/auth/csrf', '/api/auth/callback/demo', '/api/auth/signout']) {
    assert.equal(decideDemoRequest({ method: 'POST', pathname: p, demoSession: false }), 'allow');
  }
  for (const p of ['/api/auth/callback/credentials', '/api/auth/register', '/api/topics/create', '/api/listings/abc/contact', '/api/translate', '/api/newsletter/unsubscribe', '/api/profile/tour', '/kontakt']) {
    assert.equal(decideDemoRequest({ method: 'POST', pathname: p, demoSession: true }), 'refuse', p);
    assert.equal(decideDemoRequest({ method: 'POST', pathname: p, demoSession: false }), 'refuse', p);
  }
  assert.equal(decideDemoRequest({ method: 'PATCH', pathname: '/api/admin/users/abc', demoSession: true }), 'refuse');
  assert.equal(decideDemoRequest({ method: 'DELETE', pathname: '/api/topics/abc', demoSession: true }), 'refuse');
});
test('allowed writes are exact paths, not prefixes', () => {
  assert.equal(decideDemoRequest({ method: 'POST', pathname: '/api/auth/signout/x', demoSession: false }), 'refuse');
  assert.equal(decideDemoRequest({ method: 'POST', pathname: '/api/auth/csrf?x=1', demoSession: false }), 'refuse');
});
test('blocked reads need a demo session', () => {
  assert.equal(decideDemoRequest({ method: 'GET', pathname: '/api/admin/errors', demoSession: true }), 'refuse');
  assert.equal(decideDemoRequest({ method: 'GET', pathname: '/api/admin/errors', demoSession: false }), 'allow');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/lib/demo/demoRules.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/demo/demoRules.ts`**

`dbNameFromUri` parses with `new URL()` inside try/catch and returns `pathname.slice(1)`; `isDemoEnabled` is `demoMode === '1' && /dev/i.test(dbName)`; `decideDemoRequest` compares `method.toUpperCase()` against the safe set, then exact-matches `pathname` against the allowlist (no query handling: the middleware passes `url.pathname`, the test with `?x=1` pins that a stray query never matches).

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test src/lib/demo/demoRules.test.ts` — Expected: 8 passing. Then `pnpm test` — Expected: 494.

- [ ] **Step 5: Commit**

```bash
git add src/lib/demo/demoRules.ts src/lib/demo/demoRules.test.ts
git commit -m "demo: pure rules for the read-only demo deployment + tests"
```

---

### Task 2: Server wiring — flag, middleware refusal, provider `demo`, password guard, session flag

**Files:**
- Create: `src/lib/demo/demoMode.ts` (server-only)
- Create: `src/lib/demo/demoProvider.ts` (server-only)
- Modify: `src/middleware.ts` (insert after the session try/catch, before the `// NOTE: this gate runs only for SSR requests` comment)
- Modify: `auth.config.ts` (providers array line 28; `authorize` after the `if (!user)` block; `jwt` and `session` callbacks)
- Modify: `src/types/next-auth.d.ts`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  ```ts
  // demoMode.ts
  export function isDemoDeployment(): boolean;   // isDemoEnabled({ demoMode: process.env.DEMO_MODE, dbName: dbNameFromUri(import.meta.env.MONGODB_URI) })
  export function demoRefusal(pathname: string): Response; // 403; JSON DEMO_REFUSAL_BODY under /api/, text 'Demo: read-only' otherwise
  // demoProvider.ts
  export function demoCredentialsProvider(): ReturnType<typeof Credentials>; // id 'demo'
  // session shape
  session.user.demo?: true; token.demo?: true; User.demo?: true
  ```

- [ ] **Step 1: `src/lib/demo/demoMode.ts`**

`process.env.DEMO_MODE` is read at call time (run-time on Vercel; the probe sets it on the server command). The db name comes from `import.meta.env.MONGODB_URI` — the same inlined value `connectDB()` uses, so the check can never disagree with the database in use. Comment both facts in the file header (they are the spec's §7.1).

- [ ] **Step 2: Middleware rule**

Insert directly after the `try { … getSession … } catch { … }` block:

```ts
// Read-only demo deployment (spec 2026-10-26): every state change is refused except the
// three Auth.js endpoints that make sign-in/sign-out work; a demo session may not read the
// Sentry proxy. Inert without DEMO_MODE=1 + a dev-named database (fail closed).
if (isDemoDeployment()) {
  const verdict = decideDemoRequest({
    method: context.request.method,
    pathname,
    demoSession: (context.locals.user as { demo?: true } | null)?.demo === true,
  });
  if (verdict === 'refuse') return demoRefusal(pathname);
}
```

- [ ] **Step 3: `src/lib/demo/demoProvider.ts`**

`Credentials({ id: 'demo', name: 'Demo', credentials: { role: { label: 'Role', type: 'text' } }, authorize })`. `authorize({ role })`: when `role` is neither `'member'` nor `'admin'` return `null`; `const db = await connectDB()`; `findOne({ handle: role === 'admin' ? 'demo_admin' : 'demo_member', demo: true })`; `null` when missing; else return the same object shape as the credentials provider's success return (id, email, name, image, role normalised to `'admin' | 'user'`, `emailVerified: true`) plus `demo: true`. No rate limit, no bcrypt.

- [ ] **Step 4: `auth.config.ts` edits**

1. `providers: [ Credentials({...}), ...(isDemoDeployment() ? [demoCredentialsProvider()] : []) ]` — the provider object is not even constructed without the flag.
2. In the credentials `authorize`, directly after `if (!user) { … return null; }`:
   ```ts
   // A doc without a password hash (demo users, deletion tombstones) can never log in by
   // password; bcrypt.compare must not be handed undefined (it throws).
   if (typeof user.password !== 'string') {
       await consumeRateLimit(lockKey, LOGIN_MAX_FAILS, LOGIN_WINDOW_MS);
       return null;
   }
   ```
3. `jwt`: inside `if (user) { … }` add `if ((user as any).demo === true) token.demo = true;` (never written again — the recheck branch leaves it).
4. `session`: add `if ((token as any).demo === true) (session.user as any).demo = true;`.

- [ ] **Step 5: `src/types/next-auth.d.ts`**

Add `demo?: true;` to `Session.user`, `User` and `JWT`, each with a one-line comment pointing at the spec.

- [ ] **Step 6: Verify**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → `16`. `npx -y svelte-check@4 2>&1 | grep COMPLETED` → `81 ERRORS`. `pnpm test` → 494. `SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY= TELEGRAM_BOT_TOKEN= TELEGRAM_ADMIN_CHAT_ID= pnpm exec astro build --config scratchpad/astro.config.preview.mjs` → success.

- [ ] **Step 7: Commit**

```bash
git add src/lib/demo/demoMode.ts src/lib/demo/demoProvider.ts src/middleware.ts auth.config.ts src/types/next-auth.d.ts
git commit -m "demo: flag, middleware refusal, passwordless demo provider, password-hash guard"
```

---

### Task 3: Browser side — start helper, demo door, landing block, banner, robots meta

**Files:**
- Create: `src/lib/demo/startDemo.ts` (browser)
- Create: `src/components/demo/DemoDoor.svelte` (the two buttons + sentence; used by TWO islands → NO `<style>` block, classes in `global.css` under `.dd-*`)
- Create: `src/components/demo/DemoBanner.svelte` (imported by layouts only → own `<style>` allowed)
- Create: `src/components/demo/DemoHead.astro`
- Modify: `src/pages/index.astro` (pass `demo`), `src/components/landing/LandingPage.svelte` (prop + CTA swap, lines ~772–777)
- Modify: `src/pages/login.astro`, `src/pages/register.astro` (pass `demo`), `src/components/auth/kiosk/AuthLoginInner.svelte`, `src/components/auth/kiosk/AuthRegisterInner.svelte` (prop; render `DemoDoor` instead of the form)
- Modify: `src/layouts/KioskLayout.astro`, `src/layouts/AuthLayout.astro`, `src/layouts/LandingLayout.astro` (`<DemoHead />` next to `<GoatCounter />`), `src/layouts/KioskLayout.astro` + `src/layouts/AdminLayout.astro` (mount `DemoBanner` for a demo session; AdminLayout's `user` prop type gains `demo?: true`)
- Modify: `src/lib/kiosk-i18n.ts` (keys below, DE block and EN block), `src/styles/global.css` (`.dd-*`)

**Interfaces:**
- Consumes: `isDemoDeployment()` (Task 2), `safeInternalPath(raw, fallback)` from `src/lib/auth/safeRedirect.ts`.
- Produces:
  ```ts
  // startDemo.ts
  export async function startDemo(role: 'member' | 'admin', redirect?: string | null): Promise<boolean>;
  // DemoDoor props: { redirectParam?: string | null }  // reads ?redirect= itself when omitted
  // LandingPage / AuthLoginInner / AuthRegisterInner gain: demo?: boolean (default false)
  ```

- [ ] **Step 1: `startDemo.ts`**

What auth-astro's `signIn('credentials')` does, for the provider id `demo` (auth-astro routes only the literal `'credentials'` to `/callback/`; see `node_modules/auth-astro/client.ts:37-42`): `GET /api/auth/csrf` → `{ csrfToken }`; `POST /api/auth/callback/demo` with `Content-Type: application/x-www-form-urlencoded`, body `csrfToken`, `role`, `callbackUrl` (same-origin), `json=true`. Auth.js answers `{ url }` and reports a failed `authorize` NOT as a status code but as `?error=CredentialsSignin` on that url (auth-astro reads it the same way, `client.ts:25-26`): parse `data.url`, return `false` when it carries an `error` param or the response is not ok; otherwise `location.assign(target)` and return `true`. `target` = `role === 'admin' ? '/admin/moderation' : safeInternalPath(redirect, '/forum')`.

- [ ] **Step 2: i18n keys (DRAFT, DE then EN)**

```
lnd.demo.h        „Mahalle ansehen – als Demo."                                   | "See Mahalle — as a demo."
lnd.demo.p        „Das ist eine Lesekopie von Mahalle mit erfundenen Inhalten: dieselbe App, dieselben Regeln, keine echten Nachbar:innen. Schreiben ist abgeschaltet. Das echte Mahalle läuft auf mahalle.digital." | "This is a read-only copy of Mahalle with invented content: the same app, the same rules, no real neighbours. Writing is switched off. The real Mahalle runs at mahalle.digital."
lnd.demo.member   „Als Mitglied ansehen"                                          | "View as a member"
lnd.demo.admin    „Als Admin ansehen"                                             | "View as the admin"
lnd.demo.meta     „DEMO · INHALTE FIKTIV · SCHREIBEN DEAKTIVIERT"                 | "DEMO · FICTIONAL CONTENT · WRITING DISABLED"
lnd.demo.code     „Code auf GitHub"                                               | "Code on GitHub"
lnd.demo.eng      „Engineering-Notizen"                                           | "Engineering notes"
lnd.demo.real     „Das echte Mahalle"                                             | "The real Mahalle"
auth.demo.h       „Demo-Zugang"                                                   | "Demo access"
auth.demo.p       „Auf dieser Demo gibt es keine Anmeldung mit Passwort. Wähle eine Rolle:" | "This demo has no password login. Pick a role:"
auth.demo.fail    „Die Demo konnte nicht gestartet werden. Bitte noch einmal versuchen." | "The demo could not start. Please try again."
demo.banner       „Demo-Ansicht · nur lesen · Inhalte fiktiv"                     | "Demo view · read-only · fictional content"
demo.banner.code  „Code auf GitHub →"                                             | "Code on GitHub →"
```
Links: GitHub `https://github.com/atakee72/mahalle-digital`, engineering notes `https://github.com/atakee72/mahalle-digital/blob/main/docs/ENGINEERING.md`, real site `https://mahalle.digital`.

- [ ] **Step 3: `DemoDoor.svelte`**

Heading `auth.demo.h`, sentence `auth.demo.p`, two buttons (`lnd.demo.member`, `lnd.demo.admin`) calling `startDemo(role, redirectParam ?? new URLSearchParams(location.search).get('redirect'))`; while pending both buttons disabled; on `false` show `auth.demo.fail` in an `AuthBanner`-styled line. Classes `.dd-wrap`, `.dd-btn`, `.dd-btn--admin` in `global.css`, visually the auth card's primary button (copy `AuthPrimaryBtn`'s look; ochre accent, ink border, 48 px min height).

- [ ] **Step 4: Landing block**

`LandingPage.svelte` gains `demo = false` in its props; the CTA `<div class="lnd-cta" id="mitmachen">` becomes `{#if demo} <div class="lnd-cta lnd-cta--demo" id="mitmachen"> h2 lnd.demo.h · p lnd.demo.p · two buttons (same classes as `.lnd-cta-btn`, admin variant outlined) · meta line lnd.demo.meta in `.lnd-meta font-dmmono` · a row of the three links {:else} existing block {/if}`. The island's own `<style>` block takes `.lnd-cta--demo` additions (LandingPage is imported by `index.astro`, so its styles are route-linked). `index.astro`: `import { isDemoDeployment } from '../lib/demo/demoMode'` and `demo={isDemoDeployment()}`. Drop the spec's „Stand: <seed date>" — the reseed is nightly, the date would always be today (ruling, record in the report).

- [ ] **Step 5: Login and register doors**

`login.astro` / `register.astro`: `demo={isDemoDeployment()}` on the island. In both islands: `let { demo = false, … } = $props()`; `{#if demo} <DemoDoor /> {:else} existing form {/if}` — the surrounding card chrome stays.

- [ ] **Step 6: `DemoHead.astro` and `DemoBanner.svelte`**

`DemoHead.astro`: `isDemoDeployment() && <meta name="robots" content="noindex, nofollow" />`; mounted in the three layout heads next to `<GoatCounter />` (AdminLayout already carries the meta). `DemoBanner.svelte`: one static row, ochre background, ink text, `demo.banner` + a link `demo.banner.code` to the repo, not dismissible, `role="note"`; KioskLayout: `{(session?.user as { demo?: true } | undefined)?.demo && <DemoBanner client:load />}` directly above the `SuspendedBanner` line; AdminLayout: `{user.demo && <DemoBanner client:load />}` as the first child of `<body>` (extend the `user` prop type).

- [ ] **Step 7: Verify**

Budgets as in Task 2 step 6 (16 / 81 / build green). Grep: `grep -c "DRAFT" src/lib/kiosk-i18n.ts` grew by the new keys.

- [ ] **Step 8: Commit**

```bash
git add src/lib/demo/startDemo.ts src/components/demo src/pages/index.astro src/pages/login.astro src/pages/register.astro src/components/landing/LandingPage.svelte src/components/auth/kiosk/AuthLoginInner.svelte src/components/auth/kiosk/AuthRegisterInner.svelte src/layouts src/lib/kiosk-i18n.ts src/styles/global.css
git commit -m "demo: start buttons on landing/login/register, read-only banner, noindex meta"
```

---

### Task 4: Seed script and nightly workflow

**Files:**
- Create: `scripts/seed-demo-db.ts`
- Create: `.github/workflows/demo-reseed.yml`

**Interfaces:**
- Consumes: document shapes — mirror `scripts/seed-dev-db.ts` for users/topics/events/announcements/recommendations/listings; read `src/pages/api/comments/create.ts` (comment: `relevantPostId` ObjectId, `author` string, `moderationStatus`), `src/lib/notifications.ts` (`NotificationDoc`), the `FlaggedContent` type (`src/types/index.ts:293`) and `src/components/marketplace/kiosk/CLAUDE.md` (`listingAuditTrail`), `src/lib/blog/blogAnnounce.ts` (how a slug is claimed).
- Produces: a database that renders every section, the admin queue and the Protokoll; CLI `pnpm tsx scripts/seed-demo-db.ts [--write] [--copy-kiez-from <uri>]`.

- [ ] **Step 1: Interlock and CLI**

Header comment as in `seed-dev-db.ts`. `MONGODB_URI` from env; `dbName` must match `/dev/i` AND `/demo/i`, else exit 1 with the sentence `Refusing: database name must contain both "dev" and "demo"`. Without `--write` print what WOULD be written (collection → count) and exit 0. No `bcrypt` import — no demo doc carries a password.

- [ ] **Step 2: Users**

`demo_member` („Demo-Mitglied", `demo: true`, `password: null`, `email: 'demo-mitglied@mahalle-dev.test'`, `emailVerified: true`, `verified: true`, `newsletter: 'off'`, `forumNotify: 'off'`, `handleChosen: true`), `demo_admin` (same, „Demo-Admin", `role: 'admin'`), six neighbours with invented names (e.g. „Leyla Demirkaya", „Tobias Wendt", „Nour Haddad", „Kiezgarten Schillerpromenade e.V." as `memberType: 'organisation'`, „Café Fincan" as `memberType: 'business'`, „Marek Nowak"), `*.demo@mahalle-dev.test` addresses, `password: null`, one with `verified: true`, `image: ''`. Real ObjectIds for `_id`, stringified as authors.

- [ ] **Step 3: Content (relative dates via `daysAgo`/`daysAhead`)**

Counts and traits from spec §6.2: 12 forum posts over the three kinds (one with `hasWarningLabel: true` + `warningText`, one body containing `@demo_member` with a matching `mentions` entry), 1 official pinned announcement by `demo_admin` (`isOfficial: true`, `pinnedUntil: daysAhead(5)`), 10 comments spread over posts (each comment's `_id` also pushed into the parent post's `comments` array in exactly the form `src/pages/api/comments/create.ts` writes — the feed's reply count is `comments.length`, `topicsQuery.ts:270`), 6 events (two `allDay` with Berlin day bounds, one multi-day, one with `movedAt` + `movedFromStart`, one past with RSVPs from three neighbours), 6 listings (`sell`/`exchange`/`gift`; one `status: 'reserved'` with `reservedAt`, one `'sold'`, `images: []` everywhere — photos come later by the owner's hand), 5 `savedPosts` for `demo_member`, 12 `notifications` for the two demo users (types `comment`, `moderation`, `official`, `blog`, `event_moved`, two unread), 3 `flaggedContent` rows with `status: 'pending'` (a post, a comment, a listing — one of them `isUserReported: true`) + 4 reviewed rows, 1 `listingAuditTrail` row. Text in German with two or three Turkish/English lines, clearly everyday neighbourhood content, nothing that names a real person, business or address of the Schillerkiez except public places (Herrfurthplatz, Tempelhofer Feld).

- [ ] **Step 4: Collections dropped, pre-fills, Kiez copy**

Drop list exactly as spec §6.3 (users, topics, announcements, recommendations, comments, events, listings, savedPosts, savedNews, notifications, flaggedContent, listingAuditTrail, postDrafts, rateLimits, passwordResetTokens, emailVerifyTokens, emailChangeTokens, accountDeletionTokens, pushSubscriptions, listingContacts, landingCache, chronikCache, kiezKontextCache, translationCache, forumDigests, kiezBriefIssues). Then `blogAnnouncements`: one `{ _id: <id>, announcedAt: now }` per `*.mdx` file directly under `src/content/blog/` (ignore the `images/` folder), `id` = file name without `.mdx` — that is the Astro 5 content-collection `id` the claim uses (`blogNotify.ts:30` → `blogAnnounce.ts:25`). Drafts included: a superset is harmless, a miss would announce a post. `news` is never touched. With `--copy-kiez-from <uri>`: for each of `schillerkiez_demographics`, `schillerkiez_social`, `schillerkiez_reference`, `schillerkiez_air_log`, `schillerkiez_air_daily` read all docs from the source, `deleteMany({})` + `insertMany` on the target; the source URI is used read-only and its name is never printed.

- [ ] **Step 5: Verify locally**

Run dry: `MONGODB_URI="<dev uri with /mahalle-dev-demo>" pnpm tsx scripts/seed-demo-db.ts` → counts, exit 0, nothing written (check with a count on the target). Run against the plain dev URI → refusal sentence. `pnpm type-check` unchanged (scripts are outside `tsconfig`'s src — confirm the count is still 16).

- [ ] **Step 6: Workflow `.github/workflows/demo-reseed.yml`**

Model: `news-afternoon-fetch.yml` + `schillerkiez-stats.yml` (checkout@v7, setup-node@v7 Node 24, pnpm/action-setup@v5, `pnpm install --frozen-lockfile`). `on: schedule: '0 4 * * *'` + `workflow_dispatch`. Job steps: (1) `git checkout` with `ref: demo` (the deployed code), (2) seed: `pnpm tsx scripts/seed-demo-db.ts --write --copy-kiez-from "$PROD_MONGODB_URI"` with `MONGODB_URI: ${{ secrets.DEMO_MONGODB_URI }}` and `PROD_MONGODB_URI: ${{ secrets.MONGODB_URI }}` (read-only use, comment says so and names the five collections), (3) `curl` `https://demo.mahalle.digital/api/news/fetch-daily` with `Authorization: Bearer ${{ secrets.CRON_SECRET }}`, fail the job on a non-200 (copy the afternoon workflow's shape; header comment: the demo deployment's preview-scoped `CRON_SECRET` must equal the repo secret — owner's hand step).

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-demo-db.ts .github/workflows/demo-reseed.yml
git commit -m "demo: seed script for mahalle-dev-demo + nightly reseed workflow"
```

---

### Task 5: Engineering layer (orchestrator writes, owner reads before commit)

**Files:**
- Create: `docs/ENGINEERING.md`, `docs/runbooks/cold-start-cpu.md`
- Modify: `README.md` („For reviewers" block under the title), root `CLAUDE.md` (env var `DEMO_MODE` + a „Demo deployment" paragraph), `src/components/auth/kiosk/CLAUDE.md` + `src/components/landing/` area notes if present (dated pointer), `docs/runbooks/README` index if one exists.

- [ ] **Step 1: `docs/ENGINEERING.md`** — the nine sections of spec §8.1; every number dated and taken from the repo (`git rev-list --count HEAD`, `pnpm test` count, budgets); five file links; three postmortems in symptom / found how / root cause / fix / process-change shape; the AI-process paragraph in the owner's voice, first person.
- [ ] **Step 2: `docs/runbooks/cold-start-cpu.md`** — distilled from root CLAUDE.md „Cold starts are the CPU bill" (measurements, fix, verification 2026-10-19).
- [ ] **Step 3: README block** — demo link, two roles, link to ENGINEERING.md, one screenshot strip (four images under `docs/screenshots/`, shot from the local demo build at 1280 px by the probe script).
- [ ] **Step 4: CLAUDE.md + `.env.example`** — `DEMO_MODE=` line in both env blocks (commented out in `.env.example`, with the fail-closed sentence); a „Demo deployment (2026-10-26)" paragraph under „Landing + login gating" with the fail-closed rule, the three allowed writes, the branch/domain mechanics, the reseed workflow; a one-line pointer in the auth area file.
- [ ] **Step 5: Owner reads** — commit only after his word.

---

### Task 6: Probe, review, merge (orchestrator)

- [ ] **Step 1: Seed** `mahalle-dev-demo` once by hand (`--write --copy-kiez-from <dev uri>` for the local run; prod copy is the workflow's).
- [ ] **Step 2: Build A (demo):** `MONGODB_URI="<demo uri>" SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY= TELEGRAM_BOT_TOKEN= TELEGRAM_ADMIN_CHAT_ID= pnpm exec astro build --config scratchpad/astro.config.preview.mjs`; serve `DEMO_MODE=1 PORT=4655 HOST=127.0.0.1 nohup node --env-file=.env dist/server/entry.mjs &`.
- [ ] **Step 3: Probe `scratchpad/demo/probe.cjs` on build A:** (1) `/` shows both demo buttons, no `/register` CTA, robots meta present; (2) member button → `/forum`, banner visible, `GET /api/auth/session` has `demo: true`; (3) `POST /api/topics/create` → 403 `demo_read_only`; (4) `POST /api/translate` → 403; (5) `/register` shows the door, `POST /api/auth/register` → 403; (6) `/api/auth/providers` lists `demo`; (7) logged-out `/login?redirect=/calendar` → member button → `/calendar`; (8) `?redirect=https://evil.example` → `/forum`; (9) admin button → `/admin/moderation` with 3 pending cards, `GET /api/admin/errors` → 403, errors card in its unavailable state, Protokoll shows the 4 reviewed rows; (10) sign-out → `/login?abgemeldet=1` shows the door; (11) DE/EN toggle changes the banner text; (12) tour hello appears in a fresh context; (13) no page errors. Screenshots for the README strip.
- [ ] **Step 4: Build B (no flag, dev URI):** same build without `DEMO_MODE` → providers list has no `demo`, `/` shows „Mitmachen", password login as `ayse` works, no banner, no robots meta.
- [ ] **Step 5: Build C (flag, prod-named db):** build with `MONGODB_URI="mongodb://127.0.0.1:1/mahalle"` (an UNREACHABLE host carrying the prod database NAME — never the real prod URI), serve with `DEMO_MODE=1`; check only routes that touch no database: `/api/auth/providers` has no `demo`, `/login` shows the password form, not the door. Then stop the server and rebuild A for the screenshots if needed.
- [ ] **Step 6:** Opus review of `git diff main..HEAD` in parallel with step 3; fix; ff-merge on the owner's „merge"; push on „push"; region curl.
- [ ] **Step 7: Owner's hand steps (checklist to Downloads):** `git push origin main:demo`; domain `demo.mahalle.digital` → Preview → branch `demo`; Porkbun CNAME; `vercel env add` branch-scoped: `DEMO_MODE`, `MONGODB_URI`, blank `SENTRY_DSN`/`PUBLIC_SENTRY_DSN`/`SENTRY_AUTH_TOKEN`, `CRON_SECRET` equal to the repo secret; GitHub secret `DEMO_MONGODB_URI`; first `workflow_dispatch` of `demo-reseed.yml`; one visit per role on his phone; GitHub About, topics, pin.

## Dispatch notes (light SDD)

- Worktree `.claude/worktrees/demo` off `main`, `pnpm install --frozen-lockfile --prefer-offline`, `pnpm astro sync`, `.env` symlink, copy `scratchpad/astro.config.preview.mjs`.
- Dispatch A (Sonnet): Tasks 1–3 in that order, one report. Dispatch B (Sonnet, second worktree `.claude/worktrees/demo-seed` off the same base, no file overlap): Task 4. Both may run in parallel; B's branch is rebased onto A's before the review.
- Neither implementer starts a server, writes a probe, dispatches subagents, or touches a database other than one whose name contains both `dev` and `demo`.
- Order of the owner's hand steps matters once: the `demo` branch and the `DEMO_MONGODB_URI` secret must exist before the first `workflow_dispatch` of `demo-reseed.yml` (its checkout uses `ref: demo`).

## As executed (2026-10-26)

Tasks 1–4 by two Sonnet implementers in parallel worktrees (code 20a36d6b/ce232484/d3ad9d90, seed 851e53b4), my fix commits e85b0f23 (security scanner: path normalisation, gate placement, own cron secret, env source URI) and c3727b34 (Opus review: transplanted-token guard, calm blocked-read answer, fixed seed ids, sold-listing owner, logout robots meta, workflow permissions), merged ff to `main`. Task 6's three probe builds collapsed into ONE build because the database URI is a run-time read (spec §13). Task 5 (docs) 2026-10-27; `docs/ENGINEERING.md` and the README block wait for the owner's read. 495 tests, tsc 16, svelte-check 81.
