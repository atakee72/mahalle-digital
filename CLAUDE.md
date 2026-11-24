# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Mahalle - A Fullstack Community Web App for Local Neighborhoods. The name means "neighborhood" in Turkish and sounds like "meine Halle" (my hall) in German, reflecting the multicultural community it serves.

`/` is the public landing page („Das Schaufenster": `LandingLayout.astro` + `src/components/landing/LandingPage.svelte`, data from `getLandingData()` in `src/lib/landing.ts`), SSR-gated so a logged-in member is redirected to `/forum`; the forum index lives at `src/pages/forum.astro`. Everything about the landing page (ribbons, the six live phone frames and the rules for changing one, the first-screen layout, the live-first air reading, the promise ticker, rejected trials) is in `src/components/landing/CLAUDE.md`. Two rules that bite: never put a `filter` on the page-tall ribbon layer, and nothing in a frame may show a member's name or warning-labelled content.

**This file was slimmed on 2026-11-16.** Long histories moved verbatim into `docs/reference/*.md` and the area `CLAUDE.md` files; each section below names its file, and `docs/reference/README.md` maps every former section to its new place. Read that file before working on the topic.

## Tech Stack
- **Framework**: Astro 5.x with React 18.2 (hybrid SSR/SSG)
- **Styling**: Tailwind CSS 3.4
- **Animation**: CSS transitions, Svelte `transition:`, Web Animations API in `is:inline` scripts, View Transitions (the `motion` package left on 2026-09-30 with the last React surfaces that used it)
- **State Management**: TanStack Svelte Query (`@tanstack/svelte-query` 6) for server state in the forum + calendar islands, local Svelte `$state` for UI (no Zustand/Redux); the React query packages (`@tanstack/react-query` + devtools/persisters) were removed on 2026-09-30
- **Data Fetching**: `createQuery`/`createMutation` from Svelte Query in the forum + calendar islands; plain `fetch` helpers everywhere else
- **Authentication**: auth-astro over `@auth/core` (Credentials provider); the `next-auth` package is a pinned type-only DEV dependency — auth-astro's `client.ts` imports its sign-in/sign-out option types, svelte-check gains 5 errors in the login/profile islands without it (verified 2026-09-30, do not remove)
- **Database**: MongoDB 6.3 (direct driver, no Mongoose)
- **Deployment**: Vercel (serverless) — function region pinned to `fra1` in `vercel.json` (July 2026): the Atlas cluster lives in Frankfurt, and the default `iad1` made every DB roundtrip cross the Atlantic (root cause of recurring `MongoServerSelectionError` blips + slow SSR). Don't remove the `regions` pin; verify with `curl -sI <prod>/api/kiez-stats | grep x-vercel-id` → must show `fra1::fra1`. Full incident record: `docs/runbooks/mongo-region-incident.md`.
- **Validation**: Zod schemas

## Development Commands

```bash
pnpm dev          # Start dev server (the owner runs his own on :3000 — never auto-spawn one)
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm type-check   # TypeScript validation
pnpm test         # all lib tests (src/**/*.test.ts, node:test via tsx) — also the last step in checks.yml
npx -y svelte-check@4               # Svelte diagnostics sweep (dev-only warnings never appear in `pnpm build`)
node scripts/smoke-auth.mjs <base>  # auth smoke: 15 fixed requests — run against the local prod build (http://127.0.0.1:4655) after touching middleware.ts or src/pages/api/auth/
```

- **CI (`checks.yml`)** runs on Node 24 and must follow `engines.node` in package.json. Ratchet-only error budgets: tsc ≤16, svelte-check ≤81 — lower them when errors get fixed, never raise them. `pnpm/action-setup@v5` (not v6 until pnpm 11). After a push that touches package.json or a workflow: `gh run list --workflow=checks.yml --limit 1`.
- **Dead-code tools** (Knip, Fallow) are read-only: never installed, never `fix`. Their false positives and the KEEP list are in the reference file.
- **Worktree hygiene (2026-11-07):** a subagent dispatched with `isolation: "worktree"` leaves `.claude/worktrees/agent-<id>` + branch `worktree-agent-<id>` after a merged run. After each merge: `git worktree list` + `git branch --merged main | grep worktree-agent`, then `git worktree remove <path>` + `git branch -d <branch>`. The hand-made `ui-polish` worktree is NOT one of these (`docs/peer-brief-ui-polish.md`).
- Full notes (CI history, Vercel Node banner, the dead-code sweep record): `docs/reference/ci-and-tooling.md`.

## Project Structure

```
src/
├── components/       # React components (.tsx)
├── layouts/          # Astro layouts (KioskLayout, LandingLayout, AuthLayout, AdminLayout, blog/*)
├── pages/            # File-based routing
│   ├── api/          # API routes (serverless functions)
│   │   ├── auth/     # Registration endpoint
│   │   ├── topics/   # Forum CRUD
│   │   ├── events/   # Calendar events CRUD
│   │   ├── announcements/
│   │   ├── recommendations/
│   │   ├── comments/
│   │   ├── likes/
│   │   ├── views/
│   │   ├── news/          # Newsboard CRUD, daily fetch, save/unsave
│   │   ├── posts/         # Forum post image upload
│   │   ├── listings/      # Marketplace listings CRUD + draft save/publish
│   │   ├── reports/       # User report submission
│   │   ├── admin/         # Admin moderation APIs (review + bulk-review)
│   │   ├── kiez-stats.ts  # Public Schillerkiez demographics/social API
│   │   └── kiez-heartbeat.ts # Public landing-page heartbeat wrapper (getLandingData())
│   ├── index.astro   # `/` — public landing page (SSR redirect to /forum for members)
│   ├── forum.astro   # `/forum` — forum index (gated)
│   ├── 404.astro     # Global not-found page (prerendered, kiosk-styled, LandingLayout)
│   ├── 500.astro     # SSR error page (dependency-free by design — no session/DB imports ever)
│   └── *.astro       # Page components
├── hooks/
│   └── api/          # marketplace fetch helpers (plain functions)
├── lib/
│   ├── mongodb.ts    # Database connection
│   ├── auth.ts       # Auth utilities
│   ├── reviewAction.ts # Shared moderation review logic (single + bulk)
│   └── queryUtils.ts # Query helpers
├── schemas/          # Zod validation schemas
├── styles/           # Global CSS
├── types/            # TypeScript types
└── utils/            # Helper functions
```

## Key Architecture Patterns

### Authentication Flow
- `auth-astro` over `@auth/core` (NextAuth v5 beta), Credentials provider with bcrypt, JWT strategy, config in `auth.config.ts`.
- **Unknown `/api/auth/<action>` → 404 from the middleware**, but only for requests Astro routed to auth-astro's catch-all (`shouldAnswerAuth404(context.routePattern, pathname)`, pure rules in `src/lib/auth/authRoutePath.ts`; keep `AUTH_ACTIONS` equal to `node_modules/auth-astro/server.ts` on an upgrade). A path-only version of this gate swallowed the project's own `/api/auth/*` routes for three days (2026-10-27 → 10-31). **Rule: a middleware gate on a path PREFIX is probed on the local prod build against the project's own routes under that prefix — the happy path, not only the blocked one** (`node scripts/smoke-auth.mjs`).
- **Role**: `role?: 'user' | 'admin'` on the user doc, carried by `authorize` → `jwt` → `session`, so `session.user.role` exists everywhere. Type augmentation in `src/types/next-auth.d.ts` must augment `@auth/core/types` and `@auth/core/jwt`.
- **emailVerified is a soft gate** and a snapshot taken at login; live truth is `GET /api/auth/verification-status`. It never blocks login or features. Emailed links build their base URL via `getTrustedBaseUrl()` (`src/lib/auth/baseUrl.ts`, `NEXTAUTH_URL`, prod fail-closed).
- **Other-device sign-out**: the `jwt` callback stamps `token.loginAt` once and, at most every 5 minutes, compares it with `users.passwordChangedAt`; an older token is refused.
- **Gate helpers** in `src/lib/auth.ts`: `requireAdminSession(request)` and `requireMemberSession(request)` (session, then live ban check) — see „API Routes".
- Full notes: `docs/reference/auth-and-gating.md`; UI side: `src/components/auth/kiosk/CLAUDE.md`.

### Landing + login gating (Aug 2026)
- `/` is public; a request with a session is redirected to `/forum`. Member surfaces bounce logged-out visitors to login.
- **The gate lives in `src/middleware.ts`** (SSR requests only):
  - `GATED_PAGES` (prefix match → `302 /login?redirect=<path+search>`): `/forum`, `/topics`, `/announcements`, `/recommendations`, `/calendar`, `/events`, `/newsboard`, `/marketplace`, `/bookmarks`, `/search`, `/steckbrief`, `/nachbarn`, `/entwuerfe`, `/kiez-brief`.
  - `GATED_APIS` (prefix match → `401 { error: 'Unauthorized' }`): `/api/topics`, `/api/announcements`, `/api/recommendations`, `/api/events`, `/api/news`, `/api/comments`, `/api/listings`, `/api/users`, `/api/search`.
  - `API_ALLOWLIST`: `/api/news/fetch-daily` (authenticates with its own `CRON_SECRET` Bearer header).
- The marketplace is members-only by decision; `/profile` is ungated and renders its own logged-out state.
- **`?redirect=`** targets go through the shared pure `safeInternalPath()` (`src/lib/auth/safeRedirect.ts`) on both the server and the login island — never a hand-written `startsWith` check.
- PAGE requests on a `*.vercel.app` host are 308-redirected to mahalle.digital on PRODUCTION deployments only, never `/api/*` (the Vercel cron calls the deployment URL). `/landing` → `/` (301).
- Full notes (the stale-preview-link story, Deployment Protection): `docs/reference/auth-and-gating.md`.

### Demo deployment — demo.mahalle.digital (LIVE since 2026-10-27)
A read-only copy for recruiters, never prod: the git branch `demo` (always a commit of `main`) is built as a Vercel PREVIEW on the branch domain, with `DEMO_MODE=1`, the third database `mahalle-dev-demo` and its own Auth and cron secrets. **Release recipe: „release demo" = `git push origin main:demo`, by hand, on the owner's word.**
- Code: `src/lib/demo/` (pure rules `demoRules.ts`: the flag counts only with a db name matching `/dev/i`; every non-GET is refused except three Auth.js paths) and `src/components/demo/` (door, banner, noindex head).
- **Three locks that must stay:** (1) the `jwt` callback returns `null` for a token with `demo: true` on a NON-demo deployment; (2) the credentials `authorize` refuses a user doc without a string `password`; (3) `/api/admin/errors` answers `{ enabled: false }` itself on a demo deployment.
- `fetch-daily` skips `sendKiezBrief()` on the demo (`isDemoDeployment()`); a job that must not run on a second deployment is gated in code, not by a missing env var.
- Nightly reseed: `.github/workflows/demo-reseed.yml` + `scripts/seed-demo-db.ts` (db name must contain both `dev` and `demo`).
- `vercel env ls preview <branch>` lists ONLY the branch-scoped vars — check the whole preview scope before claiming a var is missing.
- Full notes (go-live steps, probes, first-night fixes): `src/components/demo/CLAUDE.md`; spec `docs/superpowers/specs/2026-10-26-demo-instance-and-engineering-tour-design.md`.

### API Routes
Member write routes in `src/pages/api/` (create/edit/upload/draft/submit/report/move, 22 files since 2026-09-30; plus the 6 self-delete routes since 2026-09-30) open with ONE helper:
```typescript
import type { APIRoute } from 'astro';
import { requireMemberSession } from '../../../lib/auth';
import { connectDB } from '../../../lib/mongodb';

export const POST: APIRoute = async ({ request }) => {
  // session → 401 `{ error: 'Unauthorized - Please login' }`, then LIVE ban check → 403 `account_banned`
  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;
  const { session, userId } = gate;   // session.user.role/name/email as before
  // ... handler logic
};
```
`requireMemberSession()` sits beside `requireAdminSession()` in `src/lib/auth.ts`; its decision logic is the pure, tested `gateMember()` in `src/lib/auth/memberGate.ts` (`npx tsx --test src/lib/auth/memberGate.test.ts`). Rules: the 401 text is frozen (clients may match it); a route that validates a path id BEFORE the session (`events/[id]/like`, `events/[id]/rsvp`) calls the helper after that check; a session without `user.id` is refused (before the helper it slipped through — the only behaviour change of the refactor). Routes with a different 401 body (`likes/toggle`, `listings/[id]/bump|status`, `profile/*`, `users/update`, `posts/drafts`) still hand-write their prelude — convert them only together with their clients. The middleware answers 401 first for the gated `/api/*` prefixes, so from outside the helper's own 401 is reachable on `/api/posts/*` and `/api/reports/*` only.

### Outgoing Email (shared mailer)
- **One transport chooser**: `src/lib/email/mailer.ts` (server-only) — SMTP when `SMTP_HOST/USER/PASS` are set (local dev), else Resend when `RESEND_API_KEY` is set (**prod transport**, domain `mahalle.digital`, EU region), else „not configured" and each send module dev-logs its link.
- `sendMail()` THROWS on failure (including Resend's `{ error }` return) and captures to Sentry with `flush(2000)` first; best-effort callers swallow the throw. `sendMailBatch()` = one Resend batch call (≤100, idempotency key, permissive validation); only caller `sendKiezBrief()`.
- The contact relay fails closed: `POST /api/listings/[id]/contact` → `503 email_unavailable` in prod without a transport (also on previews).
- The welcome mail fires on the FIRST `emailVerified` false→true transition only, never at registration.
- **Bounce webhook** `POST /api/hooks/resend`: raw body verified with `RESEND_WEBHOOK_SECRET` (read via `process.env`, fail-closed 401); a Permanent bounce stamps `users.emailBounce` and switches the Kiez-Brief off, a complaint switches it off only. Test by mailing `bounced@resend.dev`; Resend has no „send test event" button.
- Full notes: `docs/reference/email-and-alerts.md`.

### Admin alerts (Telegram)
`src/lib/adminAlerts.ts` (server-only) pings the single admin over Telegram: new member, moderation-queue item, report, new content/comment, marketplace contact, Sentry issue (`POST /api/hooks/sentry`), Kiez-Brief runs and switches, member-type changes. Contract: never-throw, awaited best-effort in the request window, 10 s timeout, silent no-op without `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ADMIN_CHAT_ID`. The admin's own actions never alert (except the session-less marketplace contact relay). A creation sends `content_new` OR `moderation_flagged`, never both. The e-mail mirror is OFF in prod since 2026-09-14. Full notes: `docs/reference/email-and-alerts.md`.

### Data Fetching
- TanStack Svelte Query for client-side data fetching in the forum + calendar islands; plain `fetch` helpers elsewhere
- Custom hooks in `src/hooks/api/`: only the four marketplace ones remain (`useBumpListingMutation`, `useContactListingMutation`, `useListingStatusMutation`, `useListingsQuery`); the legacy forum/news/comment/report hooks and the `QueryProvider` wrapper were removed on 2026-09-30 (dead since the kiosk migrations).

### State Management
- TanStack Svelte Query for server state (`src/lib/forumMutations.ts`, `calendarMutations.ts`, `savedEventsQueries.ts`, `userProfilesQueries.ts`)
- Local Svelte `$state` in the island orchestrators for UI state — no Zustand/Redux
- Canonical v5 mutation pattern: optimistic `onMutate` + `onError` rollback + single `onSettled` invalidation. Never stack `onSuccess` + `onSettled` invalidations (causes double-refetch flicker).

### Content Moderation
- **Pipeline** (`src/lib/moderation.ts`), on every submission of a topic, comment, event, announcement, recommendation or listing: three profanity blocklists (TR/EN/DE, leetspeak-normalised) → in parallel OpenAI `omni-moderation-latest`, `checkSpamWithGPT()` (spam, ads, scams, hate speech, harassment) and, for images, `checkImagesWithGPT()` → `mergeModerationResults()`. Status flow `pending` → `approved`/`rejected`, optional warning label (blur overlay).
- **OpenAI moderation takes ONE image per request** — `batchOmniInputs()` / `mergeOmniResults()` in `src/lib/omniModerationBatches.ts`.
- **Link reputation**: every http(s) link is looked up in Google Safe Browsing inside `moderateContent()` (`src/lib/linkReputation.ts`). It fails OPEN (a failed lookup never holds content; one static Sentry warning). A hit = category `unsafe_link`, urgent. Key `SAFE_BROWSING_API_KEY`, Production only, non-commercial terms.
- **Fail-safe shape**: the OpenAI functions do not throw, they RETURN `pending_review` + `moderation_error`. A caller WITHOUT a review queue (display name, profile motto) must handle that shape explicitly — `shortTextVerdict()` (`src/lib/shortTextVerdict.ts`) — or an outage refuses every signup. A `try/catch` around them catches nothing.
- **Blocklist rule**: before adding a word, check it against common words in ALL community languages after normalisation (the „mal" incident).
- **Daily limits**: four buckets of 5 per rolling 24 h (forum kinds together, events, listings, news) via `checkDailyLimit()` (`src/lib/limits/dailyLimit.ts`); an organisation may carry an admin-set `dailyLimit`. **Admins are exempt** from limits and from the whole moderation pipeline (not from the marketplace contact relay's check).
- **Reports**: members can report every content type; a self-delete KEEPS the report (`flaggedContent.contentDeleted: true`).
- **Strikes**: 3 strikes = automatic ban, enforced at login and on all content-write APIs incl. own deletes (403 `account_banned`, `src/lib/auth/banGuard.ts`). An admin account never collects a strike (2026-11-24, `c0e626c8`). There is NO unban route or button; lifting a ban is a hand edit of the user doc (an „Entsperren" button on `/admin/mitglieder` is deferred, owner 2026-11-24).
- **Review**: shared `processReviewAction()` in `src/lib/reviewAction.ts` (single + bulk, max 50); admin queue `/admin/moderation`, official announcements `/admin/announcements` — UI notes in `src/components/admin/CLAUDE.md`.
- Full notes (every incident and probe): `docs/reference/content-moderation.md`.

### Admin Moderation Table (kiosk: `ModerationApp.svelte` + `Adm*` components)
See `src/components/admin/CLAUDE.md` — full notes load when working in that subtree.

### Newsboard
Server notes: `src/pages/api/news/CLAUDE.md`; UI notes: `src/components/newsboard/kiosk/CLAUDE.md` (page `src/pages/newsboard.astro`). Facts needed elsewhere:
- **Two daily fetches** of `/api/news/fetch-daily`: the Vercel cron (06:00 UTC) and `.github/workflows/news-afternoon-fetch.yml` (GitHub starts it hours late). Dedup is by `sourceUrl`/`title`.
- The morning cron also carries the forum digest, the blog announce and the Kiez-Brief fallback (`sendKiezBrief({ fallback: true })`).
- **Sections are derived, not stored**: `resolveSektion()` in `src/lib/newsboard/newsTaxonomy.ts` must cover GPT's category list in `fetch-daily.ts` (pinned by a test) — change both in one commit.
- Order: today's articles by `aiRelevanceScore`, older days by publish time; Kiez/Neukölln sources print as ink cards.

### Kiez Data Dashboard
**Kiosk rebuild complete** (Tasks 1–11, July 2026): `/schillerkiez` moved from the legacy carousel dashboard to the kiosk design system — `src/pages/schillerkiez.astro` + `src/components/kiez/kiosk/` (Svelte islands, moss accent), plus a print route at `/schillerkiez/druck`. Full notes: `src/components/kiez/CLAUDE.md` (data pipeline, LOR codes, MSS column layout, air quality, trend backfills, kiosk architecture — orchestrator/states, view-model lib, Anwohner-Kontext, Berlin-Vergleich, druck route) load when working in that subtree.

### Blog ("Die Beilage")
`/blog` = `src/pages/blog/*` + `src/layouts/blog/*` + `src/components/blog/kiosk/` (rust accent), SSR on every route. Full notes: `src/components/blog/CLAUDE.md`. Rules needed everywhere:
- Posts are repo MDX files, so publishing is a deploy. **A new post is announced to every member once, automatically** — never rename a published post's file (the slug is its identity; a rename announces it again).
- **A published post is press**: a correction is applied in place and dated (`updatedDate`), an addition is a dated „Nachtrag", nothing changes silently.
- Never add a forward link between essay parts unasked.
- The index HTML carries a server-rendered link to every post (`slot="fallback"` of the client-only island, 2026-11-16) — keep it.
- Covers: a photo or a drawn plate (HTML/CSS, screenshotted); `coverFit: "full"` shows any aspect ratio.

### Onboarding Tour („Die Führung")
**v1 shipped** (Aug 2026): spotlight tour in per-surface chapters — engine overlay (`src/components/tour/`, mounted in `KioskLayout`), storage `users.tours` + `tourHelloDismissedAt` via `GET/POST /api/profile/tour`. **Phase 2 shipped 2026-08-10** (incl. depth pass, `TOUR_DEPTH_ANSWERS.md`): all seven chapters live — Forum (7 stops) → Kalender (6) → Marktplatz (5) → Kurier (5) → Kiez-Daten (3) → Blog (3) → Profil (3, final card, chain ends here) — 32 stops total. CD set 7·5·5·5·3·3·3 as the rhythm and said don't fill further; Kalender's 6th (month nav, 2026-08-12) is a deliberate user-approved exception — treat the caps as still binding. Ochre chrome; scrim is a box-shadow hole (stacking-context-proof — deliberate deviation from the handoff's z-index mechanism). Full notes: `src/components/tour/CLAUDE.md` (five engine duties, entrance rules, phase-2 engine additions, how to add a chapter). Remaining tour work is only the deferred code minors (LS bleed, focus restore, atomic POST, stale tail) — unchanged, still open.

### PWA shell (notification center R2, Aug 2026)
`public/manifest.webmanifest` + `public/icons/` + a push-only `public/sw.js` make Mahalle installable (home-screen install, incl. iOS) and let the service worker deliver web push when the tab is backgrounded or closed. **No offline caching** — locked 2026-08-06, deliberate: this is a push delivery mechanism, not an offline-first app. `sw.js` must never gain a `fetch` handler. Client opt-in lives in `src/lib/pushClient.ts`; see the `pushSubscriptions` collection below and `src/components/forum/kiosk/CLAUDE.md`'s "Notification bell + panel" for the UI states.

## Database Collections
**Full field lists, indexes and histories: `docs/reference/database-collections.md` — read the collection's entry there before changing its shape or a query on it.** One line each:
- `users` — accounts. Names may repeat, the unique `@handle` is the identity. Two PARTIAL unique indexes (`handle`, `email`); `register.ts` discriminates error 11000 on `e.keyPattern`. Day-7 deletion leaves a tombstone („Ehemaliges Mitglied").
- `topics`, `announcements`, `recommendations` — forum posts (`moderationStatus`, `images` with optional pixel size); announcements also carry `isOfficial` + `pinnedUntil` (max 3 pins), server-controlled.
- `events` — calendar events; all-day events store Europe/Berlin day bounds.
- `comments` — parent is `relevantPostId` ONLY, or `blogSlug` for blog comments (never both); 3000 chars.
- `listings`, `listingContacts` (hashes only, 90 d TTL), `listingAuditTrail` — marketplace.
- `news`, `savedNews`, `savedPosts`, `postDrafts` (own collection on purpose, max 20 per member).
- `notifications` (one doc per recipient, 90 d TTL, purged with their content), `pushSubscriptions` (endpoint allowlist = SSRF guard).
- `flaggedContent` — moderation queue.
- Token collections: `passwordResetTokens`, `emailVerifyTokens`, `emailChangeTokens`, `accountDeletionTokens` (hash only, single use). `rateLimits` — fixed-window buckets.
- Caches: `chronikCache`, `kiezKontextCache`, `translationCache` (90 d), `landingCache` (1 h).
- Kiez data: `schillerkiez_demographics`, `schillerkiez_social`, `schillerkiez_reference`, `schillerkiez_air_log`, `schillerkiez_air_daily`.
- Once-only claim records: `blogAnnouncements`, `forumDigests`, `kiezBriefIssues`.

Rules that bite:
- **Client-visible user joins use ONE allowlist**: `PUBLIC_AUTHOR_PROJECTION` + `toPublicAuthor()` in `src/lib/publicAuthor.ts` — never `{ password: 0 }`. Author and seller identity is a read-time join, never stored.
- **Never delete a row in prod** from `blogAnnouncements`, today's `forumDigests` or `kiezBriefIssues` — the announcement, digest or issue would go out again.
- `verified` is strict (`=== true`) and written server-side only (admin PATCH or the vouch step).
- Every delete path cascades comments (`deleteCommentsForPost()`) and ends with `purgeNotificationsFor()`.
- BLUME's „no measurement" is the NUMBER `-1`; the air log is station mc042 only, the substitute station is never logged.
- New code connects with `connectDB()`, never the default `clientPromise` export.

## Environment Variables
**Per-variable notes (what breaks when unset, where it is set, history): `docs/reference/environment-variables.md`.** Never print a value; names only. Names in `.env`:
- Auth: `AUTH_SECRET`, `AUTH_TRUST_HOST`, `NEXTAUTH_URL` (canonical origin; REQUIRED in prod, Production scope only), `JWT_SECRET` (fallback Auth.js secret — stays).
- Database: `MONGODB_URI` (db name in the path: prod `/mahalle`, dev + preview `/mahalle-dev`, demo `mahalle-dev-demo`).
- Media: `CLOUD_NAME` (not `CLOUDINARY_CLOUD_NAME`), `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- AI + content: `OPENAI_API_KEY`, `NEWSDATA_API_KEY`, `DEEPL_API_KEY`, `SAFE_BROWSING_API_KEY` (Production only).
- Cron: `CRON_SECRET`.
- Mail: `RESEND_API_KEY` (prod), `SENDING_FROM_EMAIL`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` (local dev only), `RESEND_WEBHOOK_SECRET`, `ADMIN_ALERT_EMAIL` (removed from prod).
- Security: `CONTACT_IP_SALT` (fixed across deploys), `ALLOWED_ORIGINS`.
- Kiez import: `STATS_XLSX_URL`, `STATS_PERIOD`, `MSS_XLSX_URL`, `MSS_PERIOD`, `MSS_SDI_URL`, `MSS_BEZIRKE_XLSX_URL`.
- Sentry: `SENTRY_DSN`, `PUBLIC_SENTRY_DSN` (commented out locally on purpose), `SENTRY_AUTH_TOKEN` (read-scoped), `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_WEBHOOK_SECRET`, `PUBLIC_VERCEL_ENV`.
- Push: `VAPID_PRIVATE_KEY`, `PUBLIC_VAPID_PUBLIC_KEY` (one pair).
- Legal: `IMPRESSUM_STREET`, `IMPRESSUM_ZIP_CITY`.
- Alerts: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`.
- Switches: `INVITES_PAUSED`, `DEMO_MODE` (demo branch only, never Production), `GOATCOUNTER_ENDPOINT`.

Rules that bite:
- Vercel injects env at DEPLOY time — a changed value needs a redeploy. Sensitive vars cannot be read back (`vercel env pull` returns `[SENSITIVE]`).
- `import.meta.env.X` compiles to a run-time read ONLY when X exists at build time; a variable absent at build is inlined as `undefined`. Read a late-added secret via `process.env` directly.
- Load `.env` with `node --env-file=.env`, never `source` (an unquoted `<…>` value stops the shell parse and echoes the line).

## Component Patterns
### Client-side islands
Everything interactive is a Svelte 5 island (`client:only="svelte"` for the orchestrators that read the URL or session on the client, `client:load` for the rest). The only React islands left are `ToastProvider.tsx` + `ConfirmDialog.tsx` (mounted by the layouts) and the `src/emails/*.tsx` templates (server-rendered with React Email). The old React wrapper pattern (`CalendarWrapper` → `CalendarContainer`, `ForumWrapper` → `ForumContainer`) is gone since the kiosk migrations.

### Forum patterns (List/Pagination, Performance/SSR, Post Images, Save/Bookmark, Search & Tag Filtering, Card Interactions)
See `src/components/forum/kiosk/CLAUDE.md` — full notes load when working in that subtree. **Phone bottom sheets close on a swipe down since 2026-10-26 (`df2b18cc`):** the notification panel and the account menu share the `dragToClose` action (`src/lib/sheet/`, pure rules tested); a new bottom sheet should reuse it rather than grow its own gesture — section „Swipe-down closes both phone sheets" in the area file holds the three browser traps (child `lostpointercapture` on explicit capture, `touchmove` listener registered once, snap timer). **`@handle` mentions in posts and comments since 2026-09-21** (resolved when the text is saved, stored on the document as `mentions: [{ handle, userId }]`, linked by user id, notified once and only when the content is public, autocomplete after „@", `@admin` alias for the admin account since 2026-09-26) — section „Mentions" there; not in listings, events or News. **`@alle` Admin-Hinweis since 2026-09-22** (admin-only broadcast to active members, same forum posts + comments scope) — same section, see „`@alle` Admin-Hinweis". Since 2026-09-13 an author can change a post's kind from edit mode (cross-collection move, `src/lib/forum/movePost.ts` + `POST /api/posts/move/[id]`; old URLs 302) — details under „Kind change in edit mode" there. **Search since 2026-09-24, site-wide since 2026-09-25**: masthead magnifier → centred modal over a blurred scrim → `/search`; one endpoint `GET /api/search` over Forum, Kalender, Markt, News and Blog, each under its own index page's visibility (`src/lib/search/`, area file `src/components/search/CLAUDE.md`). The forum spans dirs (`src/pages/api/topics/*`, `src/lib/topicsQuery.ts`, `src/lib/forumQueryOptions.ts`); read the area file directly when working on those server-side pieces.

### Calendar (kiosk) patterns (live ticker, saved events, attendee profiles, moderation parity, ghosting, edit-path moderation, compose toast, report flow)
See `src/components/calendar/kiosk/CLAUDE.md` — full notes load when working in that subtree. Spans `src/lib/calendar/*`, `src/lib/savedEventsQueries.ts`, `src/lib/userProfilesQueries.ts`, `src/pages/api/events/*`; read the area file directly when working on those.

### Marketplace patterns (kiosk: listings, contact relay, ownership lifecycle, freshness decay)
See `src/components/marketplace/kiosk/CLAUDE.md` — full notes load when working in that subtree. Spans `src/lib/listingActions.ts`, `src/lib/listingsQuery.ts`, `src/pages/api/listings/*`; read the area file directly when working on those server-side pieces.

**Seller identity is a read-time join, never stored** (Aug 2026): `populateSellers()` in `src/lib/listingsQuery.ts` resolves `sellerName`/`sellerImage` with one batched `$in` (allowlist projection `{name,image,userPicture}` — never `{password:0}`) from all three SSR fetchers. Denormalizing it would freeze the name a deleted user's tombstone is supposed to replace (`accountDeletion.ts` step 6 → "Ehemaliges Mitglied"). Same commit gated `GET /api/listings/[id]`, which had been a bare `findOne` serving rejected/draft/sold/past-21d listings plus `sellerEmail` to anonymous callers; it now routes through `fetchListingDetailForSSR` with `no-store` + `Vary: Cookie` (the response varies by session, so a shared cache would otherwise re-open the leak). Details in the area file.

### Auth (kiosk) patterns (login + register front door)
See `src/components/auth/kiosk/CLAUDE.md` — full notes load when working in that subtree. Auth uses a dedicated `AuthLayout.astro` (not `KioskLayout` — no app nav on the logged-out door), ochre accent (`[data-page="auth"]`), and reuses the credentials backend untouched. All phases shipped (login, register, splash + KiezHeartbeat, forgot/reset, email-verify soft gate, rate limits, ban screen); audited 2026-09-10/11 (record in the area file). `/login` and `/register` bounce logged-in members to `/forum` like `/` does. Since 2026-09-18 the login page carries its own link-preview copy for shared members-only links (`loginCardCopy()`; first case: shared calendar events, deliberately without event data) — section „Link-preview card" there.

### Profile (kiosk) patterns (own profile, Plan A)
See `src/components/profile/kiosk/CLAUDE.md` — full notes load when working in that subtree. Spans `src/lib/profile/*`, `src/pages/api/profile/*`, `src/pages/api/users/{update,profiles}.ts`; read the area file directly when working on those server-side pieces. Ochre accent (shared with Auth); `/profile` is NOT redirect-protected — it renders its own logged-out state in-page (state §10) rather than bouncing through middleware. Plan A = own profile only; public profile (`/nachbarn/[handle]`), Chronik, and konto-change flows are Plan B.

### TanStack Query — optimistic updates (gotchas; Svelte Query today, learned on the React side)
- **Use real userId, not placeholders**: optimistic `setQueryData` that mutates `likedBy: [...ids, 'optimistic-user-id']` will not match the real user id in subsequent `.includes(user.id)` checks, so UI state (heart filled/unfilled) won't flip until server refetch. Pass the actual `user?.id` into the mutation. Worked example: `src/lib/forumMutations.ts`.
- **Don't stack `onSuccess` + `onSettled` invalidations** with `refetchType: 'all'` — the double refetch overwrites the optimistic state and causes visible flicker/delay. Canonical v5 pattern: `onMutate` does the optimistic write + snapshot, `onError` rolls back, `onSettled` runs a single `invalidateQueries`. Drop `onSuccess` entirely.

### Removed legacy surfaces
Removed on 2026-09-30 / 10-01 with the last React and dark-glass code: `Navbar.tsx`, `BaseLayout`, `QueryProvider`, `Pagination.tsx`, `PageHeader.astro`, `SplashScreen.astro`, `ReportModal.tsx`, the packages `motion` and `react-remove-scroll`, the `.glass-*` utilities and the low-perf device detector. Their recipes (heavy filters on a `::after`, the low-perf detector script, `RemoveScroll` for a future React modal) are in `docs/reference/removed-legacy.md`. What is live today:
- Calendar date-range selection lives in the kiosk calendar (`src/components/calendar/kiosk/CLAUDE.md`).
- Every pager is written inline in Svelte (marketplace, blog search, admin moderation): First/Prev/Next/Last + „Page X of Y · N items".
- Animation: CSS transitions, Svelte `transition:`, Web Animations API in `is:inline` scripts, Astro View Transitions; the Kiez dashboard reveals sections with the `use:reveal` action. Respect `prefers-reduced-motion`.
- **Svelte native `<dialog>` modals must call `lockPageScroll()`** (`src/lib/scrollLock.ts`) while open — `showModal()` makes the page inert but the document still scrolls. It locks `<html>` only (see the `overflow-x: clip` corollary below).

### Blog Tag Bar (Mobile)
See `src/components/blog/CLAUDE.md` — full notes load when working in that subtree.

### Global UI: Toasts & Confirm Dialogs
- **Toast system**: `sonner` library, triggered via `CustomEvent` bridge (`app:toast`) from `src/utils/toast.ts`
- **Action button** (July 2026): `showToast(msg, { action: { label, onClick } })` renders a clickable pill inside the toast — the optional `action` passes through the bridge (functions survive same-document CustomEvents) into sonner's `action` option. Styled via the `actionButton: 'kiosk-toast__action'` classNames entry + `.kiosk-toast__action` in `global.css`. First consumer: the announce dashboard's displacement-undo toast (`duration: 8000` to leave reaction time).
- **Confirm dialog**: Custom `<dialog>`-based modal replaces all `window.confirm()` calls. Uses `CustomEvent` bridge (`app:confirm`) with `confirmAction()` returning `Promise<boolean>`. Works across React and Svelte. Since 2026-09-09 it locks page scroll while open (`lockPageScroll()`, native `showModal()` doesn't) and its default title/labels follow the kiosk locale at open time (`common.confirm.title` / `common.confirm.cta` / `common.cancel`) — callers only pass `title`/`confirmLabel` when they want specific copy.
- Both are mounted globally in `ToastProvider.tsx` — no per-component state needed. It is rendered by `KioskLayout` and `AdminLayout` ONLY: `LandingLayout` and `AuthLayout` have no toast host, a toast fired there shows nothing. Every call site uses the helpers in `src/utils/toast.ts` (about 120 calls in 30 files, counted 2026-11-24; the last hand-built `app:toast` event, in `ForumComment.svelte`, was converted that day, `187b62f4`)
- `confirmAction(message, { title, confirmLabel, variant })` — `variant: 'danger'` shows red confirm button
- **Kiosk skin**: sonner is mounted with `unstyled: true` + `classNames` map → `.kiosk-toast*` classes in `global.css`. Paper-warm bg + ink-2 border + Bricolage font + the ink print shadow on every type (until 2026-11-24 the shadow carried the type colour). `richColors` is dropped — `unstyled` strips sonner's defaults entirely so the kiosk CSS isn't fighting `!important`-laden defaults. Description copy lands in Instrument italic. Pattern lifts to any design system that ships its own palette: don't try to override sonner's defaults — strip them, then rebuild.
- **Time fill (2026-11-24, owner's choice, `de2318f5`):** a light tint in the type colour (success green, info wine, warning ochre, error danger; 30 % on paper) grows from the left, covers the whole toast 1 s before it closes and holds; the icon wears the type colour from the start. The toast's lifetime is unchanged (default 4 s, stated as `DEFAULT_DURATION_MS`). `ToastProvider.tsx` hands the fill time to the CSS as `--kt-dur`; it pauses with sonner's timer on hover (`data-expanded="true"`) and is off under `prefers-reduced-motion`. It is a BACKGROUND layer on `.kiosk-toast` — never use `::before`/`::after` on a sonner toast, sonner owns both (swipe, hover bridge). Rejected the same evening: a 4 px strip on the bottom edge, and a fill that drains from full to empty. Probe: `scratchpad/toast-band-probe.cjs` (Chromium + Firefox, 24 checks).
- **sonner's own CSS must survive the ClientRouter (fixed 2026-11-24, `e46a3db5`):** sonner injects a `<style>` (the toaster's `position: fixed`) into `<head>` at module load, and the router drops head elements the next page lacks — after ANY in-app navigation every toast fell into the page flow under the masthead and pushed the page down ~35 px (owner report: „teilen does nothing, the page jumps"; a reload cured it; live since the kiosk migration). `ToastProvider.tsx` copies that style into `newDocument.head` on `astro:before-swap`. Same trap for any library that injects CSS at import. Probe: `scratchpad/share-probe-toastpos.cjs` — assert the toast's RECT and the host's computed `position`, never only its text.

### Page-change loader (the ladybird, 2026-11-24, `fd3e45eb`)
`src/components/KioskLoader.astro`, mounted in `KioskLayout` ONLY (not admin, landing or auth). On every ClientRouter navigation the Mahalle ladybird (Claude Desktop's print mascot, `Downloads/marienkaefer/`, shape unchanged; ink parts `currentColor`, wing case print red `#DB472D`) walks on the spot in the middle of the screen while a small street slides past behind it; no frame, soft fade at the edges, a blurred paper patch behind. Rules:
- **Never holds the page back.** It starts on `astro:before-preparation`, ends on `astro:page-load`, and shows for at least ~1.4 s (`MIN_MS` + fades) on the owner's wish („visible all the time").
- **Driven by `requestAnimationFrame` from ONE clock, not by CSS:** the router replaces `<body>` mid-walk, a CSS animation would restart. The script looks the element up again every frame. The scene has its own `view-transition-name` with the old snapshot hidden (no frozen ghost in the page fade).
- **Direction follows the nav bar** (`src/lib/loader/walkDirection.ts`, 11 tests; keep its section list equal to `FORUM_MATCH`/`CALENDAR_MATCH` and the nav order in `KioskNav.svelte`): target further right walks right, further left walks left; inside a section deeper = right, back up or the back button = left; pages without a place walk right. Left = the whole scene mirrored (`data-dir="l"`).
- **Three depths**, all drawn BEHIND the beetle: houses 30 px/s, a small far tree + lamp post 38 px/s, the street with near trees/lamp/mast 55 px/s. **Keep x = 126…271 of the front row free of anything tall** and the far objects clear of x = 160 for the first ~55 px: the eye must find the beetle on open street. No house is red; doors wear the house colour with an ink outline.
- Reduced motion: the street stands still. Rejected the same evening: a strip under the masthead with a fast beetle, and a framed card.
- Probe: `scratchpad/loader-probe.cjs` (Chromium + Firefox, 42 checks, records clips), stills `scratchpad/loader-stills.cjs`. Not built: the small in-page beetle that would replace the spinning rings.
- **The same beetle sits on the masthead logo** (2026-11-24, `7f781d73`, `KioskNav.svelte`): 80 % of the disc wide (32 px on desktop, owner's choice), standing ON the disc so it „hugs" the logo — legs on the wine, wing case over the paper ring; a paper halo only on the outside, masked away over the logo. At 2 o'clock from `lg`; below `lg` (54 px bar) lower on the rim, or the antennae are cut off at the top. Geometry notes are in the component comment; sheet of all bars: `scratchpad/logo-bug-shots.cjs`. Member pages only — not the login/landing pages, the favicon or the print logo.

### Cloudinary URL Optimization
- **Utility**: `src/utils/cloudinary.ts` exports `optimizeCloudinary(url)` — rewrites any Cloudinary URL to inject `f_auto,q_auto` (auto format + auto quality) for ~30-60% smaller transfers. No-op for non-Cloudinary URLs or URLs that already have those transforms.
- **Applied in**: `KioskAvatar.svelte`, `ForumPostCard.svelte`, `ForumPostDetail.svelte`, `ArticleImage.svelte`, `ListingLead.svelte`, `ListingImagePlaceholder.svelte`, `OwnerDraftsSection.svelte`, `DraftsPage.svelte`, `AdmQueueCard.svelte`, `LandingPage.svelte`. Apply anywhere you render user-uploaded Cloudinary images.

### `content-visibility: auto` for heavy card lists
Forum cards wear `[content-visibility:auto] [contain-intrinsic-size:400px]`. Offscreen cards skip layout, paint, AND filter passes — browser treats them as the intrinsic size until they enter the viewport. On a 12-card page with only 4 visible, 8 cards' `backdrop-filter` + SVG wobble never run. Layout jumps avoided via `contain-intrinsic-size` matching the real `h-[400px]`. Apply to any list where items have expensive filters/shadows AND fixed/predictable height. Don't use on items with unpredictable height — `contain-intrinsic-size` will mis-estimate and cause scrollbar jitter.

### Horizontal scroll-fade utility (peek + scroll shadow)
Reusable pattern for horizontally-scrolling pill/chip rows where you want the off-screen edge to read as "fades into more content" rather than "ends here". Two pieces:

- **CSS class `.kiosk-scroll-fade`** in `global.css` — applies a `mask-image` gradient keyed off `data-scroll-left` / `data-scroll-right` attributes (3 states: right-fade only, both-fade, left-fade only).
- **Svelte action `scrollFade`** in `src/lib/scrollFade.ts` — writes those data-attributes from a scroll listener + `ResizeObserver`. Cleans up on destroy.

Usage:
```svelte
<script>
  import { scrollFade } from '../../../lib/scrollFade';
</script>
<div use:scrollFade class="kiosk-scroll-fade no-scrollbar flex overflow-x-auto gap-2">
  {#each items as item}
    <button class="shrink-0">…</button>   <!-- shrink-0 is essential — keeps pills at natural width so the row scrolls -->
  {/each}
</div>
```

Self-disables when the host has no box (e.g. `lg:contents` to dissolve the wrapper on desktop): `scrollWidth/clientWidth` read 0, no attrs match, no fade applies. So you can pair it with responsive layouts that switch from "scroll on mobile" to "flex-wrap on desktop" without extra responsive CSS. **Caveat:** `mask-image` masks the entire painted output including borders — if the scroll host has a `border-b border-dashed`, the dashed line will fade at the edges in mid-scroll. Move the border to a sibling element if that looks distracting. React-side: import the function directly and drive it from a `useEffect` — the lifecycle just doesn't get the Svelte action's automatic mount/destroy. Used today: forum TagBar (filters + tag rows), calendar mobile category rail, event-compose category rail.

## Color Palette
The project uses these CSS variables (defined in `global.css`):
- `--color-primary`: #4b9aaa (Teal)
- `--color-secondary`: #814256 (Wine/Burgundy)
- `--color-yellow`: #eccc6e (Yellow/Gold - main background)
- `--color-gray`: #aca89f (Gray/Beige)

When I say yellow, red, green, I always mean the default variants of the project.

### Masthead + bottom nav (kiosk chrome)
Both bars take the **section colour** (table below); Markt, Profil/Auth and pages without a `data-page` differ as listed there, the admin masthead is plum. Mechanism: every bar is COMPOSED on `<body>` in `tokens.css` from `--k-bar-lines`, `--k-bar-wash`, `--k-bar-shade` and the page's `--k-bar-tint`; a page only sets the tint, keyed off `<body data-page>`. Compose on `body`, not `:root` — a `var()` inside a custom property resolves where it is DECLARED. `KioskNav.svelte` reads `--k-bar` / `--k-bar-fg` and has no page knowledge. Frames (logo ring, DE/EN pill, search/bell/avatar discs) are paper on every bar. Bar height 54 px on phones / 67 px desktop; below `lg` the top bar hides on scroll down (it moves via `top`, never `transform`, and publishes `--k-mast-offset`). Full notes (every colour trial, hairlines, bevels): `docs/reference/kiosk-chrome.md` and `src/components/forum/kiosk/CLAUDE.md` → „Ochre masthead".

### Page inset + page width (kiosk)
Every main section's page-level wrappers use ONE side inset: **16 px on phones · 36 px from `md` · 40 px from `lg`** — `px-4 md:px-9 lg:px-10` (margins `mx-4 md:mx-9 lg:mx-10`). There is no shared wrapper component; copy the three classes. Every main section sits in ONE centred 1280 px column: forum on its `<main>`, Kiez-Daten on the orchestrator root, calendar / News / Markt via a plain `<div class="mx-auto w-full max-w-[1280px]">` around the island in the `.astro` page (a plain block — no transform/filter — so fixed and sticky children keep working). A new main section must bring the same wrapper. Deliberate exceptions and the measuring probes: `docs/reference/kiosk-chrome.md`.

### Page-accent rule (kiosk)
Each main page has its own accent color used for **kickers** (mono-uppercase eyebrows) and **carved-italic title accents**. The pairing:

| Page | Accent | Tailwind | Bars (masthead + bottom nav, 2026-09-22) |
|---|---|---|---|
| Forum | wine | `text-wine` (`#b23a5b`) | lighter burgundy `#95425d` (`--k-wine-deep`; `#814256` and `#a1415f` each held minutes on 09-22) |
| Calendar | teal | `text-teal` (`#3f8f9f`) | teal one tick calmer `#3f7e8a` (bars only, 09-22 15:00) |
| Admin | plum | `text-[#6f2f59]` via `--k-plum` | own plum masthead (AdminLayout) |
| Kiez-Daten | moss | `#6b8a4a` via `--k-moss` | moss |
| Blog | rust | `#a3552e` via `--k-rust` | rust |
| Marketplace | wine | shares the forum's wine deliberately | `#d68a1a` + paper text since 09-28 (was `#df9b2f` + ink text, 09-22); the `/search` page wears the same bar |
| Newsboard (Kurier) | ink | ink-only surface — its "newspaper" identity, no color accent | ink |
| Auth / Profile | ochre | `--k-ochre` | Profil: six-colour fade with ink edges (09-28); Auth has no masthead; other pages without a slug: ochre |

When migrating a surface into kiosk, swap kicker + italic-accent text to the page's color. **Don't touch:** live-now indicators, weekend day labels, required-field asterisks, compose step numbers (`01`, `02`, …), CTA wine-shadows, modal wine-shadows — those are semantic/sticker accents, not brand accent, and stay wine across all surfaces. **Exception since 2026-09-22 (user decision): the calendar's today indicator (the filled day-number disc + the „HEUTE" label) is teal, matching its section accent, since the calendar bars went teal** — every other surface's today-equivalent stays wine. **Exception since 2026-09-20 (user decision): the floating „+" button on phones takes the page colour** — forum wine, market a DARKER ochre `#b97a1a` with a paper plus since 2026-09-22 (user trial: plain ochre `#e8a53a` had no contrast for a paper plus and vanished against the ochre bottom bar), calendar teal, News ink (with the wine print shadow); all four surfaces have one now, see `src/components/forum/kiosk/CLAUDE.md` → „Floating „+" on phones".

## Common Errors to Avoid

### SSR Compatibility
- A library that touches browser globals at module load (the former `typewriter-editor`, removed 2026-09-30, read `KeyboardEvent` at import) needs a dynamic import inside `onMount()` — a static import breaks SSR
- **Prerendered pages + auth**: Middleware uses `context.isPrerendered` to skip `getSession()` on prerendered routes (avoids `Astro.request.headers` warning). The legacy `BlogBaseLayout` (deleted in the kiosk blog migration, July 2026) used to read session from `Astro.locals.session` because `/blog` was prerendered; the kiosk `/blog` routes are SSR (no `prerender` export anywhere under `src/pages/blog`) and go through `KioskLayout`, which calls `getSession(Astro.request)` directly like every other kiosk page — see `src/components/blog/CLAUDE.md`'s "Decision 1" for why SSR was required.
- **Navbar on prerendered pages**: `Navbar.tsx` and `BaseLayout` were removed on 2026-09-30 (dead since the kiosk migrations); the kiosk chrome is `KioskNav.svelte`, fed by `KioskLayout`'s SSR session.
- **QueryProvider hydration**: `src/providers/QueryProvider.tsx` was removed on 2026-09-30 (dead since the kiosk migrations); no page mounts a React Query provider any more.

### Astro Script + ViewTransitions
- Module `<script>` tags are deferred and only execute once — they do NOT re-run on ViewTransitions navigation
- `<script is:inline>` may or may not re-run — use `data-astro-rerun` to force re-execution on every navigation
- For critical synchronous code (e.g. splash screen), always use `is:inline` — module scripts load too late for timing-sensitive DOM manipulation
- `astro:before-swap` event can modify `e.newDocument` before it enters the live DOM — useful for stripping elements from incoming pages
- **`history.replaceState`/`pushState` must carry Astro's ClientRouter state** (learned 2026-09-13, forum back-nav): with `<ViewTransitions />` the router keeps `{ index, scrollX, scrollY }` in `history.state` and reads `index` on popstate to know the direction; `replaceState({}, '', url)` wipes it and `pushState({}, …)` pushes an entry with no index. Always `history.replaceState(history.state, '', url)`. Worked example: `src/components/forum/kiosk/ForumIndexInner.svelte` (URL-synced filter/tag/page state). **The former offenders were fixed on 2026-10-02** (`CalendarPageInner.svelte` ×2, `NewsboardIndexInner.svelte`, `MarketplaceBrowseInner.svelte` ×2 — the market's `pushState` copies `history.state` too, so its entries keep a valid `index`; `SearchPage.svelte` on 2026-09-24). Still open on the market, older than that fix: every back/forward between two filter entries makes the ClientRouter refetch and swap the whole page (a non-null state without a hash change; the result is correct, only heavier). The search field no longer pushes one entry per keystroke (2026-10-02): the first letter adds an entry, further typing rewrites it, so „back" clears the search (probe `scratchpad/market-history/probe.cjs`).
- **A same-URL history entry without a hash makes the ClientRouter refetch and swap the whole page on `popstate`** — only a hash move short-circuits to `moveToLocation`. For an overlay that „back" should close, push a hash entry through `navigate('#hash')` from `astro:transitions/client` and consume it with `history.back()` on any other close path; worked example: `KioskNav.svelte`'s search modal.
- **Scroll restore for `client:only` islands is your own job**: on browser back the router scrolls right after the swap, while the island is still empty, so the attempt clamps to ~0 and the router's scrollend bookkeeping overwrites the saved position. Pattern (forum index): snapshot `{ token, index, href, y }` to sessionStorage on `astro:before-preparation` + `pagehide`, restore after the island's first render only when the per-document token (a `<script module>` const — the instance `<script>` re-runs per mount), `history.state.index` and the pathname match. A hard navigation (reload, `location.href`) is a new document and must not inherit the old scroll. Astro's DEV server preloads `client:only` pages in a hidden same-origin iframe (`prepareForClientOnlyComponents`, dev only) that mounts a second island — guard with `window.top === window.self`.
- **Production-build pass without Vercel**: the Vercel adapter can't `astro preview`, but `@astrojs/node` is installed — a scratch config (`scratchpad/astro.config.preview.mjs`: `{ ...base, adapter: node({ mode: 'standalone' }) }`) + `astro build --config …` + `PORT=4655 node dist/server/entry.mjs` (start it with `node --env-file=.env` — never `source`/`.` the file: line 55 (`SENDING_FROM_EMAIL`, unquoted `<…>`) stops a shell parse and the shell echoes the line (the peer hit it 2026-11-02)) serves the real prod bundle for headless probes.

### `position: sticky` + `overflow-x: hidden` interaction
- **Do NOT use `overflow-x: hidden` on `html` or `body`** — it silently breaks every `position: sticky` on the site. Per CSS spec, when one axis of `overflow` is `visible` and the other is not, `visible` computes to `auto`, turning the element into a scroll container. Sticky descendants then try to stick relative to body (which doesn't scroll) instead of the viewport, and never activate.
- **Use `overflow-x: clip` instead** (supported in all modern browsers since 2020-2022). `clip` prevents horizontal overflow without creating a scroll container. For very old browsers, pair with `overflow-x: hidden` as a fallback declaration FIRST:
  ```css
  html, body {
    overflow-x: hidden; /* fallback for pre-2020 browsers */
    overflow-x: clip;   /* modern — preserves position: sticky */
  }
  ```
- **If sticky stops working anywhere in the project**, check `global.css` and any container components for `overflow-x: hidden` on the axis-scroll ancestors. Use `getComputedStyle(el).overflowY` in devtools to verify — the "upgraded" value shows as `auto` even if you wrote `visible`.
- **This was a real latent bug discovered in March 2026.** The fix preserves sticky positioning globally (sticky headers, blog sidebars, calendar agenda headers, and any future sticky usage).
- **Corollary (Aug 2026, avatar-menu mobile sheet): the `html { overflow-x: clip }` rule ALSO defeats body-only scroll-locks.** With html's overflow non-`visible`, the body's overflow no longer propagates to the viewport — `document.body.style.overflow = 'hidden'` compiles, looks right in devtools, and does nothing (page still scrolls). Any JS scroll-lock in this project must set `overflow: hidden` on `document.documentElement` — **and on `<html>` ONLY** (inline style, save/restore the previous inline value so the stylesheet's `clip` survives). **Corrected 2026-09-19:** until then this note said „BOTH html AND body", and every lock did that. Measured on the real page: `html` alone locks (touch + wheel); `body` alone locks nothing; and `body { overflow: hidden }` turns `<body>` into its own scroll container, so the sticky masthead sticks to `<body>` instead of the screen — with the account sheet, the notification panel or any `lockPageScroll()` dialog open at `scrollY > 0`, the top bar scrolled away under the scrim (prod: header top `-380` at `scrollY 380`). Use `lockPageScroll()` (`src/lib/scrollLock.ts`); worked hand-written examples: `AvatarMenu.svelte`, `NotificationPanel.svelte`. Probe: `scratchpad/scrolllock-sticky-probe.cjs` (10 checks: bar stays stuck + page really locked, for all three locks). Still body-only and therefore NOT locking anything: `AdmModalShell.svelte` (admin bar is not sticky, so nothing un-sticks there) (the legacy `Navbar.tsx` had the same body-only lock and is gone). The React modals were unaffected — they used `react-remove-scroll`, removed with them on 2026-09-30.

### `backdrop-filter` creates a containing block for `position: fixed` descendants
- **Any element with `backdrop-filter: blur(*)` (or `filter`, `transform`, `will-change`, `perspective`, `contain: paint/layout/strict`) creates a containing block for its `position: fixed` descendants.** This means a modal with `position: fixed inset-0` inside a glass container with `backdrop-blur-*` will position relative to the container, not the viewport — rendering off-screen or partially visible.
- Symptom: modal opens (DOM is there, hydration works, backdrop darkens the page) but the modal content renders at weird coordinates (`rect.top` way above or below viewport). Often looks like "the modal doesn't open" because content is invisible.
- **Fix:** remove `backdrop-filter` from any ancestor of a fixed-positioned modal/overlay. On forum/blog/marketplace/etc., the outer glass container uses bg + borders only (no backdrop-blur). Cards inside can still have backdrop-blur on hover since they don't contain fixed descendants.
- **Known offenders to watch:** any `bg-*/[n] backdrop-blur-*` wrapper that has a modal-opening action inside. If you add a new glass wrapper, audit whether any descendant can open a fixed overlay.
- **Unlike the sticky/overflow gotcha, this one was masked by working tests** — the modal works when opened from a non-glass-wrapped page, fails on forum/calendar/etc. First hit: forum ReadMoreModal in April 2026.

### Nested-island Svelte `<style>` blocks get orphaned in prod builds
- **A Svelte component imported ONLY through another Svelte island (never from any `.astro` file) loses its scoped `<style>` in production.** Astro/Vite extracts the CSS into a chunk that NO route links — the file is emitted and deployed, but nothing loads it. First hit: `AvatarMenu.svelte` (imported solely by `KioskNav.svelte`), Aug 2026.
- **Symptom**: component renders perfectly in dev (Vite injects styles via JS/HMR) and passes `pnpm build` green, but arrives completely unstyled in prod. The compiled JS applies the scoped classes; the CSS never arrives.
- **Diagnosis recipe**: build, then check the SSR manifest — `grep -o "<hash>.css" .vercel/output/_functions/manifest_*.mjs | wc -l`. A route-linked stylesheet appears once per route (~28×); an orphan appears exactly once (global assets list only).
- **Fix pattern**: move the styles into `global.css` with a namespaced class prefix (`.am-*`), same escape hatch as the `.kiosk-toast*` block. Components imported directly by a layout/page (`VerifyEmailBanner` etc.) are unaffected — their CSS lands in the route-linked bundle.
- **Rule**: any NEW styled `.svelte` component that is only reachable through another island either gets its styles in `global.css` from the start, or must be prod-build-verified with the manifest check above before declaring done.

### Platform notes (cold starts, visitor counting, Förderung page, database connect, uploads)
Full notes for all five: `docs/reference/platform-notes.md`. The rules:
- **Cold starts are the CPU bill, not traffic.** `vite.ssr.noExternal` in `astro.config.mjs` bundles `@sentry/*`, `@opentelemetry/*`, `date-fns`, `jose`, `@auth/core` into the server chunks; the list is BUILD-ONLY (gated on `process.argv.includes('build')`) because in `astro dev` it broke every page. Before adding a package that ships hundreds of files, re-measure (`scratchpad/coldstart/`; runbook `docs/runbooks/cold-start-cpu.md`). After a config change that touches the module graph, start the dev server once and load a page.
- **Visitor counting (GoatCounter):** `src/components/GoatCounter.astro` in `KioskLayout`, `LandingLayout`, `AuthLayout` — never `AdminLayout`. It renders only with `GOATCOUNTER_ENDPOINT` set AND `VERCEL_ENV === 'production'` AND a non-admin session. Privacy shape: path only, `/nachbarn/<handle>` collapsed, no title, query string blanked, external referrer on the first view only. Probe `scratchpad/goatcounter/gc-probe.cjs`. A stats card in the admin area is deferred, not built.
- **`/foerderung`** is the public transparency page (German only, indexable): a new funder gets a line with date, sum, period and precisely WHAT was funded; institution logos appear ONLY on that page, the footers stay a link word. The Sylff Association logo sits under its block since 2026-11-22 (their file, unchanged; their usage rules are in the reference file).
- **First database connect:** `connectDB()` retries the initial connect once (`src/lib/mongoRetry.ts`); never filter those errors out of Sentry. New code always uses `connectDB()`, never the default `clientPromise` export (it stays rejected for the life of an instance after one failed connect).
- **Uploads vs Vercel's 4.5 MB body cap:** every picker runs its file through `shrinkForUpload()` (`src/lib/images/shrinkImage.ts`); all image routes cap at `UPLOAD_MAX_BYTES` (4 MB). A new upload path must do both and refuse with `compose.error.imageTooLarge`.

### Server-only modules bleeding into client bundles
- **The server/client boundary in Astro is enforced by what you TRANSITIVELY import, not by file location.** If a React component with `client:only="react"` (or `client:load`) imports anything from a module that in turn imports `mongodb`, `fs`, `auth-astro/server`, etc., Vite pulls that entire module graph into the browser chunk. Node built-ins (`net`, `tls`, ...) get silently externalized and the chunk fails to evaluate at runtime — the component just never mounts.
- **Symptom**: page renders, hydration slot is empty, no obvious error in build output. `pnpm build` goes green because Vite doesn't error on unresolved Node built-ins in client bundles — it just produces a broken bundle. You only see it when you load the page in a browser.
- **Rule**: any file imported from both server (`.astro` frontmatter, `/api/*` routes) and client (React components, `.svelte` with `client:*`) must be **dependency-pure** — constants, types, pure functions. The moment it imports `mongodb`/`fs`/etc., it becomes server-only for import purposes.
- **Pattern**: split shared constants into a standalone file. Example: `src/lib/forumQueryOptions.ts` (pure, imported by both) vs `src/lib/topicsQuery.ts` (server, imports `connectDB`). The server file can re-export the constant for convenience; the client imports from the pure file directly.
- **Prevention**: after any SSR-touching change (new `Astro.locals` data threaded through, new shared util between page and component), **actually load the page in a browser** before declaring done. `pnpm build` is necessary but not sufficient.
- **First hit**: April 2026 — `FORUM_QUERY_OPTIONS` lived in `topicsQuery.ts`, which imports `connectDB`. ForumContainer's browser chunk included MongoDB, forum never hydrated.

### Cross-site form check lives in the middleware (2026-10-03)
Astro's `security.checkOrigin` is OFF in `astro.config.mjs`; the same rule runs in `src/middleware.ts` via `isCrossSiteForm()` (`src/lib/security/crossSiteForm.ts`, tested) with ONE exempt exact path, `/api/newsletter/unsubscribe`: Gmail/Yahoo POST the RFC 8058 one-click unsubscribe as a form without our Origin. Never re-enable Astro's check while that exemption is needed (it runs before the middleware and has no exemption list). The session cookie is SameSite=Lax, so cross-site form POSTs carry no session anyway. The check sits ABOVE the static-asset skip (`/_image`, `/favicon`, dotted paths), so it covers exactly what Astro's did. A bodiless `curl -X POST` without a content type is refused too — cron workflows use GET.

### Sticky bottom bars + `KioskLayout` footer math
See `src/components/forum/kiosk/CLAUDE.md` — full notes load when working in that subtree (rule of thumb: don't add a big spacer above sticky bars on kiosk pages — the `KioskFooter` already provides clearance).

## UI Verification (playwright-cli)

`@playwright/cli` (Microsoft, v0.1.x — released May 2026, **not** the old deprecated `playwright-cli` package) is installed globally for browser verification. Lets the assistant navigate the running dev server, capture token-efficient YAML snapshots of the a11y tree, click/fill elements, and read console logs — without needing the user to send screenshots.

- **Install** (already done; one-time): `npm install -g @playwright/cli@latest && playwright-cli install-browser chromium && playwright-cli install`. System libs `libnspr4` + `libnss3` required on bare WSL Ubuntu (everything else usually pre-installed).
- **Workspace files**: `.playwright/cli.config.json` (config) and `.playwright-cli/` (per-session snapshots + console logs). Both are gitignored.
- **Common flow**: `playwright-cli open <url>` opens the browser, navigates, and captures a snapshot at `.playwright-cli/page-<timestamp>.yml`. Element refs (`[ref=eN]`) in the YAML are usable with `click`, `fill`, `type`, `hover`, etc. Always `playwright-cli close` at the end of a verification session — daemons survive across commands.
- **Caveat: `client:only` Svelte/React islands**. The initial snapshot fires at `domcontentloaded`, before islands hydrate. `<main>` will look empty on Forum pages. Either re-snapshot after a delay, or use `wait-for` for a known post-hydration selector.
- **Caveat: auth-gated routes**. `/topics/create`, `/admin/*` redirect to `/login`. Two ways to verify auth-only UI: (a) scripted login — `goto /login` → `fill` email + password → `click Login` (requires test creds in chat — avoid); (b) cookie reuse — user logs in once in their normal browser, copies session cookie, assistant sets it on the CLI session (preferred — no creds in chat history).
- **When to use it**: any time the user reports a visual issue ("there's a gap", "looks wrong on mobile") OR you've made a UI change you want to verify before declaring done. Avoids the "I theorized it was invisible — actually no, the user could see it" trap from the May 2026 mobile-compose polish session.

## Error Monitoring (Sentry)
Full notes: `docs/reference/error-monitoring.md`; runbook `docs/runbooks/sentry-smoke.md`. The rules:
- **Errors only** (`@sentry/astro`, no tracing, no replay, `sendDefaultPii: false`, EU org); the free tier's 5k errors a month is the whole budget.
- **Server request-error capture lives in `src/middleware.ts`**, not the SDK's auto-middleware: a side-effect `import '../sentry.server.config'` (cold API-only instances are otherwise uninitialised) and `captureException` + `await Sentry.flush(2000)` + rethrow inside the request window (Vercel freezes the function when the response leaves). Never simplify either piece away.
- **Filters:** the server `beforeSend` drops OpenAI rate-limit noise, `AbortError`, transient Mongo network timeouts and every `development` event (preview + production still report). The client filter is `isClientNoise()` (`src/lib/sentry/clientNoise.ts`) — keep it narrow, never add a pattern for something a member could see.
- **Silent degradation must alert:** a code path that swallows a provider failure emits `Sentry.captureMessage` with a STATIC message (the variable reason in `extra`) + `await Sentry.flush(2000)`. Resolve an outage issue after fixing it, so the next outage re-alerts.
- **Blind spot 1 — callers outside the app** (GitHub-Actions crons, webhooks): they can fail without one Sentry event. After ANY change to origins, domains, redirects or auth headers, re-verify every external caller by hand (`gh run list --workflow=<name>`); prefer a data-freshness watchdog (`checkAirLoggerFreshness()` is the worked example).
- **Blind spot 2 — a wrong STATUS CODE on our own routes:** `scripts/smoke-auth.mjs` runs against prod every 30 min (`.github/workflows/smoke-auth.yml`, Telegram on failure), and the four auth forms report an unexpected server answer as ONE static message (`reportUnexpectedAuth()`).
- **Both Sentry configs scrub URLs** (`src/lib/sentry/scrubUrl.ts`): four pages carry single-use tokens in their query string.
- Widget: `AdmErrorsCard.svelte` on `/admin/moderation` via `GET /api/admin/errors`. `SENTRY_AUTH_TOKEN` is read-scoped (resolve issues in the Sentry UI or through the Sentry MCP).

## Secret Scanning
- **Pre-commit**: `.husky/pre-commit` runs `gitleaks protect --staged` on every commit. Falls back to a warning (exit 0) if gitleaks isn't installed locally, so collaborators without it aren't blocked.
- **CI safety net**: `.github/workflows/gitleaks.yml` runs `gitleaks/gitleaks-action@v3` on push to `main` and on PRs — catches anything that bypassed the local hook.
- **GitGuardian mails („internal secret incidents … Generic Password")** are a third scanner on the public repo, not ours. On 2026-10-02 it reported 7 incidents on `31ea3889`: the made-up sample passwords in `src/lib/auth/passwordRule.test.ts` — a false positive (verified: the dev test password is not in the commit). Before dismissing such a mail, read the named commit and compare against the real secrets by COUNT only (`grep -c -F -f <secret file>`), never by printing. Mark them „false positive / test credential" in the GitGuardian dashboard.
- **Whitelist**: `.gitleaksignore` lists historical findings accepted as residual risk (fingerprint format `<sha>:<file>:<rule>:<line>`). Add new entries only after a deliberate decision; each line silences a real finding.

## Repo identity & code backup
- **GitHub repo**: `atakee72/mahalle-digital` (renamed 2026-09-09 from `fullstack-community-webApp-astro---v.3`; the old URL 301-redirects for web, clone and push). Kept **public** by decision — the Impressum and the manifest blog post link to it as a trust point. The local folder name was deliberately NOT renamed (worktrees, memory dir and scratchpad paths depend on it).
- **Off-site code backup**: `.husky/pre-push` writes ONE bundle file (`git bundle create … --all`, full history + all branches) to `/mnt/c/Users/atakee/Dropbox/Backups/mahalle-digital.bundle` on every push. A bundle, not a bare repo, because Dropbox syncing a bare repo mid-write can corrupt objects; git writes the bundle to a `.lock` and renames it. Non-blocking: a missing Dropbox mount warns and lets the push through. Restore: `git clone <bundle>`. **Stale lock (2026-11-16, `7c8deeba`):** a `.bundle.lock` left by an interrupted run blocked every bundle from 11-04 to 11-16 while the hook only warned; it now removes a lock older than 60 minutes first. Read the push output — „backup: WARN" means no backup was written. Independent of the GitHub remote (rename/visibility don't touch it). `.env` is the one file no backup covers — keep a copy in the password manager.
- **If the repo ever goes private**: Actions minutes stop being unlimited (2,000/month on Free, each job rounded up to a full minute — the 30-min air logger alone is ~1,460/month → switch it to hourly first; each tick stores only the current BLUME reading, so 2-hourly halves the dataset), enable "Include private contributions" on the GitHub profile (streak widget + daily routine), rewrite the Impressum's „öffentlich einsehbar" sentence, and host `MANIFESTO.md` on-site (the manifest post links into the repo).

## License
PolyForm Noncommercial 1.0.0 — see `LICENSE`. Free for noncommercial use; commercial use requires a separate license from the author.
