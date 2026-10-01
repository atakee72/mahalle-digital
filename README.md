# Mahalle Community App

A modern, performant community web application built with Astro, TypeScript, and React — live at **[mahalle.digital](https://mahalle.digital)**, serving the Schillerkiez neighborhood in Berlin-Neukölln.

> 📜 **Read the [Mahalle Manifesto](./MANIFESTO.md)** — the project's moral charter. It describes who Mahalle is for, what it must remain, and what it refuses to become. Anyone deploying, forking, or contributing to this project is expected to honor it.

## 🚀 Tech Stack

- **Framework**: Astro 5.x with Hybrid SSR/SSG
- **UI**: React 18.2 + Svelte 5 for interactive islands
- **Styling**: Tailwind CSS 3.4 with kiosk design system (paper-warm + ink borders — migration from legacy dark-glass completed July 2026)
- **Animation**: CSS transitions, Svelte `transition:`, Web Animations API for `is:inline` scripts, Astro View Transitions
- **State Management**: TanStack Svelte Query for server state in the forum + calendar islands, local Svelte `$state` for UI (no Zustand/Redux)
- **Data Fetching**: `createQuery`/`createMutation` (`@tanstack/svelte-query` 6) in the islands, plain `fetch` helpers elsewhere
- **Database**: MongoDB 6.3 (direct driver, no Mongoose)
- **Authentication**: auth-astro with NextAuth (Credentials provider, JWT strategy)
- **Deployment**: Vercel (serverless, functions pinned to `fra1` — co-located with the Frankfurt Atlas cluster)
- **Validation**: Zod schemas
- **Language**: TypeScript

## 📁 Project Structure

```
src/
├── components/       # React (.tsx) and Svelte (.svelte) components
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
│   │   ├── listings/      # Marketplace listings CRUD
│   │   ├── reports/       # User report submission
│   │   ├── admin/         # Admin moderation APIs
│   │   ├── kiez-stats.ts  # Schillerkiez demographics + social API
│   │   └── kiez-air.ts    # Live BLUME air quality proxy
│   └── *.astro       # Page components
├── hooks/
│   └── api/          # marketplace fetch helpers (plain functions)
├── lib/
│   ├── mongodb.ts    # Database connection
│   ├── auth.ts       # Auth utilities
│   ├── moderation.ts # AI moderation + profanity filters (TR/EN/DE) + leetspeak
│   └── queryUtils.ts # Query helpers
├── schemas/          # Zod validation schemas
├── styles/           # Global CSS (dark-glass utilities, carved titles)
├── types/            # TypeScript types
└── utils/            # Helper functions
```

## 🎨 Design System

The app has completed its migration (July 2026) from a **dark-glass** aesthetic (deep indigo `#0e1033` + purple radial gradient + glass surfaces) to a **kiosk** aesthetic (paper-warm surfaces, ink borders, print shadows, carved-italic title accents, DM Mono kickers, Instrument italic copy).

### Migration status — complete, all 11 surfaces

| Surface | State |
|---|---|
| Landing „Das Schaufenster" (`/`, plus `/impressum`, `/datenschutz`) | ✅ Kiosk (Svelte island, own `LandingLayout`) — public front door, members SSR-redirect to `/forum` |
| Forum (`/forum`, `/topics/[id]`, `/announcements/[id]`, `/recommendations/[id]`) | ✅ Kiosk (Svelte) |
| Calendar (`/calendar`, `/events/edit/[id]`) | ✅ Kiosk (Svelte) |
| Newsboard (`/newsboard`, `/newsboard/[id]`, `/newsboard/submit`) | ✅ Kiosk (Svelte) |
| Marketplace (`/marketplace`, `/marketplace/[id]`, `/marketplace/create`, `/marketplace/edit/[id]`) | ✅ Kiosk (Svelte) |
| Auth (`/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`) | ✅ Kiosk (Svelte, own `AuthLayout`) |
| Admin moderation (`/admin/moderation`) | ✅ Kiosk (Svelte, own `AdminLayout`) |
| Admin announcements (`/admin/announcements`) | ✅ Kiosk (Svelte, own `AdminLayout`) |
| Profile (`/profile`, `/nachbarn/[handle]`, `/steckbrief`) | ✅ Kiosk (Svelte) — complete (Plan A: own profile; Plan B: public neighbor profiles, e-mail/password change, account deletion) |
| Kiez Data (`/schillerkiez`, `/schillerkiez/druck`) | ✅ Kiosk (Svelte) — legacy carousel dashboard removed |
| Blog (`/blog`, `/blog/[slug]`, `/blog/tag/[tag]`) | ✅ Kiosk (Svelte, own `StandardLayout`/`HeroLayout`/`GalleryLayout`) — "Die Beilage", SSR on every route, legacy dark-glass blog removed |

### Page-accent rule (kiosk)
Each migrated page has its own accent color used for kickers (mono-uppercase eyebrows) and carved-italic title accents:

| Page | Accent |
|---|---|
| Forum | Wine `#b23a5b` |
| Calendar | Teal `#3f8f9f` |
| Newsboard | Ink `#1b1a17` |
| Marketplace | Wine `#b23a5b` (kickers) + Ochre `#eccc6e` (italic headline accents only) |
| Auth | Ochre `#e8a53a` |
| Admin | Plum `#6f2f59` |
| Profile | Ochre `#e8a53a` (shared with Auth) |
| Kiez Data | Moss `#6b8a4a` |
| Blog | Rust `#a3552e` |

Semantic accents stay constant across all kiosk surfaces (never swapped per page): live-now indicator (ochre dot), today indicator, weekend-day labels, required-field asterisks, compose step numbers (`01`, `02`, …), CTA wine-shadows, modal wine-shadows, the mobile wine FAB.

### Shared kiosk components
- `KioskLayout` / `KioskFooter` — page chrome with built-in clearance for sticky bottom bars
- `KioskReportModal` — paper-warm community-report modal (forum + calendar, reusable for upcoming kiosk surfaces)
- `OwnStatusBanner` — author-facing moderation banner (pending / reported / rejected, with optional rejection-reason blockquote)
- Sonner toasts re-skinned via `unstyled: true` + `.kiosk-toast*` classes (paper-warm bg, ink-2 border, Bricolage font, Instrument italic descriptions, print-shadow per type)

### Legacy dark-glass utilities (removed)
The legacy dark-glass and glass utility classes were removed from `global.css` on 2026-10-01; no surface had used them since the kiosk redesign.

### Original palette (used across both systems)
- Teal: `#4b9aaa`
- Wine/Burgundy: `#814256`
- Gold: `#eccc6e`
- Beige: `#aca89f`

## 🛠️ Setup

1. **Install pnpm (if not already installed):**
   ```bash
   npm install -g pnpm
   # or
   corepack enable
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up environment variables:**
   Copy `.env.example` to `.env` and fill in your values:
   ```
   AUTH_SECRET=your-nextauth-secret
   AUTH_TRUST_HOST=true
   NEXTAUTH_URL=https://mahalle.digital   # canonical origin — REQUIRED in prod (password-reset links are built from it; forgot-password fails closed without it)
   MONGODB_URI=your-mongodb-uri           # db name rides in the URI path: /mahalle (prod) vs /mahalle-dev (local dev + previews)
   CLOUDINARY_CLOUD_NAME=your-cloudinary-name
   CLOUDINARY_API_KEY=your-api-key
   CLOUDINARY_API_SECRET=your-api-secret
   OPENAI_API_KEY=your-openai-key
   RESEND_API_KEY=your-resend-key
   SENDING_FROM_EMAIL=Mahalle <noreply@mahalle.digital>
   CONTACT_IP_SALT=your-32-char-random-secret
   ALLOWED_ORIGINS=https://mahalle.digital
   # optional: SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS (SMTP transport for local dev — wins over Resend when set)
   # optional: SENTRY_DSN / PUBLIC_SENTRY_DSN / SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT (error monitoring)
   ```

4. **Run development server:**
   ```bash
   pnpm dev
   ```
   The app will be available at `http://localhost:4321`

## 📝 Available Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm preview` - Preview production build
- `pnpm type-check` - Run TypeScript type checking

## 🚢 Deployment

The app is configured for Vercel deployment using `@astrojs/vercel` adapter:

1. **Build command**: `pnpm run build`
2. **Output directory**: `.vercel/output`
3. **Runtime**: Node.js 22

Vercel will automatically:
- Build the Astro app
- Deploy serverless functions (API routes)
- Handle SSR pages
- Run cron jobs defined in `vercel.json`: daily news fetch (6:00 UTC) + account-deletion pipeline (5:30 UTC)

Scheduled jobs outside Vercel (GitHub Actions): air-quality logger (every 30 min, hits `/api/cron/log-air`), statistics sync (2×/year), **nightly encrypted DB backup** (`db-backup.yml` — mongodump → AES-256 → release asset in a private repo, 90-day rolling retention; see `docs/runbooks/db-backup.md`).

### Databases

Production (`mahalle`) and development (`mahalle-dev`) are separate databases on the same Atlas cluster — the name rides in the `MONGODB_URI` path. Local dev and Vercel previews use `mahalle-dev`; seed it with `pnpm tsx scripts/seed-dev-db.ts` (refuses to run against any db whose name lacks "dev", prints a random per-run password for the fake accounts).

### Manual deploy steps (run once per environment)

- `pnpm tsx scripts/create-auth-indexes.ts` — idempotent. Ensures the auth/token/rate-limit indexes plus the two partial unique indexes on `users` (`users_handle_unique`, `users_email_unique` — see `docs/runbooks/users-email-unique-index.md`).
- `pnpm tsx scripts/create-listing-indexes.ts` — idempotent. Creates the marketplace partial indexes (`listings.lastBumpedAt`, `listings.bundleId`) + the `listingContacts` rate-limit indexes + the `listingAuditTrail` history index. Re-run is a no-op.
- `pnpm tsx scripts/migrate-legacy-categories.ts --dry-run` then `pnpm tsx scripts/migrate-legacy-categories.ts` — one-time backfill that maps pre-kiosk English category keys (furniture/electronics/etc.) → the 13 German kiosk taxonomy keys + defaults missing `delivery` to `'abholung'` + defaults missing `moderationStatus` to `'approved'`. Idempotent.

## 🔑 Key Features

- **Hybrid Rendering**: SSG for static pages, SSR for dynamic content
- **Type Safety**: Full TypeScript with Zod validation
- **State Management**: Local Svelte `$state` for UI, TanStack Svelte Query for server state
- **MongoDB Integration**: Type-safe database operations (direct driver)
- **NextAuth Authentication**: Credentials provider with bcrypt + JWT strategy
- **Responsive Design**: Mobile-first approach
- **Performance**: Optimized with Astro's island architecture
- **Content Moderation**: Multi-layer AI moderation (safety scan + GPT content check for spam/hate speech/harassment) + trilingual profanity filters (TR/EN/DE) with leetspeak detection + username validation at registration + community reporting
- **Admin moderation back-office (kiosk)**: card-based review queue with urgent-first sorting + author strike dots, Protokoll history table, decision modals replacing browser prompts — incl. the **Ban-Bremse** (third-strike rejections require an explicit ban confirmation with the author's strike ledger inline) and a **bulk consequence preview** (per-author strike deltas + ban acknowledgment before any bulk reject) — plus a mobile triage mode
- **3-strike ban enforcement**: banned accounts cannot log in (kiosk „Konto gesperrt" card, enumeration-safe) and existing sessions turn read-only (26 write APIs return 403, non-dismissible suspended banner, compose pages redirect) — bans only ever happen through the confirmed moderation flows
- **Daily Posting Limits**: four buckets of 5 per rolling 24h — forum posts (discussions, announcements and recommendations counted together), events, listings, news submissions; an admin can raise the number (1–50) for a member registered as an organisation
- **Newsboard**: AI-curated local news from 9 RSS feeds + NewsData.io, with GPT-4o relevance scoring
- **Marketplace (kiosk)**: 3 listing kinds (verkaufen / tausch / verschenken), **13 kiosk taxonomy categories** with one-time backfill of legacy English-key listings (`scripts/migrate-legacy-categories.ts`), delivery enum (Abholung / Versand / Abholung & Versand), optional detail fields (5 German free-text fields + condition enum), editorial lead-of-the-day on page 1, contact-form relay via Resend (privacy-preserving — no email addresses exposed), **single-threshold 21d visibility**: past-21d listings hide from public feed/search/direct URL (friendly "nicht mehr verfügbar" page at the same URL — HTTP 200, indexable-but-empty); author still sees them in „Meine Anzeigen" as grayed cards with a bump prompt, **no bump rate limit** (bump = freshness reset, available subject only to status/moderation guards), owner lifecycle (edit / bump / reserve / sold / delete with state-aware gating via `canMutateListing`). Warning-labeled AND rejected listings are editable — the edit endpoint re-runs full moderation + writes a pre-edit snapshot to `listingAuditTrail` for provability. Mobile FAB for new listings, SEO-friendly hybrid SSR-static + island-hydrate detail pages.
- **Custom UI Dialogs**: Native `<dialog>`-based confirm modals and sonner toasts replace all browser-native dialogs
- **Kiez Data Dashboard**: Interactive Schillerkiez neighborhood statistics with hand-drawn SVG charts, historical trends (demographics + social indicators 2013–2023), and live air quality data
- **Public landing + login gating** (Aug 2026): editorial one-pager at `/` (masthead, KiezHeartbeat strip with server-side zero rule, blog/Kiez-Daten/Kurier teasers, one CTA, watercolor riso overprint background) — member surfaces (forum, calendar, newsboard, bookmarks, search, profiles) require login via a central middleware gate with `?redirect=` round-trip (URL-normalization open-redirect guard in `src/lib/auth/safeRedirect.ts`); marketplace, blog, and Kiez-Daten stay public. Legal pages at `/impressum` + `/datenschutz`.
- **Forum (kiosk)**: Multi-collection merged feed (discussions + announcements + recommendations) on `/forum` with per-kind detail routes, per-kind card straps + chips, card height convergence (`line-clamp-3` body + `min-h-[340px]`), and resilient `Promise.allSettled` fetch (single-collection outage degrades to empty array for that kind only).
- **Official admin announcements**: up to three concurrent 7-day pins at the top of the forum feed (newest as featured card, older pins as slim pin bars; server-enforced cap with oldest-pin displacement), admin dashboard at `/admin/announcements` for create/edit/pin/unpin/delete. Admin role bypasses AI moderation.
- **Moderation visibility (forum + calendar)**: Author-only banners (`OwnStatusBanner` for pending / reported / rejected, with rejection-reason blockquote), author-only ghosting (dashed `border-warn`/`border-plum`/`border-danger` + body opacity), non-author "⚑ GEMELDET" chip for community-reported pending (no banner, no ghost — anti-stigma). Rejected items sort to the top of the author's view. Edit lockout (`403 'edit_blocked_by_moderation'`) on any non-approved status — UI mirrors with visibly disabled edit buttons.
- **Calendar (kiosk)**: Live `now` ticker store (60s aligned to wall-clock minute) drives "is this event live right now?" reactivity across detail modal, agenda, sidebar, month grid, and mobile day view. Saved events with optimistic mutations. Public attendee-profile lookup endpoint for the going-list stack. Dedicated edit page at `/events/edit/[id]` with flash-redirect cache-bust.
- **Profile (kiosk) & account lifecycle**: own-profile Meldebogen with a derived Kiez-Chronik tenure timeline, cross-surface Archiv activity feed, printable A6 Steckbrief card (QR-coded), and public neighbor profiles at `/nachbarn/[handle]` (trimmed view, no e-mail/moderation/settings) reached by clicking any author byline. Self-service e-mail change (double-confirm, old session stays valid) and password change (other-device sign-out via a `passwordChangedAt`-vs-`loginAt` JWT check, silent same-device re-login). Account deletion with a 7-day undo grace period (in-app "Widerrufen" + mailed token) followed by an automated day-7 anonymization pipeline (Vercel cron): the account is tombstoned as "Ehemaliges Mitglied" while authored content is kept intact (Nachweispflicht) and the user's own RSVPs/bookmarks/listings are cleaned up.
- **Onboarding tour („Die Führung")**: spotlight tour in seven per-surface chapters (Forum → Kalender → Marktplatz → Kurier → Kiez-Daten → Blog → Profil, 32 stops total) with ochre chrome, per-chapter seen-stamps on the user doc, and a „Hallo Kiez" post template handoff at the forum chapter's end
- **Error monitoring**: Sentry (errors-only, EU region, GDPR-conscious: no PII, no replay/tracing) with silent-degradation alerts for swallowed provider failures and an admin errors widget on `/admin/moderation`
- **Forum post images**: Up to 5 images per post (topics, announcements, recommendations) with Cloudinary upload, GPT-4o vision moderation, and scroll-snap carousel with arrow nav in the detail modal.
- **Notification center** (Aug 2026, R1 + R2): bell + panel in the kiosk nav — neighbors get notified about replies to their posts, moderation decisions (incl. strike number), official announcements (broadcast), and marketplace inquiries. Fan-out on write into a `notifications` collection (90d TTL), read-time actor-name join (deletion-safe), copy rendered client-side from i18n (locale toggle works retroactively), 90s visible-tab polling — plus optional web push (PWA — install Mahalle to the home screen on iOS) via a push-only service worker, no offline caching.
- **Forum bookmarks**: Save/bookmark posts with server-side persistence (`savedPosts` collection) and optimistic UI updates. Same pattern for saved events (`savedEvents`).
- **Forum search & tag filtering**: Client-side filtering by title, body, author name, and tags. Clickable tag pills set the search value.
- **Performance**: Cloudinary `f_auto,q_auto` URL rewriter (`src/utils/cloudinary.ts`) applied to all user-uploaded images, SSR prefetch for forum default tab and batched `$in` author lookups.

## 🛡️ Content Moderation

The app includes a comprehensive content moderation system:

### AI Moderation
- **Layer 1 — Profanity filters**: Turkish, English, and German blocklists with leetspeak normalization (catches obfuscated profanity like "m0therfu5ker5", "sh1tface", "a$$hole")
- **Layer 2 — Safety scan**: OpenAI `omni-moderation-latest` scans all content types on submission (topics, comments, events, announcements, recommendations, marketplace listings)
- **Layer 3 — GPT content check**: `checkSpamWithGPT()` catches spam, ads, scams, **hate speech**, and **harassment** that the safety scan misses — runs on all content types. Hate speech and harassment are flagged as urgent.
- **Layer 4 — Image safety** (marketplace + forum posts): GPT-4o vision scans images for inappropriate content
- **Layer 5 — Username validation**: `checkNameProfanity()` at registration runs all blocklists (word-boundary + substring for concatenated profanity) plus OpenAI Moderation API + GPT hate speech check
- All checks run in parallel via `Promise.all()` and are merged with `mergeModerationResults()`
- Content exceeding thresholds is queued for admin review
- Fail-safe: If any API fails, content is queued for manual review (never auto-approves on error)
- **Daily posting limits**: four buckets of 5 per rolling 24h (forum posts of all three kinds together, events, listings, news submissions). Comments excluded. Organisations can get a higher admin-set limit.
- **Member types**: members register as a private person, an association/initiative or a business; the latter two carry a small tag („Initiative“ / „Gewerbe“) beside their name. Self-chosen, changeable in the profile, correctable by the admin.

### User Reporting
- Users can report all content types via 🚩 flag button
- Report reasons: spam, harassment, hate speech, violence, inappropriate, misinformation
- Duplicate reports tracked per user (prevents spam reporting)
- Reported content stays visible but locked from editing/deleting
- Author sees orange banner: "Your content has been reported by the community"

### Admin Dashboard (`/admin/moderation`)
- **Queue view**: Review pending flagged content with row selection and bulk actions
- **History view**: Sortable table with column visibility toggle and human-readable category labels
- **Filter tabs**: All, Discussions, Comments, Announcements, Events, Recommendations, Marketplace
- **Stats counters**: Urgent, Pending, Approved, With Warning, Rejected
- **Actions**:
  - ✓ Approve (publish content)
  - ⚠ Approve with Warning (add content warning label)
  - ✕ Reject (remove content, add strike to author)
  - Bulk Approve / Bulk Reject (up to 50 items at once)
- **Strike system**: 3 strikes = automatic user ban

### Moderation Status Flow
| Status | Visible to Others | Author Sees | Edit/Delete |
|--------|-------------------|-------------|-------------|
| AI flagged (pending) | ❌ | Amber "under review" banner | ❌ Disabled |
| User reported (pending) | ✅ | Orange "reported" banner | ❌ Disabled |
| Approved | ✅ | Normal | ✅ Enabled |
| Approved with Warning | ✅ (blurred until revealed) | Warning badge | ✅ Enabled |
| Rejected | ❌ | Red "rejected" banner | ❌ Disabled |

## 📰 Newsboard

The app includes an AI-powered local news aggregation system:

### Daily News Fetch
- **Vercel cron job** runs daily at 6 AM UTC, triggering `/api/news/fetch-daily`
- Fetches from **9 RSS feeds** (Tagesspiegel, Berliner Zeitung, Berliner Kurier, nd-aktuell, taz, Kiez und Kneipe, Schillerpromenade, Facetten Neukölln, Pro Schillerkiez) + **NewsData.io API**
- **GPT-4o relevance scoring**: Each article scored 0-100 for Berlin/Neukölln relevance
- Only articles scoring ≥70 are saved (max 20/day)
- GPT also generates 2-3 sentence German summaries for paywalled articles

### News Sources
- **AI-fetched articles**: Auto-approved, no moderation needed
- **User-submitted articles**: Go through the standard moderation pipeline
- Articles without images use `og:image` scraping as fallback, then a local placeholder

### Newsboard UI
- Date filter tabs: 7 Days, 30 Days, 3 Months, 6 Months, 1 Year, Archive
- Live search with 300ms debounce
- Pagination with page size selector and First/Prev/Next/Last navigation
- Modal view with keyboard navigation (← →)
- Server-side bookmark persistence for logged-in users

## 📊 Kiez Data Dashboard

The `/schillerkiez` page shows neighborhood-level statistics for the Schillerkiez area in Berlin-Neukölln.

### Data Sources
- **Demographics** (half-yearly): Population, age distribution, migration background, gender — from Amt für Statistik Berlin-Brandenburg
- **Social indicators** (biennial, 2013–2023): Unemployment rate, child poverty, transfer benefits, Status/Dynamik index — from Monitoring Soziale Stadtentwicklung Berlin
- **Air quality** (live): PM10, NO₂, O₃, CO grades from BLUME station MC042 (Nansenstraße)

### Data Pipeline
- `scripts/sync-stats.ts` downloads XLSX files, parses with ExcelJS, and upserts to MongoDB
- `scripts/backfill-history.sh` — one-time demographic backfill (6 periods)
- `scripts/backfill-social.sh` — one-time MSS social index backfill (2013–2021)
- GitHub Actions workflow runs 2x/year (March + September) + manual dispatch
- Handles Berlin's 2021 LOR reform: auto-detects old (2 PLR) vs new (4 PLR) area codes

### Dashboard Sections
1. **Air Quality** — live pollutant grades with color-coded scale
2. **Age Distribution** — horizontal bar charts (aggregate + per-PLR carousel)
3. **Migration Background** — donut charts showing non-overlapping segments
4. **Gender** — donut charts (male/female split)
5. **Social Snapshot** — horizontal bar charts for unemployment, child poverty, transfer benefits
6. **Population Trend** — line charts (aggregate + per-PLR + migration diversity %)
7. **Social Trend** — "Soziale Entwicklung" carousel showing 10-year trends with merged old/new LOR lines
8. **Sources** — data attribution, LOR reform explanation, index definitions

### Environment Variables (sync script)
- `STATS_XLSX_URL` / `STATS_PERIOD` — AfS demographics XLSX
- `MSS_XLSX_URL` / `MSS_PERIOD` — MSS social index XLSX
- `MSS_SDI_URL` — MSS Status/Dynamik index XLSX (optional)

## 📚 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration

### Topics (Forum)
- `GET /api/topics` - List topics
- `POST /api/topics/create` - Create topic
- `PUT /api/topics/edit/[id]` - Edit topic
- `DELETE /api/topics/delete/[id]` - Delete topic

### Events (Calendar)
- `GET /api/events` - List events (with date range filter)
- `POST /api/events/create` - Create event
- `PUT /api/events/edit/[id]` - Edit event
- `DELETE /api/events/delete/[id]` - Delete event
- **Date range selection**: Click future days in the calendar grid to select a range (teal highlight), extend/shorten by clicking after/within the range, then click the floating "+" tooltip to open the event form with dates pre-filled

### Announcements
- `GET /api/announcements` - List announcements
- `POST /api/announcements/create` - Create announcement
- `PUT /api/announcements/edit/[id]` - Edit announcement
- `DELETE /api/announcements/delete/[id]` - Delete announcement

### Recommendations
- `GET /api/recommendations` - List recommendations
- `POST /api/recommendations/create` - Create recommendation
- `PUT /api/recommendations/edit/[id]` - Edit recommendation
- `DELETE /api/recommendations/delete/[id]` - Delete recommendation

### Comments
- `GET /api/comments/[postId]` - Get comments for a post
- `POST /api/comments/create` - Create comment
- `DELETE /api/comments/delete/[commentId]` - Delete comment

### Interactions
- `POST /api/likes/toggle` - Toggle like on content
- `POST /api/views/increment` - Increment view count

### News
- `GET /api/news` - List news (with pagination, search, date filters)
- `POST /api/news/submit` - Submit user news article
- `GET /api/news/fetch-daily` - Trigger daily AI news fetch (cron, requires CRON_SECRET)
- `POST /api/news/save` - Save/unsave a news article (bookmark)
- `GET /api/news/save` - Get user's saved news IDs
- `GET /api/news/preview` - Preview metadata from a URL

### Marketplace (Listings)
- `GET /api/listings` - Browse listings (with filters)
- `POST /api/listings/create` - Create listing
- `PUT /api/listings/edit/[id]` - Edit listing
- `DELETE /api/listings/delete/[id]` - Delete listing
- `GET /api/listings/daily-count` - Get user's daily listing count
- `POST /api/listings/draft` - Save/update draft listing (relaxed validation, no moderation)
- `POST /api/listings/draft/[id]/publish` - Publish draft (full moderation + daily limit check)
- `POST /api/listings/[id]/bump` - Bump listing to reset its 21-day freshness clock + sort to top (no rate limit; gated only on status/moderation; supersedes the original A5 7-day cooldown)
- `POST /api/listings/[id]/status` - Update listing status (available / reserved / sold / exchanged)
- `POST /api/listings/[id]/contact` - Send buyer→seller contact message (Resend relay, no email exposure)

### Moderation
- `POST /api/reports/submit` - Submit user report
- `GET /api/admin/moderation` - List flagged content (admin)
- `POST /api/admin/moderation/review` - Approve/reject content (admin)
- `POST /api/admin/moderation/bulk-review` - Bulk approve/reject up to 50 items (admin)

### Kiez Data
- `GET /api/kiez-stats` - Schillerkiez demographics, social indicators, and trends (public, 24h cache)
- `GET /api/kiez-air` - Live BLUME air quality grades for station MC042 (public, 30 min cache)
- `GET /api/kiez-heartbeat` - Aggregate landing-strip data (air / posts this week / weekend events / today's Kurier issue), public, 1h in-DB cache, zero rule applied server-side

### Other
- `POST /api/upload/image` - Upload image to Cloudinary (profile pictures)
- `POST /api/posts/upload` - Upload forum post image to Cloudinary (max 5MB)
- `POST /api/posts/save` - Toggle save/unsave forum post bookmark
- `GET /api/posts/save` - Get user's saved post IDs
- `POST /api/users/update` - Update user profile

## 🔒 Environment Variables

Required environment variables:

- `AUTH_SECRET` - NextAuth secret key
- `AUTH_TRUST_HOST` - Set to `true` for Vercel deployment
- `NEXTAUTH_URL` - Canonical app origin (`https://mahalle.digital`) — **required in prod**; emailed links (password reset, e-mail verification) are built from it and the forgot-password flow fails closed without it
- `MONGODB_URI` - MongoDB connection string (db name in the URI path: `/mahalle` prod, `/mahalle-dev` dev/preview)
- `CLOUDINARY_CLOUD_NAME` - Cloudinary cloud name
- `CLOUDINARY_API_KEY` - Cloudinary API key
- `CLOUDINARY_API_SECRET` - Cloudinary API secret
- `OPENAI_API_KEY` - OpenAI API key (content moderation + news relevance scoring)
- `CRON_SECRET` - Vercel cron job authentication secret
- `NEWSDATA_API_KEY` - NewsData.io API key (optional, for additional news sources)
- `RESEND_API_KEY` - Resend.com API key — production email transport (auth mails + contact relay)
- `SENDING_FROM_EMAIL` - Sender address for all app email, e.g. `Mahalle <noreply@mahalle.digital>`
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` - Optional SMTP transport (local dev; wins over Resend when set)
- `CONTACT_IP_SALT` - 32+ char secret, fixed across deploys, used to hash IPs in rate-limit keys
- `IMPRESSUM_STREET` / `IMPRESSUM_ZIP_CITY` - Ladungsfähige Anschrift for `/impressum` + `/datenschutz` (read at request time, rendered obfuscated; unset shows a placeholder)
- `ALLOWED_ORIGINS` - CSV of allowed origins for contact relay + resend-verification CSRF guard (e.g. `https://mahalle.digital`)
- `SENTRY_DSN` / `PUBLIC_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` - Error monitoring (all optional; init no-ops without the DSNs)
- `STATS_XLSX_URL` - AfS demographics XLSX URL (optional, sync script)
- `STATS_PERIOD` - AfS period, e.g. "2025h2" (optional, sync script)
- `MSS_XLSX_URL` - MSS social index XLSX URL (optional, sync script)
- `MSS_PERIOD` - MSS report period, e.g. "2023" (optional, sync script)
- `MSS_SDI_URL` - MSS SDI XLSX URL (optional, sync script)
- `MSS_BEZIRKE_XLSX_URL` - MSS Bezirke-level XLSX for the Berlin-Vergleich reference import (optional, sync script)
- `VAPID_PRIVATE_KEY` - Web push VAPID private key, server-secret (optional; unset ⇒ push no-ops silently)
- `PUBLIC_VAPID_PUBLIC_KEY` - Web push VAPID public key, ships to the client bundle (optional, pairs with `VAPID_PRIVATE_KEY`)

## 🐛 Debugging

1. **Check MongoDB connection:**
   - Verify `MONGODB_URI` in `.env`
   - Check MongoDB Atlas network access

2. **Vercel deployment issues:**
   - Check build logs in Vercel dashboard
   - Verify environment variables are set in Vercel project settings

3. **TypeScript errors:**
   - Run `pnpm type-check`
   - Check `tsconfig.json` configuration

## 📖 Documentation

For more information:
- [Astro Documentation](https://docs.astro.build)
- [TanStack Query](https://tanstack.com/query/latest)
- [auth-astro](https://github.com/nowatica/auth-astro)
- [MongoDB Node Driver](https://www.mongodb.com/docs/drivers/node/)
- [Vercel Deployment](https://vercel.com/docs)

## 📄 License & Manifesto

© Ercan Atak — Mahalle. Licensed under **PolyForm Noncommercial 1.0.0** with the **Mahalle Field-of-Use Rider** — see [`LICENSE`](./LICENSE).

Free for noncommercial use by neighborhood associations, housing cooperatives, public institutions, and community groups. **Not permitted** for political parties, for-profit entities, religious proselytizing, single-individual personal deployments, or surveillance of residents. Commercial licensing inquiries: contact the author.

Before deploying or forking, please read [`MANIFESTO.md`](./MANIFESTO.md) — the project's binding statement of intent on what Mahalle is, who it is for, and what it refuses to become.

**Before you deploy your own instance**, please say hello at admin@mahalle.digital. The license doesn't require it, but Mahalle is a neighborhood project and I'd like to know where it travels.
