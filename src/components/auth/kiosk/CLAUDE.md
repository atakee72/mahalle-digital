# Auth (kiosk) notes

Loaded when working in `src/components/auth/kiosk/`. The login + register front
door, migrated to the Editorial Kiosk system (Phase 1, June 2026). Plan:
`docs/superpowers/plans/2026-06-26-auth-kiosk-redesign-phase1.md`.

## Layout — AuthLayout, NOT KioskLayout
Auth pages use `src/layouts/AuthLayout.astro` (sibling to KioskLayout). KioskLayout
hardcodes the full app `KioskNav` (Forum/Calendar/… links), which is wrong on a
logged-out front door. AuthLayout gives the same `.k-paper-bg` grain + tokens +
`data-page="auth"` but only a slim masthead (monogram + wordmark + region +
`AuthLangToggle`). No KioskNav, no bottom mobile nav, no KioskFooter.

## Accent = ochre
`tokens.css` sets `[data-page="auth"] { --k-accent: var(--k-ochre); }` (#e8a53a) —
the one primary hue no other surface claims. The handoff's `tokens-auth.css` (old
`--ink`/`--carved-accent` naming) was NOT imported; the accent is wired via the
established `--k-*` page-accent pattern instead.

## Pieces
- `AuthLayout.astro` — shell + masthead.
- `AuthLangToggle.svelte` — DE/EN pills → `setLocale` (existing `kiosk-i18n` store).
- `primitives/` — `AuthField` (input + error/hint/show-toggle/success), `AuthPrimaryBtn`
  (ink fill + ochre print shadow + spinner), `AuthBanner` (warn/danger/success/info),
  `AuthStrength` (4-segment pw meter).
- `AuthLoginInner.svelte` / `AuthRegisterInner.svelte` — orchestrators, mounted
  `client:only="svelte"` on `/login` + `/register`.

## Backend reused untouched
Login → `signIn('credentials', { redirect:false })`; register → `POST /api/auth/register`

**Gate hint (2026-09-11)**: when the middleware bounces a logged-out visitor
here with `?redirect=<path>`, `AuthLoginInner` shows an ochre strap under the
title naming the destination („Bitte melde dich an, um zum Kalender zu
kommen.") — prefix map `DEST_KEYS` in the island, labels `auth.login.dest.*`,
unknown paths fall back to `auth.login.hintGeneric`. Runs through
`safeInternalPath` first, so an escaped origin shows nothing. Hidden while the
signed-out strap or the success banner is up.
({name,email,password}) then auto-login. Client validation reuses `LoginSchema` +
a local password scorer (the form's own checks: min 8 + upper/lower/digit). No
changes to `auth.config.ts` or `register.ts`.

## Anti-enumeration
Login shows ONE generic error ("E-Mail oder Passwort stimmt nicht.") for both
wrong-password and unknown-email. Never distinguish them externally.

## Phase 2A — Splash + KiezHeartbeat (shipped, 2026-06-27)

Frontend-only, no backend. Both live in `AuthLayout` (login/register only).

- **`KiezHeartbeat.svelte`** — ambient "live im Kiez" strip in the AuthLayout footer
  (`client:load`). Pulse dot keyframe is reduced-motion-gated. It is ambient, not
  load-bearing — never throws, never blocks paint.
  - **Refit for the Aug 2026 landing release**: the per-surface list APIs
    (`/api/events`, `/api/news`, …) went login-gated, so the original three-GET
    fetch would 401 for logged-out visitors on exactly the page that needs it
    most. `KiezHeartbeat` now makes a SINGLE public aggregate fetch to
    `GET /api/kiez-heartbeat` (the same source that backs the landing page's
    heartbeat strip, `src/lib/landing.ts`'s `getLandingData()`) with the same
    3s-abort + per-segment graceful-omission contract. Segment semantics
    changed with the source: `posts` is forum items (topics + announcements +
    recommendations) created in the **current ISO week** (not "today"), and
    `events` is events on the **coming weekend** (not "today") — read the
    response's `rows[].kind` (`'air' | 'forum' | 'events' | 'kurier'`) and map
    `forum`→posts, `events`→events, `air`→air (only when `!row.mute`).
- **`KioskSplash.astro`** — once-per-session splash overlay on the auth front door.
  Reuses `SplashScreen.astro`'s proven logic (`/LogoVideo.mp4`, dual-gate dismiss =
  video-ended AND window-load, 4s safety timeout) but paper-skinned for kiosk. Gate =
  `sessionStorage['mahalle-splash-shown']` (the key the global SplashScreen shared
  until that component was removed on 2026-09-30), so it is once per session. `prefers-reduced-motion` (or video-can't-play)
  → skip the video and show the CSS carve-in reveal fallback (ochre monogram + wordmark
  + tagline). Scoped to AuthLayout; extending to `KioskLayout` (the deferred "Kiosk
  variant TBD") is a future follow-up, not done here. (The old co-mount gotcha with
  the global `SplashScreen.astro` ended when that file was removed on 2026-09-30.)

Rate-limit (state 05) shipped — see the Rate-limit / hardening section.

## Forgot / reset password (shipped, 2026-06-27)

Net-new secure backend, kiosk front-end. Reuses the existing Resend + `src/emails/`
react-email pattern.

- **Token lib** `src/lib/auth/passwordReset.ts` (SERVER-ONLY): `createPasswordResetToken`
  (single-use, 30-min, latest-wins + 60s resend guard, returns RAW token),
  `findValidResetToken` (read-only, for the SSR page check), `resetPasswordWithToken`
  (atomic `findOneAndUpdate` claim → bcrypt-12 rewrite of `users.password`). Tokens are
  stored ONLY as `sha256(raw)` in the new **`passwordResetTokens`** collection
  (`{ tokenHash, userId, expiresAt, usedAt, createdAt }`); the raw token lives only in
  the emailed link.
- **Email** `src/lib/auth/sendResetEmail.ts` + `src/emails/PasswordResetEmail.tsx`.
  Reset link is built from the trusted `NEXTAUTH_URL` (not request Host header) and fails
  closed in production if unset (CWE-640 host-header-injection protection). Dev-log fallback:
  when no mail transport is configured (`isMailerConfigured()` in `src/lib/email/mailer.ts`
  — SMTP or Resend) it `console.log`s the link instead of sending (so the flow is testable
  in dev) — read the dev server stdout to get the link.
- **Endpoints**: `POST /api/auth/forgot-password` (ALWAYS generic 200 — anti-enumeration;
  issues token + sends/logs link for real users only); `POST /api/auth/reset-password`
  (`ResetPasswordSchema` validation; generic `invalid_or_expired` for bad/expired/used
  tokens). Does NOT touch `emailVerified` (that's the verify plan).
- **Pages**: `/forgot-password` (`AuthForgotInner` request→sent, anti-enum identical
  confirm) and `/reset-password?token=…` (`reset-password.astro` SSR-validates the token
  → `AuthResetInner` reset→done, or a hardcoded-DE "invalid link" card). The Phase-1 login
  "Passwort vergessen?" link now resolves.

## Email verify — soft gate (shipped, 2026-07-03)

SOFT gate: login and all features work unverified — verification only drives
the nag surfaces. Mirrors the forgot-password stack.

- **Token lib** `src/lib/auth/emailVerify.ts` (SERVER-ONLY): `createEmailVerifyToken`
  (single-use, **24h** TTL, latest-wins + 60s resend guard, returns RAW token),
  `findValidVerifyToken` (read-only, SSR page check), `verifyEmailWithToken`
  (atomic claim → sets `users.emailVerified: true`, rollback on write failure).
  Tokens stored ONLY as `sha256(raw)` in **`emailVerifyTokens`**
  (`{ tokenHash, userId, expiresAt, usedAt, createdAt }`).
- **Base URL**: emailed links use `getTrustedBaseUrl()` from `src/lib/auth/baseUrl.ts`
  (extracted from forgot-password; NEXTAUTH_URL, prod fail-closed, CWE-640).
- **Email** `src/lib/auth/sendVerifyEmail.ts` + `src/emails/VerifyEmail.tsx`;
  dev-log fallback when no mail transport is configured (`isMailerConfigured()`,
  `src/lib/email/mailer.ts`) — link in dev-server stdout.
- **Endpoints**: `POST /api/auth/verify-email` ({token}, sessionless — link may open
  in another browser; POST-not-GET so scanner prefetches can't burn tokens);
  `POST /api/auth/resend-verification` (session-gated own-account, 429 on 60s guard);
  `GET /api/auth/verification-status` (session-gated LIVE DB read — beats stale JWT).
- **Page** `/verify-email` (`AuthVerifyInner`): no token → "sent" card (session
  required, redirects `/login`; already-verified redirects `/`); `?token=` →
  SSR read-only validate, island auto-POSTs to consume → confirmed card →
  redirect `/` (or `/login` if sessionless). Invalid/expired → resend (if logged
  in) or login CTA. Register now lands here after auto-login.
- **Session flag**: `emailVerified` propagates `authorize → jwt → session` (like
  `role`; augmentation in `src/types/next-auth.d.ts` — `User` side is
  `boolean | Date | null` to stay assignable from AdapterUser). **Stale-JWT
  gotcha**: the flag snapshots at login; anything that must be CURRENT reads
  `/api/auth/verification-status`, not the session.
- **Banner** `VerifyEmailBanner.svelte`, mounted in `KioskLayout` for sessions
  with `emailVerified !== true`. Hidden until a live status check confirms
  unverified; dismiss = `sessionStorage['mahalle-verify-banner-dismissed']`
  (per browser session). Design deviations from the mock: 24h copy (not 30 min),
  no "E-Mail ändern" button (email-change feature doesn't exist).
- Existing `emailVerified: false` users got NO email blast — banner + self-resend only.

## Rate-limit / hardening — state 05 (shipped, 2026-07-04)

Fixed-window limiter in `src/lib/auth/rateLimit.ts` (SERVER-ONLY) over the
**`rateLimits`** collection (`{ key: '<baseKey>#<windowId>', baseKey, count,
expiresAt }`, TTL-cleaned; indexes via `pnpm tsx scripts/create-auth-indexes.ts`
— run against prod at deploy). IPs stored only as sha256(ip + CONTACT_IP_SALT)
truncated to 32 chars (same salt as the contact relay).

- **Login lockout (state 05)**: 5 failed attempts / 15 min per lowercased
  email, enforced INSIDE `authorize()` (peek before bcrypt, consume on fail,
  clear on success). Applies to unknown emails identically — no enumeration.
  While locked even the correct password is refused. UI: `AuthLoginInner`
  asks peek-only `POST /api/auth/login-status` after a failed signIn and
  shows the danger banner + m:ss countdown + disabled fields.
- **forgot-password**: 20/h per IP + 3/h per email, SILENT (still generic 200,
  send skipped). Also bounds the CWE-208 timing side-channel. Lookup now
  collation-insensitive (strength 2).
- **register**: 40/h per IP + 3/h per email → 429 (`auth.err.tooMany` in the
  UI; since 2026-09-28 `auth.err.tooManyIn` „in etwa {min} Minuten" when the
  body carries `retryAfterSec` — DRAFT copy, his wording open). IP gate placed
  BEFORE the OpenAI profanity check (cost guard); **the email gate moved on
  2026-09-28 to AFTER `checkNameProfanity()`, right before the duplicate-email
  lookup** — a restaurant owner had three names refused (GPT labelled „Berlin
  Cigkofte" an advert, see root CLAUDE.md „Username validation") and the fourth
  try hit the hour-long e-mail lock; the bucket still caps duplicate-e-mail
  probing. **IP gates are ROOM-sized since
  2026-09-14** (Schillermarkt stand prep): a tablet doing assisted signups, a
  phone hotspot or a venue Wi-Fi is ONE public IP, and the old 5/h refused
  the sixth neighbour of the hour. The per-email bucket is the per-person
  brake. New emails stored lowercase; duplicate check collation-insensitive.
- **resend-verification**: ALLOWED_ORIGINS CSRF origin guard (contact-relay
  pattern, skipped when unset) + 10/h per user cap on top of the 60s guard.
- **Not limited**: `POST /api/auth/verify-email` — 256-bit random tokens make
  brute force infeasible; a limiter would only add a DoS lever.
- **Login/register failure detection** probes `/api/auth/session` after
  `signIn()` — auth-astro's `signIn` (redirect:false) returns a raw Response
  with no `.error`; never reintroduce a `result?.error` check.
- **Known limit of the anti-enum posture**: `register`'s 409-on-taken-email is
  an unavoidable account-existence oracle (inherent to signup UX) — bounded by
  the 40/h/IP + 3/h/email throttles. Login/forgot-password stay fully generic.

## Ban enforcement — 3-strike Sperre (shipped, 2026-07-09)

`isBanned: true` (set by the moderation strike system) is now ENFORCED:

- **Login**: `authorize()` refuses banned accounts even with the correct
  password (no session). Prove-then-tell signal: after bcrypt success it
  drops a `banflag:<email>` marker (rateLimits collection, 5-min window,
  `BAN_FLAG_WINDOW_MS`); the peek-only `login-status` endpoint returns
  `banned: true` while the marker lives, and `AuthLoginInner` swaps the
  card for the „Konto gesperrt" screen (danger top-rule + roundel +
  moderation contact). No new enumeration oracle: only a proven password
  can set the flag. Accepted residual: third parties polling login-status
  for that email inside the 5-min window see the flag too.
- **Writes**: `rejectIfBanned(userId)` in `src/lib/auth/banGuard.ts`
  (SERVER-ONLY — never import from islands) guards all public-facing write
  APIs — since 2026-09-30 the 22 member create/edit/upload/draft/submit/report/move
  routes reach it through `requireMemberSession()` (`src/lib/auth.ts`, root
  CLAUDE.md „API Routes"); the profile routes, likes, bump/status and drafts
  still call it by hand. Since 2026-09-30 the six self-delete routes
  (topics/announcements/recommendations/events/comments/listings) go through
  the same helper — a ban is read-only, deletes included (user decision
  09-30, reversing the launch rule below). Still NOT ban-gated on purpose:
  `listings/[id]/save` (a bookmark), `my-listings` (a GET), `posts/drafts/[id]`
  DELETE (private draft cleanup) — a banned member's LISTING draft, deleted
  through `listings/delete/[id]`, is the one asymmetry. It guards (content create/edit, comments, likes, RSVP, uploads, listings
  lifecycle, news submit, reports, profile update) with
  403 `{ error: 'account_banned' }`. LIVE DB read every time — the JWT
  snapshots at login and bans happen mid-session. Deliberately NOT
  guarded: bookmarks/saves, view counters,
  and the anonymous listing contact relay (no session identity to check;
  IP-hash rate limits bound abuse).
- **Session UX**: `SuspendedBanner.svelte` (KioskLayout, above
  VerifyEmailBanner) live-checks `GET /api/auth/account-status` and shows
  the non-dismissible danger banner. Negative results are cached in
  sessionStorage (`mahalle-ban-checked-ok`) so the check runs once per
  browser session; a banned result is never cached.
- **Compose pages**: SSR frontmatter gate redirects banned users to `/`.
  (Design's inline DEAKTIVIERT composer state deferred — server 403s are
  the enforcement.)
- **Un-ban**: manual DB flip (`isBanned: false`) — admin UI is future work.
- **Known gap (accepted 2026-07-09)**: `/api/admin/*` write endpoints gate on
  `role === 'admin'` only, not `isBanned` — a striked-to-ban admin would keep
  admin powers (auto-ban never demotes `role`). Narrow by construction
  (admins are trusted superusers); revisit when the admin moderation
  redesign touches these endpoints.

## Display name rule, protected names, handle choice (2026-09-21)
Started from a member question („is there a uniqueness check for user names?" — no, and there should not be one: two real Petras exist). What signup does now, in this order, all BEFORE any OpenAI call: clean the name (`cleanDisplayName`: whitespace collapsed, control + format characters stripped, NFC) → `isValidDisplayName` (2–30, letters of any script, digits, space, `. ' ’ - _ /` (the slash since the evening of 09-21, user decision — organisations write their names that way, e.g. „STK Schillerpromenade/Neukölln“; first and last character stay letter/digit); 400 `name_invalid`) → both rate limits → `isProtectedName` / `isAdminLookalike` (400 `name_protected`) → optional `handle` (`normalizeChosenHandle` → `chosenHandleProblem`: 400 `handle_invalid` / `handle_reserved`; taken → **409 `handle_taken`**) → profanity on handle and name. Until that day signup checked only „not empty + profanity": a direct call could register any length, emoji, markup or line breaks, and the profile's stricter regex would have refused „Petra M." and „O'Neill" had it simply been copied over.
- **409 is ambiguous now**: e-mail taken AND handle taken. `AuthRegisterInner` reads the machine code first and only then falls back to „e-mail taken".
- A CHOSEN handle gets one insert attempt and no suffix (lost race → `handle_taken`); the automatic base is never a reserved word (a member called „Forum" gets `@nachbar…`). `handleChosen: true` marks a choice (removed by the tombstone). Existing members cannot change their handle — deliberate; a user-run script covers single cases. `ensureHandle()` / `scripts/backfill-user-handles.ts` (legacy, writes immediately, would also mint handles for TOMBSTONES — do not run it as is) do not know the reserved list; prod had 0 members without a handle on 09-21.
- The form shows the automatic handle as the placeholder of the optional field (`slugifyHandle(cleanName)`), hint „einmalig wählbar". Copy keys: `auth.register.handle*`, `auth.err.handle*`, `auth.err.nameInvalid`, `auth.err.nameProtected` (proposed wording — the user words copy himself).
- Accepted: a signup attempt reveals whether a handle exists (bounded by 40/h per IP, 3/h per e-mail).
- Tests: `npx tsx --test src/lib/profile/nameRules.test.ts src/lib/profile/handleChoice.test.ts`. Probes (dev): `scratchpad/e2e-handle-choice.mts` (9), `scratchpad/e2e-protected-names.mts` (6), `scratchpad/audit-names-handles.mts` (READ-ONLY, `--prod` switches the db path inside node; prod 09-21: 37 members, all with a handle, one name outside the rule — „STK Schillerpromenade/Neukölln", the slash — and one identical-name pair).

## Personal invitation links (2026-10-07)
Every eligible member has ONE permanent invitation code (`users.inviteCode`); the link `/register?invite=<code>` opens the signup door with the inviter named, and the new account records `invitedBy` (the inviter's raw `_id`) + `invitedAt`. That row is the ONLY record of a redemption — the member's budget (5 per rolling 30 days), the admin's invite tree and „über deinen Link dabei" all read it. Owner decisions (2026-10-07, after research — Lobste.rs' visible invite tree, Gmail/Clubhouse's earned small quotas): permanent link + rolling cap (a link that expires would kill printed QR cards), invites earned (confirmed address AND 7 days of membership, `INVITE_MIN_AGE_DAYS`), invite ≠ shortcut (invitees still verify and still pass moderation), revocable (member renews, admin pauses), the open door stays (plain registration unchanged), and **Mahalle never sends the invitation** — the member shares the link from their own apps (share sheet, `mailto:` into their own mail program, clipboard, QR); BGH I ZR 208/12 is the reason, and we never see the recipient's address.
- **Rules** are the dependency-pure `src/lib/invites/inviteRules.ts` (tests `inviteRules.test.ts`): `normalizeInviteCode` (10 lowercase alnum), `codeFromBytes` over an alphabet without i/l/o/0/1, `inviterBlock(user, now, pausedAll)` → `'anonymized' | 'banned' | 'paused_all' | 'paused' | 'unverified' | 'too_new' | null` (strongest reason first), `inviteBudget(redeemedAt[], now)` → `{ used, left, nextFreeAt }`, `inviteUrl`, `inviteMailto` (RFC 6068: CRLF + percent-encoding, no recipient). **Store** is `src/lib/invites/invites.ts` (server-only): `getInviteState` (mints the code on the first ELIGIBLE read — a blocked member gets `code: null`, nothing is minted or revealed), `regenerateInviteCode`, `resolveInvite(db, code)` → `{ ok, inviter } | { ok: false, reason: 'invalid' | 'blocked' | 'exhausted' }`, `invitesPausedAll()` (env `INVITES_PAUSED=1`). QR = the Steckbrief recipe (`qrcode` → SVG of OUR url).
- **Register page** (`register.astro`) resolves `?invite=` server-side and hands `AuthRegisterInner` a `RegisterInvite` (`registerInvite.ts`): valid → info banner „Eingeladen von {name}" (`[data-register-invite="ok"]`), the code rides in the POST; invalid/blocked/exhausted → warn banner „gilt nicht mehr … trotzdem anmelden" (`[data-register-invite="dead"]`), the form posts WITHOUT a code. A DB hiccup renders the plain form (never a 500 on the door). **Route** (`register.ts`): `inviteCode` is optional; a supplied code is checked right after `connectDB()` (before any OpenAI call) and refused with 400 `invite_invalid` — never silently dropped, the inviter counts on being named; the form then shows the dead banner, drops the code and the member's SECOND click registers plainly (probe C8/C9). The insert adds `invitedBy` + `invitedAt`; the `member_new` Telegram line names the inviter.
- **The inviter's name is shown to whoever opens the link** (display names are member-visible anyway; the invitee got the link from that person). A leaked permanent link yields at most 5 strangers a month, all marked „eingeladen von", and the member can renew (old link dies at once) — accepted by design.
- **Known limits (told to the owner):** the budget is count-then-insert, two simultaneous redemptions of the last slot both pass (a 6th in a race); a deleted invitee's tombstone loses `invitedBy`, so that slot frees early; the per-member pause and the global `INVITES_PAUSED` are the only brakes besides the cap. Texts are DRAFT copy (`auth.register.invite.*`, `profile.invite.*`, `admin.users.invite*`).
- Probe: `scratchpad/invites/probe.cjs` (45 checks: card desktop + phone fold, too-new / unconfirmed / banned member, register through the link, dead/malformed/exhausted/paused links, link dying between load and submit, renew + 429, admin pause pill, no leak in the public projection) with `scratchpad/invites/db.mts seed|state|fill|unfill|cleanup`. Registrations send a verify mail and a Telegram line — build AND start the local server with `TELEGRAM_BOT_TOKEN= TELEGRAM_ADMIN_CHAT_ID= SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY=` in front.

## One password rule for new passwords (2026-10-02)
`isAcceptablePassword()` in the pure `src/lib/auth/passwordRule.ts` (8–100 characters, a lowercase letter, an uppercase letter, a digit; tests `passwordRule.test.ts`, one of them pins it against `ResetPasswordSchema`) is used by BOTH the signup form (`pwOk`) and `POST /api/auth/register` (400 `password_weak`, mapped to the password field's `auth.err.pwWeak`). Until that day the route accepted 6 characters of anything and a number/object as `password` slipped through. The check runs before the rate-limit charges and before any write. Password change and reset already enforced the same rule through their zod schemas. **Login is deliberately not bound to it** (`LoginSchema` min 6, `authorize` untouched): members with an older, shorter password keep logging in. Probes: `scratchpad/batch-1002/probe.cjs` (API) and `form.cjs` (form).

## Link-preview card for shared members-only links (2026-09-18)

A shared link to a gated page sends every crawler through the middleware's 302 to `/login?redirect=…`, so the preview card in WhatsApp & co. is the LOGIN page's. `loginCardCopy(redirect)` (`src/lib/auth/loginCardCopy.ts`, pure, 4 tests) lets `login.astro` hand `AuthLayout` a `card` prop that overrides ONLY the og/twitter title + description — tab title, meta description, `noindex` and the default 1200×630 image stay. First (only) case: `/calendar?event=…` → „Ein Termin im Schillerkiez | Mahalle" + an invitation to sign in or register. **The card carries no event data, by decision**: a public `/e/<id>` share page with title/time/place was proposed and declined the same day — the login wall on shared events is wanted as a signup funnel. The copy derives from the SHAPE of the redirect only (validated through `safeInternalPath`, off-site redirects keep the default card; a test asserts nothing from the link leaks into the card). To add a surface (topic, listing): one more branch in that helper. Previews are cached on first share — links shared before the change keep the old card.

## Signed-out confirmation strap

Login has a signed-out strap keyed off `?abgemeldet=1` (stripped via `replaceState`); ALL logout paths must use `/login?abgemeldet=1` (LogoutAction, PKontoCard, legacy Navbar). The strap shows a one-line confirmation „Du bist abgemeldet. Bis bald im Kiez." / "You're signed out. See you around the Kiez." Task 3's avatar-menu links to `/logout`, whose island uses this contract.

## Phase 1 scope / deferred
Phase 1 = login + register reskin ONLY. Splash + `KiezHeartbeat` shipped in
Phase 2A (above). Forgot/reset password + email-verify soft gate + unverified banner
shipped in subsequent phases (see sections above). Rate-limit (state 05) shipped —
see the Rate-limit / hardening section.
The "Passwort vergessen?" link resolves (shipped 2026-06-27).

## Audit record (2026-09-10/11, 4 passes: visual / functional / API / mobile @390)

1 critical (no focus indicator on inputs), 11 important, ~17 minor across the
passes — the auditors' "critical" tap-target items are counted here as
important. Shipped `e1589b12` (mine) + peer tap-target batch:

- **`AuthField` is no longer a wrapping `<label>`**: with the show/hide toggle
  inside, the accessible name of the password input became „Passwort zeigen".
  Now `<label for>` ↔ `input id="auth-field-<name>"`; the box still focuses
  the input on click (unless the click hit the toggle). Focus indicator is a
  `focus-within` outline on the box (the input keeps `outline: none`).
  Inputs are 16px below `lg` (iOS Safari zooms on focus under 16px) and
  14.5px on desktop.
- **Register**: each field clears its own error on input (the „zu schwach"
  text used to stick after the password became strong); no false „stimmen
  nicht überein" when both password fields are empty; the server's English
  moderation reason (`… contains inappropriate content`) maps to
  `auth.err.nameBlocked` instead of leaking raw.
- **Cache headers**: `/login`, `/register`, `/forgot-password` send `no-store`
  like reset/verify (logged-in members are bounced to `/forum`, so the
  response varies by session — this redirect is real behaviour, not just for
  `/`), and `GET /api/auth/verification-status` + `account-status` send
  `no-store` (session-varying booleans; same class as the listings-detail fix).
- Reset „done" CTA is a button with an onclick, not `<a><button>`; the
  verify page's foot link reads „→ zum Forum" when a session exists;
  KiezHeartbeat has singular strings (`auth.heartbeat.*.one`).
- **Splash + reduced motion**: the code SKIPS the splash entirely under
  `prefers-reduced-motion` (overlay removed before paint); the CSS carve-in
  fallback only serves the can't-play-video path. Earlier notes above saying
  the fallback shows on reduced motion were wrong — the code is right.
- Peer batch: DE/EN pill halves, password toggle, text links and the
  VerifyEmailBanner controls ≥44px; the reset-password invalid-link card
  uses the calmer verify-page treatment.

Verified non-issues: the strength meter renders fine (one auditor's DOM probe
missed it); generic 200 on forgot-password, 409 on taken email, GET on
`/api/auth/signout` NOT signing out, and the open-redirect guard all behaved
as documented. Left open: favicon.ico 404 (only `favicon.svg` ships), no
diacritic folding anywhere, `/login?redirect=` shows no hint of where you'll
land.
