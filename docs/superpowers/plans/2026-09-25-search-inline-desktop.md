# Masthead Search — Inline Field on Desktop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On wide screens (1280 px and up) a click on the masthead magnifier slides a search field out of the disc, inside the bar's right cluster; below that (phones, tablets, narrow laptops) the strip under the bar stays.

**Architecture:** `KioskNav.svelte` already owns `searchOpen`, `searchQ`, `searchEl`, `toggleSearch`/`closeSearch`/`submitSearch` and the Escape / outside-click effect (shipped 2026-09-24, `b7c076ee`). This plan adds ONE viewport flag (`wide`, from `matchMedia('(min-width: 1280px)')`) and renders the same `<form id="mast-search">` in one of two places: inline in the right cluster when `wide`, as the strip under the bar otherwise. Exactly one form is mounted at a time, so the existing bindings, ids and handlers work unchanged. The inline form animates its width on mount with a CSS keyframe (no state juggling), closes instantly (same ruling as the notification panel), and is 36 px tall so the bar's height never changes on desktop.

**Tech Stack:** Svelte 5 runes, CSS keyframes in `global.css` (nested-island rule), Playwright probe on the dev server :4655.

**Spec:** User request 2026-09-25 02:20 („i would like to have it now, too, style is important") on the deferred item „inline expansion on desktop" of `docs/superpowers/plans/2026-09-24-forum-search.md`; the earlier description he accepted: „a search field slides open in the bar, focus jumps in, Enter goes to `/search?q=…`, Esc or a click outside closes it".

## Global Constraints

- **One breakpoint: 1280 px (`xl`, = the bar's `max-w-7xl`)** — NOT `lg`. Measured on prod 2026-09-25 (`scratchpad/mast-space-probe.cjs`, logged in, forum page): the row uses 979 px (brand 231 + nav 494 + right cluster 221 + gaps); free space is −19 px at 1024, 57 at 1100, 157 at 1200, **237 from 1280** (the container caps at 1216 px inner). The inline field + its 12 px gap must fit into that 237 px → **220 px wide**, inline only from 1280. Below 1280: the strip exactly as shipped.
- **Bar height must not change** when the inline field opens (67 px stays 67 px): the inline form is 36 px tall like the discs, sits in the flex row of the right cluster, `overflow: hidden` during the width animation.
- **Styles in `src/styles/global.css`** (`.ms-*` block, nested-island rule) — no `<style>` in `MastSearch.svelte` or `KioskNav.svelte`.
- **Motion**: width 0 → 220 px + opacity, 200 ms ease-out, on mount only; instant close; nothing under `prefers-reduced-motion: reduce` (`@media (prefers-reduced-motion: reduce) { animation: none }`).
- **Behaviour unchanged**: focus into the field on open, Enter → full navigation to `/search?q=…` (2+ chars), Escape → close + focus back on the disc, outside click → close, `searchOpen` locks hide-on-scroll (only matters below `lg`, harmless above).
- **No second input ever mounted**: `{#if searchOpen && wide}` inline, `{:else if searchOpen}` strip. The `wide` flag comes from `matchMedia` and updates on `change`, so a window resized across 1280 px while open re-mounts the form on the other side (the query text stays in `searchQ`).
- **Gates before push**: tsc ≤ 23, svelte-check ≤ 89, `pnpm build` green, `scratchpad/mast-search-probe.cjs` all green on both widths. Commits one line, only named files staged. Push on the user's word; freeze Fri 25 Sept evening → Sat 16:30.

## Review Focus

1. **Bar height on wide screens while open**: `--k-mast-h` must read the same value before and after the click (67 px), otherwise the sticky offset consumers (`BlogReadBar`, calendar reveal) jump. Pinned in Task 1's probe (`desktop: --k-mast-h unchanged`).
2. **Resize across 1280 px with the field open**: the form re-mounts on the other side, the typed text survives, no duplicate `#mast-search`. Pinned in Task 1's probe (`resize keeps query, one form`).
3. **The DE/EN pill, bell and avatar must not shift, wrap or leave the container** when the field appears: the row is a no-wrap flex with `shrink-0` on both ends, so anything that does not fit pushes the right cluster past the edge. Measured free space is 237 px from 1280 (see Global Constraints); 220 px + 12 px gap = 232 fits with 5 px to spare, and the brand/nav widths are fixed text. Pinned in Task 1's probe at exactly 1280 px (`one row, right cluster inside the container`) and at 1024 px (`strip, not inline`).
4. **Reduced motion**: field appears at full width at once. Pinned by CSS inspection in Task 1 (probe with `reducedMotion: 'reduce'` context checks computed `animation-name: none`).
5. **Escape with the field open on desktop returns focus to the disc, and a click on the disc while open closes (toggle)**. Already covered by the shipped probe steps; they run again unchanged.

---

### Task 1: Inline form on `lg+`, strip below — code + probe

**Files:**
- Modify: `src/components/forum/kiosk/KioskNav.svelte` (script: `wide` flag; markup: inline form in the right cluster, strip gated by `!wide`)
- Modify: `src/styles/global.css` (`.ms-inline*` rules after `.ms-close:hover`)
- Modify: `scratchpad/mast-search-probe.cjs` (desktop branch expects the inline form; new checks 1–4 above)

**Interfaces:**
- Consumes (existing in `KioskNav.svelte`): `searchOpen`, `searchQ`, `searchEl`, `toggleSearch()`, `closeSearch(restoreFocus)`, `submitSearch(e)`, the `$effect` that listens for Escape / outside `pointerdown` and looks up `#mast-search` and `[data-mast-search-btn]` inside `headerEl`; `MastSearch` props `{ open, onToggle, currentPath }`.
- Produces: nothing new for other files. The form id stays `mast-search` in both placements.

- [ ] **Step 1: `wide` flag in the script** (right after `let searchQ = $state('');`)

```ts
  // Placement of the search form: inline in the right cluster from 1280 px
  // (the bar's max width — measured 2026-09-25: only there is the row's free
  // space ≥ 237 px; at 1024 it is already −19), the strip under the bar below.
  // One form is mounted at a time, so bindings and ids stay single.
  const WIDE_QUERY = '(min-width: 1280px)';
  let wide = $state(false);
  $effect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const sync = () => (wide = mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });
```

Also: when the form re-mounts on a resize, focus should follow it. Extend `toggleSearch` — no; add one effect instead (keeps `toggleSearch` as is):

```ts
  // Re-focus when the form changes side (resize across 1280 px while open).
  $effect(() => {
    if (!searchOpen) return;
    void wide; // dependency
    tick().then(() => searchEl?.focus());
  });
```

(`tick` is already imported.)

- [ ] **Step 2: Markup — inline form in the right cluster**

In the right cluster `<div class="flex items-center gap-3 shrink-0">`, directly BEFORE `<MastSearch open={searchOpen} …/>` (so the field opens to the LEFT of the disc), add:

```svelte
        {#if searchOpen && wide}
          <!-- Desktop: the field slides out of the disc, inside the bar (user, 2026-09-25).
               Same id as the strip: exactly one of the two is mounted. -->
          <form id="mast-search" class="ms-inline" role="search" onsubmit={submitSearch}>
            <label class="ms-field ms-field--inline">
              <span class="font-dmmono text-[14px] text-ink-mute" aria-hidden="true">⌕</span>
              <input bind:this={searchEl} bind:value={searchQ} type="text" inputmode="search" enterkeyhint="search" maxlength="80" autocomplete="off" placeholder={$t['nav.search.placeholder']} aria-label={$t['nav.search.aria']} />
            </label>
          </form>
        {/if}
```

And the strip's guard at the end of `<header>` changes from `{#if searchOpen}` to `{#if searchOpen && !wide}` (markup inside unchanged).

Note: the inline form has NO close button — the disc itself (now `aria-expanded="true"`, active style) is the toggle, Escape and outside click close; the strip keeps its `×` because on phones the disc is far from the thumb.

- [ ] **Step 3: CSS** — append after `.ms-close:hover { … }` in `global.css`:

```css
/* Wide placement (≥ 1280 px, JS-gated): the field slides out of the disc,
   inside the bar's right cluster. 36 px tall like the discs, so the bar keeps
   its height. 220 px = what the row's measured free space (237 px) allows
   next to the 12 px gap — wider pushes bell and avatar out of the container. */
.ms-inline {
  display: flex; align-items: center; height: 36px; overflow: hidden;
  width: 220px;
  animation: ms-inline-in 200ms ease-out both;
}
.ms-field--inline { height: 36px; padding: 0 12px; }
.ms-field--inline input { font-size: 14px; }
@keyframes ms-inline-in {
  from { width: 0; opacity: 0; }
  to   { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) { .ms-inline { animation: none; } }
```

`to { opacity: 1 }` without a width lets the keyframe end at the rule's own width (220) — the animation interpolates from 0 to the computed width.

Check once in the browser that the animation really interpolates the width (Chrome does when `from` sets `width: 0` and `to` omits it — it uses the element's computed value). If it snaps instead, write `to { width: 220px; opacity: 1 }`.

- [ ] **Step 4: Probe** — edit `scratchpad/mast-search-probe.cjs`:

1. In the loop header the widths become: `['desktop', {1400×900}]`, `['edge', {1280×800}]` (the exact breakpoint, inline), `['laptop', {1024×800}]` (strip), `['phone', {390×844}]`.
2. Replace the two lines after `await btn.click(); await p.waitForTimeout(350);` (the `strip open + focused` and `--k-mast-h grew` checks) with a branch:

```js
    const isWide = vw.width >= 1280;
    const mastBefore = await p.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--k-mast-h')));
    await btn.click(); await p.waitForTimeout(350);
    check(`${name}: form open + focused`, (await p.locator('#mast-search input').isVisible()) && (await p.evaluate(() => document.activeElement?.closest('#mast-search') !== null)));
    check(`${name}: exactly one #mast-search`, (await p.locator('#mast-search').count()) === 1);
    const mastAfter = await p.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--k-mast-h')));
    if (isWide) {
      check(`${name}: inline (inside the right cluster, not a strip)`, await p.evaluate(() => !!document.querySelector('#mast-search.ms-inline') && !document.querySelector('#mast-search.ms-strip')));
      check(`${name}: --k-mast-h unchanged`, mastAfter === mastBefore, `${mastBefore}→${mastAfter}`);
      const w = await p.locator('#mast-search').evaluate((e) => e.getBoundingClientRect().width);
      check(`${name}: field width 220`, Math.abs(w - 220) <= 1, String(w));
      const inside = await p.evaluate(() => { const row = document.querySelector('header > div'); const right = row.lastElementChild.getBoundingClientRect(); const box = row.getBoundingClientRect(); return right.right <= box.right - parseFloat(getComputedStyle(row).paddingRight) + 0.5; });
      check(`${name}: right cluster stays inside the container`, inside);
      const rows = await p.evaluate(() => { const els = [...document.querySelectorAll('header a[href="/"], header #mast-search, header [data-mast-search-btn], header .nc-bell, header a[href="/profile"]')]; return [...new Set(els.map((e) => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 4); }))].length; });
      check(`${name}: no wrap — logo, field, disc, bell, avatar on one row`, rows === 1, String(rows));
    } else {
      check(`${name}: strip under the bar`, await p.evaluate(() => !!document.querySelector('#mast-search.ms-strip')));
      check(`${name}: --k-mast-h grew with the strip`, mastAfter > mastBefore, `${mastBefore}→${mastAfter}`);
    }
```

3. After the Escape check, add the resize test for desktop only:

```js
    if (isWide) {
      await btn.click(); await p.locator('#mast-search input').fill('fahr'); await p.waitForTimeout(100);
      await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
      check(`${name}: resize to phone keeps the query in the strip`, (await p.locator('#mast-search.ms-strip input').inputValue()) === 'fahr' && (await p.locator('#mast-search').count()) === 1);
      await p.setViewportSize(vw); await p.waitForTimeout(400);
      check(`${name}: resize back → inline again, query kept`, (await p.locator('#mast-search.ms-inline input').inputValue()) === 'fahr');
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    }
```

4. Reduced motion, once, in a separate context after the loop (before `await b.close()`):

```js
  {
    const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' })).newPage();
    await p.goto('http://localhost:4655/login?redirect=%2Fforum');
    await p.fill('input[type="email"]', 'jonas@mahalle-dev.test'); await p.fill('input[type="password"]', fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim());
    await p.keyboard.press('Enter'); await p.waitForURL((u) => u.pathname === '/forum'); await p.waitForTimeout(1200);
    await p.locator('[data-mast-search-btn]:visible').first().click(); await p.waitForTimeout(50);
    check('reduced motion: no animation, full width at once', await p.locator('#mast-search').evaluate((e) => getComputedStyle(e).animationName === 'none' && e.getBoundingClientRect().width >= 219));
    await p.close();
  }
```

5. The existing `Enter → /search?q=der` and `on /search the disc is a link, no strip` checks stay as they are (they hold for both placements).

- [ ] **Step 5: Run**

```bash
(pnpm dev --port 4655 > /dev/null 2>&1 &); sleep 12
NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/mast-search-probe.cjs
cp scratchpad/mast-search-desktop-open.png /mnt/c/Users/atakee/Downloads/mast-search-desktop-inline.png
fuser -k 4655/tcp
```
Expected: all green at 1400, 1280, 1024 and 390, plus the reduced-motion check. Look at the desktop shot: the paper pill sits between the DE/EN pill and the ink-filled disc, bar height unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/forum/kiosk/KioskNav.svelte src/styles/global.css
git commit -m "masthead search: from 1280 px the field slides out of the disc inside the bar; below that the strip stays"
```

---

### Task 2: Gates + docs

**Files:**
- Modify: `src/components/forum/kiosk/CLAUDE.md` (the „Search" section's entry-point sentence)
- Modify: `docs/superpowers/plans/2026-09-24-forum-search.md` (no edit — history stays)

- [ ] **Step 1: Gates**

```bash
pnpm type-check 2>&1 | grep -c "error TS"      # ≤ 23
npx -y svelte-check@4 2>&1 | tail -1           # ERRORS ≤ 89
pnpm build 2>&1 | tail -2                      # Complete!
```

- [ ] **Step 2: Doc** — in `src/components/forum/kiosk/CLAUDE.md`, section „Search (2026-09-24)", replace

`opens a strip under the bar on every width (user decision „strip under the bar“; the inline desktop expansion is a possible refinement)`

with

`opens the field INLINE in the right cluster from 1280 px (2026-09-25, user: „style is important“ — 220 px, the row's measured free space at the bar's max width is 237 px and −19 px at 1024, so `lg` was not an option; slides out of the disc in 200 ms, bar height unchanged, no close button: disc/Escape/outside click close) and a strip under the bar below 1280 (with a × the thumb can reach). One `<form id="mast-search">`, mounted in one of the two places by a `matchMedia('(min-width: 1280px)')` flag; a resize across 1280 px re-mounts it on the other side and keeps the typed text; measurement script `scratchpad/mast-space-probe.cjs``

- [ ] **Step 3: Commit, hand over, push on the user's word**

```bash
git add src/components/forum/kiosk/CLAUDE.md
git commit -m "docs: masthead search inline on desktop"
```

Report the probe counts, the gate numbers and the desktop screenshot; push only when he says so; afterwards check `/forum` on prod once with the throwaway account (disc present, `#mast-search.ms-inline` after a click at 1400 px).
