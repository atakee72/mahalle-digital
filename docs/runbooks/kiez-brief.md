# Kiez-Brief — first-Sunday checklist

Companion to the weekly member e-mail (shipped 2026-10-03).
Code: `src/lib/newsletter/*`, `src/pages/api/cron/kiez-brief.ts`, `src/pages/api/newsletter/unsubscribe.ts`,
`src/pages/newsletter/abmelden.astro`, `src/pages/api/admin/kiez-brief/preview.ts`,
`.github/workflows/kiez-brief.yml`. Design: `docs/superpowers/specs/2026-10-03-kiez-brief-newsletter-design.md`.

## Before the first Sunday

1. **Repo secret present:** `gh secret list` must show `CRON_SECRET` (same value as the Vercel env; it is there).
2. **Verify your own prod e-mail** — unverified members are skipped, the owner's account included.
3. **Look at the issue:** open `GET /api/admin/kiez-brief/preview` (add `?lang=en` or `?lang=de` to see the other language) in the browser (admin session). No `%%UNSUB%%` may be left in the links.
4. **Get a copy in a real mail client:** `POST` the same route — browser console on any mahalle.digital page:
   `fetch('/api/admin/kiez-brief/preview', { method: 'POST' })` (or curl with the session cookie and `Content-Type: application/json`).
   Check the Gmail/Yahoo „Abbestellen" button (one-click) and the footer link.
5. **First real send (optional, early):** `workflow_dispatch` of `kiez-brief.yml` (`gh workflow run kiez-brief.yml`). It CLAIMS the week — Sunday's scheduled run then finds it claimed and sends nothing. Do it on a Sunday, or accept that the week's issue goes out that day.

## The test copy before the send

Every scheduled Sunday job first sends the issue to the admin's own address („[Vorschau] …") and a Telegram line, then waits two hours, then sends to the members.

- Looks fine: do nothing.
- Something is wrong: GitHub → Actions → the running „Kiez-Brief" job → Cancel. Sunday's send is stopped. The Monday 08:00 fallback will send the issue unless the cause is fixed (or the week is deliberately given up) before then.
- No test copy arrived but Telegram says „Testausgabe konnte nicht verschickt werden": the members' mail still goes out as planned; look at Sentry.
- A manual dispatch (`gh workflow run kiez-brief.yml`) skips the test copy and the wait.

## Watching a run

- `gh run list --workflow=kiez-brief.yml` — the job is scheduled for 15:00 Berlin (13:00 UTC; 14:00 Berlin in winter) and GitHub starts scheduled runs 0–4 h late: test copy 15:00 to ~19:00, the members' mail two hours after it (17:00 at the earliest). If the run never arrives, the Monday 06:00 UTC cron (`fetch-daily`) sends the issue instead (the fallback start is for Berlin Mondays only; on other days the job only sends a waiting group, see below).
- The route answers JSON `{ week, outcome, recipients }`; `outcome` is `sent` (with `group` and `more`), `claimed-elsewhere`, `quiet`, `no-recipients`, `not-configured`, `not-due` or `failed` (see the workflow log).
- A failed batch is a Sentry issue and the week stays claimed — it is not retried.

## More members than one day's quota: groups

Resend Free allows 100 mails per UTC calendar day (reset at midnight UTC, not a rolling 24 hours), shared with the login mails. An issue therefore goes out in groups of 75 (`GROUP_SIZE` in `kiezBriefRules.ts`), one group per UTC day: Sunday evening, then Monday 08:00 with the morning job, then Tuesday 08:00 (07:00 in winter time). Members are taken oldest first; each group is claimed in the issue's row before it is sent, so no group goes out twice and a failed group is not retried.

- Telegram tells you when a group went out („Gruppe 1 an 59 Mitglieder verschickt"), when the week was quiet and when a send failed. Since 2026-10-05 it also tells you when a member switches the Kiez-Brief off or on again by themselves („📭 Kiez-Brief abbestellt: Name (@handle) — im Profil / über den Abmelde-Link / über das Mail-Programm", „📬 … wieder abonniert"); your own pill on `/admin/mitglieder` sends nothing.
- Watch it: the route's answer and the morning job's log name the group (`group 2 sent to 31 members`). The row shows `groups`, `more`, `recipients`.
- Sentry warning „more members than two daily groups": more than 150 recipients — the issue now takes three days. That is the agreed moment for the paid plan; up to about 300 members nothing is lost meanwhile (four groups fit before the four-day cut-off).
- A group still waiting after four days is dropped (the week is no longer news).
- One malformed address no longer costs the whole group (the batch is sent „permissive"): Sentry warning „the provider refused some mails of a batch" names the count; find the address in Resend's log and switch that member off.
- The row's `lastGroupSize` is the size of the last claimed group. If `recipients` did not grow by it, that group was claimed but never booked as sent (a crash or freeze between claim and send) — check Resend's log before telling anyone.
- A manual dispatch of the workflow works on a Sunday or Monday (Berlin) only; any other day it answers `not-due`.
- A bounce in Resend's log (`https://resend.com/emails`): Resend puts a hard-bounced address on its suppression list by itself — later mails to it, the login mails included, are skipped and do not count as new bounces. To find the member behind the address, start typing the address into the search field on `/admin/mitglieder` (it narrows from three characters).
- Exclude a test account or an address that bounces: `/admin/mitglieder` → the „Kiez-Brief: an" pill of that member → „aus".

## Re-sending

- **Prod: never.** Never delete a `kiezBriefIssues` row — the issue would be sent to every member again.
- **Dev only:** `npx tsx --env-file=.env scratchpad/kiez-brief/dry-run.mts cleanup` removes the claim and resets preferences; run `dry-run.mts` again. Probes: `token.mts`, `probe.cjs` (16 checks).

## Browser view

- Every mail links to `/kiez-brief/<week>` („Im Browser ansehen"); `/kiez-brief` lists the sent issues. Members only, in no menu.
- The page is rebuilt from today's data for the window stored in the issue's row — nothing of the mail is stored. An old issue therefore differs from the mail: deleted, sold or moderated items are gone; a post approved after the send, or an event entered later for that week, can appear; when an item inside a section's cap is deleted, the next one moves up. Everything shown passes the same public filter as the mail. That is intended.
- Only an issue with `sentAt` has a page. If a send succeeded but the `sentAt` write failed (Sentry issue of that evening), the link in that mail leads to the list. Repair, prod, by hand and only then: set `sentAt` (a date) and `recipients` on that one row — never delete the row.
- Dev probe: `npx tsx --env-file=.env scratchpad/kiez-brief/web-seed.mts seed` prints four week keys (two sent, one skipped, one never sent); pass that JSON to `web-probe.cjs` on the local build (30 checks); `web-seed.mts cleanup` afterwards.
