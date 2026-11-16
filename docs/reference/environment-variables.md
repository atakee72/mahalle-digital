# Environment variables

Moved verbatim from the root `CLAUDE.md` on 2026-11-16, when that file was slimmed; the root keeps a short version and points here. Add new notes on this topic HERE and keep the root's short version true. A „see X above/below" or a quoted section name in this text may point to another file now — the map is in `docs/reference/README.md`.

## Environment Variables

Required in `.env`:
```
AUTH_SECRET=            # NextAuth secret
AUTH_TRUST_HOST=true
NEXTAUTH_URL=           # Canonical app origin — https://mahalle.digital in prod (domain live since 2026-08-09; the old mahalle-das-kiezgesichterbuch.vercel.app 308-redirects here, deep links preserved). REQUIRED in prod — the password-reset link is built from this, NOT the request Host header (host-header-injection protection). If unset in prod the forgot-password flow FAILS CLOSED (no reset email sent). Dev falls back to the request origin.
MONGODB_URI=            # MongoDB connection string. DB name rides in the URI path (client.db() reads it): prod = /mahalle, local dev + Vercel Preview = /mahalle-dev (split 2026-08-14; same Atlas cluster). Seed dev via scripts/seed-dev-db.ts (interlock: refuses any db name without "dev"). Pre-split snapshot CommunityWebApp-test is frozen — never write to it.
CLOUD_NAME=             # Cloudinary cloud name — the upload routes read CLOUD_NAME (not CLOUDINARY_CLOUD_NAME)
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
OPENAI_API_KEY=         # Content moderation API + news relevance scoring
CRON_SECRET=            # Vercel cron job authentication
NEWSDATA_API_KEY=       # NewsData.io API (optional, for additional news sources)
DEEPL_API_KEY=          # DeepL API key for on-demand content translation (POST /api/translate). Target languages = DeepL's FULL set (101 languages as of 2026-10-13, `src/lib/translation/targetLangs.ts`, pure, shared by server + client; the browser's language picks the target). Until that day a hand-picked 15 (de en tr pl ru uk ar fr es it ro bg el nl pt) while the landing page promised „30+" — refresh recipe in the file's header. Free-tier keys end ":fx" → api-free.deepl.com host is auto-selected. SERVER-ONLY secret. Unset ⇒ endpoint 503s translate_unavailable and the UI shows an inline error — no other feature affected. **Visitors may translate BLOG posts since 2026-11-07** (owner: the Beilage is the public door, a reader from a search engine must get the same toggle): `POST /api/translate` without a session is allowed for `contentType: 'blog'` only — 10/h per IP hash + ONE shared budget of 10 DeepL calls (cache misses) per UTC day across all visitors, cache hits unlimited (`translateBlogPost({ reserveFetch })` reserves a budget slot atomically on a cache miss, `budget` → 429); every other type stays 401 for visitors, members keep 30/h. Rules in the pure `src/lib/translation/translateAccess.ts` (tested). Datenschutz needed no change (it names DeepL and „nur der zu übersetzende Text", nothing about members).
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
SENTRY_AUTH_TOKEN=       # SERVER-ONLY secret. Never exposed to the client. Powers /api/admin/errors + sourcemap uploads (astro.config.mjs). READ-scoped: issue writes (resolve/ignore) return 403 — resolve issues in the Sentry UI (select-all → Resolve), verified 2026-09-16. Stats API: `interval=1d` (a 30d interval is rejected).
SENTRY_ORG=              # Sentry org slug
SENTRY_PROJECT=          # Sentry project slug
PUBLIC_VERCEL_ENV=       # Optional; set per Vercel scope (production/preview) so CLIENT Sentry events tag their true environment (server gets VERCEL_ENV for free). Not needed locally.
VAPID_PRIVATE_KEY=      # Web push VAPID private key. SERVER-SECRET, never exposed to the client. Unset ⇒ push send no-ops silently (preview deploys have no keys — expected).
PUBLIC_VAPID_PUBLIC_KEY= # Web push VAPID public key. PUBLIC_-prefixed — ships to the client bundle (src/lib/pushClient.ts). Pairs with VAPID_PRIVATE_KEY; generate both together, never mix pairs.
IMPRESSUM_STREET=       # Ladungsfähige Anschrift, Straße + Hausnummer. SSR-only (read at request time in impressum/datenschutz.astro — but Vercel injects env at DEPLOY time, so changing the value still needs one redeploy; verified 2026-08-24), rendered via src/components/legal/ObfuscatedText.astro (char-code obfuscation, JS-decoded — keeps the address out of the repo and away from naive scrapers). Unset ⇒ visible "[Anschrift nicht konfiguriert]" placeholder.
IMPRESSUM_ZIP_CITY=     # e.g. "12049 Berlin" — same handling as IMPRESSUM_STREET.
TELEGRAM_BOT_TOKEN=     # BotFather token for the admin-alerts bot. SERVER-ONLY secret (Vercel Sensitive). Unset ⇒ Telegram alerts silently no-op (dev/preview default).
TELEGRAM_ADMIN_CHAT_ID= # Numeric chat id of the admin↔bot DM (from getUpdates after /start). Server-only.
ADMIN_ALERT_EMAIL=      # Email mirror recipient for admin-action alerts (member/moderation/report). Unset ⇒ email leg no-op. REMOVED from Vercel Production 2026-09-14 for the Schillermarkt debut (Resend Free = 100 mails/day; the mirror cost a third mail per signup) — Telegram carries every alert; re-add after the event if wanted.
SENTRY_WEBHOOK_SECRET=  # Random 32+ chars guarding POST /api/hooks/sentry. Unset ⇒ endpoint fail-closed 401.
INVITES_PAUSED=         # Optional kill switch for personal invitation links (2026-10-07): `1` pauses inviting for EVERY member (links die, the profile card says „zurzeit pausiert"). Read at request time, but Vercel injects env at deploy time — flipping it is a redeploy. Unset = invites on. Per-member pause: the admin's pill on /admin/mitglieder.
DEMO_MODE=              # Read-only demo deployment (2026-10-26): `1` ONLY on the `demo` branch's preview scope. Takes effect only together with a database whose name matches /dev/i (prod's `mahalle` never qualifies) — then the passwordless `demo` Auth.js provider exists, every non-GET is refused except three Auth.js paths, landing/login/register show „Demo starten", a banner says „nur lesen". Read at request time. Never set it in Production. See „Demo deployment".
GOATCOUNTER_ENDPOINT=   # Visitor counting (2026-10-14): beacon URL of the hosted GoatCounter site, e.g. https://mahalle.goatcounter.com/count. Not a secret. Read at REQUEST time (compiles to process.env); the counter renders only when this is set AND VERCEL_ENV=production AND the session is not an admin. Unset ⇒ no counter anywhere (dev, preview). See „Visitor counting".
SAFE_BROWSING_API_KEY=  # Google Safe Browsing link check (2026-10-31): unset = silent no-op (dev, preview, demo); set in Production only; non-commercial terms. See „Content Moderation“.
RESEND_WEBHOOK_SECRET=  # Svix signing secret of the Resend webhook endpoint (2026-11-02, `whsec_…`, shown once at resend.com/webhooks): verifies POST /api/hooks/resend. Read via `process.env` at REQUEST time on purpose — `import.meta.env.X` is compiled to a run-time read ONLY when X exists in the environment at build; a variable absent at build is inlined as `undefined` (the route would answer 401 forever). Unset ⇒ 401 `not_configured` (fail-closed). Set in Production as a sensitive var 2026-11-02; in local `.env` for probes.
```
