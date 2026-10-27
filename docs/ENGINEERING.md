# Mahalle — engineering notes for people who read code

A 10-minute path through this repository for engineers. The product itself is explained on [mahalle.digital](https://mahalle.digital) and in the blog essay series; this page is about how it is built and run. Figures are as of 2026-10-26.

**Try it first:** [demo.mahalle.digital](https://demo.mahalle.digital) — a read-only copy with fictional content, two one-click roles (member, admin), no sign-up. Writing is refused server-side; the real neighbourhood is never exposed.

## 1. What it is, in numbers

| | |
|---|---|
| Live for members since | 2026-08-19 (landing + login gate); the neighbourhood's first public event 2026-09-13 |
| Surfaces | Forum, Kalender, Markt, Kurier (news), Kiez-Daten (statistics + air), Beilage (blog), Profil, Admin |
| Repository | 1 629 commits since 2023-02, one author |
| Source files | 681 `.ts` / `.svelte` / `.astro`, 117 API routes |
| Tests | 68 test files, 486 cases (`node:test` via tsx), run in CI |
| CI budgets | `tsc` ≤ 16 errors, `svelte-check` ≤ 81 — ratchet-only, lowered as errors are fixed, never raised |
| Hosting | Vercel Hobby (one cron a day, 4 h active CPU a month), region `fra1`; MongoDB Atlas Frankfurt |
| Written process | 9 runbooks, 9 design specs, 81 implementation plans in `docs/` |

## 2. Architecture

```
 browser ──► Vercel (fra1) ── Astro 5 SSR ─┬─ Svelte 5 islands (client state)
                                           ├─ middleware.ts: session, login gate, cross-site check,
                                           │   Sentry capture inside the request window
                                           ├─ /api/* routes (Zod-validated) ──► MongoDB Atlas (Frankfurt)
                                           │        │
                                           │        ├─ OpenAI moderation (text, images, spam/hate)
                                           │        ├─ Resend (member mail), Telegram (admin alerts)
                                           │        └─ DeepL (on-demand translation, 101 languages)
                                           └─ one Vercel cron (news fetch + weekly mail + watchdogs)
 GitHub Actions ──► everything the one cron cannot do: air logger (30 min), afternoon news,
                    Kiez-Brief Sunday run, statistics import, DB backup, nightly demo reseed
```

Principles that shaped it:

- **Pure decisions, thin effects.** Anything with rules lives in a dependency-free module with a `node:test` file beside it (`src/lib/**/*Rules.ts`); the route or action around it only does I/O. The browser gesture, the mail batching, the moderation batching, the invite budget, the member gate — all follow this split.
- **One gate, one mailer, one alert channel.** `requireMemberSession()` guards the 28 member write routes; `sendMail()` chooses the transport and throws; `adminAlerts.ts` never throws. New code reuses them or explains why not.
- **Server/client boundary by import graph.** A module that imports `mongodb` is server-only for import purposes; shared constants live in pure files. Learned the hard way (an island that silently never hydrated).
- **Claim before you send.** Every scheduled send (blog announcement, forum digest, weekly Kiez-Brief) claims an `_id` row by insert BEFORE rendering or sending, so a duplicate run stays silent and a failed send is never retried twice.

## 3. Five files worth reading

1. [`src/middleware.ts`](../src/middleware.ts) — the single request gate: cross-site form check with one deliberate exemption (RFC 8058 one-click unsubscribe), stale-host 308s, the login gate for pages and APIs, and why Sentry capture lives here and not in the SDK's auto-handler (Vercel freezes the function before an unflushed event leaves).
2. [`src/lib/auth/memberGate.ts`](../src/lib/auth/memberGate.ts) + its test — a 40-line pure decision with injected effects; the 401 body is frozen because clients match it.
3. [`src/lib/sheet/sheetDragRules.ts`](../src/lib/sheet/sheetDragRules.ts) + [`dragToClose.ts`](../src/lib/sheet/dragToClose.ts) — a swipe-to-close gesture: pure thresholds and velocity window, a Svelte action around them, and the three browser traps it documents (a child's `lostpointercapture` bubbling, a `touchmove` listener that must be registered at setup, a snap timer that must not clear a later gesture).
4. [`src/lib/newsletter/kiezBrief.ts`](../src/lib/newsletter/kiezBrief.ts) — the weekly mail: claim-by-insert idempotency, groups of 75 per provider quota day, a browser view rebuilt from today's data rather than stored mail bodies.
5. [`src/lib/omniModerationBatches.ts`](../src/lib/omniModerationBatches.ts) — a provider contract learned from a 400: OpenAI's moderation endpoint takes one image per request; results are merged per category.

## 4. Three incidents, as postmortems

- **The Atlantic in every query** — [`docs/runbooks/mongo-region-incident.md`](runbooks/mongo-region-incident.md). Sporadic `MongoServerSelectionError` in production. Found through the `x-vercel-id` header reading `fra1::iad1`: functions in Washington, database in Frankfurt. One line in `vercel.json`; then a staged driver tuning when a low-rate regression followed; then a first-connect retry that is deliberately NOT a Sentry filter, so a real outage stays loud.
- **Cold starts were the CPU bill** — [`docs/runbooks/cold-start-cpu.md`](runbooks/cold-start-cpu.md). Measured, not guessed: ~1 000 files on the first request. Bundling the offenders cut the cold start from 2.9 s to 0.4 s and the monthly CPU from the alarm zone to about a quarter.
- **The bug that hid inside a fail-safe for eight weeks.** Marketplace listings with two or more photos never reached the public market: the text and ALL photos went to OpenAI's moderation endpoint in one request, it answered `400 too_many_images`, and the fail-safe did what it should — queued the listing for manual review — but recorded only a bare status. Nothing errored, so nothing alerted. Found when the owner read a Vercel runtime log. Fix: one image per request, results merged (`src/lib/omniModerationBatches.ts`), and every fail-safe reason now carries the provider's own message. Process change: test a provider contract on a 400, not only on a 200; a „worst result" merge is fail-open and must be fail-closed.

## 5. Testing strategy

- **Rules under `node:test`** (`pnpm test`, in CI): every decision that can be pure is, with the exact strings and numbers from the spec in the assertions.
- **Browser probes against a local production build**, not the dev server: a Node adapter config serves the real bundle, Playwright drives it, touch gestures go through CDP (`Input.dispatchTouchEvent`). A change to a `.svelte` file is not done until a probe has clicked it — `svelte-check` is a budget, not a proof.
- **Ratcheted budgets in CI**: `tsc` and `svelte-check` counts may fall, never rise. Secret scanning on every commit (gitleaks pre-commit + CI) and GitGuardian on the public repo.
- **Data freshness over error absence**: external callers (GitHub Actions crons) can die at the edge without a single app error, so watchdogs assert on data age (`airFreshness.ts`) rather than on missing exceptions.

## 6. Security posture

Member gate with a live ban check on every write · fixed-window rate limits sized per room, not per person, with the per-person brake on the e-mail bucket · `?redirect=` validated by URL parsing against a fixed base origin, not by character enumeration · web-push endpoints allowlisted by host (the server later POSTs to them) and sent with a socket timeout · cross-site form check in the middleware · partial unique indexes (tombstones unset the fields) · user joins through ONE allowlist projection, never `{ password: 0 }` · sensitive env vars unreadable even to the owner · admin actions exempt from the moderation pipeline, the outbound contact relay deliberately not.

## 7. Decisions

Design specs, dated, in [`docs/superpowers/specs/`](superpowers/specs/): notification centre, multi-pin announcements, Telegram admin alerts, the landing „Schaufenster", member types, the Kiez-Brief newsletter, forum notifications, this demo. The running engineering diary is the root `CLAUDE.md` plus one `CLAUDE.md` per area under `src/components/*/` — every rule that bit once is written down there with its date.

## 8. How I work with AI tools

I build Mahalle with Claude Code, and I treat that as an engineering process rather than autocomplete. A feature starts as a written spec I approve; a plan breaks it into tasks with the exact tests; implementers work in git worktrees; an independent review reads the diff; a browser probe against the production build runs before I merge; I decide, I merge, I push. The `CLAUDE.md` files are the shared memory that makes the next session as careful as the last one. The process has caught real defects before they shipped — a Kurier query without its warning-label filter, a referrer that would have leaked a reset token, a gesture ended early by a child's pointer-capture event — and it recorded each of them so they stay caught.

## 9. Try it

[demo.mahalle.digital](https://demo.mahalle.digital): „Als Mitglied ansehen" or „Als Admin ansehen". Deliberately disabled there: every write, uploads, mail, push, translation, registration. The code that makes it read-only is `src/lib/demo/` and one block in `src/middleware.ts`; the same build serves production with the flag absent.
