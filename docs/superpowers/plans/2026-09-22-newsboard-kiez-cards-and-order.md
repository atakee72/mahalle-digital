# Newsboard: Kiez cards in ink + recency order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Kurier's lead card comes from today's articles (yesterday's as fallback), articles inside a day are ordered by their real publish time, and articles from Kiez sources are printed as INK cards with an „AUS DEM KIEZ" kicker so they stay visible without outranking fresh news.

**Architecture:** Two pure additions (`isKiezSource()` in `newsTaxonomy.ts`, `pickLead()` in `newsFormat.ts`, both tested with `node:test`), one server change (the sort chain in `src/pages/api/news/index.ts` and `src/lib/newsboard/newsQuery.ts` gets `publishedAt: -1` right after `fetchDate: -1`, replacing `source` / score as the day-internal order), and one island change (`NewsboardIndexInner.svelte` picks the lead with `pickLead()`, `toVM` sets `kiez`, `NewsCard` / `NewsCardLead` invert their colour tokens for `kiez` cards). No data repair: every field is correct (investigation 2026-09-22 11:20).

**Tech Stack:** Astro 5 SSR routes, Svelte 5 islands (nested islands: NO `<style>` blocks — orphaned CSS in prod builds), MongoDB driver, `node:test` via `npx tsx --test <file>`, Playwright `.cjs` probes against the own dev server on port 4655.

**Spec:** the user's decisions in chat, 2026-09-22 11:23–11:47: option 1 („lead card only from today"), plus „give another, more visible background color for the hyperlocal cards … the ink color, matching the news board's style", plus „choose the sources yourself, we can edit the list later".

## Global Constraints

- **Why (the finding):** the API sorts `fetchDate → source → aiRelevanceScore → approvedAt → _id` (`src/pages/api/news/index.ts:66`, hard-copied in `src/lib/newsboard/newsQuery.ts:81`); every article of one 6 AM cron run shares the `fetchDate` string, so the GPT score alone orders a day, and `NewsboardIndexInner.svelte:158` takes `approvedItems[0]` as the lead with no recency check — a 4-day-old score-90 item became the lead above a 4-hour-old score-85 item. `publishedAt` never took part in ordering.
- **New order (server):** `{ fetchDate: -1, publishedAt: -1, aiRelevanceScore: -1, _id: -1 }` in BOTH places (keep the API's `[sortBy]` key after `aiRelevanceScore` in `index.ts` so the query contract does not change; the default `sortBy` is `approvedAt`). The score becomes a tiebreak only. The documented „user-submitted first" rule is dropped — a submission sorts by its publish date like everything else (say so in the docs).
- **Lead:** first APPROVED article whose `chronoBucket(publishedAt) === 'today'`; if none, the first with `'yesterday'`; else no lead (the page then shows only the sections — this happens before the 6 AM cron on a quiet day and is acceptable). `chronoBucket` is in `src/lib/newsboard/newsFormat.ts:47`.
- **Kiez sources (my choice, editable later — ONE list, pure):** `sourceName` contains (case-insensitive) any of `Pro Schillerkiez`, `Schillerpromenade`, `Facetten Neukölln`, `Kiez und Kneipe`, `Neuköllner Wochenkurier`, `neukoellner.net`, `Nachbarschaftstreff`, `Schillerkiez`, `Neukölln` (the umlaut variants `Neukoelln`/`neukoellner` too). A member submission (`source === 'user_submitted'`) is NOT Kiez by itself — a member may submit a Tagesspiegel link; it is Kiez only when its `sourceName` matches. Exported as `KIEZ_SOURCE_PATTERNS`.
- **Kiez card look:** the card keeps its layout; it inverts the colour tokens ON ITS ROOT via inline custom-property overrides, so every child that uses `var(--k-ink)` / `var(--k-paper)` inverts by itself: `--k-paper: #1b1a17; --k-ink: #f5efe0; --k-ink-soft: #ebe1c7; --k-ink-mute: #c9bea3; --k-border-hair: 1px solid #f5efe0`. Root `background` stays `var(--k-paper)` (now ink) and `border: var(--k-border-hair)`. Plus a mono kicker as the FIRST chip in the chip row: key `news.kiez.kicker`, DE „Aus dem Kiez", EN „From the Kiez", rendered `font-dmmono uppercase` 9 px, letter-spacing 0.1em, paper text on a 1 px paper border, `data-kiez` attribute on the card root (`data-kiez="true"`) for probes. Images are untouched. The lead card gets the same inversion + kicker.
- **Nested-island rule:** `NewsCard.svelte` / `NewsCardLead.svelte` are imported only by another island — no `<style>` block; inline styles / Tailwind only.
- `newsTaxonomy.ts` and `newsFormat.ts` are DEPENDENCY-PURE (imported by islands); keep them so.
- Gates: `pnpm type-check` ≤ 23 errors, `npx -y svelte-check@4` ≤ 89, `pnpm build` green. One-line commit messages, no attribution lines, `git add` named files only, `scratchpad/` is gitignored, never print `.env`/password files, dev DB only, never push.
- Dev server: `SENTRY_DSN= TELEGRAM_BOT_TOKEN= SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY= nohup pnpm astro dev --port 4655 --force > scratchpad/dev-4655.log 2>&1 &`; stop with `fuser -k 4655/tcp` (never `pkill -f`). Playwright: standalone `.cjs`, `NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" timeout 120 node <file>`; login by filling the form as `ayse@mahalle-dev.test` with the password from `scratchpad/devpw.txt` read straight into `page.fill`; wait on the URL pathname.

---

### Task 1: Pure helpers `isKiezSource` + `pickLead`

**Files:**
- Modify: `src/lib/newsboard/newsTaxonomy.ts` (append after `resolveQuelle`), `src/lib/newsboard/newsFormat.ts` (append after `chronoBucket`)
- Test: `src/lib/newsboard/newsOrder.test.ts` (new)

**Interfaces:**
- Produces: `export const KIEZ_SOURCE_PATTERNS: readonly string[]; export function isKiezSource(sourceName?: string | null): boolean` (newsTaxonomy.ts) and `export function pickLead<T extends { publishedAt: string | Date }>(items: readonly T[], now?: Date): T | undefined` (newsFormat.ts).

- [ ] **Step 1: Failing test**

```ts
// Run: npx tsx --test src/lib/newsboard/newsOrder.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKiezSource } from './newsTaxonomy';
import { pickLead } from './newsFormat';

test('Kiez sources by name, case-insensitive, umlaut variants', () => {
  for (const s of ['Pro Schillerkiez', 'Facetten Neukölln', 'facettenneukoelln', 'Kiez und Kneipe', 'Schillerpromenade', 'Neuköllner Wochenkurier', 'neukoellner.net', 'Nachbarschaftstreff Schillerkiez'])
    assert.equal(isKiezSource(s), true, s);
  for (const s of ['Tagesspiegel', 'Berliner Zeitung', 'rbb24', 'taz', '', undefined, null])
    assert.equal(isKiezSource(s as any), false, String(s));
});

test('lead: first of today, else first of yesterday, else none — input order kept', () => {
  const now = new Date('2026-09-22T09:00:00Z');
  const a = { id: 'old', publishedAt: '2026-09-18T07:15:00Z' };
  const b = { id: 'y1', publishedAt: '2026-09-21T20:00:00Z' };
  const c = { id: 't1', publishedAt: '2026-09-22T04:54:00Z' };
  const d = { id: 't2', publishedAt: '2026-09-22T06:33:00Z' };
  assert.equal(pickLead([a, b, c, d], now)?.id, 't1');
  assert.equal(pickLead([a, b], now)?.id, 'y1');
  assert.equal(pickLead([a], now), undefined);
  assert.equal(pickLead([], now), undefined);
});
```

- [ ] **Step 2: Run** `npx tsx --test src/lib/newsboard/newsOrder.test.ts` — FAIL (exports missing).

- [ ] **Step 3: Implement**

newsTaxonomy.ts, after `resolveQuelle`:

```ts
// „Aus dem Kiez" (2026-09-22, user decision): articles from Kiez / Neukölln
// sources are printed as INK cards on the board so they stay visible now that
// the day is ordered by publish time instead of the GPT score. ONE list, by
// sourceName only — a member-submitted Tagesspiegel link is not Kiez. Edit
// freely; lowercase substrings, umlaut variants spelled out.
export const KIEZ_SOURCE_PATTERNS: readonly string[] = [
  'schillerkiez', 'schillerpromenade', 'facetten neukölln', 'facettenneukoelln', 'facetten neukoelln',
  'kiez und kneipe', 'kiezundkneipe', 'wochenkurier', 'neukoellner', 'neuköllner', 'nachbarschaftstreff', 'neukölln', 'neukoelln',
];

export function isKiezSource(sourceName?: string | null): boolean {
  const s = (sourceName ?? '').toLowerCase();
  return s.length > 0 && KIEZ_SOURCE_PATTERNS.some((p) => s.includes(p));
}
```

newsFormat.ts, after `chronoBucket`:

```ts
// Lead card = the newest of TODAY (input order is the server's publish-time
// order), yesterday's as a fallback before the 6 AM cron, else none. Until
// 2026-09-22 the lead was simply approvedItems[0], i.e. the day's highest GPT
// score — a 4-day-old item sat above a 4-hour-old one.
export function pickLead<T extends { publishedAt: string | Date }>(items: readonly T[], now: Date = new Date()): T | undefined {
  return items.find((it) => chronoBucket(it.publishedAt, now) === 'today')
    ?? items.find((it) => chronoBucket(it.publishedAt, now) === 'yesterday');
}
```

- [ ] **Step 4: Run** — 2 pass. Also `npx tsx --test src/lib/newsboard/*.test.ts` still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/newsboard/newsTaxonomy.ts src/lib/newsboard/newsFormat.ts src/lib/newsboard/newsOrder.test.ts
git commit -m "newsboard: pure isKiezSource + pickLead"
```

---

### Task 2: Server order — publish time inside a day

**Files:**
- Modify: `src/pages/api/news/index.ts:66`, `src/lib/newsboard/newsQuery.ts:81`

- [ ] **Step 1:** In `index.ts` replace the sort with

```ts
        // Day (fetchDate) first, then the article's real publish time; the GPT
        // score is only a tiebreak since 2026-09-22 — before, every item of one
        // cron run tied on fetchDate and the score alone ordered the day, so a
        // 4-day-old score-90 item outranked a 4-hour-old score-85 one. The
        // „user-submitted first" rule (source: -1) went with it.
        .sort({ fetchDate: -1, publishedAt: -1, aiRelevanceScore: -1, [sortBy]: sortOrder === 'asc' ? 1 : -1, _id: -1 })
```

and in `newsQuery.ts` (its comment says it is kept in sync by hand — update that comment too):

```ts
    .sort({ fetchDate: -1, publishedAt: -1, aiRelevanceScore: -1, approvedAt: -1, _id: -1 })
```

- [ ] **Step 2:** Check `publishedAt` is a Date on inserted docs (`grep -n "publishedAt" src/pages/api/news/fetch-daily.ts src/pages/api/news/submit.ts`) — the investigation saw Dates; if `submit.ts` stores a string, convert at insert (`new Date(...)`) in the same commit and say so.

- [ ] **Step 3:** tsc ≤ 23, then

```bash
git add src/pages/api/news/index.ts src/lib/newsboard/newsQuery.ts
git commit -m "newsboard: order a day by publish time, score only as tiebreak"
```

---

### Task 3: Island — lead pick, `kiez` flag, ink cards with kicker

**Files:**
- Modify: `src/lib/newsboard/newsTaxonomy.ts` (`NewsVM` gets `kiez: boolean`), `src/components/newsboard/kiosk/NewsboardIndexInner.svelte` (`toVM`, `lead`, `rest`), `src/components/newsboard/kiosk/browse/NewsCard.svelte`, `src/components/newsboard/kiosk/browse/NewsCardLead.svelte`, `src/lib/kiosk-i18n.ts` (DE + EN `news.kiez.kicker`)

- [ ] **Step 1: VM + lead.** `NewsVM`: add `kiez: boolean; // source is a Kiez / Neukölln outlet → ink card`. In `toVM`: `kiez: isKiezSource(it.sourceName),` (import from `../../../lib/newsboard/newsTaxonomy`, the file already imports `resolveQuelle` from there). Replace

```ts
  const lead = $derived(!activeSektion && !savedOnly ? approvedItems[0] : undefined);
  const rest = $derived(lead ? approvedItems.slice(1) : approvedItems);
```

with

```ts
  // Lead = newest of today (yesterday's as fallback), never „highest score of
  // the day" (2026-09-22) — see pickLead().
  const lead = $derived(!activeSektion && !savedOnly ? pickLead(approvedItems) : undefined);
  const rest = $derived(lead ? approvedItems.filter((a) => a.id !== lead.id) : approvedItems);
```

(import `pickLead` from `../../../lib/newsboard/newsFormat`, next to `chronoBucket`). Check any other consumer of `approvedItems[0]` / `RelatedRail` — leave the detail page alone. `kiez` is a REQUIRED field on `NewsVM`: if tsc reports another place that builds a `NewsVM` (grep `NewsVM` / `toVM`), set `kiez: isKiezSource(it.sourceName)` there too.

- [ ] **Step 2: i18n.** DE block, next to the other `news.*` keys: `'news.kiez.kicker': 'Aus dem Kiez',`; EN block: `'news.kiez.kicker': 'From the Kiez',`.

- [ ] **Step 3: NewsCard.** On the `<article>` root add `data-kiez={article.kiez ? 'true' : undefined}` and extend the `style` attribute:

```svelte
  style={`background:var(--k-paper); border:var(--k-border-hair); border-radius:var(--k-radius-md); padding:18px; gap:22px; opacity:${decay};`
    + (article.kiez ? ' --k-paper:#1b1a17; --k-ink:#f5efe0; --k-ink-soft:#ebe1c7; --k-ink-mute:#c9bea3; --k-border-hair:1px solid #f5efe0;' : '')}
```

(the file currently uses a plain `style="…{decay}…"` string — convert to the template form above; keep every existing declaration). In the chip row, as the FIRST child before `<ReadDot …/>`:

```svelte
      {#if article.kiez}<span data-kiez-kicker class="font-dmmono uppercase" style="font-size:9px; font-weight:700; letter-spacing:0.1em; padding:2px 7px; color:var(--k-ink); border:1px solid var(--k-ink); border-radius:3px;">{$t['news.kiez.kicker']}</span>{/if}
```

(`--k-ink` is paper on a Kiez card, so this reads paper-on-ink.) Then LOOK at the card: any child that hard-codes a colour instead of a token (grep the file for `#` inside `style=` and for `text-ink`/`bg-paper` Tailwind classes) must be switched to the token, or it stays ink-on-ink. `SektionTag`, `HeatChip`, `ReadDot`, `ArticleMeta`, `SaveToggle` (in `primitives/`): read each; if one uses a fixed colour, note it and switch it to the token in the same commit (name every file you touched).

- [ ] **Step 4: NewsCardLead.** Same three moves (data attribute, token override on the root, kicker first in its chip row) with its own root style string.

- [ ] **Step 5: Probe on dev.** Start the dev server. Dev needs a Kiez article: insert ONE approved item into the dev `news` collection with `sourceName: 'Pro Schillerkiez'`, `source: 'ai_fetched'`, title starting `E2E-KIEZ`, `publishedAt: new Date()` (today), `fetchDate: today's 'YYYY-MM-DD'`, `approvedAt: new Date()`, `aiRelevanceScore: 90`, `aiCategory` like the others, `sourceUrl: 'https://proschillerkiezblog.wordpress.com/e2e'`, `description`, `aiSummary`, `moderationStatus: 'approved'`, `imageUrl: ''` — and a second one with `sourceName: 'Tagesspiegel'`, `publishedAt` = now + 1 minute, score 85, title starting `E2E-FRESH`. Write `scratchpad/news-kiez-probe.cjs` (env `PROBE_WIDTH`, 1280 and 390): log in, open `/newsboard`, assert (1) the lead card's title starts with `E2E-FRESH` (newer publish time wins the lead although the score is lower), (2) `[data-kiez="true"]` exists and contains the `E2E-KIEZ` title, (3) its computed `background-color` is `rgb(27, 26, 23)` and its title's computed `color` is `rgb(245, 239, 224)`, (4) `[data-kiez-kicker]` text is „Aus dem Kiez" (DE default), (5) a non-Kiez card has the paper background `rgb(245, 239, 224)`, (6) no page errors. Screenshots `scratchpad/news-kiez-1280.png`, `scratchpad/news-kiez-390.png`. LOOK at both with the Read tool: every text on the ink card readable, chips readable, image (if any) untouched. Delete the two fixture items afterwards (by title prefix `E2E-`).

- [ ] **Step 6: Gates and commit.** svelte-check ≤ 89, tsc ≤ 23, `pnpm build` green.

```bash
git add src/lib/newsboard/newsTaxonomy.ts src/components/newsboard/kiosk/NewsboardIndexInner.svelte src/components/newsboard/kiosk/browse/NewsCard.svelte src/components/newsboard/kiosk/browse/NewsCardLead.svelte src/lib/kiosk-i18n.ts
git commit -m "newsboard: lead from today, Kiez sources as ink cards with kicker"
```

(add any primitive you had to fix to the `git add` line).

---

### Task 4: Docs

**Files:**
- Modify: `src/pages/api/news/CLAUDE.md` (the sort rule sentence „sorted by day, then user-submitted first, then aiRelevanceScore descending" → the new chain, dated), `src/components/newsboard/kiosk/CLAUDE.md` (a short section „Kiez cards + lead pick (2026-09-22)": the finding, `pickLead`, `KIEZ_SOURCE_PATTERNS` editable list, the token-inversion trick and why no `<style>`, the probe name), root `CLAUDE.md` Newsboard paragraph: one clause.

- [ ] Commit: `git add src/pages/api/news/CLAUDE.md src/components/newsboard/kiosk/CLAUDE.md CLAUDE.md && git commit -m "docs: newsboard Kiez cards and recency order"`

---

## Does NOT do
- No change to the detail page, RelatedRail, the landing „Kurier top 3" (`src/lib/landing.ts` has its own pick — leave it; note in docs if it still uses the score).
- No admin UI for the source list (it is a constant; „we can edit the list later").
- No data repair.
