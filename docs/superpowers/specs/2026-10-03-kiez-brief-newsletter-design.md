# Kiez-Brief — the weekly member e-mail (design, 2026-10-03)

Decisions taken with the owner on 2026-10-03 13:30–13:45 (his answers to five questions and the
research notes below). Prototype → generated plan, as with the two 2026-10-03 plans.

## Purpose

A short e-mail once a week to every member, built from what happened in the Kiez this week, so that
members who do not open the app still see that something is going on — and have a link back in.
Push and the bell reach only the members who allowed push; the mail reaches the rest.

## Decisions

- **Audience:** members only, at their account e-mail. No public signup, no subscriber list.
- **Cadence:** weekly, **Sunday evening**, skipped when the week was quiet.
- **Consent:** everyone with a verified e-mail gets it; one switch in the app turns it off, every mail
  carries an unsubscribe link, Gmail/Yahoo get the one-click headers. Legal basis: § 7 Abs. 3 UWG
  (soft opt-in for an existing relationship) — the EuGH ruled on 2025-11-13 (C-654/23) that a free
  account is a „sale of a service" in the sense of Art. 13(2) ePrivacy, so the rule covers registered
  members **provided** (a) the address was collected with the account, (b) the mail is about our own
  similar content, (c) the member is told at registration and in every mail that they can object, and
  (d) has not objected. Therefore: one sentence on the register form and in the Datenschutz page
  (section „Zwecke und Rechtsgrundlagen"); for existing members the official announcement and the
  first mail's footer are the notice.
- **Content:** automatic sections only, no admin text per issue.
- **Sender:** `SENDING_FROM_EMAIL` (noreply@mahalle.digital), `Reply-To: admin@mahalle.digital`.
- **Language:** German only (push precedent — the DE/EN toggle is client-side).
- **Transport:** Resend transactional sends via the **batch endpoint** (up to 100 mails per call,
  `Idempotency-Key: kiez-brief-<ISO week>`), NOT Resend Broadcasts/Audiences — that would copy every
  member's e-mail into Resend's contact store (a second processor copy) for a hosted unsubscribe page
  we can serve ourselves. Resend Free: 100 mails per UTC day; the run refuses above 95 recipients and
  alerts (the plan is the cap, not the code). Local dev/SMTP: the batch falls back to one `sendMail`
  per recipient.

## Trigger (Vercel Hobby has one run a day and both cron slots are taken)

1. **GitHub Actions** workflow `.github/workflows/kiez-brief.yml`, `cron: '0 16 * * 0'` (Sunday 16:00
   UTC = 18:00 CEST / 17:00 CET; GitHub jitters scheduled runs by 0–4 h, so „Sunday evening" is the
   promise), `workflow_dispatch` for a manual send. Rings `POST /api/cron/kiez-brief` with
   `Authorization: Bearer $CRON_SECRET` at `https://mahalle.digital` (canonical origin, never
   `*.vercel.app` — the 308 drops the header). Fail-closed: without `CRON_SECRET` the route answers 503
   (the `process-deletions` precedent), and it is NOT in the middleware's gated prefixes.
2. **Monday fallback:** `fetch-daily.ts` (06:00 UTC) calls `sendKiezBrief({ fallback: true })` after
   the forum digest; it sends only when the current ISO week's issue is not claimed yet — i.e. when the
   Sunday workflow never arrived. Nothing is lost, nothing goes out twice.
3. **At-most-once per issue week:** collection `kiezBriefIssues` `{ _id: '2026-W41', windowFrom,
   windowTo, recipients, skipped?: 'quiet' | 'quota', sentAt }`, claim-by-insert BEFORE rendering or
   sending (the `forumDigests` precedent; a duplicate-key loser returns silently; never delete a row
   in prod). **The issue key is the ISO week (Europe/Berlin) of `now − 24 h`**, not of `now`: Sunday
   18:00 and the Monday 06:00 UTC fallback must land on the SAME key — Monday already belongs to the
   next ISO week, so a naive `isoWeek(now)` would let the fallback claim a fresh week and send a
   second mail. `issueWeek(nowMs)` is a pure, tested function; the audit found this before any code.

## Content of an issue (one data set per issue, not per member)

Window: the 7 days ending at the run (`windowFrom = now − 7 d`). Everything public-only, like the
pages: `moderationStatus` approved or absent, no warning label.

| Section | Source | Shown |
|---|---|---|
| **Im Forum** | topics + announcements + recommendations, `date` in the window, not `isOfficial` (officials had their own mail/notification) | up to 8, newest first: kind label, title, author display name, comment count; link to the post |
| **Nächste Woche im Kiez** | events with `startDate` in [now, now + 7 d], approved (an event that started earlier and is still running is left out — it was in last week's issue) | up to 8 by start: Berlin weekday + time (all-day → „ganztägig"), title, place if set; link to `/calendar` (events have no detail route) |
| **Neu auf dem Markt** | listings `createdAt` in the window, status available/reserved, public | up to 6: title, kind label (Verkaufen/Tausch/Verschenken), price when sell; link to the listing |
| **In der Beilage** | blog posts with `pubDate` in the window, not draft | all: title, description; link to the post |
| **Luft im Kiez** | `getAirHistory(db).lastReading` (mc042 only, never the substitute station) | one line „Luftqualität heute: gut (LQI 2)"; omitted without a valid reading |

Quiet week = all four content sections empty → the issue is claimed with `skipped: 'quiet'`, no mail.
Subject: `Kiez-Brief · KW 41 · 3 neue Beiträge, 2 Termine` (counts of the non-empty sections, max two
named). Preheader: the newest forum title. Every link carries `?utm_source=kiez-brief` so a visit from
the mail is visible in GoatCounter later (no tracking pixel, no per-member link tracking).

## The mail

- React Email template `src/emails/KiezBriefEmail.tsx`, same look as `WelcomeEmail.tsx` (paper,
  Bricolage headline, ink rule). No hand-made plain-text part: Resend derives the text alternative
  from the HTML when `text` is omitted (its documented default), so the template must read well
  linearised (headings, one link per line).
- Header: wordmark „mahalle" + „Kiez-Brief · Schillerkiez · KW 41". Footer: „Du bekommst diesen
  Brief, weil du Mitglied bei Mahalle bist. [Abbestellen] · [Mitteilungen einstellen] ·
  Impressum · Datenschutz".
- Per-recipient only the unsubscribe URL differs: the body is rendered ONCE with the literal
  placeholder `%%UNSUB%%` in the footer link, and `replaceAll('%%UNSUB%%', url)` runs per recipient.
  Author names in the forum section come through `PUBLIC_AUTHOR_PROJECTION` (tombstone-safe), never
  from a stored name.

## Unsubscribe (two paths, no token table)

- Token: `base64url(userId) + '.' + HMAC-SHA256(AUTH_SECRET, 'kiez-brief:' + userId)` — a pure,
  tested helper `src/lib/newsletter/unsubToken.ts` (`makeUnsubToken`, `verifyUnsubToken`). No
  expiry (the link must work from a months-old mail), no state; revoking is impossible, and that is
  fine: the only thing the token can do is turn the mail off. Rotating `AUTH_SECRET` invalidates
  every old link (the member then uses the switch in the app) — accepted, the secret has never been
  rotated and a rotation logs everyone out anyway.
- `GET /newsletter/abmelden?t=<token>` — a small SSR page (KioskLayout, no login needed): sets
  `users.newsletter = 'off'`, shows „Du bekommst den Kiez-Brief nicht mehr." with a link to switch it
  back on in the app. Invalid token → neutral „Dieser Link ist ungültig." (no oracle).
- `POST /api/newsletter/unsubscribe?t=<token>` — RFC 8058 one-click target: accepts
  `List-Unsubscribe=One-Click` form body, sets the flag, answers 200 with no body. Gmail/Yahoo call it
  from their „Abbestellen" button. Headers on every mail: `List-Unsubscribe: <https://mahalle.digital/api/newsletter/unsubscribe?t=…>, <mailto:admin@mahalle.digital?subject=unsubscribe>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Both routes are in the middleware's public set (not gated), rate-limited by IP via the existing
  `rateLimits` helper (60/h) — the token is the secret, the limit only blunts scanning.

## The switch in the app

- `users.newsletter?: 'off'` (absent = on; unset by the deletion tombstone).
- Notification panel, under the forum row: „Kiez-Brief · wöchentlich | aus" (same `.nc-pref` styling,
  `aria-pressed`, optimistic with rollback). Route `GET/POST /api/profile/newsletter` (`{ mode:
  'weekly' | 'off' }`, `'weekly'` ⇒ `$unset`), not ban-gated.
- Members without a verified e-mail see the row too; the send skips them (bounces hurt the domain's
  reputation) — the row's label notes „an deine bestätigte Adresse".

## Recipients of an issue

`emailVerified: true`, `anonymized != true`, `isBanned != true`, `newsletter != 'off'`, `email` is a
string. On 2026-10-03 prod has 62 members, 45 of them verified — the 17 unverified addresses were typed
once and never confirmed, and a bounce rate hurts the domain's reputation at Resend, so they stay out
until they verify (the banner nags them on every page; the owner's own prod account is among the
unverified — he must verify to receive the Sunday issue himself). Projection `{ _id, email, name }` — never the full document. More than 95 → claim the week
with `skipped: 'quota'`, send nothing, `Sentry.captureMessage` (static text) so the owner upgrades
the Resend plan before the next Sunday. Admins are recipients like everyone.

## Admin preview

`GET /api/admin/kiez-brief/preview` (admin session) renders THIS week's issue as HTML for the owner's
own address (no send, no claim) — the way to look at it before the first Sunday and after any change
to the template. Query `?send=1` sends that preview to the admin's own e-mail only.

## Code layout (mirrors the blog/forum notification trio)

- `src/lib/newsletter/kiezBriefRules.ts` — pure: `isoWeek(nowMs)`, `windowFor(nowMs)`, `pickSections(data)`, `subjectFor(sections)`, `MAX_RECIPIENTS = 95`; tests.
- `src/lib/newsletter/kiezBriefStore.ts` — takes a `Db`: `claimIssue(db, week, …)`, `loadIssueData(db, window, now)`, `loadRecipients(db)`; tests with the in-memory Db double.
- `src/lib/newsletter/kiezBrief.ts` — server: `sendKiezBrief({ fallback?, now? })` never-throw (Sentry capture + flush), renders once, batches sends, writes `recipients` on the claim row afterwards.
- `src/lib/newsletter/unsubToken.ts` — pure, tested.
- `src/lib/email/mailer.ts` — gains `sendMailBatch(inputs[], idempotencyKey)` (Resend `batch.send`, SMTP/dev fallback = sequential `sendMail`); `MailInput` gains `text?` and `headers?`.
- Routes: `src/pages/api/cron/kiez-brief.ts`, `src/pages/api/newsletter/unsubscribe.ts`, `src/pages/newsletter/abmelden.astro`, `src/pages/api/profile/newsletter.ts`, `src/pages/api/admin/kiez-brief/preview.ts`.
- Template `src/emails/KiezBriefEmail.tsx`; panel row in `NotificationPanel.svelte` + `nc.newsletter.*` keys (DE/EN, draft copy); register form + Datenschutz sentence; `.github/workflows/kiez-brief.yml`; `fetch-daily.ts` fallback call; tombstone `$unset`.

## Not in this design (deliberately)

- No open/click tracking, no per-member personalisation beyond the unsubscribe link.
- No admin text per issue (he chose automatic; can be added as an admin field later).
- No public signup for non-members.
- No re-send on failure: a failed batch is a Sentry issue and the week is claimed. The
  `Idempotency-Key` only protects against a duplicated HTTP call inside one run (Resend answers 409
  to the same key with a different payload, so a later re-render could not reuse it anyway). On prod
  the rule is „never delete a claim row"; on dev the e2e script removes it.

## Honest gaps

- Hard bounces are not fed back: Resend's bounce webhooks are not wired, so a dead address keeps
  receiving one attempt a week until the member is anonymized. At ≤100 members this is invisible;
  wire `email.bounced` → `newsletter: 'off'` when the list grows.
- The `mailto:` fallback in `List-Unsubscribe` lands in the admin@ mailbox for the owner to handle by
  hand (the one-click POST is the path every modern client takes).

- GitHub's cron jitter: the mail lands between 18:00 and ~22:00 Berlin; if GitHub skips the run, Monday 08:00.
- A member who verified their e-mail after the Sunday run is first included the following week.
- The daily Free quota is shared with the auth mails of that UTC day; a signup wave on a Sunday evening could push the issue over 100 — the 95 cap leaves 5 for that.
