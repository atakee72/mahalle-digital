# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Mahalle - A Fullstack Community Web App for Local Neighborhoods. The name means "neighborhood" in Turkish and sounds like "meine Halle" (my hall) in German, reflecting the multicultural community it serves.

**Landing + forum split (Aug 2026)**: `/` is the public landing page („Das Schaufenster" — `LandingLayout.astro` + `src/components/landing/LandingPage.svelte`), SSR-gated so any logged-in member is redirected straight to `/forum` before render. The forum index itself lives at `src/pages/forum.astro`. See "Landing + login gating" below.

## Tech Stack
- **Framework**: Astro 5.x with React 18.2 (hybrid SSR/SSG)
- **Styling**: Tailwind CSS 3.4
- **Animation**: Motion 12.x (`motion/react` for React, Web Animations API for Astro inline scripts)
- **State Management**: TanStack Query for server state + local `useState` for UI (no Zustand/Redux)
- **Data Fetching**: TanStack Query 5.17 (with `@tanstack/react-query-devtools` in dev)
- **Authentication**: auth-astro with NextAuth (Credentials provider)
- **Database**: MongoDB 6.3 (direct driver, no Mongoose)
- **Deployment**: Vercel (serverless) — function region pinned to `fra1` in `vercel.json` (July 2026): the Atlas cluster lives in Frankfurt, and the default `iad1` made every DB roundtrip cross the Atlantic (root cause of recurring `MongoServerSelectionError` blips + slow SSR). Don't remove the `regions` pin; verify with `curl -sI <prod>/api/kiez-stats | grep x-vercel-id` → must show `fra1::fra1`. Full incident record: `docs/runbooks/mongo-region-incident.md`.
- **Validation**: Zod schemas

## Development Commands

```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm type-check   # TypeScript validation
npx -y svelte-check@4  # Svelte diagnostics sweep — dev-only warnings (e.g. state_referenced_locally) never appear in `pnpm build` output
# CI (checks.yml) gates PRs on ratchet-only error budgets: tsc ≤26, svelte-check ≤92 (2026-09-10 baselines: 27/94→26/93 on 09-06 when the contact-form i18n fix cleared an untyped record, 93→92 on 09-10 with the shared initialsOf helper — lower them when errors get fixed, never raise them)
```

## Project Structure

```
src/
├── components/       # React components (.tsx)
├── layouts/          # Astro layouts (BaseLayout.astro)
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
│   └── api/          # TanStack Query hooks
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
- Uses `auth-astro` wrapping NextAuth v5 beta (which itself wraps `@auth/core`)
- Credentials provider with bcrypt password hashing
- MongoDB adapter for session storage
- JWT strategy for stateless auth
- Config in `auth.config.ts`
- **Role**: users have `role?: 'user' | 'admin'` on their MongoDB doc. The `authorize` → `jwt` → `session` callback chain in `auth.config.ts` propagates it so `session.user.role` is available on every API route + page. Type augmentation lives in `src/types/next-auth.d.ts` (must augment `@auth/core/types` and `@auth/core/jwt`, not `next-auth/*` — that's the package the lib actually uses).
- **emailVerified (soft gate)**: propagated through the same `authorize` → `jwt` → `session` chain as `role`, so `session.user.emailVerified` exists everywhere — but it SNAPSHOTS at login (JWT). For live truth use `GET /api/auth/verification-status`. Verification never blocks login or features; it only drives `/verify-email` + the `VerifyEmailBanner` nag in `KioskLayout`. Emailed links (reset + verify) build their base URL via `getTrustedBaseUrl()` (`src/lib/auth/baseUrl.ts`, NEXTAUTH_URL, prod fail-closed).
- **Other-device sign-out**: the `jwt` callback stamps an immutable `token.loginAt` once at login (deliberately NOT the auto-refreshed `iat` claim) and, at most every 5 minutes per token, compares it against `users.passwordChangedAt` — a token whose `loginAt` predates a password change/reset returns `null` from the callback, forcing that device to re-authenticate. Full story (silent same-device re-login, legacy-token handling) in `src/components/profile/kiosk/CLAUDE.md`'s "Password change" section.
- **Admin gate helper**: `requireAdminSession(request)` in `src/lib/auth.ts` returns `{ ok: true, userId }` or a pre-shaped 401/403 `Response`. Used by all `/api/admin/announcements/*` endpoints.

### Landing + login gating (Aug 2026)
- `/` is the public landing page; any request with a session is SSR-redirected to `/forum` before render (members never see the landing). Logged-out visitors get the landing, `/forum` and the other member surfaces bounce to login.
- **Gate lives in `src/middleware.ts`**, runs only for SSR (non-prerendered) requests, ahead of the pre-existing protected-routes block:
  - `GATED_PAGES` (prefix match, → `302 /login?redirect=<path+search>`): `/forum`, `/topics`, `/announcements`, `/recommendations`, `/calendar`, `/events`, `/newsboard`, `/marketplace`, `/bookmarks`, `/search`, `/steckbrief`, `/nachbarn`.
  - `GATED_APIS` (prefix match, → `401 { error: 'Unauthorized' }`): `/api/topics`, `/api/announcements`, `/api/recommendations`, `/api/events`, `/api/news`, `/api/comments`, `/api/listings`.
  - `API_ALLOWLIST`: `/api/news/fetch-daily` — the daily news cron authenticates via its own `CRON_SECRET` Bearer header and must keep working without a session.
- **Marketplace gated since 2026-08-25** (user decision: inner-community, not a public market — this closed the formerly pending "keep it public for SEO" question); `/profile` stays ungated (it renders its own logged-out state rather than redirecting).
- **`?redirect=` login flow**: both the middleware's post-login bounce and `AuthLoginInner`'s post-login navigation validate the target through the shared, dependency-pure `safeInternalPath()` (`src/lib/auth/safeRedirect.ts`) — it parses the candidate against a fixed private base origin via `URL` and accepts it only if the parsed origin didn't escape that base, returning the re-serialized `pathname + search + hash` (never the raw string). This replaced an earlier `startsWith('//')`-style character-enumeration guard, which WHATWG URL normalization can bypass (e.g. tab/CR/LF stripped before resolution turns `/\t/evil.com` into `//evil.com`).
- **`/landing` → `/` (301)**: the old `/landing` route is a redirect-only fossil kept for any stale bookmarks/links from before the route swap.

### API Routes
All API routes in `src/pages/api/` follow this pattern:
```typescript
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../lib/mongodb';

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  // ... handler logic
};
```

### Outgoing Email (shared mailer)
- **One transport chooser**: `src/lib/email/mailer.ts` (SERVER-ONLY) — SMTP (nodemailer, mailbox.org) when `SMTP_HOST/USER/PASS` set, else Resend when `RESEND_API_KEY` set, else "not configured" and each send module dev-logs its link instead of sending. `sendMail()` THROWS on failure — including Resend's `{ error }` return, which the SDK does not throw on — and captures to Sentry with `flush(2000)` before rethrowing (best-effort callers swallow the throw; Vercel freeze would eat an unflushed capture).
- **Send modules** (`src/lib/auth/send*.ts`, contact relay) own copy + dev-log fallbacks; the mailer owns transport, From (`SENDING_FROM_EMAIL`), timeouts (SMTP: 10s connect, `requireTLS`; Resend: 10s `Promise.race` around the SDK send — its bare fetch has no timeout and would otherwise hold the caller's request open until Vercel kills the function). `sendWelcomeEmail.ts` fires from `/api/auth/verify-email` on the FIRST `emailVerified` false→true transition only (exactly-once via `findOneAndUpdate` returnDocument 'before'), awaited best-effort inside the request window — never at registration (deliberate: no double mail on signup).
- **Contact relay fails closed**: `POST /api/listings/[id]/contact` returns `503 email_unavailable` in prod when no transport is configured (before rate-limit/metadata writes).
- **Prod transport is Resend** (since 2026-08-09, domain switch): `RESEND_API_KEY` + `SENDING_FROM_EMAIL="Mahalle <noreply@mahalle.digital>"` in Production; `SMTP_*` REMOVED from prod (mailbox.org SMTP retired there — it sent from the borrowed `noreply@ercan-atak.de`). Local `.env` still carries `SMTP_*`, so dev uses SMTP; that's fine. Resend domain `mahalle.digital` verified (EU region `eu-west-1`; DKIM/SPF/MX live on the `send.` subdomain at Porkbun, DMARC `p=none` on root). Preview deploys have no transport → auth mails dev-log into function logs; the contact relay 503s there since `import.meta.env.PROD` is true on Preview builds too. Runbook: `docs/runbooks/smtp-mailer-smoke.md` (SMTP-era, kept for the transport-chooser smoke pattern).

### Admin alerts (Telegram + email mirror)
`src/lib/adminAlerts.ts` (server-only) pings the single admin: Telegram for everything (new member, moderation-queue item, report, new content/comment, marketplace contact, Sentry issue via `POST /api/hooks/sentry` — secret-guarded, middleware-allowlisted), email mirror (`ADMIN_ALERT_EMAIL`) only for member/moderation/report. Contract: never-throw (static `captureMessage` + flush), awaited best-effort in the request window, 10s TG timeout, silent no-op without `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ADMIN_CHAT_ID` (preview/dev default). Self-suppression: the admin's own actions never alert (rides the `skipModeration` gates), EXCEPT the marketplace contact relay (`/api/listings/[id]/contact`) which is session-less by design (buyer is anonymous) — an admin using the relay does ping himself. Either/or rule: a creation sends `content_new` OR `moderation_flagged`, never both; news always sends `moderation_flagged` (editorial queue). The `moderation_flagged` alert on fail-safe `moderation_error` records doubles as an OpenAI-outage tripwire.

### Data Fetching
- TanStack Query for client-side data fetching
- Custom hooks in `src/hooks/api/` (useTopicsQuery, useEventsQuery, etc.)
- QueryProvider wrapper in `src/providers/QueryProvider.tsx`

### State Management
- TanStack Query for server state (hooks in `src/hooks/api/*`)
- Local `useState` in container components for UI state — no Zustand/Redux
- Canonical v5 mutation pattern: optimistic `onMutate` + `onError` rollback + single `onSettled` invalidation. Never stack `onSuccess` + `onSettled` invalidations (causes double-refetch flicker).

### Content Moderation
- **AI moderation**: OpenAI `omni-moderation-latest` scans all content types (topics, comments, events, announcements, recommendations, marketplace listings) on submission
- **GPT content check**: `checkSpamWithGPT()` runs in parallel with `moderateText()` on all content types — catches spam, ads, scams, **hate speech**, and **harassment** that the safety scan misses. `irrelevant_nonsense` classification is treated as legitimate (too many false positives on short/casual content like "nice", "Çok iyi!"). `hate_speech` and `harassment` are flagged as urgent.
- **Image moderation**: Forum posts (topics, announcements, recommendations) and marketplace listings get `checkImagesWithGPT()` (GPT-4o vision) for image safety — runs in parallel with text moderation
- **Profanity blocklists**: Turkish, English, and German blocklists in `lib/moderation.ts` — ALL THREE run on every post's text BEFORE the AI (word-boundary match, short-circuits into the flag queue with hardcoded harassment 0.8). **Cross-language collision rule (learned 2026-09-01, the „mal" incident)**: before adding a word, check it against common words in ALL community languages post-normalization — removed that day: TR `mal`/`meme`/`lan`/bare `göt`/`got`, EN `dick`/`ass`, DE `dreckig`/`behindert` (each was flagging legitimate German/English text; contextual abuse stays caught by the OpenAI + GPT checks). Residual accepted: `piç`→`pic` / `oç`→`oc` fold onto English "pic"/"OC" inseparably. Leetspeak normalization (`normalizeLeetspeak()` converts `0→o, 1→i, 3→e, 4→a, 5→s/c, 7→t, 8→b, @→a, $→s` etc.). Runs two normalization passes for ambiguous characters (e.g. `5` can mean `s` or `c`).
- **Username validation**: `checkNameProfanity()` at registration — runs all 3 blocklists (word-boundary + substring check for concatenated profanity like "PenisPenisPenis"), then `moderateText()` + `checkSpamWithGPT()` via OpenAI as safety net for creative spellings and hate speech.
- **Result merging**: `mergeModerationResults()` combines all checks into a single flagged record
- **Daily posting limits**: 5 per rolling 24h for topics, events, announcements, recommendations, and marketplace listings. Comments excluded (lightweight/conversational). Checked before validation to save API costs. **Admins are exempt** (limits since 2026-08-30, moderation since 2026-09-01): all 7 create/publish gates skip the daily limit on `session.user.role === 'admin'` (3 `daily-count` pre-checks report `canCreate/canSubmit: true`), AND all 12 create/edit/publish endpoints skip the AI moderation pipeline entirely for admins — no OpenAI calls, no blocklist, no `flaggedContent` record, straight to `approved` (news: straight to the newsboard, no editorial queue record). The listings-edit audit-trail snapshot still runs for admins (provenance, not moderation). NOT exempt: the marketplace contact relay (`/api/listings/[id]/contact`) — its moderation guards outbound email in the app's name. Admin news items get `approvedAt`/`fetchDate` stamped at insert (parity with `processReviewAction`'s approval stamps — without `fetchDate` the item sorts last on the newsboard and the landing Kurier drops it). Caveat: a demoted admin's stale JWT keeps `role: 'admin'` for up to 7 days — when demoting, also force a password reset (stamps `passwordChangedAt`, invalidating old tokens).
- **User reports**: Community can flag content via report button (topics, comments, events, announcements, recommendations, marketplace listings). Kiosk calendar reports at the EVENT level via `EventDetailModal` + `KioskReportModal` (`contentType: 'event'`); event *comments* were dropped in the kiosk migration (deliberate, confirmed 2026-09-06), so there is no comment-level report on the calendar. Forum comments ARE reportable via the kiosk comment ⚑ trigger (2026-09-06). **Self-delete keeps the report (2026-09-08):** when an author deletes their own reported/flagged content, all 6 self-delete handlers (`topics`/`events`/`comments`/`announcements`/`recommendations`/`listings`) stamp `flaggedContent.contentDeleted: true` instead of orphaning the record — it stays `pending` in the active admin queue, still reviewable/strikeable from the stored snapshot (report-laundering guard), and the queue card shows a „Vom Autor gelöscht" badge (`AdmQueueCard`/`AdmTriageCard`, key `admin.card.contentDeleted`). No `reviewAction.ts` change needed (strike targets the surviving author doc). News has no self-delete route, so it's unaffected.
- **Admin queue**: `/admin/moderation` page (kiosk design system: `AdminLayout.astro` + `src/components/admin/kiosk/ModerationApp.svelte` orchestrator + `Adm*` components) with filter tabs (All/Discussion/Comment/Event/Announcement/Recommendation/Marketplace/News + ⚑ Reported), plus a desktop-only Protokoll (history) view and bulk approve/reject. `AdminLayout` is also shared by `/admin/announcements` and `/admin/mitglieder` (pages pass `wordmark`/`ribbonEcho` to customize the masthead; the layout itself renders the Moderation · Amtliches · Mitglieder section rail on desktop and mobile — see `src/components/admin/CLAUDE.md`).
- **Admin official announcements**: `/admin/announcements` — also kiosk (`AdminLayout` + `AnnounceApp.svelte` orchestrator, `src/components/admin/kiosk/announce/`), migrated off the legacy dark-glass panel in July 2026. Optimistic oldest-pin displacement (three-pin board) + View-Transition board↔archive animation + two-PATCH undo (unpin new, restore displaced); full architecture in `src/components/admin/CLAUDE.md`.
- **Warning labels**: Approved-with-warning content shows blur overlay until user clicks "Show content anyway" (persisted to localStorage)
- **Strike system**: 3 strikes = automatic user ban — enforced at login (no session for banned accounts) and on all content-write APIs (403 `account_banned` via `src/lib/auth/banGuard.ts`); banned users keep read access
- **Status flow**: `pending` → `approved`/`rejected` (with optional warning label)
- **Bulk review**: `POST /api/admin/moderation/bulk-review` — approve/reject up to 50 items at once. Skips already-reviewed items, processes all even if some fail, returns partial results with ban notifications.
- **Shared review logic**: `src/lib/reviewAction.ts` — `processReviewAction()` handles updating flagged content, original content, comment parent arrays, strike system, and auto-ban. Used by both `review.ts` and `bulk-review.ts`. `bansTriggered`/`userBanned` count per **TRANSITION** (not-banned → banned), guarded by `isBanned !== true` before setting the ban — rejecting multiple items from an already-banned author no longer inflates the count.
- Key fields: `moderationStatus`, `isUserReported`, `hasWarningLabel`, `warningText` on content

### Admin Moderation Table (kiosk: `ModerationApp.svelte` + `Adm*` components)
See `src/components/admin/CLAUDE.md` — full notes load when working in that subtree.

### Newsboard
See `src/pages/api/news/CLAUDE.md` — full notes load when working in that subtree (or read directly for UI work — frontend lives at `src/components/NewsCardsWrapper.tsx` and `src/components/ui/NewsCards.tsx`).

**Kiosk UI** (June 2026): the Newsboard index was migrated to the kiosk design system — `src/pages/newsboard.astro` + `src/components/newsboard/kiosk/` (Svelte islands). Full notes: `src/components/newsboard/kiosk/CLAUDE.md` (loads when working in that subtree).

### Kiez Data Dashboard
**Kiosk rebuild complete** (Tasks 1–11, July 2026): `/schillerkiez` moved from the legacy carousel dashboard to the kiosk design system — `src/pages/schillerkiez.astro` + `src/components/kiez/kiosk/` (Svelte islands, moss accent), plus a print route at `/schillerkiez/druck`. Full notes: `src/components/kiez/CLAUDE.md` (data pipeline, LOR codes, MSS column layout, air quality, trend backfills, kiosk architecture — orchestrator/states, view-model lib, Anwohner-Kontext, Berlin-Vergleich, druck route) load when working in that subtree.

### Blog ("Die Beilage")
**Kiosk migration complete** (July 2026): `/blog` moved from the legacy dark-glass blog (`BlogBaseLayout.astro` + `BlogSearch`/`ImageGallery`/`TagCloud`/`TagBarMobile`/`BlogCard` — all deleted, no trace remains) to the kiosk design system — `src/pages/blog/*` + `src/layouts/blog/*` (`StandardLayout`/`HeroLayout`/`GalleryLayout`) + `src/components/blog/kiosk/` (Svelte islands, rust accent), SSR on every route (no prerendering — see the area file for why). Full notes: `src/components/blog/CLAUDE.md` (architecture, island split, `beilage.ts` helpers, Druckbogen print recipe, draft gating, states matrix) load when working in that subtree.

### Onboarding Tour („Die Führung")
**v1 shipped** (Aug 2026): spotlight tour in per-surface chapters — engine overlay (`src/components/tour/`, mounted in `KioskLayout`), storage `users.tours` + `tourHelloDismissedAt` via `GET/POST /api/profile/tour`. **Phase 2 shipped 2026-08-10** (incl. depth pass, `TOUR_DEPTH_ANSWERS.md`): all seven chapters live — Forum (7 stops) → Kalender (6) → Marktplatz (5) → Kurier (5) → Kiez-Daten (3) → Blog (3) → Profil (3, final card, chain ends here) — 32 stops total. CD set 7·5·5·5·3·3·3 as the rhythm and said don't fill further; Kalender's 6th (month nav, 2026-08-12) is a deliberate user-approved exception — treat the caps as still binding. Ochre chrome; scrim is a box-shadow hole (stacking-context-proof — deliberate deviation from the handoff's z-index mechanism). Full notes: `src/components/tour/CLAUDE.md` (five engine duties, entrance rules, phase-2 engine additions, how to add a chapter). Remaining tour work is only the deferred code minors (LS bleed, focus restore, atomic POST, stale tail) — unchanged, still open.

### PWA shell (notification center R2, Aug 2026)
`public/manifest.webmanifest` + `public/icons/` + a push-only `public/sw.js` make Mahalle installable (home-screen install, incl. iOS) and let the service worker deliver web push when the tab is backgrounded or closed. **No offline caching** — locked 2026-08-06, deliberate: this is a push delivery mechanism, not an offline-first app. `sw.js` must never gain a `fetch` handler. Client opt-in lives in `src/lib/pushClient.ts`; see the `pushSubscriptions` collection below and `src/components/forum/kiosk/CLAUDE.md`'s "Notification bell + panel" for the UI states.

## Database Collections
- `users` - User accounts. **Two unique indexes** (both **partial**, both ensured idempotently by `scripts/create-auth-indexes.ts`): `users_handle_unique` on `handle`, and `users_email_unique` on `email` — unique, `partialFilterExpression: { email: { $type: 'string' } }`, collation `{locale:'en',strength:2}`. Partial is load-bearing in both cases: the deletion tombstone `$unset`s those fields, and a full unique index would collide every such doc on one implicit null key. The email collation is a **one-way door** (MongoDB ≥7.3 forbids re-adding the same partial index with a different collation) and the index is **not** used by any query — partial indexes only become plan-eligible when the query restates the filter, which none of the five email lookups do. Because a second unique index now exists, `register.ts` must discriminate code 11000 on `e.keyPattern` (`handle` → retry with a suffix, `email` → 409, anything else → rethrow); never read `e.keyValue`, which is a raw ICU sort key for collated indexes. Full rationale + rollback: `docs/runbooks/users-email-unique-index.md`. Fields include `moderationStrikes`, `strikeHistory` (per-strike ledger: date/reason/contentType/contentId/reviewedBy), `isBanned` — ENFORCED: banned accounts cannot log in and all content-write APIs return 403 `account_banned` (see `src/lib/auth/banGuard.ts`); plus `role?: 'user' | 'admin'` — admin role unlocks `/admin/announcements`, the moderation queue, and the `isOfficial`-true admin-create endpoint; defaults to `'user'`; plus `handle?: string` — unique per-user slug (`[a-z0-9_]{3,20}`, see `src/lib/profile/handle.ts`), enforced by a **partial** unique index `users_handle_unique` (a full unique index would collide every handle-less user on the same implicit null key and break registration) — set at registration going forward, batch-backfilled for older accounts via `scripts/backfill-user-handles.ts`, and lazily self-healed on first profile load by `ensureHandle()` for any stragglers; plus `verified?: boolean` — Kiez-verification v1 (Aug 2026): STRICT, badge renders only on `verified === true` (absent/undefined = not verified); toggled by admins on `/admin/mitglieder` via `PATCH /api/admin/users/[id]` (the flag's only writer — keep it server-controlled); single source of truth so future proof sources (postcard code, event QR) can set the same flag; plus `motto?: string` — optional Steckbrief line, own-view/print-only, never on the public profile; `pendingEmail?: string` — set mid e-mail-change, cleared on confirm/cancel; `passwordChangedAt?: Date` — stamped on password change/reset, invalidates JWTs whose `loginAt` predates it (other-device sign-out, see `auth.config.ts`'s `jwt` callback); `deletionScheduledAt?: Date` — 7-day account-deletion grace timestamp (`src/lib/auth/accountDeletion.ts`), cleared on undo; `dankeCrossedAt?: Date` — stamp-on-first-observation date the user's summed likes crossed 100 (Kiez-Chronik milestone, `src/lib/profile/chronik.ts`); `anonymized?: boolean` + `deletedAt?: Date` — set together by the day-7 deletion pipeline's tombstone step, replacing `name` with "Ehemaliges Mitglied" and unsetting email/password/image/userPicture/hobbies/handle/verified/emailVerified/roleBadge/role/motto/pendingEmail/dankeCrossedAt/deletionScheduledAt/tours/tourHelloDismissedAt/deletionClaimedAt (last three added in the 2026-08-30 hardening batch) while KEEPING moderationStrikes/strikeHistory/isBanned/bannedAt/bannedReason/createdAt/passwordChangedAt — see `src/components/profile/kiosk/CLAUDE.md`'s "Account deletion" section for the full ordered pipeline); plus `tours?: { forum?: Date, kalender?: Date, markt?: Date, kurier?: Date, kiezdaten?: Date, blog?: Date, profil?: Date }` + `tourHelloDismissedAt?: Date` — spotlight-tour per-chapter seen stamps (timestamps not booleans; first write wins; see `src/components/tour/CLAUDE.md`))
- `topics` - Forum posts (includes `moderationStatus`, `isUserReported`, `rejectionReason`, `images` fields)
- `events` - Calendar events (includes `moderationStatus`, `isUserReported` fields)
- `announcements` - Community + official announcements (includes `moderationStatus`, `isUserReported`, `rejectionReason`, `images`, plus **`isOfficial?: boolean`** + **`pinnedUntil?: Date | null`** for admin-posted official announcements with the 7-day pin lifecycle (up to `MAX_PINS` = 3 concurrent pins since Aug 2026, oldest displaced — `src/lib/announcements/pin.ts`; the forum index renders all pins as slim collapsed bars, one opening in place as a fused bar+card accordion — v3 2026-09-12, see `src/components/forum/kiosk/CLAUDE.md`) — server-controlled, never settable from client input; **authors can change a post's kind from edit mode since 2026-09-13** (cross-collection move via `POST /api/posts/move/[id]`, `src/lib/forum/movePost.ts`; officials excluded; old URLs 302 — see `src/components/forum/kiosk/CLAUDE.md` „Kind change in edit mode"); plus **`editCount?: number`** — incremented server-side on every successful title/body `PATCH` from the admin composer's edit mode, surfaced in the kiosk `AnnCard` meta line ("Nx bearbeitet" / "edited Nx"); see admin dashboard at `/admin/announcements` (kiosk `AnnounceApp.svelte`, see `src/components/admin/CLAUDE.md`))
- `recommendations` - User recommendations (includes `moderationStatus`, `isUserReported`, `rejectionReason`, `images` fields)
- `comments` - Comments on posts (includes `moderationStatus` field). Parent link is `relevantPostId` (ObjectId) ONLY. Deleting a post cascades its thread through `deleteCommentsForPost()` (`src/lib/comments/cascade.ts`) from all five delete routes (topics/events/announcements/recommendations self-delete + admin official delete) since 2026-09-14 — before that, announcement/recommendation deletes filtered on a nonexistent `topic` field and the admin route never cascaded, orphaning threads (cleanup: `scripts/cleanup-orphan-comments.ts`). Reported comments in a deleted thread keep their `flaggedContent` row, stamped `contentDeleted`.
- `listings` - Marketplace listings (includes `moderationStatus`, `listingType`, `status`, `listingKind` (`sell`/`exchange`/`gift`), `category`, `delivery`, `specs`, `reservedAt`, `lastBumpedAt`, `bundleId` fields)
- `listingContacts` - Contact-relay metadata for buyer→seller emails (`{ listingId, sellerId, buyerEmailHash (sha256+CONTACT_IP_SALT, 32 hex), senderIpHash, sentAt }` — no message bodies, no plaintext buyer identity since Option C 2026-08-31; 90d TTL index). Deleted with the listing (manual delete cascade) and by the account-deletion pipeline (seller side via listingId/sellerId, buyer side via hash of the captured email).
- `news` - Newsboard articles (AI-fetched and user-submitted, includes `moderationStatus`, `aiRelevanceScore`, `fetchDate`, `sourceName`, `sourceUrl` fields)
- `savedNews` - User bookmarks for news (userId + newsId pairs, server-side persistence)
- `savedPosts` - User bookmarks for forum posts (userId + postId pairs, server-side persistence). Feed cards show a per-post save COUNT (read-time `$group`, `attachSavedCounts()` in `topicsQuery.ts`) since 2026-09-11 — never store a counter on the post. `/bookmarks` joins all three forum collections since 2026-09-13 (a saved post follows a kind change).
- `notifications` - In-app notification center docs, one per recipient per event (`{ userId, type: 'comment'|'moderation'|'official'|'market_contact', actorId?, target: { contentType, contentId, title, href }, meta?, createdAt, readAt }`). Fan-out on write (broadcasts insertMany one doc per member); actor names are a read-time join, never stored; no rendered copy stored (client renders DE/EN from kiosk-i18n by type). Real Mongo TTL index on `createdAt` (90d) + `{userId, createdAt}` compound (`scripts/create-notification-indexes.ts`). Write helpers in `src/lib/notifications.ts` are never-throw (Sentry capture + flush). **R2 (Aug 2026):** each insert also fires a best-effort web push — German-only payload, dead endpoints (404/410) pruned from `pushSubscriptions`, never-throw (mirrors the write helpers). See `src/components/forum/kiosk/CLAUDE.md` "Notification bell + panel".
- `pushSubscriptions` - Web push subscription endpoints (`{ endpoint (unique), keys: { p256dh, auth }, userId, createdAt, updatedAt }`). Upsert-by-`endpoint` on re-subscribe or account-switch on the same browser (no duplicate rows). Deleted on account tombstone (day-7 anonymization pipeline) and pruned server-side on 404/410 from the push service. **SSRF guard (final review, Aug 2026):** the server later POSTs VAPID-signed requests to whatever endpoint is stored, so `PushSubscribeSchema` (`src/schemas/push.schema.ts`) accepts only `https:` + an allowlist of known push-service hosts (FCM/Google, Mozilla autopush, Apple, legacy WNS) — an unknown push service is rejected at subscribe time (client shows the error toast); extend the list rather than loosening the check. Unsubscribe is deliberately NOT allowlisted (it only deletes the caller's own row, no outbound request). Sends carry `timeout: 10000` — without it web-push registers no socket timeout and a hung endpoint would stall the awaited send past the never-throw envelope until Vercel kills the function. Opt-in UI lives in the notification panel's foot slot — see `src/components/forum/kiosk/CLAUDE.md` and `src/lib/pushClient.ts`. Smoke/rollout recipe: `docs/runbooks/web-push-smoke.md`.
- `flaggedContent` - Content flagged by AI or user reports (for admin review queue)
- `passwordResetTokens` - Single-use password-reset tokens (`{ tokenHash (sha256 of raw), userId, expiresAt, usedAt, createdAt }`); raw token only in the emailed link. 30-min TTL, atomic single-use consume. See `src/lib/auth/passwordReset.ts`.
- `emailVerifyTokens` - Single-use email-verification tokens (`{ tokenHash (sha256 of raw), userId, expiresAt, usedAt, createdAt }`); raw token only in the emailed link. 24h TTL, atomic single-use consume, sets `users.emailVerified: true`. See `src/lib/auth/emailVerify.ts`.
- `rateLimits` - Fixed-window rate-limit buckets (`{ key: '<baseKey>#<windowId>', baseKey, count, expiresAt }`, TTL index). Used by login lockout (5 fails/15min), forgot-password (5/h IP + 3/h email, silent), register (5/h IP), resend-verification (10/h user). See `src/lib/auth/rateLimit.ts`; indexes via `scripts/create-auth-indexes.ts`.
- `emailChangeTokens` - Single-use e-mail-change confirmation tokens (`{ tokenHash (sha256 of raw), userId, newEmail, expiresAt, usedAt, createdAt }`); raw token only in the emailed link. See `src/lib/auth/emailChange.ts`.
- `accountDeletionTokens` - Single-use account-deletion undo tokens (`{ tokenHash (sha256 of raw), userId, expiresAt, usedAt, createdAt }`), issued alongside `users.deletionScheduledAt`. See `src/lib/auth/accountDeletion.ts`.
- `chronikCache` - 24h-TTL (checked in-code, not a Mongo TTL index) cache of each user's derived Kiez-Chronik tenure timeline (`{ userId, payload: ChronikData, computedAt, expiresAt }`). See `src/lib/profile/chronik.ts`.
- `listingAuditTrail` - Pre-edit snapshots of marketplace listings whose moderation state is about to be cleared by an author edit (warning labels OR rejections). One record per warning-clearing or rejection-clearing edit. Write-once, never reviewed by admin. Event discriminator: `'edit_warning_cleared'` or `'edit_rejection_cleared'`. See `src/components/marketplace/kiosk/CLAUDE.md`.
- `schillerkiez_demographics` - AfS demographic data per PLR area per period (unique: `plr_code + period`)
- `schillerkiez_social` - MSS social index data per PLR area per report period (unique: `plr_code + period`). `dynamik_class` (`positiv|stabil|negativ`) added 2026-09-09 — the Dynamik-Index is a class in the MSS file, and `dynamik_index` had been a silent 0 for every row; populated in prod by a workflow dispatch on 2026-09-10 (see `src/components/kiez/CLAUDE.md`).
- `schillerkiez_air_log` - BLUME air readings for station mc042, appended every 30 min by the GitHub-Actions-triggered `GET /api/cron/log-air` (Bearer `CRON_SECRET`, fail-closed 503 when unset). **The workflow's `APP_ORIGIN` must be the canonical domain** (`https://mahalle.digital`): the old `*.vercel.app` origin 308-redirects there and `curl` without `-L` scores that a failure — which silently killed the logger for 2 days after the Aug 2026 domain cutover. `-L` is NOT the fix (curl drops `Authorization` across hosts → 401). Nothing alerts on this by itself — the request dies at the edge, so neither Sentry nor the app's degradation captures fire, and only the Actions tab goes red. **Mitigated Aug 2026** by `checkAirLoggerFreshness()` (`src/lib/kiez/airFreshness.ts`), called from the Vercel-native news cron: it Sentry-alerts when this collection has had zero rows in 24h. One doc per BLUME measurement `ts` (unique index; duplicates dropped), with Europe/Berlin `day` key and LQI + pollutant grades. Hourly rows pruned after 90 days.
- `schillerkiez_air_daily` - Per-Berlin-day LQI rollups (`lqiMax`, `lqiMean`, `readings`), kept forever. Written only for days WITH readings — measurement gaps stay absent and render as dashed bars (never interpolated). Served with a last-reading lookup by public `GET /api/kiez-air-history`.
- `schillerkiez_reference` - Berlin + Neukölln yardstick figures (unemployment/child-poverty/transfer rates) per MSS period, imported by `scripts/sync-stats.ts` from the MSS Bezirke-level XLSX (`MSS_BEZIRKE_XLSX_URL`). Berlin is the residents-weighted mean of the 12 Bezirke (the file has no Berlin row; see `derivation`). Exposed additively as `reference?` on `/api/kiez-stats`, strictly 1:1 with the displayed social period.
- `kiezKontextCache` - 24h-TTL (checked in-code, same pattern as `chronikCache`) cache of the Kiez-Daten "Anwohner-Kontext" chip payload (`{ key, computedAt, payload: KiezKontext }`), computed by `getKiezKontext()` in `src/lib/kiez/kontext.ts` from a curated forum-title keyword match (public-approved-or-absent gate only, stricter than forum visibility). See `src/components/kiez/CLAUDE.md`.
- `translationCache` - 90d-TTL cache of DeepL translations (`{ key (unique: contentType:contentId:lang:contentHash), contentType, contentId, targetLang, contentHash, title, body, detectedSource, createdAt }`). Content-hash keying means edits miss the cache naturally (no invalidation hook needed); stale rows for edited content just age out via TTL. Translations of later-DELETED content also persist until TTL — accepted TTL-bounded residue, same precedent as `kiezKontextCache` snapshots. Indexes via `scripts/create-translation-indexes.ts`. Written by `src/lib/translation/translateContent.ts` (server-authoritative: visibility-checked content only, never client-supplied text).
- `landingCache` - 1h in-code-TTL singleton doc (`{ _id: 'landing', payload, computedAt }`) behind `getLandingData()` (`src/lib/landing.ts`) — backs the public landing page's heartbeat strip (forum posts this ISO week, weekend events, air grade + 7-day spark, today's Kurier top 3, population). The "zero rule" (a row without life is omitted, not zeroed) is applied server-side before caching. `GET /api/kiez-heartbeat` is a thin public wrapper around the same lib call — never self-fetched by the landing SSR itself.

## Environment Variables

Required in `.env`:
```
AUTH_SECRET=            # NextAuth secret
AUTH_TRUST_HOST=true
NEXTAUTH_URL=           # Canonical app origin — https://mahalle.digital in prod (domain live since 2026-08-09; the old mahalle-das-kiezgesichterbuch.vercel.app 308-redirects here, deep links preserved). REQUIRED in prod — the password-reset link is built from this, NOT the request Host header (host-header-injection protection). If unset in prod the forgot-password flow FAILS CLOSED (no reset email sent). Dev falls back to the request origin.
MONGODB_URI=            # MongoDB connection string. DB name rides in the URI path (client.db() reads it): prod = /mahalle, local dev + Vercel Preview = /mahalle-dev (split 2026-08-14; same Atlas cluster). Seed dev via scripts/seed-dev-db.ts (interlock: refuses any db name without "dev"). Pre-split snapshot CommunityWebApp-test is frozen — never write to it.
CLOUDINARY_CLOUD_NAME=  # Image upload
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
OPENAI_API_KEY=         # Content moderation API + news relevance scoring
CRON_SECRET=            # Vercel cron job authentication
NEWSDATA_API_KEY=       # NewsData.io API (optional, for additional news sources)
DEEPL_API_KEY=          # DeepL API key for on-demand content translation (POST /api/translate). Free-tier keys end ":fx" → api-free.deepl.com host is auto-selected. SERVER-ONLY secret. Unset ⇒ endpoint 503s translate_unavailable and the UI shows an inline error — no other feature affected.
SMTP_HOST=              # SMTP relay host (smtp.mailbox.org). LOCAL DEV ONLY since 2026-08-09 — removed from Vercel prod (Resend is the prod transport). With SMTP_USER+SMTP_PASS set, SMTP wins over Resend in the transport chooser.
SMTP_PORT=              # 587 (STARTTLS; 465 = implicit TLS also supported)
SMTP_USER=              # SMTP login (mailbox.org account, e.g. atakee@mailbox.org)
SMTP_PASS=              # mailbox.org APP password (not the account password). Secret. Keep double-quoted (contains #).
RESEND_API_KEY=         # Resend.com API key — ACTIVE prod transport since 2026-08-09 (domain mahalle.digital verified at Resend, EU region). Set in Vercel Production (Sensitive).
SENDING_FROM_EMAIL=     # Prod: "Mahalle <noreply@mahalle.digital>" (Resend). For SMTP sends the address MUST be registered at the provider (mailbox.org "Externes Alias") or sends are rejected. All app email (auth + contact relay) uses it.
CONTACT_IP_SALT=        # 32+ chars, fixed across deploys (hashes IPs in contact rate-limit keys). Also used by auth rate limiting (src/lib/auth/rateLimit.ts). Also salts buyerEmailHash in listingContacts — any OFFLINE operation that must reproduce prod hashes (row migration, investigation lookup) needs prod's salt, and **prod's value is a Vercel Sensitive var: unreadable by anyone, forever** (verified 2026-08-31 — `vercel env pull` returns `[SENSITIVE]`). Runtime is self-consistent regardless (route + deletion sweep read the same env). If an offline op ever truly needs the salt, ROTATE it first to a known value (cheap: nothing salted outlives 24h rate-limit windows except buyerEmailHash rows, which would orphan to their 90d TTL). The 2026-08-31 index/TTL rollout ran with an irrelevant salt because prod had 0 rows to migrate.
ALLOWED_ORIGINS=        # CSV of allowed origins for contact relay + resend-verification CSRF guard. SET in Vercel prod since 2026-08-09: "https://mahalle.digital,https://mahalle-das-kiezgesichterbuch.vercel.app" — the guard is ARMED now.
STATS_XLSX_URL=         # AfS demographics XLSX URL (sync script + GitHub Actions)
STATS_PERIOD=           # AfS period, e.g. "2025h2" (sync script + GitHub Actions)
MSS_XLSX_URL=           # MSS social index XLSX URL (optional, sync script)
MSS_PERIOD=             # MSS report period, e.g. "2023" (optional, sync script)
MSS_SDI_URL=            # MSS SDI XLSX URL (optional, for Status/Dynamik index)
MSS_BEZIRKE_XLSX_URL=   # MSS Bezirke-level shares XLSX (optional, reference import for Berlin-Vergleich)
SENTRY_DSN=              # Sentry ingest DSN, server-side config (sentry.server.config.ts). Not a secret (public ingest identifier), but not hardcoded either.
PUBLIC_SENTRY_DSN=       # Same value as SENTRY_DSN — client bundles only see PUBLIC_-prefixed vars (sentry.client.config.ts reads this one). Deliberately COMMENTED OUT in local .env (2026-08-04): dev-browser errors (Vite HMR artifacts etc.) were landing on the prod Sentry board and nibbling the 5k/mo cap. Client init no-ops without it; server-side SENTRY_DSN stays active locally (diagnostically useful). Set in Vercel prod as before.
SENTRY_AUTH_TOKEN=       # SERVER-ONLY secret. Never exposed to the client. Powers /api/admin/errors + sourcemap uploads (astro.config.mjs).
SENTRY_ORG=              # Sentry org slug
SENTRY_PROJECT=          # Sentry project slug
PUBLIC_VERCEL_ENV=       # Optional; set per Vercel scope (production/preview) so CLIENT Sentry events tag their true environment (server gets VERCEL_ENV for free). Not needed locally.
VAPID_PRIVATE_KEY=      # Web push VAPID private key. SERVER-SECRET, never exposed to the client. Unset ⇒ push send no-ops silently (preview deploys have no keys — expected).
PUBLIC_VAPID_PUBLIC_KEY= # Web push VAPID public key. PUBLIC_-prefixed — ships to the client bundle (src/lib/pushClient.ts). Pairs with VAPID_PRIVATE_KEY; generate both together, never mix pairs.
IMPRESSUM_STREET=       # Ladungsfähige Anschrift, Straße + Hausnummer. SSR-only (read at request time in impressum/datenschutz.astro — but Vercel injects env at DEPLOY time, so changing the value still needs one redeploy; verified 2026-08-24), rendered via src/components/legal/ObfuscatedText.astro (char-code obfuscation, JS-decoded — keeps the address out of the repo and away from naive scrapers). Unset ⇒ visible "[Anschrift nicht konfiguriert]" placeholder.
IMPRESSUM_ZIP_CITY=     # e.g. "12049 Berlin" — same handling as IMPRESSUM_STREET.
TELEGRAM_BOT_TOKEN=     # BotFather token for the admin-alerts bot. SERVER-ONLY secret (Vercel Sensitive). Unset ⇒ Telegram alerts silently no-op (dev/preview default).
TELEGRAM_ADMIN_CHAT_ID= # Numeric chat id of the admin↔bot DM (from getUpdates after /start). Server-only.
ADMIN_ALERT_EMAIL=      # Email mirror recipient for admin-action alerts (member/moderation/report). Unset ⇒ email leg no-op.
SENTRY_WEBHOOK_SECRET=  # Random 32+ chars guarding POST /api/hooks/sentry. Unset ⇒ endpoint fail-closed 401.
```

## Component Patterns

### Client-Side React Components
Use `client:load` or `client:only="react"` directive:
```astro
<Navbar client:load user={session?.user} />
<CalendarWrapper client:only="react" />
<ForumWrapper client:only="react" session={session} />
```
Note: `ForumWrapper` uses `client:only="react"` (not `client:load`) because the forum is fully interactive (TanStack Query, client-side state) with no SEO benefit from server rendering.

### Wrapper Pattern
Complex React components use a wrapper pattern:
- `CalendarWrapper.tsx` → `CalendarContainer.tsx`
- `ForumWrapper.tsx` → `ForumContainer.tsx`

### Forum patterns (List/Pagination, Performance/SSR, Post Images, Save/Bookmark, Search & Tag Filtering, Card Interactions)
See `src/components/forum/kiosk/CLAUDE.md` — full notes load when working in that subtree. Since 2026-09-13 an author can change a post's kind from edit mode (cross-collection move, `src/lib/forum/movePost.ts` + `POST /api/posts/move/[id]`; old URLs 302) — details under „Kind change in edit mode" there. The forum spans dirs (`src/pages/api/topics/*`, `src/lib/topicsQuery.ts`, `src/lib/forumQueryOptions.ts`); read the area file directly when working on those server-side pieces.

### Calendar (kiosk) patterns (live ticker, saved events, attendee profiles, moderation parity, ghosting, edit-path moderation, compose toast, report flow)
See `src/components/calendar/kiosk/CLAUDE.md` — full notes load when working in that subtree. Spans `src/lib/calendar/*`, `src/lib/savedEventsQueries.ts`, `src/lib/userProfilesQueries.ts`, `src/pages/api/events/*`; read the area file directly when working on those.

### Marketplace patterns (kiosk: listings, contact relay, ownership lifecycle, freshness decay)
See `src/components/marketplace/kiosk/CLAUDE.md` — full notes load when working in that subtree. Spans `src/lib/listingActions.ts`, `src/lib/listingsQuery.ts`, `src/pages/api/listings/*`; read the area file directly when working on those server-side pieces.

**Seller identity is a read-time join, never stored** (Aug 2026): `populateSellers()` in `src/lib/listingsQuery.ts` resolves `sellerName`/`sellerImage` with one batched `$in` (allowlist projection `{name,image,userPicture}` — never `{password:0}`) from all three SSR fetchers. Denormalizing it would freeze the name a deleted user's tombstone is supposed to replace (`accountDeletion.ts` step 6 → "Ehemaliges Mitglied"). Same commit gated `GET /api/listings/[id]`, which had been a bare `findOne` serving rejected/draft/sold/past-21d listings plus `sellerEmail` to anonymous callers; it now routes through `fetchListingDetailForSSR` with `no-store` + `Vary: Cookie` (the response varies by session, so a shared cache would otherwise re-open the leak). Details in the area file.

### Auth (kiosk) patterns (login + register front door)
See `src/components/auth/kiosk/CLAUDE.md` — full notes load when working in that subtree. Auth uses a dedicated `AuthLayout.astro` (not `KioskLayout` — no app nav on the logged-out door), ochre accent (`[data-page="auth"]`), and reuses the credentials backend untouched. All phases shipped (login, register, splash + KiezHeartbeat, forgot/reset, email-verify soft gate, rate limits, ban screen); audited 2026-09-10/11 (record in the area file). `/login` and `/register` bounce logged-in members to `/forum` like `/` does.

### Profile (kiosk) patterns (own profile, Plan A)
See `src/components/profile/kiosk/CLAUDE.md` — full notes load when working in that subtree. Spans `src/lib/profile/*`, `src/pages/api/profile/*`, `src/pages/api/users/{update,profiles}.ts`; read the area file directly when working on those server-side pieces. Ochre accent (shared with Auth); `/profile` is NOT redirect-protected — it renders its own logged-out state in-page (state §10) rather than bouncing through middleware. Plan A = own profile only; public profile (`/nachbarn/[handle]`), Chronik, and konto-change flows are Plan B.

### TanStack Query — optimistic updates (gotchas)
- **Use real userId, not placeholders**: optimistic `setQueryData` that mutates `likedBy: [...ids, 'optimistic-user-id']` will not match the real user id in subsequent `.includes(user.id)` checks, so UI state (heart filled/unfilled) won't flip until server refetch. Pass the actual `user?.id` into the mutation hook. See `useLikeMutation.ts`.
- **Don't stack `onSuccess` + `onSettled` invalidations** with `refetchType: 'all'` — the double refetch overwrites the optimistic state and causes visible flicker/delay. Canonical v5 pattern: `onMutate` does the optimistic write + snapshot, `onError` rolls back, `onSettled` runs a single `invalidateQueries`. Drop `onSuccess` entirely.

### Calendar Date Range Selection
- **Click-to-select**: Click a future day to select it (teal highlight + speech-bubble tooltip), click another future day to select a range (teal highlight across days)
- **Tooltip**: Floating speech-bubble with "+" (mobile) / "+ Event" (desktop) above selected cell — opens EventModal with dates pre-filled (09:00–17:00, or next full hour if today)
- **State design**: `selectedDate` (sidebar filtering) is separate from `rangeStart`/`rangeEnd` (event creation) — past date clicks update sidebar only and clear range
- **Auto-swap**: If second click is before start date, they swap automatically
- **Extend/shorten**: Click after end → extends range forward; click within range → shortens to that day
- **Pivot**: Click end date again → makes it the new start (ready to select new range from there)
- **Deselect**: Click start date (no range) → deselects; click before start (range exists) → new selection
- **Auth-gated**: Tooltip only appears for logged-in users
- **`prefillDates` memoized** via `useMemo` in CalendarContainer to prevent useEffect churn in EventModal

### Pagination
- **React component**: `src/components/ui/Pagination.tsx` — reusable with props for accent color, page size options, item label
- **Used in**: Forum (`ForumContainer.tsx`, client-side slicing, 12/24/48), Newsboard (`NewsCards.tsx`, server-side, 12/24/48)
- **Svelte inline**: Marketplace (`MarketplaceBrowse.svelte`), Blog (`BlogSearch.svelte`), Admin Moderation (`ModerationApp.svelte`, queue + Protokoll each with their own pager) — same layout, adapted to Svelte syntax
- **Features**: First/Prev/Next/Last buttons, "Page X of Y · N items" display, optional page size dropdown
- **Accent colors**: Wine/burgundy for forum and newsboard, teal for marketplace/moderation, white-on-dark for blog

### Blog Tag Bar (Mobile)
See `src/components/blog/CLAUDE.md` — full notes load when working in that subtree.

### Splash Screen
- `SplashScreen.astro` — plays logo video with fade-out and 3D CSS effect
- **Page allowlist**: Only shows on main nav pages (`/newsboard`, `/calendar`, `/marketplace`, `/profile`, `/schillerkiez`). `/blog` was dropped from the allowlist when it migrated to the kiosk system (kiosk pages don't use `SplashScreen` — see `KioskLayout.astro`). `/` was dropped from the allowlist with the Aug 2026 landing release — the new public landing page doesn't use `SplashScreen` either. Sub-pages (e.g. `/login`) skip it entirely via pathname check.
- **Session-gated**: `sessionStorage['mahalle-splash-shown']` — shows once per session, skipped on subsequent main-page visits/reloads. Also skipped if `prefers-reduced-motion: reduce`.
- Included in `BaseLayout.astro`
- Uses `<script is:inline data-astro-rerun>` for synchronous execution and ViewTransitions compatibility
- Hidden by default (`display: none` in CSS) — JS shows it only on allowed pages to prevent flash-of-overlay
- Dual-gate dismiss: waits for both video end AND `window.load` before fading out. Safety timeout bumped to 4s.
- **No blob flash**: `<video>` has `visibility: hidden` + dark bg (`#0e1033`) until `loadeddata` fires (first frame decoded), then JS adds `.ready` class to reveal. Prevents empty blob-shape showing before frames paint.
- **Autoplay fallback**: `video.play()` catch → dismiss after 600ms. Covers mobile Firefox where muted autoplay still blocks.
- **Overlay**: transparent bg, `backdrop-filter: blur(2px)` — just softens the page behind, no dark tint.
- **Body bg**: `BaseLayout` uses `bg-[#0e1033]` (dark indigo) to match dark-glass redesign pages — no yellow flash behind glass divs.
- **Video**: compressed to ~56 KB (H.264 720x720 CRF 30, `+faststart`, no audio). `fetchpriority="high"` on `<video>` for early download.
- Uses native Web Animations API (not Motion) because `is:inline` scripts can't use ES imports
- `astro:before-swap` listener (commented out, available if needed) strips overlay from incoming pages

### Global UI: Toasts & Confirm Dialogs
- **Toast system**: `sonner` library, triggered via `CustomEvent` bridge (`app:toast`) from `src/utils/toast.ts`
- **Action button** (July 2026): `showToast(msg, { action: { label, onClick } })` renders a clickable pill inside the toast — the optional `action` passes through the bridge (functions survive same-document CustomEvents) into sonner's `action` option. Styled via the `actionButton: 'kiosk-toast__action'` classNames entry + `.kiosk-toast__action` in `global.css`. First consumer: the announce dashboard's displacement-undo toast (`duration: 8000` to leave reaction time).
- **Confirm dialog**: Custom `<dialog>`-based modal replaces all `window.confirm()` calls. Uses `CustomEvent` bridge (`app:confirm`) with `confirmAction()` returning `Promise<boolean>`. Works across React and Svelte. Since 2026-09-09 it locks page scroll while open (`lockPageScroll()`, native `showModal()` doesn't) and its default title/labels follow the kiosk locale at open time (`common.confirm.title` / `common.confirm.cta` / `common.cancel`) — callers only pass `title`/`confirmLabel` when they want specific copy.
- Both are mounted globally in `ToastProvider.tsx` (rendered in layouts) — no per-component state needed
- `confirmAction(message, { title, confirmLabel, variant })` — `variant: 'danger'` shows red confirm button
- **Kiosk skin**: sonner is mounted with `unstyled: true` + `classNames` map → `.kiosk-toast*` classes in `global.css`. Paper-warm bg + ink-2 border + Bricolage font + print-shadow per type (success=green, info=wine, warning=ochre, error=danger). `richColors` is dropped — `unstyled` strips sonner's defaults entirely so the kiosk CSS isn't fighting `!important`-laden defaults. Description copy lands in Instrument italic. Pattern lifts to any design system that ships its own palette: don't try to override sonner's defaults — strip them, then rebuild.

### Cloudinary URL Optimization
- **Utility**: `src/utils/cloudinary.ts` exports `optimizeCloudinary(url)` — rewrites any Cloudinary URL to inject `f_auto,q_auto` (auto format + auto quality) for ~30-60% smaller transfers. No-op for non-Cloudinary URLs or URLs that already have those transforms.
- **Applied in**: `Navbar.tsx` (user avatar), `UserProfile.tsx` (profile picture), `ForumContainer.tsx` (post cover images), `ReadMoreModal.tsx` (post gallery images). Apply anywhere you render user-uploaded Cloudinary images.

### Page Header
- **Component**: `src/components/ui/PageHeader.astro` — animated title with fade-in + sweeping status bars
- **Props**: `title`, `subtitle?`, `color?` (hex, defaults to wine `#814256`), `subtitleClass?` (defaults to `text-gray-600`)
- **Animation**: `is:inline data-astro-rerun` script — re-triggers on every ViewTransitions navigation. Title fades in + slides up, then 3 decorative bars sweep in with staggered delays. Respects `prefers-reduced-motion`.
- **Used on**: Remaining legacy main pages (`/`, `/calendar`, `/newsboard`, `/marketplace`, `/profile`). Marketplace uses `color="#4b9aaa"` (teal). (`/schillerkiez` and `/blog` no longer use PageHeader — both are on the kiosk system.)

### Glass Utility System
Five opt-in CSS utilities in `global.css` layer the dark-glass look. Pair them as needed with standard Tailwind dark-glass classes (`bg-white/[0.06] backdrop-blur-sm border border-white/[0.15] ...`).

- **`.glass-inner-glow`** — Apple-style `box-shadow: inset 0 0 22px -4px rgba(255,255,255,0.4)`. Zero cost. Drop-in on any glass surface for a subtle inner highlight.
- **`.glass-luxe`** — full-area liquid glass: `::after` with `backdrop-filter: blur(8px)` + `#glass-distortion` SVG filter (wobble). Used on the profile hero card. Host must have **no** `bg-*` or `backdrop-blur-*` — the pseudo handles it.
- **`.glass-luxe-edge`** — same wobble as luxe but masked to an edge frame via radial `mask-composite: exclude`. Host keeps its own bg color visible in the center. Used on forum cards so the tan `bg-[#c9c4b9]/75` remains the trademark center while edges show the glass refraction. Base uses `#glass-distortion-subtle` (gentler scale/blur settings).
- **`.glass-smooth`** — same shape as `glass-luxe` but **no SVG filter**: flat blur + tint, no wobble. Use when the wobble looks too fragmented or the surface doesn't need refraction.
- **`.glass-smooth-edge`** — flat blur + tint masked to an edge frame. Use when you want a glass frame without the SVG cost.

**Required helper component:** `GlassFilters.astro` (injected once in `BaseLayout`) defines three SVG filters — `#glass-distortion` (default, scale 60), `#glass-distortion-strong` (scale 110, for hover), `#glass-distortion-subtle` (low-frequency, heavy blur, scale 85 for organic curl without chunkiness). Without this component mounted, `.glass-luxe*` classes render as flat glass (SVG url() refs silently no-op).

**Why `::after` instead of filtering the host:** `backdrop-filter` and `filter` create a containing block for `position: fixed` descendants (see Common Errors). Putting the filter on `::after` keeps the host a normal element, so modals inside still escape to the viewport. Also isolates `z-index` via `isolation: isolate`.

**Reduced motion:** all `.glass-luxe*` variants drop the SVG filter under `prefers-reduced-motion: reduce` (flat glass fallback). Effect gracefully degrades — nothing disappears.

### Low-perf Device Detector
Inline script in `<head>` of `BaseLayout.astro`. Runs before first paint, tags underpowered devices so heavy SVG filters degrade to flat glass.

```js
if ((navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) ||
    (navigator.deviceMemory && navigator.deviceMemory < 4)) {
  document.documentElement.classList.add('low-perf');
}
```

`.low-perf .glass-luxe-edge::after, .low-perf .glass-luxe::after { filter: none }` in `global.css` drops the filter on flagged devices. Old Android (2 cores, 2 GB) → flat; modern iPhone/flagship → full wobble. Safari/Firefox `deviceMemory` is undefined — falls back to core count only, fail-safe (unknown = assume capable). Brave/Tor spoof `hardwareConcurrency` to 2 → falls to flat; zero harm, they opt into minimalism. Pattern reusable for any "heavy effect on mid-tier mobile" concern.

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

### Animation (Motion Library)
- **Navbar**: `motion/react` — spring-based menu slide (`AnimatePresence`), staggered nav item entrance
- **Calendar**: `motion/react` — spring-physics slide on month change (grid slides horizontally, month name slides vertically). `AnimatePresence mode="popLayout"` for smooth height transitions between 4/5/6-week months. Direction tracked via `useRef`.
- **Newsboard**: `motion/react` — `whileInView` scroll-triggered card reveals with per-column stagger delay
- **Splash screen**: Native Web Animations API (fade-in/out) — `is:inline` context, no imports
- **Kiez dashboard**: Scroll-triggered section reveal via IntersectionObserver (`use:reveal` Svelte action). CSS transitions for opacity + translateY. Respects `prefers-reduced-motion`.

## Color Palette
The project uses these CSS variables (defined in `global.css`):
- `--color-primary`: #4b9aaa (Teal)
- `--color-secondary`: #814256 (Wine/Burgundy)
- `--color-yellow`: #eccc6e (Yellow/Gold - main background)
- `--color-gray`: #aca89f (Gray/Beige)

When I say yellow, red, green, I always mean the default variants of the project.

### Masthead + bottom nav (kiosk chrome, 2026-09-10)
Both bars are ochre (`var(--k-ochre)`); the admin masthead stays plum. Bar rhythm: 54 px on phones / 67 px desktop, title-block kickers sit 20/24 px under the masthead rule on every surface. Anatomy of the DE/EN pill and the paper avatar disc: `src/components/forum/kiosk/CLAUDE.md` → "Ochre masthead".

### Page-accent rule (kiosk)
Each main page has its own accent color used for **kickers** (mono-uppercase eyebrows) and **carved-italic title accents**. The pairing:

| Page | Accent | Tailwind |
|---|---|---|
| Forum | wine | `text-wine` (`#b23a5b`) |
| Calendar | teal | `text-teal` (`#3f8f9f`) |
| Admin | plum | `text-[#6f2f59]` via `--k-plum` |
| Kiez-Daten | moss | `#6b8a4a` via `--k-moss` |
| Blog | rust | `#a3552e` via `--k-rust` |
| Marketplace | wine | shares the forum's wine deliberately |
| Newsboard (Kurier) | ink | ink-only surface — its "newspaper" identity, no color accent |
| Auth / Profile | ochre | `--k-ochre` |

When migrating a surface into kiosk, swap kicker + italic-accent text to the page's color. **Don't touch:** live-now indicators, today indicator, weekend day labels, required-field asterisks, compose step numbers (`01`, `02`, …), CTA wine-shadows, modal wine-shadows, or wine-filled FABs — those are semantic/sticker accents, not brand accent, and stay wine across all surfaces.

## Common Errors to Avoid

### SSR Compatibility
- `typewriter-editor` requires dynamic import inside `onMount()` to avoid SSR errors - it accesses browser globals (KeyboardEvent) at module load time
- **Prerendered pages + auth**: Middleware uses `context.isPrerendered` to skip `getSession()` on prerendered routes (avoids `Astro.request.headers` warning). The legacy `BlogBaseLayout` (deleted in the kiosk blog migration, July 2026) used to read session from `Astro.locals.session` because `/blog` was prerendered; the kiosk `/blog` routes are SSR (no `prerender` export anywhere under `src/pages/blog`) and go through `KioskLayout`, which calls `getSession(Astro.request)` directly like every other kiosk page — see `src/components/blog/CLAUDE.md`'s "Decision 1" for why SSR was required.
- **Navbar on prerendered pages**: `BaseLayout` calls `getSession(Astro.request)` which returns `null` at build time, so `user={undefined}` is baked into static HTML. `Navbar.tsx` compensates by fetching `/api/auth/session` client-side in `useEffect` when `initialUser` is undefined — ensures login state reflects reality on prerendered routes (e.g. `/schillerkiez`).
- **QueryProvider hydration**: `src/providers/QueryProvider.tsx` renders the same JSX tree on SSR and client (`<QueryClientProvider>` only). The cache persister attaches imperatively via `persistQueryClient` in a client-only `useEffect` — if you wrap with `<PersistQueryClientProvider>` instead, the SSR/client trees differ and React hydration crashes, which cascades to Svelte `effect_orphan` errors on any `client:only="svelte"` island.

### Astro Script + ViewTransitions
- Module `<script>` tags are deferred and only execute once — they do NOT re-run on ViewTransitions navigation
- `<script is:inline>` may or may not re-run — use `data-astro-rerun` to force re-execution on every navigation
- For critical synchronous code (e.g. splash screen), always use `is:inline` — module scripts load too late for timing-sensitive DOM manipulation
- `astro:before-swap` event can modify `e.newDocument` before it enters the live DOM — useful for stripping elements from incoming pages
- **`history.replaceState`/`pushState` must carry Astro's ClientRouter state** (learned 2026-09-13, forum back-nav): with `<ViewTransitions />` the router keeps `{ index, scrollX, scrollY }` in `history.state` and reads `index` on popstate to know the direction; `replaceState({}, '', url)` wipes it and `pushState({}, …)` pushes an entry with no index. Always `history.replaceState(history.state, '', url)`. Worked example: `src/components/forum/kiosk/ForumIndexInner.svelte` (URL-synced filter/tag/page state). **Known offenders still to fix** (parked): `SearchPage.svelte:64`, `CalendarPageInner.svelte:94,391`, `NewsboardIndexInner.svelte:131`, `MarketplaceBrowseInner.svelte:305` (`replaceState({})`) and `MarketplaceBrowseInner.svelte:243` (`pushState({})`).
- **Scroll restore for `client:only` islands is your own job**: on browser back the router scrolls right after the swap, while the island is still empty, so the attempt clamps to ~0 and the router's scrollend bookkeeping overwrites the saved position. Pattern (forum index): snapshot `{ token, index, href, y }` to sessionStorage on `astro:before-preparation` + `pagehide`, restore after the island's first render only when the per-document token (a `<script module>` const — the instance `<script>` re-runs per mount), `history.state.index` and the pathname match. A hard navigation (reload, `location.href`) is a new document and must not inherit the old scroll. Astro's DEV server preloads `client:only` pages in a hidden same-origin iframe (`prepareForClientOnlyComponents`, dev only) that mounts a second island — guard with `window.top === window.self`.
- **Production-build pass without Vercel**: the Vercel adapter can't `astro preview`, but `@astrojs/node` is installed — a scratch config (`scratchpad/astro.config.preview.mjs`: `{ ...base, adapter: node({ mode: 'standalone' }) }`) + `astro build --config …` + `PORT=4655 node dist/server/entry.mjs` (export the `.env` vars first) serves the real prod bundle for headless probes.

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
- **Corollary (Aug 2026, avatar-menu mobile sheet): the `html { overflow-x: clip }` rule ALSO defeats body-only scroll-locks.** With html's overflow non-`visible`, the body's overflow no longer propagates to the viewport — `document.body.style.overflow = 'hidden'` compiles, looks right in devtools, and does nothing (page still scrolls). Any JS scroll-lock in this project must set `overflow: hidden` on BOTH `document.documentElement` AND `document.body` (inline styles, save/restore previous inline values so the stylesheet's `clip` survives). Worked example: the mobile-gated `$effect` in `src/components/forum/kiosk/AvatarMenu.svelte`. React modals are unaffected — they use `react-remove-scroll`, which handles this.

### `backdrop-filter` creates a containing block for `position: fixed` descendants
- **Any element with `backdrop-filter: blur(*)` (or `filter`, `transform`, `will-change`, `perspective`, `contain: paint/layout/strict`) creates a containing block for its `position: fixed` descendants.** This means a modal with `position: fixed inset-0` inside a glass container with `backdrop-blur-*` will position relative to the container, not the viewport — rendering off-screen or partially visible.
- Symptom: modal opens (DOM is there, hydration works, backdrop darkens the page) but the modal content renders at weird coordinates (`rect.top` way above or below viewport). Often looks like "the modal doesn't open" because content is invisible.
- **Fix:** remove `backdrop-filter` from any ancestor of a fixed-positioned modal/overlay. On forum/blog/marketplace/etc., the outer glass container uses bg + borders only (no backdrop-blur). Cards inside can still have backdrop-blur on hover since they don't contain fixed descendants.
- **Known offenders to watch:** `.dark-glass-gradient` (fine — it's a sibling, not ancestor), any `bg-*/[n] backdrop-blur-*` wrapper that has a modal-opening action inside. If you add a new glass wrapper, audit whether any descendant can open a fixed overlay.
- **Unlike the sticky/overflow gotcha, this one was masked by working tests** — the modal works when opened from a non-glass-wrapped page, fails on forum/calendar/etc. First hit: forum ReadMoreModal in April 2026.

### Modal scroll-lock: wrap in `<RemoveScroll>` from `react-remove-scroll`
- All 5 modals (ReportModal, EventModal, PostModal, ReadMoreModal, EventViewModal) use `<RemoveScroll enabled={isOpen}>` as the outermost wrapper. Battle-tested lib (used by Radix, Headless UI) that handles iOS touch-scroll, desktop scrollbar-gutter compensation, and nested-scroller preservation.
- Replaced earlier `overflow: hidden` on html/body and `position: fixed; top: -scrollY` patterns — both had edge cases (iOS touch leaks, fixed-descendant conflicts with `backdrop-filter` containing blocks).
- For new modals: just wrap in `<RemoveScroll enabled={isOpen}>` and drop any bespoke scroll-lock `useEffect`.
- **Svelte native `<dialog>` modals are NOT covered by the browser** (audit 2026-09-09): `showModal()` makes the page inert but the document still scrolls under the backdrop. All four Svelte ones (`EventDetailModal`, `KioskReportModal`, `PDeleteAccountModal`, marketplace `DetailGallery` lightbox) plus the React `ConfirmDialog` call `lockPageScroll()` from `src/lib/scrollLock.ts` while open — it locks html AND body (the `overflow-x: clip` corollary) and compensates the scrollbar gutter. Any new native-dialog island must do the same; a comment saying "the browser handles scroll-lock" is wrong.

### Nested-island Svelte `<style>` blocks get orphaned in prod builds
- **A Svelte component imported ONLY through another Svelte island (never from any `.astro` file) loses its scoped `<style>` in production.** Astro/Vite extracts the CSS into a chunk that NO route links — the file is emitted and deployed, but nothing loads it. First hit: `AvatarMenu.svelte` (imported solely by `KioskNav.svelte`), Aug 2026.
- **Symptom**: component renders perfectly in dev (Vite injects styles via JS/HMR) and passes `pnpm build` green, but arrives completely unstyled in prod. The compiled JS applies the scoped classes; the CSS never arrives.
- **Diagnosis recipe**: build, then check the SSR manifest — `grep -o "<hash>.css" .vercel/output/_functions/manifest_*.mjs | wc -l`. A route-linked stylesheet appears once per route (~28×); an orphan appears exactly once (global assets list only).
- **Fix pattern**: move the styles into `global.css` with a namespaced class prefix (`.am-*`), same escape hatch as the `.kiosk-toast*` block. Components imported directly by a layout/page (`VerifyEmailBanner` etc.) are unaffected — their CSS lands in the route-linked bundle.
- **Rule**: any NEW styled `.svelte` component that is only reachable through another island either gets its styles in `global.css` from the start, or must be prod-build-verified with the manifest check above before declaring done.

### Server-only modules bleeding into client bundles
- **The server/client boundary in Astro is enforced by what you TRANSITIVELY import, not by file location.** If a React component with `client:only="react"` (or `client:load`) imports anything from a module that in turn imports `mongodb`, `fs`, `auth-astro/server`, etc., Vite pulls that entire module graph into the browser chunk. Node built-ins (`net`, `tls`, ...) get silently externalized and the chunk fails to evaluate at runtime — the component just never mounts.
- **Symptom**: page renders, hydration slot is empty, no obvious error in build output. `pnpm build` goes green because Vite doesn't error on unresolved Node built-ins in client bundles — it just produces a broken bundle. You only see it when you load the page in a browser.
- **Rule**: any file imported from both server (`.astro` frontmatter, `/api/*` routes) and client (React components, `.svelte` with `client:*`) must be **dependency-pure** — constants, types, pure functions. The moment it imports `mongodb`/`fs`/etc., it becomes server-only for import purposes.
- **Pattern**: split shared constants into a standalone file. Example: `src/lib/forumQueryOptions.ts` (pure, imported by both) vs `src/lib/topicsQuery.ts` (server, imports `connectDB`). The server file can re-export the constant for convenience; the client imports from the pure file directly.
- **Prevention**: after any SSR-touching change (new `Astro.locals` data threaded through, new shared util between page and component), **actually load the page in a browser** before declaring done. `pnpm build` is necessary but not sufficient.
- **First hit**: April 2026 — `FORUM_QUERY_OPTIONS` lived in `topicsQuery.ts`, which imports `connectDB`. ForumContainer's browser chunk included MongoDB, forum never hydrated.

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
- **Errors only** — `@sentry/astro`, `tracesSampleRate: 0` in both configs; replay sample rates `0` in the client config (replay is browser-only) (5k errors/mo free-tier cap is the whole budget; `sendDefaultPii: false` for GDPR, EU-region org). With `SENTRY_DSN`/`PUBLIC_SENTRY_DSN` unset, init is a documented no-op.
- **`beforeSend` transient filter** (server config only): drops OpenAI 429/rate-limit noise, `AbortError`, and transient `MongoNetworkError` timeouts before they ship — the moderation pipeline's per-submission OpenAI calls would otherwise let a provider incident burn the monthly cap. **Also drops `event.environment === 'development'` (2026-09-03, `9c6434f8`)**: the server-side `SENTRY_DSN` stays active in local dev on purpose (diagnostics), but its events — including unhandled promise rejections from throwaway git-worktree dev servers (e.g. Astro's route-manifest reader ENOENT-ing on files a `git reset` removed mid-run) — were landing on the prod board and burning the cap (was the #1 issue, 62 events, before the filter). `development` is dropped, not "non-production", so **preview + production still report** — preview is where the silent-degradation tripwires legitimately fire. This is the server-side twin of the client-side `PUBLIC_SENTRY_DSN`-commented-out fix.
- **Silent-degradation alerts** (Aug 2026, after the OpenAI-credits-exhausted incident starved the newsboard for 4 days with zero errors anywhere): code paths that swallow provider failures and degrade gracefully must emit `Sentry.captureMessage` + `await Sentry.flush(2000)` at the capture site (success responses aren't flushed by middleware — Vercel's freeze eats unflushed events). Implemented in `fetch-daily.ts` (scoring `degraded` flag) and `moderation.ts` `createFailSafeResult` (STATIC message, variable reason in `extra` — else every error string becomes its own issue). `captureMessage` bypasses the beforeSend filter (it only inspects `event.exception`). Alert rule "New issue in production" also fires on resolved→unresolved regression — resolve outage issues after fixing so the next outage re-alerts.
- **Sentry's blind spot: callers OUTSIDE the app.** Anything that reaches the app over HTTP from elsewhere (GitHub-Actions crons, webhooks, uptime probes) can fail entirely without producing a single Sentry event — the request dies at the edge and no app code runs. The Aug 2026 domain cutover killed the air logger this way for 2 days (see `schillerkiez_air_log` above); the only signal was a red Actions tab nobody was watching. **After ANY change to origins, domains, redirects, or auth headers, re-verify every external caller by hand** (`gh run list --workflow=<name>`), and prefer asserting on freshness of the DATA (e.g. `readings: 0` today) over trusting the absence of errors. The general remedy is a **data-freshness watchdog hosted on a schedule the same change can't break** — `checkAirLoggerFreshness()` in `src/lib/kiez/airFreshness.ts`, called from the Vercel-native news cron, is the worked example; copy the shape for any future externally-triggered job.
- **Widget**: `AdmErrorsCard.svelte` on `/admin/moderation` (desktop only, between the stat row and title block) via the `requireAdminSession`-gated proxy `GET /api/admin/errors`. Full architecture in `src/components/admin/CLAUDE.md`.
- **Server request-error capture lives in `src/middleware.ts`, NOT the SDK's auto-middleware** (live-debugged 2026-07-19, two real Vercel-serverless failure modes): (1) Astro bundles `sentry.server.config`'s `Sentry.init()` into PAGE chunks only — a cold instance serving only `/api/*` ran with an uninitialized SDK, so the middleware does a side-effect `import '../sentry.server.config'`; (2) Vercel freezes the function the moment the response leaves, eating the SDK's async event POST — the middleware catch does `captureException` + `await Sentry.flush(2000)` + rethrow INSIDE the request window. The SDK's own request handler is disabled (`autoInstrumentation.requestHandler: false` in astro.config.mjs) so this is the single capture point. Don't "simplify" either piece away — each reverts to silently-lost server errors.
- **Runbook**: `docs/runbooks/sentry-smoke.md` — the one-time post-account-creation smoke checklist (deploy smoke, cron coverage, widget live states, alerts, CSP, privacy policy). Item 1 (server capture, #14054) VERIFIED 2026-07-19 on preview; client capture verified same day.

## Secret Scanning
- **Pre-commit**: `.husky/pre-commit` runs `gitleaks protect --staged` on every commit. Falls back to a warning (exit 0) if gitleaks isn't installed locally, so collaborators without it aren't blocked.
- **CI safety net**: `.github/workflows/gitleaks.yml` runs `gitleaks/gitleaks-action@v2` on push to `main` and on PRs — catches anything that bypassed the local hook.
- **Whitelist**: `.gitleaksignore` lists historical findings accepted as residual risk (fingerprint format `<sha>:<file>:<rule>:<line>`). Add new entries only after a deliberate decision; each line silences a real finding.

## Repo identity & code backup
- **GitHub repo**: `atakee72/mahalle-digital` (renamed 2026-09-09 from `fullstack-community-webApp-astro---v.3`; the old URL 301-redirects for web, clone and push). Kept **public** by decision — the Impressum and the manifest blog post link to it as a trust point. The local folder name was deliberately NOT renamed (worktrees, memory dir and scratchpad paths depend on it).
- **Off-site code backup**: `.husky/pre-push` writes ONE bundle file (`git bundle create … --all`, full history + all branches) to `/mnt/c/Users/atakee/Dropbox/Backups/mahalle-digital.bundle` on every push. A bundle, not a bare repo, because Dropbox syncing a bare repo mid-write can corrupt objects; git writes the bundle to a `.lock` and renames it. Non-blocking: a missing Dropbox mount warns and lets the push through. Restore: `git clone <bundle>`. Independent of the GitHub remote (rename/visibility don't touch it). `.env` is the one file no backup covers — keep a copy in the password manager.
- **If the repo ever goes private**: Actions minutes stop being unlimited (2,000/month on Free, each job rounded up to a full minute — the 30-min air logger alone is ~1,460/month → switch it to hourly first; each tick stores only the current BLUME reading, so 2-hourly halves the dataset), enable "Include private contributions" on the GitHub profile (streak widget + daily routine), rewrite the Impressum's „öffentlich einsehbar" sentence, and host `MANIFESTO.md` on-site (the manifest post links into the repo).

## License
PolyForm Noncommercial 1.0.0 — see `LICENSE`. Free for noncommercial use; commercial use requires a separate license from the author.
