# Newsboard: card grid, bento sizes, real save control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is written for the UI-polish PEER session (Opus, own worktree `.claude/worktrees/ui-polish`, branch `fix/ui-polish`, dev port 4656) — it may execute the tasks itself.

**Goal:** The Kurier index shows articles as cards in a responsive grid (1 / 2 / 3 columns), today's two highest-scored articles take a double-width card (bento), the oversized lead card disappears, and the card's save control becomes the same „🔖 speichern / gespeichert" pill the rest of the app uses.

**Architecture:** Layout only, in the index island and the card. The data/order logic from this morning stays (`orderBoard()` in `src/lib/newsboard/newsFormat.ts` — today by score, older days by time; Kiez sources as ink cards via token inversion). The board calls `orderBoard(items, now, /* withLead */ false)`; the first two items of `today` get `size="double"` under the same condition that used to produce the lead (`!activeSektion && !savedOnly`). `NewsCard.svelte` gets a `size: 'single' | 'double'` prop and a vertical layout (image on top). `NewsCardLead.svelte` loses its only consumer and is deleted. `SaveToggle.svelte` is restyled to the app's pill (it is used by `NewsCard`, and `detail/ReadingListControls.svelte` — keep both callers working).

**Tech Stack:** Astro 5, Svelte 5 islands (nested islands: NO `<style>` blocks — orphaned CSS in prod; inline styles / Tailwind only), `node:test` via `npx tsx --test`, Playwright `.cjs` probes against the peer's own dev server on port **4656**.

**Spec:** the user's words, 2026-09-22 12:49–12:55: „the lead is still too large … restructure them as smaller cards, 2-3 each row … otherwise the user must scroll all the time"; „why on earth has the newsboard a really meaningless, shapeless save button? … use the save icon as other places in the app"; „bento style … the articles with the highest scores appear bigger than others, taking up 2 times more space". My rule he accepted: at most two sizes, top TWO of today double-width, everything else single; phones one column.

## Global Constraints

- Columns: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4` on the board wrapper (keep its inset classes `px-4 md:px-9 lg:px-10` — the one page inset rule — and the 1280 px centre column the page already has). `DateDivider` rows span the full width (`col-span-full`). Own pending/rejected submissions (`ownNonApproved`) stay first, single cells.
- Bento: a `double` card is `md:col-span-2` (a full row on tablets, 2 of 3 on desktop). Only today's first two items, only when no Sektion filter / saved-only view is active; never in „Gestern"/„Älter". On phones `double` looks like `single` except the image ratio (see below). `data-size="double"` on the card root for probes.
- Card layout: image on TOP for every card (`ArticleImage` already takes `--news-img-ratio`): single 16/9, double 21/9 on `lg`, 16/9 below. Text block: chip row (Kiez kicker first, as today) → title (single: current size; double: one step bigger, e.g. 22–24 px, `text-wrap: balance`) → summary (single: clamp 3 lines via `-webkit-line-clamp`; double: 4 lines) → meta row with `ArticleMeta`, the read-more link and the save pill. Cards in one row must align: `h-full` / `flex flex-col` so the meta row sits at the bottom.
- Save control = the app's pill, copied from `src/components/forum/kiosk/ForumPostDetail.svelte` (search `aria-pressed={bookmarked}`): `rounded-full border-2 border-ink font-semibold`, ochre background when saved (`bg-ochre`) else transparent with `hover:bg-paper-warm`, glyph `🔖`, label `$t['detail.engagement.save']` („speichern") while unsaved and `$t['detail.engagement.saved']` („gespeichert") once saved (the user's 2026-09-10 rule: verb while unsaved, state once saved), `aria-pressed`, `aria-label` = the same text, an invisible tap-target extender to ≥ 44 px like the original. Card size: text 11–12 px, `px-2.5 py-0.5`. On an INK (Kiez) card the border/text tokens are already inverted; check that the unsaved pill is readable on ink (border = `var(--k-ink)` which is paper there) and the saved pill (ochre + ink text) still reads — set the saved pill's text colour explicitly to `#1b1a17` so the inversion cannot turn it paper-on-ochre.
- `NewsCardLead.svelte`: delete the file after `grep -rn NewsCardLead src` shows no other consumer. Any `import` of it goes too.
- Nothing changes in `orderBoard`, `isKiezSource`, the server sort, the detail page, RelatedRail, or the landing teaser.
- Copy keys reused, nothing new: `detail.engagement.save`, `detail.engagement.saved`, `news.readmore`, `news.divider.*`, `news.kiez.kicker`.
- Gates: `pnpm type-check` ≤ 23 errors, `npx -y svelte-check@4` ≤ 89, `pnpm build` green (then restart dev with `--force`). One-line commit messages, NO attribution lines, NO Co-Authored-By, `git add` named files only, `scratchpad/` gitignored, never print `.env`/password files, dev DB only (`mahalle-dev`), never push, never merge — the main session reviews the branch and the user merges.
- Dev server (peer): `SENTRY_DSN= TELEGRAM_BOT_TOKEN= SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY= nohup pnpm astro dev --port 4656 --force > scratchpad/dev-4656.log 2>&1 &`; stop with `fuser -k 4656/tcp` (never `pkill -f`). Playwright: standalone `.cjs`, `NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" timeout 120 node <file>`; login as `ayse@mahalle-dev.test`, password from `scratchpad/devpw.txt` (main repo folder — `../../scratchpad/devpw.txt` from the worktree; copy nothing, read it into `page.fill` only); wait on the URL pathname.

---

### Task 0: Recycle the worktree

- [ ] In `.claude/worktrees/ui-polish`: `git fetch origin && git status --short` (must be empty) `&& git reset --hard origin/main` (guarded: refuse if status is not empty) `&& git log --oneline -1` (must be `8b3f9529` or newer). Branch stays `fix/ui-polish`.

### Task 1: Save pill

**Files:** `src/components/newsboard/kiosk/primitives/SaveToggle.svelte` (rewrite the markup, keep the props `saved`, `mini`, `disabled`, `onToggle` so `NewsCard` and `detail/ReadingListControls.svelte` keep working; `mini` = card size, non-mini = detail size like the forum detail button).

- [ ] Rewrite per the Global Constraints; open `/newsboard` and `/newsboard/<id>` on dev and LOOK (both states, paper card and ink card).
- [ ] Commit: `newsboard: save control is the app's 🔖 pill`

### Task 2: Grid + bento + vertical card

**Files:** `src/components/newsboard/kiosk/NewsboardIndexInner.svelte` (the board wrapper at the end of the template: `orderBoard(..., false)`, grid classes, `size` per card, dividers `col-span-full`; drop the `NewsCardLead` import/usage), `src/components/newsboard/kiosk/browse/NewsCard.svelte` (`size` prop, vertical layout, clamps, `data-size`), delete `src/components/newsboard/kiosk/browse/NewsCardLead.svelte`.

- [ ] Implement per Global Constraints. Keep the Kiez inversion (`data-kiez`, the inline `--k-*` overrides incl. `--k-paper-warm`) and the kicker exactly as they are.
- [ ] Probe: adapt `scratchpad/news-kiez-probe.cjs` + `scratchpad/news-kiez-fixtures.mts` (main repo's `scratchpad/`; copy them into the worktree's own `scratchpad/` first — that folder is gitignored there too) so the fixtures create FOUR approved today items: `E2E-A` score 95, `E2E-B` score 90 (Kiez source, ink), `E2E-C` score 80, `E2E-D` score 70, plus one yesterday item `E2E-Y`. Assert at 390 / 768 / 1280: (1) no `NewsCardLead` markup (no element with the old lead class — inspect the deleted file first for its root class), (2) exactly two `[data-size="double"]` cards and they are `E2E-A` and `E2E-B`, (3) on 1280 a double card's width ≈ 2× a single's (+ gap, tolerance 8 px) and on 768 a double spans the full row while singles are half, on 390 all widths equal, (4) `E2E-Y` is single under „GESTERN", (5) every card's save pill text is „speichern" (unsaved) and the ink card's pill is readable (computed colour ≠ its background), (6) cards in a desktop row share the same rendered height, (7) zero page errors. Screenshots `scratchpad/news-grid-390.png`, `-768.png`, `-1280.png`; LOOK at all three. Delete the fixtures.
- [ ] Gates. Commit: `newsboard: card grid 1/2/3 columns, today's top two as double cards, lead card removed`

### Task 3: Docs

**Files:** `src/components/newsboard/kiosk/CLAUDE.md` (update the „Kiez cards + lead pick" section: the lead card is gone, bento rule, grid, save pill; date and the user's words), root `CLAUDE.md` Newsboard paragraph (one clause).

- [ ] Commit: `docs: newsboard grid and bento`

### Report back (to the main session, via SendMessage)
Commit hashes on `fix/ui-polish`, `git log --oneline origin/main..HEAD`, the probe table (checks × widths), screenshot paths (absolute), gates, dev server stopped, fixtures cleaned, anything that did not match this plan. Do not push, do not merge.
