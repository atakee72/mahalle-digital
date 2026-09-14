# Debut event readiness — Schillermarkt info stand, Sat 19 + Sat 26 Sept 2026

Written 2026-09-14, corrected the same day against the Fabric state notes („MAHALLE — Master durum notu", 2 Sept; „Schillermarkt stand çözümü", 26 Aug).

**What the events actually are:** an **outdoor info stand** at the weekly Schillermarkt on Herrfurthplatz, Saturdays 10–16, two weeks running. Table, flyers in four languages with a QR code, a tablet running the platform, no sales. Funded by the Bezirksamt Neukölln Gebietsfonds (320 €, signed, 75 % paid out; documentation with photos due by 30 Nov); a SYLFF SLI decision ($9 660, Oct 2026–Sep 2027) lands on **16 Sept**, three days before the first stand. Stakes: this is the platform's public debut in front of the people it is for and the funders watching it — a failure at the stand costs users before they exist.

**What that changes about the load picture:** signups arrive as a **trickle over six hours**, not a burst in one evening; visitors register on **their own phones over mobile data** (own IPs) after scanning the QR — the shared-IP problem moves to the **stand's tablet and any hotspot it hangs on**. Question, restated: is Mahalle ready for a few dozen signups and first posts across a Saturday, with one tablet doing demos and assisted signups?

**Verdict:** the platform is (Vercel fra1 + Atlas, a few requests per second is nothing). Two *settings* would break on the evening — one blocks signups, one silently stops mails. Both are small. Everything else below is verification or event-day routine.

---

## A. Must fix before the event (code, ~1 h total)

### A1. ✅ DONE 2026-09-14 (`e3dd3843`, live) — Signup rate limit was per IP: 5 per hour → the stand's tablet/hotspot is ONE IP
`src/pages/api/auth/register.ts:34` — `consumeRateLimit('reg:ip:<hash>', 5, 1h)`. At the stand this bites in two ways: (1) **assisted signups on the tablet** — the 6th person you register on the tablet within an hour gets `429 rate_limited`; (2) anyone who joins the stand's phone hotspot shares its IP. Visitors registering on their own mobile data are unaffected (own IPs). A market Saturday with a helpful host at a tablet is exactly the case where 5/h from one IP fails.

Same class, lower likelihood: `forgot-password.ts:29` — 5/h per IP (silent limit; a 6th „Passwort vergessen" on the Wi-Fi just never sends).

**Shipped:** `reg:ip` 40/h, `fp:ip` 20/h, new `reg:email` 3/h; dev probe: 7 signups from one IP all 201, same address 201/409/409/429. Original recommendation for the record — keep the IP gate as a bot brake but size it for a room: `reg:ip` 5 → **40/h**, `fp:ip` 5 → **20/h**. Add a per-email brake on register (`reg:email:<normalized>`, 3/h) so a single retrying person is still throttled. Two constants + one added call; probe: 6 registrations from one IP on dev must all succeed. Revert to 5 after the events if you want — or leave it, 40/h from one IP is still a bot brake. Login lockout is per *account* (`auth.config.ts:40`), not per IP — fine as is.

### A2. ⬜ OPEN (user decision: Resend plan) — Mail volume: 3 mails per signup → 50 signups over a Saturday ≈ 150 mails/day
Per signup: verification mail (`register.ts:166`) + welcome mail on first verification (`verify-email.ts`) + **admin mirror mail** for `member` alerts (`adminAlerts.ts:66`, `ADMIN_ALERT_EMAIL`). Resend **Free** = 100 mails/day, 3 000/month. A failed send never blocks the signup (`register.ts:171-173` swallows it) — the person simply gets no verification mail and, since verification is a soft gate, can still use everything. So the failure is silent, not fatal.

**Do:** open resend.com → Usage, note the plan. Then either
- **upgrade to Pro for September** (cheapest certainty; 50k/month), or
- **drop the admin mirror for the event**: remove `ADMIN_ALERT_EMAIL` from Vercel Production (`vercel env rm ADMIN_ALERT_EMAIL production`) and redeploy (empty-commit push) — Telegram keeps every alert; that brings it to 2 mails/signup = 100 for 50 people, i.e. exactly the Free cap. Upgrade is the safer of the two.

**Two more Resend facts (researched 2026-09-14, see Sources):**
- **Bounce rate above 4 % → Resend may pause sending for the whole account.** At an event, typos in email addresses bounce; 2 typos in 50 signups is 4 %. A pause would also kill password-reset mails. Mitigation for now: watch the Resend dashboard's bounce rate the morning after; if it is near 4 %, stop nothing — just be aware sending may pause and verification is a soft gate. Longer term: a „E-Mail wiederholen" field on the register form (typo guard) — parked.
- **API rate limit 10 requests/second, `429` beyond**, all plans. A `429` makes `sendMail` throw and the signup swallows it (mail silently not sent). 50 people signing up over an evening will not reach 10/s; a bot burst would. Nothing to do.
- `resend-verification` is 10/h per user, fine.

---

## B. Verify (no code, 20 min)

- [ ] **DB backup**: `gh run list --workflow=db-backup.yml --limit 3` → all `success` (they were on 09-12/13/14). Restore recipe in `docs/runbooks/db-backup.md`. Take one **manual** run right before the event (`gh workflow run db-backup.yml`) so the pre-event state is a named release.
- [ ] **Atlas** (free cluster limits, researched): 500 connections, 0.5 GB storage, **100 operations/second** and 10 GB transfer in/out per rolling 7 days. Above 100 ops/s Atlas does not error — it throttles the connection with a 1-second cooldown, so pages get slow, not broken. One forum page load is several queries (topics + pins + saved counts + session + kontext); 50 people refreshing in the same second could touch the cap briefly. Section C measures this. cloud.mongodb.com → Metrics: note storage and connections.
- [ ] **External uptime monitor** — there is none today: Sentry only sees errors inside the app; a Vercel/DNS outage would alert nobody. Create a free UptimeRobot (or similar) HTTPS check on `https://mahalle.digital/api/kiez-stats` every 5 min with email + Telegram/push alert. 10 minutes, standard launch practice.
- [ ] **Password reset on prod**: request one for your own account and complete it end to end (mail arrives, link works, login with the new password). Standard launch-checklist item; the flow has not been exercised on prod since the Resend switch.
- [ ] **Vercel** (Hobby limits, researched): 1 M function invocations, 100 GB transfer, 4 h active CPU per month; functions auto-scale to 30 000 concurrent, 300 s max duration, 2 GB memory. 50 people are far inside all of that. Hobby is **non-commercial only** — a free community project on a PolyForm-NC license fits; note it if sponsorship/ads ever appear. Check project → Usage once.
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
- **Throttle check**: in the prod read run, also fire 50 `/forum` loads in the same second and compare p95 against the paced run — a jump to > 1 s indicates the Atlas 100 ops/s throttle. If it shows, the cheap fix is caching the pinned-officials + saved-count queries per request (they are the same for every visitor), not a paid tier.
- Output goes to `scratchpad/load-smoke-<date>.md` and is summarized in chat. No prod writes.

---

## D. Event-day sheet (print or keep on the admin phone)

1. **Admin phone**: `/admin/moderation` open in a tab; Telegram alerts on. Approve flagged first posts quickly — a newcomer whose first post sits „in Prüfung" for an hour is a lost newcomer.
2. **Signup QR** on flyer + QR cards → `https://mahalle.digital/register`. Assisted signups on the tablet: after A1 fine; without A1, at most 5 per hour from the tablet — send the 6th to their own phone. If the tablet hangs on a phone hotspot, the tablet + that phone share one IP.
2b. **Photos** of the stand and people using the platform — the Gebietsfonds AL-7 documentation needs 3–4 per event; not a tech item, but the day is lost if forgotten.
2c. **Tablet demo**: a logged-in demo account (not the admin) with the tour reset, so every visitor sees the first-run experience; keep the 60–90 s screen-recording loop as fallback when the market Wi-Fi/hotspot drops.
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
- Second admin account (the queue has one reviewer; if you are busy hosting, flagged first posts wait) — the `role: 'admin'` flag is DB-only today, no UI; set it by hand for a trusted person if you want a co-moderator on the night.
- „E-Mail wiederholen" typo guard on the register form (bounce-rate protection).
- Admin „create account for someone" endpoint — nice for a booth, not for weekend one.
- Telegram digest instead of one ping per new member — 50 pings is noisy but harmless.
- Atlas paid tier — no reason at this size.

---

## Audit 2026-09-14 (against code)
Verified: `reg:ip` 5/h at `register.ts:34`, `fp:ip` 5/h at `forgot-password.ts:29`, login lockout keyed per email (`auth.config.ts:40`); mail failure swallowed at `register.ts:171-173`; admin mirror covers `member_new` (`adminAlerts.ts:17-18`); welcome mail sent from `verify-email.ts`; no admin create-user endpoint (`api/admin/users`: GET list + PATCH only); `db-backup.yml` has `workflow_dispatch` and ran green 09-12/13/14; view counts are written only by the client-side `POST /api/views/increment`, not by SSR; dev mailer picks SMTP when `SMTP_*` are set (`mailer.ts:35`), hence the disabled-mailer dev run in C. Not verifiable from here (user checks): Resend plan, OpenAI balance, Vercel/Atlas/Cloudinary/DeepL usage. Resend Free caps (100/day, 3 000/month) are from memory — confirm on the Usage page.

## Sources (researched 2026-09-14)
- Resend quotas and limits (100/day, 3 000/month Free; 10 req/s; 4 % bounce pause): https://resend.com/docs/knowledge-base/account-quotas-and-limits
- Atlas free cluster limits (500 conns, 0.5 GB, 100 ops/s throttle, 10 GB/7 d): https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/
- Vercel Functions limits (Hobby 300 s, 2 GB, 30 000 concurrency): https://vercel.com/docs/functions/limitations — Hobby monthly quotas (1 M invocations, 100 GB, 4 h CPU, non-commercial): https://www.fencode.dev/en/blog/vercel-free-vs-pro-2026-official-limits-pricing
- Launch-day checklist (uptime monitor, alert channels, first-user core action, email delivery test): https://dev.to/david_friedman_c2808375c1/web-app-launch-checklist-2026-47-things-to-check-before-going-live-1j7c
