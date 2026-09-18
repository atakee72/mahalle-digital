# Mobile Masthead Hide-on-Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On phones and tablets (below the `lg` breakpoint) the ochre top bar slides away while the member scrolls down and comes back on the first scroll up; the bottom nav stays fixed.

**Architecture:** A pure, tested state function (`nextMastState`) decides hidden/visible from scroll positions. `KioskNav.svelte` feeds it from one rAF-throttled passive scroll listener and moves the sticky `<header>` by animating its `top` (never `transform` — the account menu and the notification panel are `position: fixed` children of the header, and a transform would become their containing block). The bar's current visible height is published as the CSS variable `--k-mast-offset`, so the two things docked under the bar (blog reading bar, mobile calendar "reveal" scroll) follow without knowing about scroll logic.

**Tech Stack:** Astro 5 SSR, Svelte 5 runes (`$state`, `$effect`, `untrack`), Tailwind 3.4, `node:test` via `npx tsx <file>`, Playwright (the copy bundled with the global `@playwright/cli`).

**Spec:** none on file — the decisions were made in conversation on 2026-09-19 and are recorded verbatim under Global Constraints.

## Global Constraints

- **Top bar only.** The bottom nav (`<nav class="lg:hidden fixed bottom-0 …">` in `KioskNav.svelte`) is not touched: it is the only place with Forum/Kalender/News/Markt/Kiez on phones, the mobile comment composer is anchored above it (`fixed bottom-12`), and iOS Safari's own toolbar already moves at that edge.
- **Below `lg` only** (`max-width: 1023.98px`). Desktop never hides the bar.
- **Always visible:** within the first 80 px of the page; on pages that do not scroll; while the account menu or the notification panel is open; while a tour card (`.tour-card`) is on screen; while keyboard focus (`:focus-visible`) is inside the header; right after every navigation (the island re-mounts).
- **Hide** after 24 px of continuous downward travel; **show** after 8 px of continuous upward travel ("first scroll up"). A single-frame jump larger than 600 px is a programmatic jump (scroll restore), not a gesture: it never changes the state.
- **No `transform`, `filter`, `will-change` or `contain` on the `<header>`** — see Architecture. Animate `top` on the sticky element.
- `prefers-reduced-motion: reduce` → the bar still hides/shows, without a transition.
- Admin pages (`AdminLayout`), auth pages (`AuthLayout`) and the landing page have their own headers and are out of scope.
- Error budgets must not rise: `pnpm type-check` ≤ 26 errors, `npx -y svelte-check@4` ≤ 92 errors.
- Commit messages: ONE line, no "Generated with" line, no Co-Authored-By line. `git add` specific files only, never `-A`.
- Never print any value from `.env` or from `scratchpad/devpw.txt`. Dev server on port 4655 only (`npx astro dev --port 4655`), stop it afterwards with `fuser -k 4655/tcp`. Do not start anything on port 3000.
- **No push and no merge to `main`** — that is the user's call, and not before Saturday 19 Sept 16:30 (deploy freeze for the market stand). Work in a worktree/branch created with superpowers:using-git-worktrees; suggested branch name `feat/mobile-masthead-hide`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/nav/hideOnScroll.ts` (create) | Pure decision logic + constants. No DOM access. |
| `src/lib/nav/hideOnScroll.test.ts` (create) | `node:test` suite for the above. |
| `src/components/forum/kiosk/KioskNav.svelte` (modify) | Scroll listener, locks, header `top`, publishes `--k-mast-h` / `--k-mast-offset`. |
| `src/components/blog/kiosk/BlogReadBar.svelte` (modify) | Docks at `var(--k-mast-offset)` instead of a measured constant. |
| `src/components/calendar/kiosk/mobile/CalendarMobileMonth.svelte` (modify) | `revealPanel()` aims at where the bar WILL be after its own scroll. |
| `scratchpad/masthead-hide-probe.cjs` (create, gitignored) | Headless browser verification. |
| `src/components/forum/kiosk/CLAUDE.md`, `CLAUDE.md` (modify) | Docs. |

---

### Task 1: Pure decision logic

**Files:**
- Create: `src/lib/nav/hideOnScroll.ts`
- Test: `src/lib/nav/hideOnScroll.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAST_HIDE_QUERY: string`
  - `TOP_ZONE = 80`, `HIDE_AFTER = 24`, `SHOW_AFTER = 8`, `TELEPORT = 600`
  - `interface MastState { hidden: boolean; lastY: number; anchorY: number; dir: -1 | 0 | 1 }`
  - `initialMastState(y?: number): MastState`
  - `nextMastState(prev: MastState, rawY: number, maxY: number, locked: boolean): MastState`
  - `mastBottomAfterScroll(delta: number, mastH: number, currentBottom: number, hides: boolean): number`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/nav/hideOnScroll.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialMastState, nextMastState, mastBottomAfterScroll,
  TOP_ZONE, HIDE_AFTER, SHOW_AFTER, type MastState,
} from './hideOnScroll';

const MAX = 5000;
// Feed a list of scroll positions, return the final state.
const run = (ys: number[], start: MastState, locked = false): MastState =>
  ys.reduce((s, y) => nextMastState(s, y, MAX, locked), start);
// Most cases start mid-page, just outside the top zone, with no travel yet.
const at100 = () => initialMastState(100);

test('inside the top zone the bar is always visible', () => {
  assert.equal(run([10, 40, TOP_ZONE], initialMastState(0)).hidden, false);
});

test('hides after HIDE_AFTER px of continuous downward travel', () => {
  const s = run([110, 100 + HIDE_AFTER - 1], at100());
  assert.equal(s.hidden, false, 'one px short of the threshold');
  assert.equal(nextMastState(s, 100 + HIDE_AFTER + 10, MAX, false).hidden, true);
});

test('shows again after SHOW_AFTER px of upward travel — the first scroll up', () => {
  const down = run([140, 180, 220], at100());
  assert.equal(down.hidden, true);
  assert.equal(nextMastState(down, 220 - (SHOW_AFTER - 1), MAX, false).hidden, true, 'finger jitter does not show it');
  assert.equal(run([220 - 4, 220 - SHOW_AFTER - 2], down).hidden, false);
});

test('a direction change restarts the travel count', () => {
  // 20 down, 4 up, 20 down: never 24 in one direction → still visible
  assert.equal(run([120, 116, 136], at100()).hidden, false);
});

test('returning to the top zone shows the bar whatever happened before', () => {
  const down = run([200, 300], at100());
  assert.equal(down.hidden, true);
  assert.equal(nextMastState(down, 60, MAX, false).hidden, false);
});

test('locked (menu open, tour, desktop …) forces visible and forgets the travel', () => {
  const down = run([200, 300], at100());
  const locked = nextMastState(down, 340, MAX, true);
  assert.equal(locked.hidden, false);
  assert.equal(nextMastState(locked, 350, MAX, false).hidden, false, 'needs a fresh 24 px after the lock');
});

test('iOS rubber band: negative y and y beyond the end are clamped', () => {
  assert.equal(nextMastState(initialMastState(0), -80, MAX, false).hidden, false);
  const atEnd = run([4960, MAX], initialMastState(4900));
  assert.equal(atEnd.hidden, true);
  assert.equal(nextMastState(atEnd, MAX + 90, MAX, false).hidden, true, 'overscroll past the end is not an upward scroll');
  assert.equal(nextMastState(atEnd, MAX + 90, MAX, false).lastY, MAX);
});

test('a programmatic jump (scroll restore) never changes the state', () => {
  assert.equal(nextMastState(initialMastState(0), 1500, MAX, false).hidden, false);
  const down = run([200, 300], at100());
  assert.equal(nextMastState(down, 2000, MAX, false).hidden, true);
});

test('a page that cannot scroll never hides the bar', () => {
  assert.equal(run([0, 0, 0], initialMastState(0)).hidden, false);
  assert.equal(nextMastState(initialMastState(0), 50, 0, false).hidden, false);
});

test('mastBottomAfterScroll predicts where the bar will be after a programmatic scroll', () => {
  assert.equal(mastBottomAfterScroll(200, 56, 56, true), 0, 'far enough down → the bar will be gone');
  assert.equal(mastBottomAfterScroll(-120, 56, -2, true), 56, 'up → the bar will be back');
  assert.equal(mastBottomAfterScroll(10, 56, 56, true), 56, 'a small move keeps the current state');
  assert.equal(mastBottomAfterScroll(10, 56, -2, true), 0, 'hidden bar: never a negative bottom');
  assert.equal(mastBottomAfterScroll(200, 67, 67, false), 67, 'desktop: the bar never hides');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx src/lib/nav/hideOnScroll.test.ts`
Expected: FAIL — `Cannot find module './hideOnScroll'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/nav/hideOnScroll.ts`:

```ts
/**
 * Hide-on-scroll for the kiosk masthead on phones/tablets. PURE — no DOM, so
 * it is unit-tested and safe to import from any island.
 *
 * Rules (user decision 2026-09-19): top bar only, below `lg` only; hide after
 * a deliberate scroll down, show on the FIRST scroll up; always visible near
 * the top of the page and whenever the caller says `locked`.
 */

/** Below Tailwind's `lg` — the viewports that get the bottom nav. */
export const MAST_HIDE_QUERY = '(max-width: 1023.98px)';

/** px from the top where the bar is always shown. */
export const TOP_ZONE = 80;
/** px of continuous DOWNWARD travel before the bar hides (a deliberate scroll, not a nudge). */
export const HIDE_AFTER = 24;
/** px of continuous UPWARD travel before it returns (more than finger jitter). */
export const SHOW_AFTER = 8;
/** A single-step jump larger than this is programmatic (scroll restore, anchor), not a gesture. */
export const TELEPORT = 600;

export interface MastState {
  hidden: boolean;
  /** Last clamped scroll position seen. */
  lastY: number;
  /** Where the current direction of travel started. */
  anchorY: number;
  dir: -1 | 0 | 1;
}

export const initialMastState = (y = 0): MastState => ({ hidden: false, lastY: y, anchorY: y, dir: 0 });

export function nextMastState(prev: MastState, rawY: number, maxY: number, locked: boolean): MastState {
  // iOS rubber-bands past both ends: clamp, or the bounce reads as a scroll the other way.
  const y = Math.min(Math.max(rawY, 0), Math.max(maxY, 0));
  if (locked || y <= TOP_ZONE) return { hidden: false, lastY: y, anchorY: y, dir: 0 };

  const step = y - prev.lastY;
  if (step === 0) return prev;
  if (Math.abs(step) > TELEPORT) return { ...prev, lastY: y, anchorY: y, dir: 0 };

  const dir: -1 | 1 = step > 0 ? 1 : -1;
  const anchorY = dir === prev.dir ? prev.anchorY : prev.lastY;
  const travel = Math.abs(y - anchorY);

  let hidden = prev.hidden;
  if (dir === 1 && travel >= HIDE_AFTER) hidden = true;
  if (dir === -1 && travel >= SHOW_AFTER) hidden = false;
  return { hidden, lastY: y, anchorY, dir };
}

/**
 * For code that scrolls the page so something lands "right under the masthead":
 * the scroll itself may hide or show the bar, so aim at where the bar WILL be.
 * `delta` = the scroll distance computed against the bar's current bottom
 * (positive = down); `hides` = whether this viewport hides the bar at all.
 */
export function mastBottomAfterScroll(delta: number, mastH: number, currentBottom: number, hides: boolean): number {
  if (!hides) return currentBottom;
  if (delta >= HIDE_AFTER) return 0;
  if (delta <= -SHOW_AFTER) return mastH;
  return Math.max(currentBottom, 0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx src/lib/nav/hideOnScroll.test.ts`
Expected: `pass 10`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/nav/hideOnScroll.ts src/lib/nav/hideOnScroll.test.ts
git commit -m "nav: pure hide-on-scroll decision logic for the mobile masthead"
```

---

### Task 2: Wire the masthead

**Files:**
- Modify: `src/components/forum/kiosk/KioskNav.svelte` (script block + the `<header …>` line, currently line 99)

**Interfaces:**
- Consumes (Task 1): `initialMastState`, `nextMastState`, `MAST_HIDE_QUERY` from `src/lib/nav/hideOnScroll`.
- Produces (for Task 3), both set on `document.documentElement`:
  - `--k-mast-h` — the header's full height in px, constant while the layout is stable (e.g. `56px`).
  - `--k-mast-offset` — the header's currently VISIBLE height: `--k-mast-h` when shown, `0px` when hidden.
  - the attribute `data-mast-hidden="true"` on the `<header>` while hidden (absent otherwise) — used by the probe in Task 4.

- [ ] **Step 1: Add the imports**

In `src/components/forum/kiosk/KioskNav.svelte`, directly under the line `import NotificationBell from './NotificationBell.svelte';` add:

```ts
  import { untrack } from 'svelte';
  import { initialMastState, nextMastState, MAST_HIDE_QUERY } from '../../../lib/nav/hideOnScroll';
```

- [ ] **Step 2: Add the state and the scroll wiring**

In the same file, directly under the line `let avatarEl = $state<HTMLElement | null>(null);` add:

```ts
  // ─── Hide-on-scroll (phones/tablets, 2026-09-19) ─────────────────────
  // The bar slides away on a deliberate scroll down and returns on the first
  // scroll up (rules + thresholds: lib/nav/hideOnScroll.ts). It moves by
  // animating the sticky header's `top` — NEVER transform: AvatarMenu's
  // bottom sheet and the notification panel are position:fixed CHILDREN of
  // this header, and a transformed ancestor becomes their containing block
  // (root CLAUDE.md, „backdrop-filter creates a containing block").
  let headerEl = $state<HTMLElement | null>(null);
  let mastHidden = $state(false);
  let mastH = $state(0);

  $effect(() => {
    const el = headerEl;
    if (!el) return;
    const root = document.documentElement;
    const mq = window.matchMedia(MAST_HIDE_QUERY);
    let st = initialMastState(window.scrollY);
    let raf = 0;

    const measure = () => {
      mastH = el.offsetHeight;
      root.style.setProperty('--k-mast-h', `${mastH}px`);
    };
    const apply = () => {
      raf = 0;
      // untrack: these reads must not turn this effect into a dependent of the
      // menu flags (it would tear down and re-subscribe on every menu toggle).
      const locked = untrack(
        () =>
          !mq.matches ||
          menuOpen ||
          bellOpen ||
          el.querySelector(':focus-visible') !== null ||
          document.querySelector('.tour-card') !== null
      );
      st = nextMastState(st, window.scrollY, root.scrollHeight - window.innerHeight, locked);
      mastHidden = st.hidden;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onResize = () => {
      measure();
      onScroll();
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    mq.addEventListener('change', onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      mq.removeEventListener('change', onScroll);
      root.style.removeProperty('--k-mast-h');
      root.style.removeProperty('--k-mast-offset');
    };
  });

  // Opening a menu, or keyboard focus entering the bar, brings it back at once
  // (the scroll handler only runs on scroll).
  $effect(() => {
    if (menuOpen || bellOpen) mastHidden = false;
  });

  // Published for whatever docks under the bar (BlogReadBar, calendar reveal).
  $effect(() => {
    document.documentElement.style.setProperty('--k-mast-offset', mastHidden ? '0px' : `${mastH}px`);
  });
```

- [ ] **Step 3: Move the header by its `top`**

Replace the line

```svelte
<header class="sticky top-0 {menuOpen || bellOpen ? 'z-50' : 'z-40'} border-b-2 border-ink" style="background: var(--k-ochre);">
```

with

```svelte
<header
  bind:this={headerEl}
  data-mast-hidden={mastHidden ? 'true' : undefined}
  onfocusin={() => (mastHidden = false)}
  class="sticky {menuOpen || bellOpen ? 'z-50' : 'z-40'} border-b-2 border-ink transition-[top] duration-200 ease-out motion-reduce:transition-none"
  style="background: var(--k-ochre); top: {mastHidden ? -(mastH + 2) : 0}px;"
>
```

(`+ 2`: the header's own `border-b-2` must leave the screen too. `top-0` is gone from the class list on purpose — the inline `top` replaces it, and the server-rendered value is `0px` because `mastHidden` starts `false`.)

- [ ] **Step 4: Run the gates**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → expected `26` or lower.
Run: `npx -y svelte-check@4 2>&1 | tail -1` → expected `… 92 ERRORS …` or lower.
If either number rose, read the new error and fix it in `KioskNav.svelte` — do not touch unrelated files.

- [ ] **Step 5: Smoke it by hand in a headless browser**

```bash
(SENTRY_DSN= TELEGRAM_BOT_TOKEN= npx astro dev --port 4655 > /tmp/dev4655.log 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:4655/login && break; sleep 1; done
cat > scratchpad/masthead-smoke.cjs <<'EOF'
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p.goto('http://localhost:4655/blog', { waitUntil: 'networkidle' });
  const top = () => p.evaluate(() => Math.round(document.querySelector('header').getBoundingClientRect().bottom));
  console.log('at top, header bottom:', await top());
  for (let i = 0; i < 12; i++) { await p.evaluate(() => window.scrollBy(0, 40)); await p.waitForTimeout(40); }
  await p.waitForTimeout(350);
  console.log('after 480px down, header bottom:', await top(), '(expected <= 0)');
  for (let i = 0; i < 2; i++) { await p.evaluate(() => window.scrollBy(0, -20)); await p.waitForTimeout(40); }
  await p.waitForTimeout(350);
  console.log('after 40px up, header bottom:', await top(), '(expected > 40)');
  await b.close();
})();
EOF
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/masthead-smoke.cjs
fuser -k 4655/tcp
```

Expected output: a positive number (≈ 56), then a number ≤ 0, then a number > 40. (`/blog` is public, so no login is needed for this smoke.)

- [ ] **Step 6: Commit**

```bash
git add src/components/forum/kiosk/KioskNav.svelte
git commit -m "nav: masthead hides on scroll down and returns on scroll up (below lg)"
```

---

### Task 3: The two things docked under the bar

**Files:**
- Modify: `src/components/blog/kiosk/BlogReadBar.svelte` (the root `<div style="… position: sticky; top: {topOffset}px; …">`, currently line 55–56)
- Modify: `src/components/calendar/kiosk/mobile/CalendarMobileMonth.svelte` (`revealPanel()`, currently lines 153–164, plus one import)

**Interfaces:**
- Consumes (Task 2): CSS variables `--k-mast-offset`, `--k-mast-h` on `document.documentElement`.
- Consumes (Task 1): `mastBottomAfterScroll(delta, mastH, currentBottom, hides)`, `MAST_HIDE_QUERY`.
- Produces: nothing new.

- [ ] **Step 1: Blog reading bar follows the masthead**

In `src/components/blog/kiosk/BlogReadBar.svelte` replace

```svelte
<div
  style="border-bottom: 1.5px solid var(--k-ink); background: var(--k-paper-warm); position: sticky; top: {topOffset}px; z-index: 30;"
>
```

with

```svelte
<!-- Docks under the masthead's VISIBLE height: KioskNav publishes --k-mast-offset
     (0px while the bar is hidden on phones, 2026-09-19). The measured topOffset
     stays as the fallback for the first paint before the island has run. -->
<div
  class="transition-[top] duration-200 ease-out motion-reduce:transition-none"
  style="border-bottom: 1.5px solid var(--k-ink); background: var(--k-paper-warm); position: sticky; top: var(--k-mast-offset, {topOffset}px); z-index: 30;"
>
```

Leave the `topOffset` measuring code in the `<script>` as it is.

- [ ] **Step 2: Calendar reveal aims at where the bar will be**

In `src/components/calendar/kiosk/mobile/CalendarMobileMonth.svelte`, add to the imports at the top of the `<script>` block (next to the other `../../../../lib/…` imports; count the `../` from an existing import in that file and use the same depth):

```ts
  import { mastBottomAfterScroll, MAST_HIDE_QUERY } from '../../../../lib/nav/hideOnScroll';
```

Then, inside `revealPanel()`, replace these two lines

```ts
    const mastheadBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    const delta = stepper.getBoundingClientRect().top - mastheadBottom - 8;
```

with

```ts
    // The scroll below may itself hide or show the masthead (hide-on-scroll,
    // 2026-09-19) — aim at where the bar WILL be, or the stepper lands a bar's
    // height too low (bar hides) or under it (bar returns).
    const header = document.querySelector('header');
    const currentBottom = header?.getBoundingClientRect().bottom ?? 0;
    const stepperTop = stepper.getBoundingClientRect().top;
    const mastheadBottom = mastBottomAfterScroll(
      stepperTop - Math.max(currentBottom, 0) - 8,
      header?.offsetHeight ?? 0,
      currentBottom,
      window.matchMedia(MAST_HIDE_QUERY).matches
    );
    const delta = stepperTop - mastheadBottom - 8;
```

- [ ] **Step 3: Run the gates**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → expected `26` or lower.
Run: `npx -y svelte-check@4 2>&1 | tail -1` → expected `92 ERRORS` or lower.
Run: `npx tsx src/lib/nav/hideOnScroll.test.ts` → `pass 10`, `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add src/components/blog/kiosk/BlogReadBar.svelte src/components/calendar/kiosk/mobile/CalendarMobileMonth.svelte
git commit -m "blog reading bar and calendar reveal follow the hiding masthead"
```

---

### Task 4: Browser verification and docs

**Files:**
- Create: `scratchpad/masthead-hide-probe.cjs` (gitignored — never staged)
- Modify: `src/components/forum/kiosk/CLAUDE.md` (section "Ochre masthead")
- Modify: `CLAUDE.md` (section "### Masthead + bottom nav (kiosk chrome, 2026-09-10)")

**Interfaces:**
- Consumes: `data-mast-hidden` on `<header>` (Task 2), `--k-mast-offset` (Task 2).
- Produces: a PASS/FAIL line per check; screenshots in `scratchpad/`.

- [ ] **Step 1: Write the probe**

Create `scratchpad/masthead-hide-probe.cjs`:

```js
// Hide-on-scroll verification. Logs in on the DEV server (dev DB) — the password
// file is read straight into fill() and never printed.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:4655';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scrollSteps = async (page, total, step = 40) => {
  for (let d = 0; d < Math.abs(total); d += step) { await page.evaluate((s) => window.scrollBy(0, s), Math.sign(total) * step); await page.waitForTimeout(35); }
  await page.waitForTimeout(350); // the 200 ms top transition
};
const bottom = (page) => page.evaluate(() => Math.round(document.querySelector('header').getBoundingClientRect().bottom));
const hiddenAttr = (page) => page.evaluate(() => document.querySelector('header').getAttribute('data-mast-hidden'));
async function login(page, redirect) {
  await page.goto(`${BASE}/login?redirect=${encodeURIComponent(redirect)}`);
  await page.fill('input[type="email"]', 'admin@mahalle-dev.test');
  await page.fill('input[type="password"]', fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim());
  await page.keyboard.press('Enter');
  await page.waitForURL(`**${redirect}**`, { timeout: 20000 });
  await page.waitForTimeout(1500); // client:only island
}

(async () => {
  const b = await chromium.launch();

  // ── phone, forum ──
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE' });
  const p = await phone.newPage();
  await login(p, '/forum');
  const h = await bottom(p);
  check('phone: bar visible at the top', h > 40 && (await hiddenAttr(p)) === null, `bottom=${h}`);
  await scrollSteps(p, 60);
  check('phone: still visible inside the top zone (60px)', (await bottom(p)) > 40);
  await scrollSteps(p, 400);
  check('phone: hidden after scrolling down', (await bottom(p)) <= 0 && (await hiddenAttr(p)) === 'true', `bottom=${await bottom(p)}`);
  await p.screenshot({ path: 'scratchpad/masthead-hidden-forum.png' });
  const navBox = await p.evaluate(() => { const n = [...document.querySelectorAll('nav')].find((x) => getComputedStyle(x).position === 'fixed'); const r = n.getBoundingClientRect(); return { bottom: Math.round(r.bottom), vh: innerHeight }; });
  check('phone: bottom nav did not move', navBox.bottom === navBox.vh, JSON.stringify(navBox));
  await scrollSteps(p, -20, 10);
  check('phone: back on the first scroll up (20px)', (await bottom(p)) > 40, `bottom=${await bottom(p)}`);
  await scrollSteps(p, 300);
  await scrollSteps(p, -2000);
  check('phone: visible again at the very top', (await bottom(p)) > 40 && (await p.evaluate(() => scrollY)) === 0);

  // menu lock: open the account menu, the bar must be visible and the sheet must be a full-width bottom sheet
  await scrollSteps(p, 400);
  await scrollSteps(p, -20, 10);
  await p.locator('header a[aria-expanded]').click(); // the avatar link (the bell is a <button>)
  await p.waitForTimeout(400);
  const sheet = await p.evaluate(() => { const el = document.querySelector('.am-menu'); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight }; });
  check('phone: account sheet is positioned against the VIEWPORT (no containing-block bug)', !!sheet && sheet.w >= sheet.vw - 2 && sheet.bottom >= sheet.vh - 2, JSON.stringify(sheet));
  check('phone: bar visible while the menu is open', (await bottom(p)) > 40);
  await p.keyboard.press('Escape');

  // ── phone, blog article: the reading bar follows ──
  const q = await phone.newPage();
  await q.goto(`${BASE}/blog/das-mahalle-manifest`, { waitUntil: 'networkidle' });
  const barTop = () => q.evaluate(() => { const el = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).position === 'sticky' && d.style.top.includes('--k-mast-offset')); return el ? Math.round(el.getBoundingClientRect().top) : null; });
  await scrollSteps(q, 900);
  check('blog: reading bar docks at the very top while the masthead is hidden', (await barTop()) === 0, `top=${await barTop()}`);
  await scrollSteps(q, -40, 10);
  const mast = await bottom(q);
  check('blog: reading bar sits right under the masthead when it returns', Math.abs((await barTop()) - mast) <= 1, `bar=${await barTop()} mast=${mast}`);
  await q.screenshot({ path: 'scratchpad/masthead-blog-shown.png' });

  // ── desktop never hides ──
  const desk = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await desk.goto(`${BASE}/blog`, { waitUntil: 'networkidle' });
  await scrollSteps(desk, 800);
  check('desktop: bar never hides', (await bottom(desk)) > 40 && (await hiddenAttr(desk)) === null);

  // ── reduced motion: still hides, no transition ──
  const rm = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
  await rm.goto(`${BASE}/blog`, { waitUntil: 'networkidle' });
  await scrollSteps(rm, 400);
  const dur = await rm.evaluate(() => getComputedStyle(document.querySelector('header')).transitionDuration);
  check('reduced motion: hides without a transition', (await bottom(rm)) <= 0 && (dur === '0s' || dur === ''), `duration=${dur}`);

  await b.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('PROBE ERROR', e.message); process.exit(2); });
```

Selectors used, all verified against the code on 2026-09-19: the avatar trigger is the only `<a aria-expanded>` inside `<header>` (`KioskNav.svelte`), the account menu's root is `.am-menu` (`AvatarMenu.svelte`; below `lg` it is a fixed bottom sheet, `.am-*` block in `src/styles/global.css`), and `/blog/das-mahalle-manifest` exists (`src/content/blog/das-mahalle-manifest.mdx`).

- [ ] **Step 2: Run the probe**

```bash
(SENTRY_DSN= TELEGRAM_BOT_TOKEN= npx astro dev --port 4655 > /tmp/dev4655.log 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:4655/login && break; sleep 1; done
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/masthead-hide-probe.cjs
fuser -k 4655/tcp
```

Expected: every line `PASS`, last line `12/12 passed`, exit code 0. On any `FAIL`: fix the code in the task that owns it (Task 2 for the bar itself, Task 3 for the reading bar), re-run the gates of that task, re-run the probe. Do not edit a check to make it pass.

- [ ] **Step 3: Check the mobile calendar reveal**

After a tap on a day, `revealPanel()` scrolls the month stepper "right under the masthead". With hide-on-scroll that scroll usually hides the bar, so the stepper must land 8 px below the TOP EDGE — not 8 px plus a bar's height. Create `scratchpad/masthead-cal-reveal.cjs`:

```js
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:4655';
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE' })).newPage();
  await p.goto(`${BASE}/login?redirect=%2Fcalendar`);
  await p.fill('input[type="email"]', 'admin@mahalle-dev.test');
  await p.fill('input[type="password"]', fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim());
  await p.keyboard.press('Enter');
  await p.waitForURL('**/calendar**', { timeout: 20000 });
  // :visible — the desktop grid coexists in the DOM below lg
  const stepper = p.locator('[data-tour="cal-month-nav"]:visible').first();
  await stepper.waitFor({ timeout: 20000 });
  const cells = p.locator('button[data-cell-date]:not([disabled]):visible');
  await cells.nth(Math.min(20, (await cells.count()) - 1)).click(); // a day in the lower half of the grid
  await p.waitForTimeout(1200); // smooth scroll + the 200 ms bar transition
  const m = await p.evaluate(() => {
    const s = [...document.querySelectorAll('[data-tour="cal-month-nav"]')].find((e) => e.getBoundingClientRect().height > 0);
    const h = document.querySelector('header').getBoundingClientRect();
    return { stepperTop: Math.round(s.getBoundingClientRect().top), headerBottom: Math.round(h.bottom), scrollY: Math.round(scrollY) };
  });
  const expected = Math.max(m.headerBottom, 0) + 8;
  const ok = Math.abs(m.stepperTop - expected) <= 4;
  console.log(`${ok ? 'PASS' : 'FAIL'}  stepper lands 8px under the visible masthead edge  — ${JSON.stringify(m)} expected≈${expected}`);
  await p.screenshot({ path: 'scratchpad/masthead-cal-reveal.png' });
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('PROBE ERROR', e.message); process.exit(2); });
```

Run it with the dev server up (same start/stop commands as Step 2):

```bash
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/masthead-cal-reveal.cjs
```

Expected: `PASS`. If the page did not need to scroll (the stepper was already in place, `scrollY` stays small) the check still holds — the bar is then visible and the stepper sits 8 px under it. Open `scratchpad/masthead-cal-reveal.png` and confirm the whole month grid is on screen.

- [ ] **Step 4: Docs**

In `src/components/forum/kiosk/CLAUDE.md`, at the end of the section whose heading contains "Ochre masthead", add this paragraph:

```markdown
**Hide on scroll (phones/tablets, 2026-09-19).** Below `lg` the top bar slides away after 24 px of continuous downward travel and returns after 8 px upward ("first scroll up"); always visible within the first 80 px, on pages that do not scroll, while the account menu / notification panel is open, while a `.tour-card` is on screen, and while `:focus-visible` is inside the bar. A single-step jump > 600 px (scroll restore) never changes the state. Logic is pure and tested (`src/lib/nav/hideOnScroll.ts`); `KioskNav.svelte` feeds it from one rAF-throttled passive scroll listener. **The bar moves by animating the sticky header's `top`, never `transform`** — AvatarMenu's bottom sheet and the notification panel are `position: fixed` children of the header, and a transformed ancestor would become their containing block. `KioskNav` publishes `--k-mast-h` (full height) and `--k-mast-offset` (currently visible height, `0px` while hidden) on `<html>`: anything that docks under the bar uses `top: var(--k-mast-offset)` (`BlogReadBar`), and anything that SCROLLS something "right under the masthead" asks `mastBottomAfterScroll()` where the bar will be after its own scroll (`CalendarMobileMonth.revealPanel`). The BOTTOM nav deliberately stays fixed (only place with the five surfaces on phones; the comment composer is anchored above it; iOS Safari's toolbar already moves at that edge). Probe: `scratchpad/masthead-hide-probe.cjs`.
```

In the root `CLAUDE.md`, in the section "### Masthead + bottom nav (kiosk chrome, 2026-09-10)", append this sentence to the end of its paragraph:

```markdown
 Since 2026-09-19 the top bar hides on scroll down / returns on scroll up below `lg` (bottom nav stays fixed; moves via `top`, never `transform`; publishes `--k-mast-offset`) — details in the same area file, „Hide on scroll".
```

- [ ] **Step 5: Final gates and commit**

Run: `npx tsx src/lib/nav/hideOnScroll.test.ts` → `pass 10`, `fail 0`.
Run: `pnpm type-check 2>&1 | grep -c "error TS"` → `26` or lower.
Run: `npx -y svelte-check@4 2>&1 | tail -1` → `92 ERRORS` or lower.
Run: `git status --short` → only the two `CLAUDE.md` files modified; nothing from `scratchpad/` listed.

```bash
git add src/components/forum/kiosk/CLAUDE.md CLAUDE.md
git commit -m "docs: mobile masthead hide-on-scroll"
```

- [ ] **Step 6: Hand back**

Report to the user: the probe's PASS list, the three screenshots (`scratchpad/masthead-hidden-forum.png`, `scratchpad/masthead-blog-shown.png`, `scratchpad/masthead-cal-reveal.png`), the branch name and its commits. Do NOT merge or push. The user wants to try it on a real phone for a few days before deciding about the bottom bar — say that a real-device pass (iOS Safari and Android Chrome) is still owed, because headless Chromium cannot reproduce iOS rubber-banding or Safari's collapsing toolbar.
