# Section-coloured masthead + bottom nav — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Written for the UI-polish PEER (worktree `.claude/worktrees/ui-polish`, branch `fix/ui-polish`, dev port 4656).

**Goal:** The kiosk masthead and the phone bottom nav take the current section's accent colour (user decision 2026-09-22 13:45, „option A — one colour for both bars"): Forum wine, Kalender teal, Kurier ink, Markt ochre (unchanged — „its title also includes that colour"), Kiez-Daten moss, Blog rust; Profil/Auth stay ochre; Admin stays plum (own layout, untouched).

**Architecture:** One CSS custom property `--k-bar` set per page on the `<html>`/layout root from the existing `data-page` attribute that `KioskLayout.astro` already renders (`page` prop); `KioskNav.svelte` paints both bars with `var(--k-bar, var(--k-ochre))` and switches its foreground tokens through a second property `--k-bar-fg` (ink on ochre, paper on every other colour). No per-section markup, no JS. Prototype and the user's choice: `scratchpad/bars-sheet-A-vs-B-phone.png` (main repo), produced with `page.addStyleTag` overrides — the selectors there are the map.

**Tech Stack:** Astro 5 layout + Svelte 5 island (`KioskNav.svelte` is mounted by the layout, so its `<style>`, if any, is route-linked — but the existing file uses Tailwind/inline styles; keep that), Tailwind 3.4, Playwright `.cjs` probes on port 4656.

**Spec:** the chat of 2026-09-22 13:09–13:45; the peer-independent facts below.

## Global Constraints

- Colour map (hex from `tailwind.config.mjs` / `tokens.css`; use the tokens, not literals, where a token exists): forum `var(--k-wine)` `#b23a5b`; calendar `var(--k-teal)` `#3f8f9f`; newsboard `var(--k-ink)` `#1b1a17`; marketplace `var(--k-ochre)` `#e8a53a`; schillerkiez `var(--k-moss)` `#6b8a4a`; blog `var(--k-rust)` `#a3552e`; profile + auth `var(--k-ochre)`; pages with no `data-page` (e.g. `/entwuerfe` carries `page="forum"`, `/bookmarks`, `/search`, `/nachbarn/*` — check each `.astro` page's `page` prop; whatever has none) fall back to ochre.
- Foreground: on ochre the bars keep today's ink text; on all other bar colours the wordmark, the tagline, the desktop nav items and the bottom-nav labels become paper `#f5efe0`. Elements that keep their own anatomy: the wine logo disc (on the wine bar it melts into the bar — give the disc a 2 px paper ring ONLY when `--k-bar-fg` is paper, so it stays a disc), the DE/EN pill (ink/paper, self-contained), the avatar disc and the bell disc (paper with ink border — on dark bars the ink border vanishes into the bar, which is fine).
- Active tab: masthead desktop pills are `bg-ink text-paper` when active — on the INK bar (Kurier) flip to `bg-paper text-ink`; on wine/teal/moss/rust keep ink. Bottom nav active tab is `bg-paper-warm text-ink` + bold — keep on every colour (verified in the prototype). Inactive bottom-nav labels: paper on coloured bars.
- Hover states: `hover:bg-paper-warm` on coloured bars would flash a light box; on non-ochre bars use `hover:bg-black/15` (or `hover:bg-white/15` on ink) — pick one that works on all five and keep it simple.
- The masthead's `border-b-2 border-ink` stays on every colour (on the ink bar it is invisible; acceptable).
- Hide-on-scroll (masthead moves via `top`, publishes `--k-mast-offset`) and the notification panel / avatar sheet (they read the masthead colour? — check `NotificationPanel.svelte`, `AvatarMenu.svelte` for `k-ochre`; the sheet head may be ochre by design — leave those as they are unless they visibly clash on a dark bar; report).
- The tour chrome stays ochre (deliberate, `src/components/tour/CLAUDE.md`).
- Root `CLAUDE.md` „Masthead + bottom nav" and „Page-accent rule" sections must be updated (Task 3); `src/components/forum/kiosk/CLAUDE.md` „Ochre masthead" gets a dated addendum.
- Gates: tsc ≤ 23, svelte-check ≤ 89, `pnpm build` green. One-line commits, no attribution lines, named `git add`, never push/merge, dev DB only, never print `.env`/password files.
- Dev server on **4656**; Playwright as in the previous plan (login as `ayse@mahalle-dev.test`, password from `../../scratchpad/devpw.txt` into `page.fill` only).

---

### Task 1: The property

**Files:** `src/layouts/KioskLayout.astro` (where `data-page={page}` is rendered), `src/styles/global.css` (or `tokens.css` — wherever `--k-ochre` etc. are declared; check `src/styles/`).

- [ ] Add to the stylesheet, next to the kiosk tokens:

```css
/* Section-coloured chrome (2026-09-22, user decision „one colour for both bars"):
   the masthead + bottom nav paint var(--k-bar); --k-bar-fg is their text colour.
   Default ochre/ink (Markt, Profil, Auth, pages without data-page). */
:root { --k-bar: var(--k-ochre); --k-bar-fg: var(--k-ink); }
[data-page="forum"]        { --k-bar: var(--k-wine); --k-bar-fg: var(--k-paper); }
[data-page="calendar"]     { --k-bar: var(--k-teal); --k-bar-fg: var(--k-paper); }
[data-page="newsboard"]    { --k-bar: var(--k-ink);  --k-bar-fg: var(--k-paper); }
[data-page="schillerkiez"] { --k-bar: var(--k-moss); --k-bar-fg: var(--k-paper); }
[data-page="blog"]         { --k-bar: var(--k-rust); --k-bar-fg: var(--k-paper); }
```

Confirm `data-page` sits on an ANCESTOR of the nav island (the layout's `<body>`/wrapper — `KioskLayout.astro:94`); if it sits on a sibling, move the attribute up to `<html>` or `<body>`.

- [ ] Commit: `chrome: --k-bar / --k-bar-fg per section`

### Task 2: Paint the bars

**Files:** `src/components/forum/kiosk/KioskNav.svelte` (masthead `style="background: var(--k-ochre)"` ~line 185 and bottom nav ~line 300; wordmark/tagline `text-ink` ~197/200; desktop pill classes ~213–214; bottom tab classes ~307–309; logo disc ~192).

- [ ] `background: var(--k-bar)` on both bars. Wordmark + tagline `color: var(--k-bar-fg)` (inline style or an arbitrary class `text-[color:var(--k-bar-fg)]`). Desktop inactive pills: `text-[color:var(--k-bar-fg)]` + the hover from the constraints; active pill: keep `bg-ink text-paper`, and on the ink bar flip — implement with a tiny derived: `const onInk = $derived(barIsInk)` where `barIsInk` reads `getComputedStyle(document.documentElement).getPropertyValue('--k-bar')` once on mount **or**, simpler and SSR-safe, add `[data-page="newsboard"] header nav a[aria-current="page"] { background: var(--k-paper); color: var(--k-ink); }` to the stylesheet next to the properties (the nav is inside the layout's `data-page` scope; this keeps the island free of page knowledge). Prefer the stylesheet rule. Logo disc: add `ring-2 ring-paper` only when `--k-bar-fg` is paper — again via stylesheet: `[data-page]:not([data-page="marketplace"]):not([data-page="profile"]):not([data-page="auth"]) header a[href="/"] > span:first-child { box-shadow: 0 0 0 2px var(--k-paper); }` — or set a third property `--k-bar-disc-ring: 0 0 0 2px var(--k-paper)` in the five coloured rules and `none` in `:root`, and use `style="box-shadow: var(--k-bar-disc-ring)"` on the disc (cleaner; do this).
- [ ] Bottom nav: inactive labels `color: var(--k-bar-fg)`; active tab unchanged.
- [ ] Probe `scratchpad/bars-probe.cjs` (worktree scratchpad), 390 and 1280: for each of `/forum`, `/calendar`, `/newsboard`, `/marketplace`, `/schillerkiez`, `/blog`, `/profile`: computed `background-color` of `header` and (390 only) of `nav[aria-label="Primary"]` equals the map; wordmark colour = paper on the five coloured sections, ink on marketplace/profile; the active desktop pill on `/newsboard` has paper background; contrast ratio of the inactive bottom-nav label against its bar ≥ 3.0 (compute from the two rgb values); no page errors. Screenshots `scratchpad/bars-<section>-390.png` and `-1280.png` + one contact sheet `scratchpad/bars-final-sheet.png` (ImageMagick, sections in rows, 390 | 1280 columns). Also one shot of the masthead mid-hide on a phone (scroll down 300 px on `/forum`) to confirm the moving bar keeps its colour, and one with the notification panel open on `/newsboard`.
- [ ] Gates; commit: `chrome: masthead and bottom nav in the section colour (Markt/Profil stay ochre)`

### Task 3: Docs

**Files:** root `CLAUDE.md` (sections „Masthead + bottom nav (kiosk chrome, 2026-09-10)" and „Page-accent rule (kiosk)": add the bar column / a sentence each, dated, with the user's decision and the Markt exception in his words), `src/components/forum/kiosk/CLAUDE.md` („Ochre masthead" → addendum with the property names, the ink-bar active-pill flip, the disc ring, the probe name).

- [ ] Commit: `docs: section-coloured bars`

### Report
Commits, the probe table, the contact-sheet path (absolute), gates, anything that clashed (panel/sheet heads, tour, hide-on-scroll), dev server stopped. Do not push or merge.
