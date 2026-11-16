# Reference notes (moved out of the root CLAUDE.md on 2026-11-16)

These files hold the long notes and histories that used to sit in the root `CLAUDE.md`. They do NOT load automatically: open the topic's file before working on it. New notes on a topic go into its file; the root keeps a short rules version.

## Where a former root section lives now

| Former root section | File |
|---|---|
| Project Overview (landing ribbons, Schaufenster frames, first screen) | `src/components/landing/CLAUDE.md` |
| Development Commands (CI history, dead-code sweep) | `docs/reference/ci-and-tooling.md` |
| Authentication Flow · Landing + login gating | `docs/reference/auth-and-gating.md` |
| Demo deployment | `src/components/demo/CLAUDE.md` |
| Outgoing Email · Admin alerts | `docs/reference/email-and-alerts.md` |
| Content Moderation (incl. „ONE image per request", link reputation) | `docs/reference/content-moderation.md` |
| Newsboard | `src/pages/api/news/CLAUDE.md` (appendix) |
| Blog ("Die Beilage") | `src/components/blog/CLAUDE.md` (appendix) |
| Database Collections | `docs/reference/database-collections.md` |
| Environment Variables | `docs/reference/environment-variables.md` |
| Pagination · Splash Screen · Page Header · Glass Utility System · Low-perf Device Detector · Animation · Calendar Date Range Selection · Modal scroll-lock | `docs/reference/removed-legacy.md` |
| Masthead + bottom nav · Page inset rule | `docs/reference/kiosk-chrome.md` |
| Cold starts · Visitor counting · Förderung page · First database connect · Uploads vs the 4.5 MB cap | `docs/reference/platform-notes.md` |
| Error Monitoring (Sentry) | `docs/reference/error-monitoring.md` |

## Reading a cross-reference in the moved text

The text was moved verbatim, so it still says „see X above/below" or names a section in quotation marks as if everything were one file. Look the name up in the table above. Sections that stayed in the root in full: API Routes, Common Errors to Avoid (sticky/overflow and its scroll-lock corollary, `backdrop-filter`, nested-island styles, server-only modules, ViewTransitions, cross-site form check), Page-accent rule, Secret Scanning, Repo identity & code backup.
