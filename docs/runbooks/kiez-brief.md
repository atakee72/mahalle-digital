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

## Watching a run

- `gh run list --workflow=kiez-brief.yml` — GitHub starts scheduled runs 0–4 h late (mail lands 18:00 to ~22:00 Berlin). If the run never arrives, the Monday 06:00 UTC cron (`fetch-daily`) sends the issue instead (Berlin Mondays only; other days the fallback is a no-op `not-due`).
- The route answers JSON `{ week, outcome, recipients }`; `outcome` is `sent`, `claimed-elsewhere`, `quiet`, `quota`, `not-configured` or `failed` (see the workflow log).
- A failed batch is a Sentry issue and the week stays claimed — it is not retried.

## Sentry: „more recipients than the daily mail quota allows"

More than `MAX_RECIPIENTS` (95, in `kiezBriefRules.ts`) members qualify. Resend Free allows 100 mails per UTC day, shared with the auth mails. The week was claimed `skipped: 'quota'` and nothing went out. Upgrade the Resend plan before the next Sunday; do not raise the cap on the Free plan.

## Re-sending

- **Prod: never.** Never delete a `kiezBriefIssues` row — the issue would be sent to every member again.
- **Dev only:** `npx tsx --env-file=.env scratchpad/kiez-brief/dry-run.mts cleanup` removes the claim and resets preferences; run `dry-run.mts` again. Probes: `token.mts`, `probe.cjs` (16 checks).

## Browser view

- Every mail links to `/kiez-brief/<week>` („Im Browser ansehen"); `/kiez-brief` lists the sent issues. Members only, in no menu.
- The page is rebuilt from today's data for the window stored in the issue's row — nothing of the mail is stored. An old issue therefore differs from the mail: deleted, sold or moderated items are gone; a post approved after the send, or an event entered later for that week, can appear; when an item inside a section's cap is deleted, the next one moves up. Everything shown passes the same public filter as the mail. That is intended.
- Only an issue with `sentAt` has a page. If a send succeeded but the `sentAt` write failed (Sentry issue of that evening), the link in that mail leads to the list. Repair, prod, by hand and only then: set `sentAt` (a date) and `recipients` on that one row — never delete the row.
- Dev probe: `npx tsx --env-file=.env scratchpad/kiez-brief/web-seed.mts seed` prints four week keys (two sent, one skipped, one never sent); pass that JSON to `web-probe.cjs` on the local build (30 checks); `web-seed.mts cleanup` afterwards.
