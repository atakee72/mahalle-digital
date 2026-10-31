# Demo instance + engineering tour — design

**Date:** 2026-10-26 · **Status:** approved by the owner 2026-10-26 (chat), open questions decided in §12 · **Owner decisions in this spec are quoted; everything else is the design's proposal.**

## 1. Goal

Let recruiters and hiring managers see Mahalle without touching production: the product, live and clickable; the admin side; and the engineering behind it (architecture, decisions, incidents, tests, process). One link in a job application, no credentials anywhere, nothing to rotate, no real member's data in reach.

Two audiences, two layers:

| Audience | Has | Wants | Gets |
|---|---|---|---|
| Recruiter | 2–5 minutes | A working link and a one-screen story | `demo.mahalle.digital` → „Demo starten" → the app with fictional content |
| Hiring manager | 20–60 minutes | Code, architecture, decisions, incidents, how I work | The same demo plus `docs/ENGINEERING.md`, a 10-minute reading path through the public repo |

## 2. Decisions already taken (owner, 2026-10-26, in chat)

- Never production. A stranger reading real neighbours' posts breaks the members-only promise.
- Read-only, enforced server-side, not by hiding buttons.
- No password on a public page: „Demo starten" logs the visitor in directly („sounds good").
- Two demo roles: member and admin.
- The engineering layer is written for people who read code; the AI-assisted process is stated openly, not hidden.

## 3. Non-goals

- No per-recruiter accounts, no expiring links, no visitor tracking on the demo.
- No prod feature changes beyond flag-guarded code that is inert without the flag.
- No separate Vercel project (crons, Sentry and quota would follow it — §5.1).
- No public dashboard, no visitor counter, no analytics on the demo.
- Not a staging environment: the demo is never used to test prod data or prod env.

## 4. Architecture in one paragraph

A long-lived git branch `demo` that always points at a commit of `main`. Vercel builds it as a PREVIEW deployment (no crons, no mail/push/Telegram transport) and serves it on the branch domain `demo.mahalle.digital`. Branch-scoped preview env vars give that deployment `DEMO_MODE=1` and a third database `mahalle-dev-demo` on the existing Atlas cluster, seeded with fictional content by a script and reseeded nightly by a GitHub Action so dates stay fresh. In code, `DEMO_MODE` does four things: adds an Auth.js provider `demo` that signs a visitor in as one of two fixed demo users without a password; refuses every state-changing request except Auth.js's own sign-in/sign-out endpoints; swaps the landing page's „Mitmachen" block and the login page for the two demo buttons; and shows a slim demo banner under the masthead. Prod never sets the flag; a flag without a dev-named database is ignored (fail closed).

## 5. Deployment

### 5.1 Why a branch preview, not a second project

A second Vercel project built from this repo would run `vercel.json`'s two crons against the demo database (news fetch with OpenAI cost, deletion sweep), report to Sentry as `production`, and double the Hobby CPU budget's exposure. Preview deployments run no crons, and the preview environment already has no `RESEND_API_KEY`, `SMTP_*`, `TELEGRAM_*`, `VAPID_*` or `GOATCOUNTER_ENDPOINT`, so nothing leaves the demo. Vercel's docs name branch domains as the Hobby alternative to custom environments (`vercel.com/docs/projects/domains/assign-domain-to-a-git-branch`; the knowledge-base staging guide says the same). The GitHub Actions crons (`log-air`, afternoon news, Kiez-Brief, stats) target `https://mahalle.digital` and never see the demo.

### 5.2 Branch, domain, env — the owner's hand steps

1. `git push origin main:demo` creates the branch (and later releases a new state to the demo; a GitHub Action that mirrors `main` to `demo` on every push is a possible later step, not in this spec).
2. Vercel → Settings → Domains → add `demo.mahalle.digital` → Edit → environment Preview → Git Branch `demo` (the docs' gotcha: a new domain first binds to the default branch, you must edit it). Porkbun: CNAME `demo` → `cname.vercel-dns.com`.
3. Branch-scoped preview variables (`vercel env add <NAME> preview demo`, value via stdin, never echoed): `DEMO_MODE=1`; `MONGODB_URI` = the dev URI with the path `/mahalle-dev-demo`; `SENTRY_DSN`, `PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` = empty (Sentry init is a documented no-op without a DSN; if Vercel refuses an empty value, the demo reports as `preview` like every preview today, the admin errors card is blocked by §7.3 anyway, and the daily air-freshness check of §6.2(b) would raise a false alarm every morning — then choose news option (a)). No `NEXTAUTH_URL`: the preview scope has none today (audit 2026-10-26), `getTrustedBaseUrl()` fails closed, and the demo never builds an emailed link. Everything else inherits the preview scope — the audit found `CRON_SECRET`, `OPENAI_API_KEY`, `NEWSDATA_API_KEY` and the Cloudinary keys there. Note: `MONGODB_URI` is read through `import.meta.env` and inlined at BUILD time (`src/lib/mongodb.ts`, `auth.config.ts`); on Vercel the branch-scoped value is present during the `demo` build, so this is fine — it matters for the local probe (§9).
4. Deployment Protection stays OFF. It has been off since 2026-09-27 for the sponsor link; a preview demo cannot work behind Vercel's login wall and Hobby has no „production only" option. This closes the open „switch it back on" note: with the demo live, it stays off.
5. First deploy of `demo` → `curl -s https://demo.mahalle.digital/ | grep -c 'name="robots"'` shows the noindex meta (§7.4; Vercel's own `X-Robots-Tag: noindex` on previews is documented for `*.vercel.app` hosts, whether it covers a branch domain is unverified, so the app sets its own) and `/api/auth/providers` lists `demo`.

### 5.3 Hobby terms

A portfolio demo is non-commercial use; the Hobby plan allows it. CPU: a cold start is ~0.4 s since the bundling fix, demo traffic is a few visits a day; the shared 4 h/month budget is not at risk. If the usage page ever shows the demo mattering, the lever is a later „keep-warm" ping or a static landing in front.

## 6. Data

### 6.1 Third database `mahalle-dev-demo`

Same cluster, same Atlas user as dev. The name contains both `dev` (so every existing script interlock accepts it) and `demo` (so the demo seed's own interlock can insist on it, §6.2). The dev database stays the owner's and my playground; probe content never shows up to a visitor.

### 6.2 `scripts/seed-demo-db.ts`

A sibling of `seed-dev-db.ts`, not a mode of it. Interlocks: refuses a database name that does not contain BOTH `dev` and `demo`; dry-run by default, writes with `--write`. Drops and rewrites the content collections, then writes:

- **Users (8):** `demo_member` (name „Demo-Mitglied", `demo: true`, `password: null`, `emailVerified: true`, `verified: true`, `newsletter: 'off'`, `forumNotify: 'off'`), `demo_admin` (same, `role: 'admin'`), and six fictional neighbours with clearly invented names, `*.test` addresses, two with `memberType` (one Initiative, one Gewerbe), one with the Kiez badge, portraits = the licensed Schaufenster placeholder or none. No name of a real member, no real address, no portrait of a real person.
- **Content, all dated relative to the seed run** (`daysAgo()`), so the nightly reseed keeps it current: 12 forum posts across the three kinds with tags and comments (one with a warning label, one `@handle` mention), 1 pinned official announcement, 6 calendar events (two all-day, one multi-day, one moved, one in the past with RSVPs), 6 listings (sell/exchange/gift, one reserved, one sold, one with three photos), 5 saved posts, a dozen notifications for both demo users (comment, moderation, official, blog, event_moved), 3 pending `flaggedContent` rows + 4 reviewed ones so the admin queue and the Protokoll have something to show, one `listingAuditTrail` row.
- **News — owner's choice, §12:** (a) a committed snapshot of 20 real public articles (headline, source, URL, real date, section — no member data), re-inserted on every reseed with their REAL dates; the Kurier then shows them under ÄLTER and the landing Kurier frame falls back to its static screenshot once they age. Shifting the dates was considered and rejected: a wrong publication date on a real newspaper's article is a false statement about a third party. (b) the nightly workflow calls the demo deployment's own `GET /api/news/fetch-daily` with the `CRON_SECRET` Bearer after the reseed — real articles, real dates, GPT sections, exactly what prod does; the preview scope already holds the OpenAI and NewsData keys. Costs: one GPT scoring run a day and a share of the NewsData quota prod uses; side effects inside that route on the demo: `sendForumDigest()` writes digest notifications for the seeded members (harmless, even lively), `sendKiezBrief()` claims a `kiezBriefIssues` row and dev-logs the mail (no transport — the `/kiez-brief` browser view gets content), `checkAirLoggerFreshness()` would raise „air logger silent" every morning UNLESS Sentry is blanked on the branch (§5.2 step 3). Fictional articles attributed to real newspapers are out in both options. Recommendation: (b) if the NewsData quota allows, else (a).
- **Kiez data — owner's choice, §12:** the five `schillerkiez_*` collections are public statistics with no member data. (a) copied once from the dev database by a local run (`--copy-kiez-from <uri>`), then left alone by the reseed — the 7-day air bars go stale because the air logger writes prod only; (b) copied nightly from PROD by the reseed workflow, read-only, through an explicit allowlist of exactly those five collection names — the GitHub repository already holds the prod `MONGODB_URI` as a secret for `schillerkiez-stats.yml`, so no new secret, but a scheduled prod READ by a workflow is the owner's call, not the design's. The live air strip is live in both (BLUME, read-only).
- **Blog:** repo files, nothing to seed; `blogAnnouncements` pre-filled with every current slug so no „new post" fan-out ever runs on the demo.
- **Photos:** a fixed set of CC0 images uploaded ONCE by the owner to Cloudinary under `mahalle/demo/` (URLs hard-coded in the seed; the upload itself is a one-time hand step, the demo never uploads).

### 6.3 Nightly reseed

`.github/workflows/demo-reseed.yml`, cron 04:00 UTC, runs the seed with `--write` against secret `DEMO_MONGODB_URI`. The seed names what it drops: `users`, `topics`, `announcements`, `recommendations`, `comments`, `events`, `listings`, `savedPosts`, `savedNews`, `notifications`, `flaggedContent`, `listingAuditTrail`, `postDrafts`, `rateLimits`, every `*Tokens` collection, `pushSubscriptions`, `listingContacts`, the three in-code caches (`landingCache`, `chronikCache`, `kiezKontextCache`), `translationCache`, `forumDigests`, `kiezBriefIssues`; it pre-fills `blogAnnouncements` with every slug under `src/content/blog` of the checked-out commit (a superset of what the deployed `demo` commit knows is harmless). It touches `news` only under news option (a) and `schillerkiez_*` only under Kiez option (b). Purpose: relative dates stay fresh, residue vanishes (there can be little: writes are refused, the GET-side writes are listed in §10). Failure → the Actions tab goes red; a freshness watchdog is out of scope (the demo is not a service).

## 7. Code (lives in `main`, inert without the flag)

### 7.1 `src/lib/demo/demoRules.ts` — pure, tested

```ts
export function isDemoEnabled(a: { demoMode: string | undefined; dbName: string }): boolean
// true only when demoMode === '1' AND /dev/i.test(dbName). Prod's db is `mahalle` → never.

export const DEMO_ALLOWED_WRITES = ['/api/auth/csrf', '/api/auth/callback/demo', '/api/auth/signout'] as const;
export function decideDemoRequest(a: { method: string; pathname: string }): 'allow' | 'refuse'
// GET/HEAD/OPTIONS → allow. Anything else → allow only on the exact paths above.
// Covers anonymous writes too: register, forgot-password, contact relay, unsubscribe, translate, uploads.

export const DEMO_BLOCKED_READS = ['/api/admin/errors'] as const;
// GET with a demo session on these → refuse (the Sentry proxy would show the owner's real issue board).
```

Server-side resolution of the flag: `src/lib/demo/demoMode.ts` (server-only) reads `process.env.DEMO_MODE` at request time and the db name from `import.meta.env.MONGODB_URI` — the SAME inlined value `connectDB()` connects with, so the check can never disagree with the database actually in use. Consequence for the local probe: the production build must be made with the demo URI in the shell environment (`MONGODB_URI=<demo uri> pnpm exec astro build …`; a shell value beats `.env`), while `DEMO_MODE=1` goes on the SERVER command (same lesson as GoatCounter).

### 7.2 Middleware rule

In `src/middleware.ts`, after the session is resolved and before the login gate: when `isDemoEnabled()`, refuse per `decideDemoRequest()` with `403 { error: 'demo_read_only' }` (JSON for `/api/*`, a one-line text response for anything else); with a demo session also refuse `DEMO_BLOCKED_READS`. The Auth.js endpoints that make sign-in and sign-out work are the only writes that pass. Consequences accepted: the three self-writes (`/api/profile/tour`, `visit`, `locale`) are refused too — all three clients already treat a non-OK response as „nothing happened" (verified 2026-10-26: `tourStore.postSeen` catches, `visitClient` returns on `!res.ok`, `localeSync` ignores), so the tour runs from the visitor's own localStorage (every visitor gets it once in their browser), the „neu" dots stay off, and the DE/EN toggle works locally. Password login (`/api/auth/callback/credentials`) is refused on the demo by the same rule — nobody logs into the demo with a password, including me (probes use the demo buttons).

### 7.3 Auth: provider `demo`

In `auth.config.ts`, `providers` gains a second `Credentials({ id: 'demo', name: 'Demo', credentials: { role: {} } })` ONLY when `isDemoEnabled()` is true at module load. Its `authorize({ role })`: `role ∈ { 'member', 'admin' }` else `null`; `findOne({ handle: role === 'admin' ? 'demo_admin' : 'demo_member', demo: true })`; returns the usual user object plus `demo: true`. No rate limit, no password, no lockout — the user doc has `password: null`. The existing credentials `authorize` gains a one-line guard `if (typeof user.password !== 'string') { consume lockout; return null; }` so a demo user (or a tombstoned one) can never be logged in by password anywhere, and `bcrypt.compare` is never handed `undefined`.

`jwt` callback: copy `user.demo` to `token.demo` once at login; `session` callback: `session.user.demo`. Type augmentation in `src/types/next-auth.d.ts` (`demo?: true` on Session.user, User, JWT). The 5-minute `passwordChangedAt` recheck is harmless for demo users (no field, never changes) and keeps stamping `lastSeenAt` (server-side write, not a request, fine).

Sign-in from the browser: `src/lib/demo/startDemo.ts` does what auth-astro's `signIn('credentials')` does, for the provider id `demo` (auth-astro only routes the literal `'credentials'` id to `/callback/`; any other id is sent to the OAuth `/signin/` path — verified in `node_modules/auth-astro/client.ts:37-42`): GET `/api/auth/csrf`, then POST form-encoded `{ csrfToken, role, callbackUrl: '/forum' }` to `/api/auth/callback/demo`, then `location.assign('/forum')` (admin: `/admin/moderation`).

### 7.4 UI

- **Landing (`/`) in demo mode:** `index.astro` passes `demo={isDemoEnabled()}`; `LandingPage.svelte` renders, in place of the „Mitmachen" CTA block, a „Demo" block: three sentences (what Mahalle is, that this is a read-only copy with fictional content, where the real one lives), two buttons „Als Mitglied ansehen" / „Als Admin ansehen", a meta line „Stand: <seed date> · Inhalte fiktiv · Schreiben deaktiviert", and three links: Code (GitHub), Engineering notes (`docs/ENGINEERING.md` on GitHub), mahalle.digital. Everything else on the landing stays — it IS the product. Copy DE/EN via kiosk i18n keys `lnd.demo.*`, marked DRAFT until the owner reads them.
- **Login and register pages in demo mode:** the form is replaced by the same two buttons and a sentence; a bookmark to `/login` on the demo still works, and a visitor who logs out lands on something useful. A `?redirect=` parameter (a logged-out visitor who opened a deep link) is honoured through the existing `safeInternalPath()`.
- **`<meta name="robots" content="noindex, nofollow">`** in the `<head>` of every layout when the flag is on. The demo is a link you hand to people, never a search result (and never a duplicate of mahalle.digital in Google's eyes).
- **Demo banner:** `src/components/demo/DemoBanner.svelte`, mounted by `KioskLayout` and `AdminLayout` when the session carries `demo`, in the `VerifyEmailBanner` slot position: „Demo-Ansicht · nur lesen · fiktive Inhalte — Code auf GitHub →". Slim, ochre, not dismissible. Individual write attempts keep their generic error texts; the banner carries the explanation (no per-feature copy changes).
- **Admin demo:** `/admin/moderation`, `/admin/announcements`, `/admin/mitglieder` render from the seeded rows; every action 403s; the errors card shows its „nicht verfügbar" state because `/api/admin/errors` is refused.

### 7.5 What the flag must never do

Change anything observable when absent. `pnpm build` without the flag → `/api/auth/providers` lists only `credentials`, the landing shows „Mitmachen", no banner component is mounted, the middleware rule is skipped at its first `if`. This is pinned by the probe (§9) and by a unit test that `isDemoEnabled({ demoMode: '1', dbName: 'mahalle' })` is false.

## 8. Engineering layer (docs, no code)

### 8.1 `docs/ENGINEERING.md` — a 10-minute reading path

Sections, each a few lines with links into the repo:

1. **What it is, in numbers that are true** (sections, members-only since, commits, tests, CI budgets — figures taken from the repo at writing time and dated).
2. **Architecture sketch** (one diagram as an SVG or ASCII block): Astro SSR on Vercel fra1 → Svelte islands → MongoDB Atlas Frankfurt; OpenAI moderation; Resend; Telegram alerts; Sentry; GitHub Actions for everything Hobby's one cron cannot do.
3. **Five files worth reading, and why:** `src/middleware.ts` (one gate, cross-site check, 308s, Sentry capture inside the request window), `src/lib/auth/memberGate.ts` + test (pure decision, injected effects), `src/lib/sheet/sheetDragRules.ts` + `dragToClose.ts` (pure rules, browser action, CDP probe), `src/lib/newsletter/kiezBrief.ts` (claim-by-insert idempotency, groups of 75), `src/lib/omniModerationBatches.ts` (a provider contract learned from a 400).
4. **Three incidents, written as postmortems:** the Frankfurt region (`docs/runbooks/mongo-region-incident.md`), the cold-start CPU bill (new short runbook `docs/runbooks/cold-start-cpu.md`, distilled from the CLAUDE.md section), the one-image-per-request moderation bug that hid in a fail-safe for eight weeks. Each: symptom, how it was found, root cause, fix, what changed in the process.
5. **Testing strategy:** pure-rule modules under node:test; browser probes against a local production build (Playwright + CDP touch); ratcheted tsc/svelte-check budgets in CI; secret scanning.
6. **Security posture:** member gate with live ban check, rate limits, safe-redirect parser, push SSRF allowlist, cross-site form check, partial unique indexes, Sensitive env vars, allowlisted user projections.
7. **Decisions:** an index of `docs/superpowers/specs/*` with one line each (dated), and a pointer to the area `CLAUDE.md` files as the engineering diary.
8. **How I work with AI tools:** one honest paragraph — specs first, subagent implementers in worktrees, independent review, probes before merge, the owner decides and merges; CLAUDE.md as the shared memory; what that process caught (examples from §4).
9. **Try it:** the demo link, the two roles, what is deliberately disabled.

### 8.2 README

A „For reviewers" block directly under the title: demo link, the two roles, link to `docs/ENGINEERING.md`, one screenshot strip (landing, forum, calendar, admin queue). Nothing else in the README moves.

### 8.3 Repo metadata (owner's hand steps)

GitHub About: description + website `https://mahalle.digital`; topics (`astro`, `svelte`, `mongodb`, `vercel`, `community`, `civic-tech`, `berlin`); pin the repo on the profile.

## 9. Testing

- **Unit:** `src/lib/demo/demoRules.test.ts` — flag + prod db name → disabled; flag + `mahalle-dev-demo` → enabled; no flag → disabled; GET anywhere → allow; POST `/api/topics/create` → refuse; POST `/api/auth/callback/demo`, `/csrf`, `/signout` → allow; POST `/api/auth/callback/credentials`, `/api/auth/register`, `/api/listings/x/contact`, `/api/translate` → refuse; GET `/api/admin/errors` → blocked read.
- **Probe `scratchpad/demo/probe.cjs`** against a local production build made with the seeded `mahalle-dev-demo` URI in the shell environment (inlined, §7.1) and started with `DEMO_MODE=1` on the SERVER command; the robots meta present on `/`, `/forum`, `/admin/moderation`: landing shows the two buttons and no „Mitmachen"; member button → `/forum` with the banner, session `demo`; a compose POST → 403 `demo_read_only`; `/api/translate` POST → 403; `/register` shows the demo block, `POST /api/auth/register` → 403; admin button → `/admin/moderation` with the queue from the seed, `/api/admin/errors` → 403, the card shows its unavailable state; sign-out works and lands on the demo login block; DE/EN toggle works; the tour hello appears once per fresh context. Then the same build WITHOUT the flag: providers list has no `demo`, landing shows „Mitmachen", a password login still works, no banner. Then `DEMO_MODE=1` with the plain dev URI name swapped to `mahalle` (no connect needed, the provider list is enough) → no `demo` provider.
- **Budgets:** tsc 16 / svelte-check 81 exactly; `pnpm test` grows by the new file.
- **After the owner's deploy:** one curl for `noindex` + `/api/auth/providers`, one visit per role on his phone.

## 10. Security and privacy review of the design

- **Blast radius of a public login:** read access to a database of fictional content and public statistics; nothing else. Writes are refused before any route runs; uploads, mails, Telegram, push, DeepL, OpenAI are unreachable (no transport, and the moderation pipeline only runs on writes).
- **Fail-closed in prod:** two independent conditions (`DEMO_MODE=1` AND a dev-named database) and the provider is not even constructed otherwise. A mis-set flag in prod does nothing.
- **Owner data on the demo:** the Sentry proxy is refused and its token blanked; the admin member list shows only seeded `*.test` addresses; `IMPRESSUM_*` are preview vars and render the real Impressum — correct, the demo is still his site.
- **Session cookies:** the demo deployment has its own host, so cookies never cross to `mahalle.digital`.
- **Server-side writes that a GET still causes (accepted, all harmless, all wiped nightly):** the JWT recheck stamps `lastSeenAt`; `ensureHandle()` self-heals; the four in-code caches fill; the profile's Einladen card MINTS an invite code on first read (the link leads to the demo's register page, which shows the demo block — nothing can be redeemed); the blog visit's `claimNewBlogPosts()` finds every slug pre-claimed (§6.3), so no fan-out runs.
- **CI:** `checks.yml` runs on pushes to `main` and on PRs only; a push to `demo` triggers Vercel, not CI. That is fine because `demo` only ever carries a commit `main` already tested.
- **What a reviewer could still do:** hammer the demo with reads and burn CPU minutes (Hobby budget, visible on the usage page; a Vercel Firewall rate rule is the lever if it ever happens), or share the link — intended.

## 11. Work plan and estimate

| # | Piece | Who | Size |
|---|---|---|---|
| 1 | `demoRules.ts` + tests, `demoMode.ts`, middleware rule, provider + guard, type augmentation, `startDemo.ts` | Sonnet implementer, light SDD | ½ day |
| 2 | Landing/login/register demo blocks, `DemoBanner`, i18n DRAFT copy | same run | ½ day |
| 3 | `seed-demo-db.ts` + fictional content + `demo-reseed.yml` | Sonnet, separate brief | ½ day |
| 4 | Opus review ‖ my probe, fixes, merge, push | me | 2 h |
| 5 | `docs/ENGINEERING.md`, `cold-start-cpu.md`, README block | me (Desktop reads, if he wants) | ½ day |
| 6 | Branch, domain, CNAME, env vars, Cloudinary demo photos, GitHub About/topics/pin, first visit | owner | 1 h |

## 12. Decisions on the open questions (owner, 2026-10-26 14:54: „go with your recommendations")

1. Fictional content: I draft names and texts (DE, a few TR/EN lines like the real forum); the owner reads the seed file before it is committed. Decided.
2. Photos: the first version seeds WITHOUT photos (the seed's image lists are empty and the layouts already render imageless cards); the CC0 set is a later hand step by the owner, after which the seed gains the URLs. Decided.
3. Release to the demo by hand (`git push origin main:demo`, on the owner's word) for now; an automatic mirror is a later step. Decided.
4. The demo admin sees the Protokoll (history view); nothing in it is real. Decided.
5. ENGINEERING.md is written here, from the repo, with the owner reading before commit. Decided.
6. News: option (b) — the nightly workflow calls the demo deployment's `GET /api/news/fetch-daily` with the `CRON_SECRET` Bearer after the reseed; Sentry is blanked on the `demo` branch so the air-freshness check stays silent (§5.2 step 3, §6.2). If the NewsData quota turns out too tight, fall back to (a). Decided.
7. Kiez statistics: option (b) — the reseed workflow copies the five `schillerkiez_*` collections read-only from prod through an explicit allowlist of those names, using the `MONGODB_URI` secret the stats workflow already holds; the owner authorised this scheduled prod read on 2026-10-26. Decided.

## 13. As built (2026-10-26, merged `c3727b34`) — deviations from the design above

Recorded here rather than rewritten into the sections, so the approved design stays readable as what was approved.

- **The database URI is read at RUN time, not inlined.** §5.2 step 3, §7.1 and §9 assumed `import.meta.env.MONGODB_URI` is inlined at build; in the server bundle it compiles to a `process.env.MONGODB_URI` read (verified: four such reads in `dist/server`). Consequences: one build serves prod, demo and the probe's three modes; the probe sets the URI on the SERVER command; Vercel's branch-scoped var applies at request time. `demoMode.ts` documents it.
- **New lock, from the Opus review (critical):** a demo admin's session cookie copied onto mahalle.digital would have been a working prod admin session whenever the Auth secret is shared across environments. The `jwt` callback now returns `null` for any token carrying `demo: true` on a non-demo deployment. **New hand step for §5.2:** a branch-scoped `NEXTAUTH_SECRET` for `demo` with a fresh random value, so the two deployments never share a signing key. §10's „cookies never cross" sentence covered automatic sending only; a copied cookie is now dead on arrival.
- **Blocked read answers the route's own shape.** §7.2's 403 made the admin errors card show a warning-toned „nicht erreichbar"; the middleware now answers `200 { enabled: false, demo: true }` (`demoBlockedRead()`), the card shows „nicht konfiguriert", and `/api/admin/errors` carries the same lock itself. The blocked-read match is by normalised prefix (repeated slashes collapsed, trailing slash dropped) — exact matching let `/api/admin/errors/` through (security scanner).
- **Write gate placement.** The write refusal runs ABOVE the middleware's static-asset skip, like the cross-site check, so a dotted dynamic path cannot bypass it; only the session-dependent blocked read sits after session resolution.
- **Own cron secret.** The workflow uses repo secret `DEMO_CRON_SECRET`, which must equal a branch-scoped preview `CRON_SECRET` for `demo`; prod's cron secret is never reused (security scanner).
- **Source URI via env.** `--copy-kiez-from <uri>` became `--copy-kiez` + `KIEZ_SOURCE_URI` in the environment (argv shows in process lists and step logs); the seed prints only an error's name and code.
- **Fixed ObjectIds** (`64656d6f…01–08`) for all eight seeded users: the nightly reseed would otherwise orphan every 7-day demo session and `/` would bounce a returning visitor to `/forum` with no way back to the buttons (Opus review).
- **Sold listing** belongs to the demo member (public browse hides sold listings; only the seller's own view shows it).
- **„Stand: <seed date>"** on the landing block dropped — the nightly reseed would always print today.
- **Robots meta** also on `/logout`, which has its own `<head>`. Workflow carries `permissions: contents: read`.
- **Probe result (local prod build):** 23/23 demo mode, 6/6 flagless, 3/3 with the prod database name on an unreachable host. The admin card text for the off state is „Fehler-Monitoring nicht konfiguriert".
- **Noted, not done (owner's calls):** SHA-pinned GitHub Actions (the repo pins by major tag everywhere); a dedicated read-only Atlas user for the Kiez copy instead of the stats workflow's read-write login.

## 14. Go-live notes (2026-10-27 21:35, live at https://demo.mahalle.digital)

- Order that works: push the branch BEFORE adding branch-scoped vars (`branch_not_found` otherwise); add the vars; push an empty commit so the branch rebuilds with them (the first branch push got no build at all).
- Vercel refuses empty env values: the three Sentry vars stay on the demo, which therefore reports tagged `preview`. The §6.2 worry (a daily air-freshness false alarm) does not materialise because the nightly Kiez copy brings fresh air-log rows.
- The domain was bound to the branch through the API (`POST /v10/projects/{id}/domains { name, gitBranch }`, verified at once since the apex is on the account). After the CNAME, Vercel did not issue the certificate by itself within five minutes; `vercel certs issue demo.mahalle.digital` did it in nine seconds.
- First `demo-reseed.yml` run: success (seed, five Kiez collections from prod, the demo's own fetch-daily saved 20 articles). Live probe on the real domain: 23/23.
- GitHub: description, homepage and topics set by CLI; pinning has no API any more (owner's click).
- `lnd.demo.p` DE replaced by the owner's wording the same evening; the remaining demo keys are DRAFT.
- First night (`098892b1`, released to the demo at 22:26): two Sentry issues from the demo — the Kiez-Brief step of `fetch-daily` threw without `NEXTAUTH_URL` (the preview scope has none; now skipped on a demo deployment, the other piggy-backs stay), and a scanner's `GET /api/auth/<unknown>` was a 500 because auth-astro returns nothing for it (now a 404 from the middleware, `src/lib/auth/authRoutePath.ts` — which until 2026-10-31 `b1d9df1f` also 404'd the app's own `/api/auth/register` & co. on prod for three days; the gate now also requires Astro's `routePattern` to be the catch-all). §6.2's „no mail job ever runs on the demo" is thereby true in code, not only by missing transport.
