# Debut event readiness — weekend of 19/20 Sept 2026

Written 2026-09-14. Question: is Mahalle ready for up to ~50 people signing up and posting at once, on the venue's Wi-Fi, over one evening?

**Verdict:** the platform is (Vercel fra1 + Atlas, a few requests per second is nothing). Two *settings* would break on the evening — one blocks signups, one silently stops mails. Both are small. Everything else below is verification or event-day routine.

---

## A. Must fix before the event (code, ~1 h total)

### A1. Signup rate limit is per IP: 5 per hour → the venue Wi-Fi is ONE IP
`src/pages/api/auth/register.ts:34` — `consumeRateLimit('reg:ip:<hash>', 5, 1h)`. Everyone on the venue Wi-Fi shares one public IP (NAT), so the **6th person to register gets `429 rate_limited`** and is locked out for up to an hour. People on mobile data are unaffected (own IPs).

Same class, lower likelihood: `forgot-password.ts:29` — 5/h per IP (silent limit; a 6th „Passwort vergessen" on the Wi-Fi just never sends).

**Fix (recommended):** keep the IP gate as a bot brake but size it for a room: `reg:ip` 5 → **40/h**, `fp:ip` 5 → **20/h**. Add a per-email brake on register (`reg:email:<normalized>`, 3/h) so a single retrying person is still throttled. Two constants + one added call; probe: 6 registrations from one IP on dev must all succeed. Revert to 5 after the events if you want — or leave it, 40/h from one IP is still a bot brake. Login lockout is per *account* (`auth.config.ts:40`), not per IP — fine as is.

### A2. Mail volume: 3 mails per signup → 50 signups ≈ 150 mails in one evening
Per signup: verification mail (`register.ts:166`) + welcome mail on first verification (`verify-email.ts`) + **admin mirror mail** for `member` alerts (`adminAlerts.ts:66`, `ADMIN_ALERT_EMAIL`). Resend **Free** = 100 mails/day, 3 000/month. A failed send never blocks the signup (`register.ts:171-173` swallows it) — the person simply gets no verification mail and, since verification is a soft gate, can still use everything. So the failure is silent, not fatal.

**Do:** open resend.com → Usage, note the plan. Then either
- **upgrade to Pro for September** (cheapest certainty; 50k/month), or
- **drop the admin mirror for the event**: remove `ADMIN_ALERT_EMAIL` from Vercel Production (`vercel env rm ADMIN_ALERT_EMAIL production`) and redeploy (empty-commit push) — Telegram keeps every alert; that brings it to 2 mails/signup = 100 for 50 people, i.e. exactly the Free cap. Upgrade is the safer of the two.

Also worth knowing: `resend-verification` is 10/h per user, fine.

---

## B. Verify (no code, 20 min)

- [ ] **DB backup**: `gh run list --workflow=db-backup.yml --limit 3` → all `success` (they were on 09-12/13/14). Restore recipe in `docs/runbooks/db-backup.md`. Take one **manual** run right before the event (`gh workflow run db-backup.yml`) so the pre-event state is a named release.
- [ ] **Atlas**: cloud.mongodb.com → cluster → Metrics: storage used (M0 cap 512 MB; we are far below) and connections (cap 500). Nothing to change, just know the numbers.
- [ ] **Vercel**: project → Usage: function invocations / bandwidth vs plan. Hobby is ample for this; if the account is Hobby and the site is treated as a commercial-ish community, note Vercel's Hobby terms (non-commercial) — PolyForm-NC license fits, but be aware.
- [ ] **OpenAI credits** (platform.openai.com → Billing): 50 people posting = 100+ moderation calls + image checks in an evening. The Aug 2026 credits-exhausted incident showed what happens: every post fails safe into the queue as `moderation_error`, nothing errors, the admin gets a `moderation_flagged` Telegram per post. Top up so the balance is not near zero.
- [ ] **DeepL** (free: 500k chars/month): translations at the event are cheap, but check the month's usage once.
- [ ] **Sentry**: 5k errors/month cap — check current month's count (< 500 expected). A burst of 50 identical errors would still be one issue.
- [ ] **Cloudinary**: 25 credits/month free — check usage (post images at events).
- [ ] **Content for the evening**: the event exists in the calendar; an official announcement is pinned (admin → Amtliches) welcoming newcomers; the landing page heartbeat shows life (it hides empty rows).
- [ ] **Tour** („Die Führung"): 32 stops — a first-timer's first minutes. Walk it once on a phone as a fresh account.
- [ ] **PWA install** on an iPhone and an Android: home-screen install works, push opt-in prompt appears in the notification panel.
- [ ] **Prod region pin**: `curl -sI https://mahalle.digital/api/kiez-stats | grep x-vercel-id` → `fra1::fra1`.

---

## C. Load smoke (I run it, ~30 min, prod READ-ONLY + dev writes)

- **Prod, reads only**: the user registers ONE throwaway prod account („Lasttest") and puts its password in `scratchpad/prodpw.txt` (gitignored; same handling as `devpw.txt` — read straight into the login fill, never printed). The script logs in once, then runs 50 parallel sessions with that cookie fetching `/forum`, `/calendar`, `/api/kiez-stats` and one post detail; measures p95 latency and counts non-200s. Request-level fetches do NOT fire the client-side `POST /api/views/increment`, so the detail page is a pure read. Expectation: p95 < 1.5 s, zero errors. Delete the throwaway account afterwards (profile → Konto löschen, 7-day grace).
- **Dev, writes**: start the dev server with the mailer disabled — `SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY= pnpm dev --port 4655` — otherwise 50 fake `@mahalle-dev.test` signups send 50 real mails through the mailbox.org relay (bounces, possible account flag). Then 50 parallel registrations from one IP (after A1), then 50 parallel comments on one topic. Expectation: all 201, moderation queue fills without errors, no mail sent (dev-logged links only).
- Output goes to `scratchpad/load-smoke-<date>.md` and is summarized in chat. No prod writes.

---

## D. Event-day sheet (print or keep on the admin phone)

1. **Admin phone**: `/admin/moderation` open in a tab; Telegram alerts on. Approve flagged first posts quickly — a newcomer whose first post sits „in Prüfung" for an hour is a lost newcomer.
2. **Signup QR** → `https://mahalle.digital/register`. Below it, one line: *„Klappt's nicht im WLAN? Kurz mobile Daten an."* (different IP — the fallback if A1 wasn't shipped).
3. **Verification mail didn't arrive?** It's a soft gate — they can use everything; tell them to check spam later, or resend from `/verify-email` (10/h).
4. **„Du hast dein Tageslimit erreicht"**: 5 posts per rolling 24 h per person (topics, events, announcements, recommendations, listings each count; comments are unlimited; admins exempt). A keen newcomer can hit it — tell them comments are free and the limit resets on its own.
5. **Someone can't log in**: 5 wrong passwords lock the *account* for 15 min (not the IP). „Passwort vergessen" works from the phone.
6. **Admin can't create accounts for people** — there is no such endpoint. If signup is broken for everyone, the fix is on the laptop: Vercel env → redeploy, or raise the limit and push (CI ~3 min).
7. **If the site is down**: Vercel status + `gh run list` + Sentry. The 500 page is dependency-free and will render.

---

## E. After the first event (30 min)

- `rateLimits` collection: count `baseKey` starting with `reg:ip` that hit the cap (tells you whether A1 mattered).
- Resend usage vs cap; Sentry new issues; moderation queue drained; `flaggedContent` with `moderation_error` (OpenAI outage tripwire).
- Orphan check is free: `pnpm tsx scripts/cleanup-orphan-comments.ts` against prod (dry-run) — expect 0.
- Decide whether to keep the raised limits.

---

## Not needed for this event (parked)
- Admin „create account for someone" endpoint — nice for a booth, not for weekend one.
- Telegram digest instead of one ping per new member — 50 pings is noisy but harmless.
- Atlas paid tier — no reason at this size.

---

## Audit 2026-09-14 (against code)
Verified: `reg:ip` 5/h at `register.ts:34`, `fp:ip` 5/h at `forgot-password.ts:29`, login lockout keyed per email (`auth.config.ts:40`); mail failure swallowed at `register.ts:171-173`; admin mirror covers `member_new` (`adminAlerts.ts:17-18`); welcome mail sent from `verify-email.ts`; no admin create-user endpoint (`api/admin/users`: GET list + PATCH only); `db-backup.yml` has `workflow_dispatch` and ran green 09-12/13/14; view counts are written only by the client-side `POST /api/views/increment`, not by SSR; dev mailer picks SMTP when `SMTP_*` are set (`mailer.ts:35`), hence the disabled-mailer dev run in C. Not verifiable from here (user checks): Resend plan, OpenAI balance, Vercel/Atlas/Cloudinary/DeepL usage. Resend Free caps (100/day, 3 000/month) are from memory — confirm on the Usage page.
