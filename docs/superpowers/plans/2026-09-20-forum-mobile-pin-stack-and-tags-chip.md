# Forum on phones: one pin bar + tags chip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On phones (below 768 px) the forum index shows ONE bar for the pinned official announcements („newest title +2 ▾") instead of three, and folds the tag row behind a „# Tags" chip at the end of the filter row — so the first post starts roughly 130 px higher. Tablet and desktop stay exactly as they are.

**Architecture:** CSS-only breakpoint switching (Tailwind `md:` variants) plus two pieces of per-visit view state (`tagsOpen` in `TagBar.svelte`, `pinsUnfolded` in `ForumIndexInner.svelte`). No `matchMedia`, no new component, no new `<style>` block (so the „nested-island orphaned CSS" trap cannot hit). The two decisions that have branches live in one pure, unit-tested helper file.

**Tech Stack:** Astro 5, Svelte 5 runes (`$state`, `$derived`, `$props`), Tailwind 3.4, `node:test` via `npx tsx`, standalone Playwright probes (`.cjs`) against an own dev server on port 4655 and the dev database `mahalle-dev`.

**Spec:** the user's go of 2026-09-20 19:24 („ok, build 1 & 2") on this description, given in chat the same evening:
1. *One pin bar instead of three.* A single bar shows the newest pinned title plus „+2 ▾". A tap unfolds all three, as they are today.
2. *The tags become a chip.* The separate tag row goes. A „# Tags" chip sits in the filter row and opens the tags on tap.
3. Both only on phones; nothing gets smaller or harder to tap; desktop and tablet stay as today.

## Global Constraints

- „Phones" = viewport width **< 768 px** (Tailwind `md`). At ≥ 768 px the DOM may differ but the rendered page must be pixel-identical to today.
- Nothing gets smaller: the summary pin bar keeps `min-h-[36px]` (today's phone bar height); the chip uses the same pill classes as the other filter pills; the fold control is `min-h-[36px]`.
- View state is per visit only: never persisted (no localStorage, no URL param), never reorders pins.
- The tour keeps exactly 7 forum stops. The stop anchored on `[data-tour="forum-tag"]` must still resolve on phones.
- Gates, both ratchet-only: `pnpm type-check` error count **≤ 26**, `npx -y svelte-check@4` error count **≤ 92**. `pnpm build` must be green.
- Work on branch `feat/forum-mobile-chrome`. **No push, no merge to `main` without the user's word.**
- Commit messages: ONE line, no „Generated with Claude Code", no `Co-Authored-By`. `git add` only the named files.
- Never print a value from `.env` or from `scratchpad/devpw.txt`. Never snapshot/screenshot a page while a password field is filled.
- Do NOT start anything on port 3000 (the user's own server). Own dev server: `SENTRY_DSN= TELEGRAM_BOT_TOKEN= pnpm astro dev --port 4655`; stop it with `fuser -k 4655/tcp` when done.
- Playwright probes run as `NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/<file>.cjs`. `scratchpad/` is gitignored — probes are never committed.
- Database writes only against `mahalle-dev` (scripts must refuse any db name without „dev").
- Python one-off edits: `assert s.count(old) == 1` before replacing; triple-quote strings that contain German „…" quotes.

## File Structure

| File | Responsibility |
|---|---|
| Create `src/lib/forum/mobileChrome.ts` | Pure: `pinStackMode()` and `tagsChipLabel()` — the only branching logic |
| Create `src/lib/forum/mobileChrome.test.ts` | Unit tests for both |
| Modify `src/components/forum/kiosk/TagBar.svelte` | „# Tags" chip + folded tag row below `md` |
| Modify `src/components/forum/kiosk/ForumIndexInner.svelte` | Summary pin bar + fold control below `md` |
| Modify `src/lib/kiosk-i18n.ts` | 4 new keys × DE/EN (chip, 2 × pin stack, tour mobile copy) |
| Modify `src/lib/tour/tourChapters.ts` | `bodyMobileKey` on the Forum „Tags" stop |
| Modify `src/components/forum/kiosk/CLAUDE.md`, `src/components/tour/CLAUDE.md`, `CLAUDE.md`, `docs/runbooks/debut-event-readiness.md` | Docs |
| Scratch (not committed) `scratchpad/dev-pin-officials.mts`, `scratchpad/forum-tags-chip-probe.cjs`, `scratchpad/forum-pin-stack-probe.cjs` | Dev-DB prep + browser probes |

---

### Task 1: Pure helper `mobileChrome.ts`

**Files:**
- Create: `src/lib/forum/mobileChrome.ts`
- Test: `src/lib/forum/mobileChrome.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PinStackMode = 'single' | 'folded' | 'unfolded'`
  - `pinStackMode(count: number, unfolded: boolean): PinStackMode`
  - `tagsChipLabel(activeTag: string | null | undefined, fallback: string): string`

- [ ] **Step 0: Branch**

```bash
git checkout -b feat/forum-mobile-chrome
```

- [ ] **Step 1: Write the failing test**

`src/lib/forum/mobileChrome.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinStackMode, tagsChipLabel } from './mobileChrome';

test('no pin or one pin never folds — there is nothing to save', () => {
  assert.equal(pinStackMode(0, false), 'single');
  assert.equal(pinStackMode(1, false), 'single');
  assert.equal(pinStackMode(1, true), 'single');
});

test('two or three pins start folded and unfold on request', () => {
  assert.equal(pinStackMode(2, false), 'folded');
  assert.equal(pinStackMode(3, false), 'folded');
  assert.equal(pinStackMode(3, true), 'unfolded');
});

test('a pin expiring while the stack is unfolded falls back to single', () => {
  assert.equal(pinStackMode(1, true), 'single');
});

test('the chip shows its plain label while no tag is active', () => {
  assert.equal(tagsChipLabel(null, '# Tags'), '# Tags');
  assert.equal(tagsChipLabel(undefined, '# Tags'), '# Tags');
  assert.equal(tagsChipLabel('', '# Tags'), '# Tags');
  assert.equal(tagsChipLabel('   ', '# Tags'), '# Tags');
});

test('the chip names the active tag, so a folded row never hides an active filter', () => {
  assert.equal(tagsChipLabel('garten', '# Tags'), '#garten');
  assert.equal(tagsChipLabel(' kita ', '# Tags'), '#kita');
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx tsx src/lib/forum/mobileChrome.test.ts`
Expected: FAIL — `Cannot find module './mobileChrome'`.

- [ ] **Step 3: Implement**

`src/lib/forum/mobileChrome.ts`:

```ts
// Phone-only chrome of the forum index (2026-09-20): one summary bar for
// the pinned officials and a "# Tags" chip instead of the tag row.
// Dependency-pure on purpose — imported by client islands.

export type PinStackMode = 'single' | 'folded' | 'unfolded';

// 0–1 pins: nothing to fold, render the bars as always. 2–3 pins: phones
// start with ONE summary bar; a tap unfolds the usual bars. (Tablet and
// desktop ignore the mode — they always show the bars, via CSS.)
export function pinStackMode(count: number, unfolded: boolean): PinStackMode {
  if (count <= 1) return 'single';
  return unfolded ? 'unfolded' : 'folded';
}

// The chip names the active tag so a folded tag row never hides the fact
// that a filter is on.
export function tagsChipLabel(activeTag: string | null | undefined, fallback: string): string {
  const tag = (activeTag ?? '').trim();
  return tag ? `#${tag}` : fallback;
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `npx tsx src/lib/forum/mobileChrome.test.ts`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forum/mobileChrome.ts src/lib/forum/mobileChrome.test.ts
git commit -m "forum: pure helpers for the phone pin stack and the tags chip"
```

---

### Task 2: „# Tags" chip in `TagBar.svelte`

**Files:**
- Modify: `src/components/forum/kiosk/TagBar.svelte` (script: imports + one `$state`; markup: rows 1 and 2, currently lines 85–136)
- Modify: `src/lib/kiosk-i18n.ts` (after `'filter.tagsLabel'` — DE near line 192, EN near line 2155; tour copy near lines 1941 / 3826)
- Modify: `src/lib/tour/tourChapters.ts` (Forum stop 6, line 39)
- Scratch: `scratchpad/forum-tags-chip-probe.cjs`

**Interfaces:**
- Consumes: `tagsChipLabel(activeTag, fallback)` from `src/lib/forum/mobileChrome.ts` (Task 1).
- Produces (DOM contract the probe and Task 4's docs rely on): chip = `button[data-tags-chip]` with `aria-expanded` + `aria-controls="forum-tag-row"`; tag row = `#forum-tag-row`. `TagBar`'s props are unchanged.

**Background you need:**
- `TagBar` renders two rows below `lg` (filters, then tags), each a horizontal scroller; `lg:contents` dissolves both wrappers on desktop so everything sits in one wrapping line. Do not break that.
- `use:scrollFade` self-disables on an element without a box (`display:none`) and re-measures through its `ResizeObserver` when the element gets a box — so hiding the row with a class is safe.
- The tour (`src/components/tour/TourController.svelte`, `findAnchor`) takes the FIRST match of a selector that has client rects. Putting `data-tour="forum-tag"` on the chip (which comes first in the DOM) makes the tour ring land on the chip on phones; at ≥ 768 px the chip is `display:none`, so the ring lands on the first tag as today.

- [ ] **Step 1: i18n keys**

In `src/lib/kiosk-i18n.ts`, DE block, directly under `'filter.tagsLabel': 'TAGS',` add:

```ts
  'filter.tagsChip': '# Tags',
```

EN block, directly under its `'filter.tagsLabel': 'TAGS',` add the same line:

```ts
  'filter.tagsChip': '# Tags',
```

(The file has the key twice — once per language. Use a Python edit that asserts `s.count("  'filter.tagsLabel': 'TAGS',\n") == 2` and replaces both.)

- [ ] **Step 2: Script changes in `TagBar.svelte`**

Under the existing `import { scrollFade } …` line add:

```ts
  import { tagsChipLabel } from '../../../lib/forum/mobileChrome';
```

Directly above `// Pill chrome — outlined rounded-full…` add:

```ts
  // Phones (< md): the tag row is folded behind a "# Tags" chip at the end
  // of the filter row (2026-09-20 — brings the first post up by one row).
  // Per-visit view state only. From md up the row is always visible and
  // the chip is display:none, so this flag has no effect there.
  let tagsOpen = $state(false);
```

Also update the ASCII sketch in the file's header comment by appending these two lines after the existing sketch:

```
  //   Phones (< md): [ Alle | Diskussion | … scrolls … ] [# Tags ▾]
  //                  tag row only after a tap on the chip
```

- [ ] **Step 3: Markup — row 1 gets a wrapper and the chip**

Replace the current row-1 opening tag

```svelte
  <!-- Row 1: filters (type + personal). -->
  <div
    use:scrollFade
    class="kiosk-scroll-fade flex items-center gap-2 overflow-x-auto no-scrollbar lg:contents"
  >
```

with

```svelte
  <!-- Row 1: filters (type + personal) in a scroller; on phones the
       "# Tags" chip sits OUTSIDE the scroller so it is always in view
       (the pills alone are wider than a 390px screen). Both wrappers
       dissolve at lg. -->
  <div class="flex items-center gap-2 lg:contents">
  <div
    use:scrollFade
    class="kiosk-scroll-fade flex-1 min-w-0 flex items-center gap-2 overflow-x-auto no-scrollbar lg:contents"
  >
```

and replace the row-1 closing `</div>` (the one directly above `<!-- Row 2: tags. -->`) with

```svelte
  </div>
    {#if tags.length}
      <!-- data-tour: on phones the tour's "Tags" stop lands here (first
           visible match); from md up this button is display:none and the
           stop lands on the first tag, as before. -->
      <button
        type="button"
        data-tags-chip
        data-tour="forum-tag"
        aria-expanded={tagsOpen}
        aria-controls="forum-tag-row"
        onclick={() => (tagsOpen = !tagsOpen)}
        class={`md:hidden shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full font-bricolage font-medium text-sm transition-colors duration-150 ${pillClass(!!activeTag)}`}
      >
        <span class="truncate max-w-[7rem]">{tagsChipLabel(activeTag, $t['filter.tagsChip'])}</span>
        <span aria-hidden="true" class="text-[10px]">{tagsOpen ? '▴' : '▾'}</span>
      </button>
    {/if}
  </div>
```

- [ ] **Step 4: Markup — row 2 folds below md**

Replace

```svelte
    <div
      use:scrollFade
      class="kiosk-scroll-fade flex items-center gap-2 overflow-x-auto no-scrollbar mt-2 lg:mt-0 lg:contents"
    >
```

with

```svelte
    <!-- 'hidden md:flex' must stay a literal string — Tailwind only
         generates classes it can read in the source. -->
    <div
      id="forum-tag-row"
      use:scrollFade
      class={`kiosk-scroll-fade items-center gap-2 overflow-x-auto no-scrollbar mt-2 lg:mt-0 lg:contents ${tagsOpen ? 'flex' : 'hidden md:flex'}`}
    >
```

Also update the HTML comment above the outer wrapper („Mobile (< lg): two horizontally-scrollable rows…") by adding one sentence at its end: `Below md the tag row is folded behind the "# Tags" chip (tagsOpen).`

- [ ] **Step 4b: Tour copy for the chip (phones)**

The tour's Tags stop says „Ein Klick auf einen Tag filtert den Kiez…". With the ring on the chip that sentence is wrong — a tap on the chip OPENS the tags. The tour already supports per-stop mobile copy (`bodyMobileKey`, shown below 1024 px by `TourSpotlight.svelte`). Because that breakpoint also covers tablets (768–1023 px, where the tag row is visible and there is no chip), the mobile sentence must be true in BOTH situations.

In `src/lib/tour/tourChapters.ts` change the Forum stop

```ts
      { anchor: '[data-tour="forum-tag"]',                   titleKey: 'tour.forum.s6.title', bodyKey: 'tour.forum.s6.body' },
```

to

```ts
      { anchor: '[data-tour="forum-tag"]',                   titleKey: 'tour.forum.s6.title', bodyKey: 'tour.forum.s6.body', bodyMobileKey: 'tour.forum.s6.bodyMobile' },
```

In `src/lib/kiosk-i18n.ts` add directly under the DE `'tour.forum.s6.body'` line:

```ts
  'tour.forum.s6.bodyMobile': 'Tags filtern Beiträge nach einem bestimmten Thema. Ein Tipp genügt, um die Auswahl ein- oder auszublenden.',
```

and under the EN `'tour.forum.s6.body'` line:

```ts
  'tour.forum.s6.bodyMobile': 'Tags filter posts by a specific topic. One tap is enough to show or hide the selection.',
```

(Wording approved by the user before execution — see „Decisions for the user" at the end. Desktop copy is untouched.) Add `src/lib/tour/tourChapters.ts` to this task's `git add`.

- [ ] **Step 5: Probe**

Create `scratchpad/forum-tags-chip-probe.cjs`:

```js
// Tags chip: folded on phones, untouched from 768px up. Dev server on :4655, dev DB.
const { chromium } = require('playwright'); const fs = require('fs');
const BASE = process.env.PROBE_BASE || 'http://localhost:4655';
const EMAIL = process.env.PROBE_EMAIL || 'admin@mahalle-dev.test';
const PWFILE = process.env.PROBE_PWFILE || 'scratchpad/devpw.txt';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const shown = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
async function open(b, width) {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, locale: 'de-DE', reducedMotion: 'reduce', hasTouch: width < 768 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login?redirect=%2Fforum`);
  await p.fill('input[type="email"]', EMAIL);
  await p.fill('input[type="password"]', fs.readFileSync(PWFILE, 'utf8').trim());
  await p.keyboard.press('Enter');
  await p.waitForURL('**/forum**', { timeout: 20000 });
  await p.waitForSelector('[data-tour="forum-filter-all"]', { timeout: 20000 });
  await p.waitForTimeout(1200);
  return { ctx, p };
}
(async () => {
  const b = await chromium.launch();
  { // phone
    const { ctx, p } = await open(b, 390);
    ok('390: chip is visible', await shown(p, '[data-tags-chip]'));
    ok('390: tag row starts folded', !(await shown(p, '#forum-tag-row')));
    ok('390: chip is inside the viewport (not scrolled away)', await p.evaluate(() => { const r = document.querySelector('[data-tags-chip]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
    ok('390: no sideways page scroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.click('[data-tags-chip]');
    ok('390: tap opens the row', await shown(p, '#forum-tag-row'));
    ok('390: aria-expanded is true', (await p.getAttribute('[data-tags-chip]', 'aria-expanded')) === 'true');
    const tag = p.locator('#forum-tag-row button').first();
    const tagText = (await tag.innerText()).trim();
    await tag.click(); await p.waitForTimeout(400);
    ok('390: choosing a tag writes ?tag= to the URL', /[?&]tag=/.test(p.url()), p.url());
    await p.click('[data-tags-chip]');
    ok('390: second tap folds the row', !(await shown(p, '#forum-tag-row')));
    const chipText = (await p.innerText('[data-tags-chip]')).replace(/\s+/g, ' ').trim();
    ok('390: folded chip names the active tag', chipText.startsWith(tagText), `${chipText} vs ${tagText}`);
    ok('390: chip is pressed-styled while a tag is active', await p.evaluate(() => getComputedStyle(document.querySelector('[data-tags-chip]')).backgroundColor !== 'rgba(0, 0, 0, 0)'));
    await p.screenshot({ path: 'scratchpad/forum-tags-chip-390.png' });
    await ctx.close();
  }
  for (const w of [800, 1280]) { // tablet + desktop unchanged
    const { ctx, p } = await open(b, w);
    ok(`${w}: chip is not rendered visibly`, !(await shown(p, '[data-tags-chip]')));
    ok(`${w}: tag row is visible without a tap`, await p.evaluate(() => { const e = document.querySelector('#forum-tag-row button'); return !!e && e.getClientRects().length > 0; }));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 6: Run the probe**

```bash
(SENTRY_DSN= TELEGRAM_BOT_TOKEN= nohup pnpm astro dev --port 4655 > scratchpad/dev-4655.log 2>&1 &)
until curl -s -o /dev/null http://localhost:4655/login; do sleep 2; done
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/forum-tags-chip-probe.cjs
```

Expected: `14 passed, 0 failed`. Then LOOK at `scratchpad/forum-tags-chip-390.png` (Read tool): chip at the right end of the filter row, same height as the pills, row folded. Leave the server running for Task 3.

The chip only renders when the feed has tags; the dev DB had 4 tagged topics on 2026-09-20. If the chip is absent because that changed, report BLOCKED with the probe output rather than seeding data yourself.

- [ ] **Step 7: Gates + commit**

```bash
pnpm type-check > /tmp/tsc.log 2>&1; grep -c 'error TS' /tmp/tsc.log                     # must be ≤ 26
pnpm exec svelte-check --output machine > /tmp/sc.log 2>&1; grep ' COMPLETED ' /tmp/sc.log  # "… N ERRORS …": N must be ≤ 92
git add src/components/forum/kiosk/TagBar.svelte src/lib/kiosk-i18n.ts src/lib/tour/tourChapters.ts
git commit -m "forum: on phones the tag row folds behind a Tags chip at the end of the filter row"
```

---

### Task 3: One summary pin bar in `ForumIndexInner.svelte`

**Files:**
- Modify: `src/components/forum/kiosk/ForumIndexInner.svelte` (script near lines 229–248; markup lines 631–682)
- Modify: `src/lib/kiosk-i18n.ts` (after `'pinned.bar.label'` — DE near line 198, EN near line 2160)
- Scratch: `scratchpad/dev-pin-officials.mts`, `scratchpad/forum-pin-stack-probe.cjs`

**Interfaces:**
- Consumes: `pinStackMode(count, unfolded)` from `src/lib/forum/mobileChrome.ts` (Task 1). Existing in the file: `pinnedOfficials` (derived array, newest pin first), `expandedPinId` (`$state<string|null>`), `togglePin(id)`, `$t`.
- Produces (DOM contract): summary = `button[data-pin-summary]`; bar list = `#forum-pin-stack`; fold control = `button[data-pin-fold]`. The per-pin bars keep `aria-controls="pin-card-<id>"`.

- [ ] **Step 1: i18n keys**

DE block, directly under `'pinned.bar.label': 'AMTLICH',`:

```ts
  'pinned.stack.more': '{n} weitere amtliche Mitteilungen anzeigen',
  'pinned.stack.collapse': 'einklappen',
```

EN block, directly under `'pinned.bar.label': 'OFFICIAL',`:

```ts
  'pinned.stack.more': 'show {n} more official announcements',
  'pinned.stack.collapse': 'collapse',
```

- [ ] **Step 2: Script**

Add to the imports (next to the other `../../../lib/forum/…` imports):

```ts
  import { pinStackMode } from '../../../lib/forum/mobileChrome';
```

Directly under the existing `function togglePin(id: string) { … }` add:

```ts
  // Phones (< md), 2026-09-20: two or three pins start as ONE summary bar
  // ("newest title +2 ▾"); a tap unfolds the usual bars, "einklappen" folds
  // them again. From md up the bars always show (CSS) and this state has no
  // effect. Per-visit view state, like expandedPinId — never persisted.
  let pinsUnfolded = $state(false);
  const pinMode = $derived(pinStackMode(pinnedOfficials.length, pinsUnfolded));
  // The tapped button leaves the DOM on both switches — hand the focus on,
  // or keyboard and screen-reader users are dropped back to <body>.
  async function unfoldPins() {
    pinsUnfolded = true;
    await tick();
    document.querySelector<HTMLElement>('#forum-pin-stack button')?.focus();
  }
  async function foldPins() {
    pinsUnfolded = false;
    expandedPinId = null; // a card must not stay open inside a hidden stack
    await tick();
    document.querySelector<HTMLElement>('[data-pin-summary]')?.focus();
  }
```

`tick` comes from `svelte`. Check the file's existing `import { … } from 'svelte'` line: if `tick` is already in it, do nothing; otherwise add it to that same import (do not add a second import line).

- [ ] **Step 3: Markup**

In the pinned block, replace the opening wrapper

```svelte
        <div class="md:col-span-2 lg:col-span-3 flex flex-col gap-2">
          {#each pinnedOfficials as pin (pin._id)}
```

with

```svelte
        <div class="md:col-span-2 lg:col-span-3">
          {#if pinMode === 'folded'}
            <!-- Phones only: one bar for all pins. Same chrome and height as
                 a pin bar; the relative time gives way to the "+n" badge. -->
            <button
              type="button"
              data-pin-summary
              aria-expanded="false"
              aria-controls="forum-pin-stack"
              onclick={unfoldPins}
              class="md:hidden w-full text-left flex items-center gap-3 min-h-[36px] px-4 py-[5px] bg-ink text-paper border-[1.5px] border-teal rounded-lg shadow-[2px_2px_0_var(--k-teal)] focus:outline-none focus:ring-2 focus:ring-ink"
            >
              <span aria-hidden="true" class="text-[12px]">📌</span>
              <span class="shrink-0 font-dmmono text-[9px] uppercase tracking-[0.12em] text-[#7fc2ce]">{$t['pinned.bar.label']}</span>
              <span class="min-w-0 truncate font-bricolage text-[14px] font-bold tracking-[-0.01em]">{pinnedOfficials[0].title}</span>
              <span aria-hidden="true" class="ml-auto shrink-0 px-1.5 rounded-full border border-[#7fc2ce] font-dmmono text-[10px] leading-[16px] text-[#7fc2ce]">+{pinnedOfficials.length - 1}</span>
              <span class="sr-only">{($t['pinned.stack.more'] as string).replace('{n}', String(pinnedOfficials.length - 1))}</span>
              <span aria-hidden="true" class="shrink-0 text-[#7fc2ce] font-bold">▾</span>
            </button>
          {/if}
          <!-- 'hidden md:flex' must stay a literal string (Tailwind scan). -->
          <div id="forum-pin-stack" class={`flex-col gap-2 ${pinMode === 'folded' ? 'hidden md:flex' : 'flex'}`}>
          {#each pinnedOfficials as pin (pin._id)}
```

and replace the block's closing. It is the ONLY place in the file where these lines are directly followed by the comment `<!-- Regular feed. Per-topic moderation status drives placement:` — anchor on that comment (Python: include the blank line and the comment's first line in `old`, assert `count == 1`, and put them back unchanged in `new`):

```svelte
          {/each}
        </div>
      {/if}

      <!-- Regular feed. Per-topic moderation status drives placement:
```

becomes

```svelte
          {/each}
          </div>
          {#if pinMode === 'unfolded'}
            <button
              type="button"
              data-pin-fold
              aria-controls="forum-pin-stack"
              onclick={foldPins}
              class="md:hidden mt-1 ml-auto flex items-center gap-1 min-h-[36px] px-2 font-dmmono text-[10px] uppercase tracking-[0.12em] text-ink-mute focus:outline-none focus:ring-2 focus:ring-ink rounded"
            ><span aria-hidden="true">▴</span> {$t['pinned.stack.collapse']}</button>
          {/if}
        </div>
      {/if}

      <!-- Regular feed. Per-topic moderation status drives placement:
```

Extend the big HTML comment above the block („Pinned official announcements … Accordion v3 …") with one sentence at its end: `Phones (< md), 2026-09-20: with 2–3 pins the stack starts as ONE summary bar (data-pin-summary, "+n"); a tap unfolds these bars, "einklappen" folds them (pinMode / pinsUnfolded).`

- [ ] **Step 4: Dev-DB prep script**

The dev DB has 3 official announcements and (2026-09-20) none pinned. Create `scratchpad/dev-pin-officials.mts`:

```ts
// DEV ONLY: pins the three newest official announcements for 7 days so the
// forum's pin stack can be probed. Refuses any database without "dev".
import 'dotenv/config';
import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
const db = c.db();
if (!db.databaseName.includes('dev')) throw new Error(`refusing: ${db.databaseName}`);
const col = db.collection('announcements');
const ids = (await col.find({ isOfficial: true }, { projection: { _id: 1 } }).sort({ date: -1 }).limit(3).toArray()).map((d) => d._id);
const until = new Date(Date.now() + 7 * 864e5);
for (let i = 0; i < ids.length; i++) await col.updateOne({ _id: ids[i] }, { $set: { pinnedUntil: new Date(until.getTime() - i * 60000) } });
console.log(`db ${db.databaseName}: pinned ${ids.length} officials`);
await c.close();
```

Run: `npx tsx scratchpad/dev-pin-officials.mts` → expected `db mahalle-dev: pinned 3 officials`. (It prints no env value.)

- [ ] **Step 5: Probe**

Create `scratchpad/forum-pin-stack-probe.cjs`:

```js
// Pin stack: one summary bar on phones, three bars from 768px up. Dev server :4655, dev DB with 3 pins.
const { chromium } = require('playwright'); const fs = require('fs');
const BASE = process.env.PROBE_BASE || 'http://localhost:4655';
const EMAIL = process.env.PROBE_EMAIL || 'admin@mahalle-dev.test';
const PWFILE = process.env.PROBE_PWFILE || 'scratchpad/devpw.txt';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const shown = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
const visibleBars = (page) => page.evaluate(() => [...document.querySelectorAll('#forum-pin-stack button[aria-controls^="pin-card-"]')].filter((e) => e.getClientRects().length > 0).length);
// first regular feed card = the grid cell right after the pinned cell
const firstCardTop = (page) => page.evaluate(() => { const cell = document.querySelector('#forum-pin-stack').parentElement.nextElementSibling; return Math.round(cell.getBoundingClientRect().top + scrollY); });
async function open(b, width) {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, locale: 'de-DE', reducedMotion: 'reduce', hasTouch: width < 768 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login?redirect=%2Fforum`);
  await p.fill('input[type="email"]', EMAIL);
  await p.fill('input[type="password"]', fs.readFileSync(PWFILE, 'utf8').trim());
  await p.keyboard.press('Enter');
  await p.waitForURL('**/forum**', { timeout: 20000 });
  await p.waitForSelector('#forum-pin-stack', { state: 'attached', timeout: 20000 });
  await p.waitForTimeout(1200);
  return { ctx, p };
}
(async () => {
  const b = await chromium.launch();
  { // phone
    const { ctx, p } = await open(b, 390);
    ok('390: summary bar is visible', await shown(p, '[data-pin-summary]'));
    ok('390: the three bars start hidden', (await visibleBars(p)) === 0);
    ok('390: summary says +2', (await p.innerText('[data-pin-summary]')).includes('+2'));
    ok('390: summary is at least 36px high', await p.evaluate(() => document.querySelector('[data-pin-summary]').getBoundingClientRect().height >= 36));
    const foldedTop = await firstCardTop(p);
    await p.screenshot({ path: 'scratchpad/forum-pin-stack-390-folded.png' });
    await p.click('[data-pin-summary]');
    ok('390: tap unfolds three bars', (await visibleBars(p)) === 3);
    ok('390: summary is gone while unfolded', !(await shown(p, '[data-pin-summary]')));
    ok('390: fold control is visible', await shown(p, '[data-pin-fold]'));
    ok('390: focus moved to the first bar', await p.evaluate(() => document.activeElement?.getAttribute('aria-controls')?.startsWith('pin-card-') === true));
    const unfoldedTop = await firstCardTop(p);
    await p.locator('#forum-pin-stack button[aria-controls^="pin-card-"]').first().click(); await p.waitForTimeout(300);
    ok('390: a bar still opens its card', await shown(p, '[id^="pin-card-"]'));
    await p.click('[data-pin-fold]'); await p.waitForTimeout(200);
    ok('390: fold brings the summary back', await shown(p, '[data-pin-summary]'));
    ok('390: focus moved to the summary bar', await p.evaluate(() => document.activeElement?.hasAttribute('data-pin-summary') === true));
    await p.click('[data-pin-summary]'); await p.waitForTimeout(200);
    ok('390: no card is open after fold + unfold', !(await shown(p, '[id^="pin-card-"]')));
    ok('390: no sideways page scroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(`INFO  first post top: folded ${foldedTop}px, unfolded ${unfoldedTop}px, saved by the pin bar ${unfoldedTop - foldedTop}px`);
    await ctx.close();
  }
  for (const w of [800, 1280]) { // tablet + desktop unchanged
    const { ctx, p } = await open(b, w);
    ok(`${w}: no summary bar`, !(await shown(p, '[data-pin-summary]')));
    ok(`${w}: three bars without a tap`, (await visibleBars(p)) === 3);
    ok(`${w}: no fold control`, !(await shown(p, '[data-pin-fold]')));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 6: Run the probe**

```bash
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/forum-pin-stack-probe.cjs
```

Expected: `19 passed, 0 failed`, and an INFO line whose „saved by the pin bar" value is about 80–90 px (two 36 px bars + two 8 px gaps, minus nothing). LOOK at `scratchpad/forum-pin-stack-390-folded.png`: one ink bar with 📌, „AMTLICH", a truncated title, a „+2" badge and ▾; the „# Tags" chip from Task 2 in the row above it.

If the dev server from Task 2 is no longer running, start it as in Task 2 Step 6 first.

- [ ] **Step 7: Re-run Task 2's probe (the two features share the top of the page)**

```bash
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/forum-tags-chip-probe.cjs
```

Expected: `14 passed, 0 failed`.

- [ ] **Step 8: Gates, production build, stop the server, commit**

```bash
fuser -k 4655/tcp
npx tsx src/lib/forum/mobileChrome.test.ts        # 5 pass
pnpm type-check > /tmp/tsc.log 2>&1; grep -c 'error TS' /tmp/tsc.log                     # ≤ 26
pnpm exec svelte-check --output machine > /tmp/sc.log 2>&1; grep ' COMPLETED ' /tmp/sc.log  # N ERRORS ≤ 92
pnpm build 2>&1 | tail -5                          # green
git add src/components/forum/kiosk/ForumIndexInner.svelte src/lib/kiosk-i18n.ts
git commit -m "forum: on phones two or three pinned officials start as one bar that unfolds on tap"
```

---

### Task 4: Docs

**Files:**
- Modify: `src/components/forum/kiosk/CLAUDE.md` (the „Pinned slot on the forum index" bullet, ~line 60; add a TagBar sentence next to it)
- Modify: `src/components/tour/CLAUDE.md` (one note)
- Modify: `CLAUDE.md` (the `announcements` collection bullet mentions „renders all pins as slim collapsed bars")
- Modify: `docs/runbooks/debut-event-readiness.md` (the sentence added on 09-20 that says the idea was NOT approved)

**Interfaces:** consumes the DOM contract names from Tasks 2–3 (`data-tags-chip`, `#forum-tag-row`, `data-pin-summary`, `#forum-pin-stack`, `data-pin-fold`) and the helper names from Task 1.

- [ ] **Step 1: Forum area file**

Append to the end of the „**Pinned slot on the forum index**" bullet:

```
 **Phones (< md) since 2026-09-20:** with 2–3 pins the stack starts as ONE summary bar (`data-pin-summary`: newest title + „+n" badge, same 36px chrome); a tap unfolds the usual bars (`#forum-pin-stack`), „▴ einklappen" (`data-pin-fold`) folds them and closes any open card. Mode = pure `pinStackMode()` (`src/lib/forum/mobileChrome.ts`, tested); switching is CSS-only (`md:hidden` / `hidden md:flex` — keep those literal for Tailwind), state `pinsUnfolded` is per visit. From md up nothing changed. Probe: `scratchpad/forum-pin-stack-probe.cjs` (19 checks; needs 3 dev pins via `scratchpad/dev-pin-officials.mts`).
```

Add a new bullet directly after it:

```
- **Tag row on phones (2026-09-20):** below md the tag row is folded behind a „# Tags" chip (`data-tags-chip`, `aria-controls="forum-tag-row"`) that sits OUTSIDE the filter scroller so it is always in view; the chip names the active tag (`tagsChipLabel()`) and takes the pressed style, so a folded row never hides an active filter. From md up the chip is `display:none` and the row always shows. The chip carries `data-tour="forum-tag"`, so the tour's Tags stop lands on it on phones (first visible match) and on the first tag elsewhere. Probe: `scratchpad/forum-tags-chip-probe.cjs` (14 checks). User go: 2026-09-20 („ok, build 1 & 2"); measured gain for the first post ≈ 130 px.
```

Replace „≈ 130 px" with the two measured numbers if they differ (pin bar: the probe's INFO line; tag row: 40 px = row + `mt-2`).

- [ ] **Step 2: Tour area file**

Add under the section that explains anchors / `findAnchor` (visible-first lookup):

```
- **Forum „Tags" stop on phones (2026-09-20):** `[data-tour="forum-tag"]` exists twice — on the „# Tags" chip (phones, first in the DOM) and on the first tag pill. Visible-first lookup puts the ring on the chip below md and on the first tag from md up. The stop has a `bodyMobileKey` whose sentence is true with AND without the chip, because the tour's mobile copy breakpoint (< 1024 px) also covers tablets, which have no chip. Both anchors share one condition (`tags.length`), so the „anchors must be unconditional" rule is no worse off than before. Still 7 forum stops.
```

- [ ] **Step 3: Root `CLAUDE.md`**

In the `announcements` bullet, after „the forum index renders all pins as slim collapsed bars, one opening in place as a fused bar+card accordion — v3 2026-09-12" insert:

```
; on phones 2–3 pins start as ONE summary bar since 2026-09-20
```

- [ ] **Step 4: Runbook**

In `docs/runbooks/debut-event-readiness.md` replace the sentence that begins „(A combined pin bar + „# Tags" chip was proposed here by the assistant" through its closing parenthesis with:

```
(A combined pin bar + „# Tags" chip: proposed by the assistant 09-18, declined that night („ok, let us leave"), wrongly carried as „approved" until the user caught it on 09-20 — and then really approved the same evening („ok, build 1 & 2"). Built on `feat/forum-mobile-chrome`.)
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md src/components/forum/kiosk/CLAUDE.md src/components/tour/CLAUDE.md docs/runbooks/debut-event-readiness.md
git commit -m "docs: forum phone chrome — one pin bar, tags chip, tour anchor"
```

- [ ] **Step 6 (controller only, not a subagent): hand over**

Show the user the two 390 px screenshots and the measured gain; ask for „merge" / „push". Local memory (`project_open_followups.md`, `feedback_never_record_unquoted_approval.md` stays as is) and the handoff are updated by the controller after the user's decision.

---

## Audit record (2026-09-20, before execution)

Checked against the code, not assumed:
- `scrollFade` re-measures through its `ResizeObserver` when a `display:none` host gets a box, and `.kiosk-scroll-fade` in `global.css` sets no `display` (an unlayered `display` there would have beaten Tailwind's `hidden`). ✓
- `TagBar` has exactly one consumer (`ForumIndexInner`), so the new markup cannot surprise another page. ✓
- `findAnchor` is visible-first → the duplicated `data-tour="forum-tag"` is the documented pattern, not a hack. ✓
- CI counts errors with `grep -c 'error TS'` and svelte-check's machine `COMPLETED` line → the gate commands above now mirror it.

Changed by the audit:
1. **Tour copy** would have been wrong on phones (ring on the chip, sentence about tapping a tag) → Step 4b, `bodyMobileKey`.
2. **Focus loss**: the summary bar and the fold control remove themselves from the DOM when tapped → `unfoldPins()` / `foldPins()` hand the focus on; two probe checks added (19 total).
3. **Ambiguous replace** at the end of the pin block → anchored on the unique „Regular feed" comment.

## Decisions for the user

- **Tour sentence on phones and tablets** (Step 4b) — DECIDED 2026-09-20 20:07, the user's own wording: „Tags filtern Beiträge nach einem bestimmten Thema. Ein Tipp genügt, um die Auswahl ein- oder auszublenden." (The assistant's draft said „Auf dem Handy öffnet …"; the user: a person on a phone does not need to be told so.) English twin by the assistant. Execution: inline, on the user's word.

## Known limits (accepted, not tasks)

- Fold state is not restored on browser back: someone who unfolds the pins, opens a post and comes back sees the summary bar again (≈ 90 px less page height than the saved scroll position assumed). Same precedent as `expandedPinId`; members interact with pins at the top of the page, where the shift is invisible.
- Between 768 and 1023 px the tag row stays a second scroll row exactly as today — the user asked for phones only.
- No slide animation on fold/unfold (CSS `display` switch). Deliberate: no `matchMedia`, nothing to break under reduced motion.
