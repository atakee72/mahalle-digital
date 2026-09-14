# Marketplace Shell Link Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the marketplace listing page's default (SSR) description the same short link labels the rest of the app got in `65ff7c2a`, so a long pasted URL no longer wraps raw across three lines on listing pages.

**Architecture:** The listing description has TWO render sites: the SSR shell in `src/pages/marketplace/[id].astro` (the default, untranslated view everyone sees) and the `MarketDetailInner.svelte` island (renders ONLY the translated variant). `65ff7c2a` changed the island only. This plan changes the shell's `.map()` to render the same anchor: `displayUrl()` label, full URL in `href` and `title`, an aria-hidden `↗` marker, `overflow-wrap: break-word`. No new helpers, no data change.

**Tech Stack:** Astro 5 SSR page (JSX-style expression in the template), `src/lib/linkify.ts` (`linkifySegments`, `displayUrl` — dependency-pure), playwright for the visual check.

**Spec:** No separate spec. Requirements come from the shipped forum/calendar behaviour (`src/components/forum/kiosk/CLAUDE.md` → „Display labels (2026-09-13)") and the marketplace gotcha (`src/components/marketplace/kiosk/CLAUDE.md` → „the description body has TWO render sites").

## Global Constraints

- Anchor contract (verbatim from the forum area file): anchor text is `displayUrl(url)`; full URL stays in `href` AND `title`; a `↗` span with `aria-hidden="true"` marks it external; wrap with `overflow-wrap: break-word` (Tailwind `break-words`), not `word-break: break-all`.
- Only `http(s)` URLs become anchors (already guaranteed by `linkifySegments`; do not add a second matcher).
- Astro template: the shell uses inline `style=""` attributes (no Tailwind classes on this page block) — keep the inline-style convention of the surrounding markup.
- Gates: `pnpm type-check` ≤ 26 errors, `npx -y svelte-check@4` ≤ 92 errors (both currently AT budget: 26 / 92 — a change that adds one error fails CI).
- Commit message: one line, no signature, no `Co-Authored-By`. Only `git add` the named files.
- Never print `scratchpad/devpw.txt` (dev password) — read it straight into `page.fill()`; never snapshot/screenshot a page while the password field is filled (fill it LAST, verify via `page.url()`).
- Do not start `pnpm dev` on port 3000 (user's). Use port 4655 and `fuser -k 4655/tcp` afterwards.
- Do NOT touch the island (`MarketDetailInner.svelte`) — it already has the new anchor.

---

### Task 1: Short link labels in the marketplace SSR shell

**Files:**
- Modify: `src/pages/marketplace/[id].astro:8` (import) and `:100-102` (the `.map()` in the description `<p>`)
- Modify: `src/components/marketplace/kiosk/CLAUDE.md` (close the „Bit us again 2026-09-13" note)
- Probe (gitignored, not committed): `scratchpad/mkt-links-probe.cjs`

**Interfaces:**
- Consumes: `linkifySegments(text: string): { type: 'text' | 'link'; value: string }[]` and `displayUrl(url: string, max = 40): string` from `src/lib/linkify.ts` (both exist, tested in `src/lib/linkify.test.ts`).
- Produces: nothing new. Later tasks: none.

- [ ] **Step 1: Confirm the gap on the dev server (the "failing test")**

Start the dev server on 4655 and create a listing with a long link as the admin seed account (admins skip AI moderation, so the listing is `approved` immediately — no OpenAI wait). Write `scratchpad/mkt-links-probe.cjs`:

```js
// Probe: marketplace listing page renders a long link as a short label in the SSR shell.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const BASE = process.env.BASE_URL || 'http://localhost:4655';
  const LONG = 'https://www.berlin.de/ba-neukoelln/aktuelles/pressemitteilungen/2026/pressemitteilung.1234567.php?utm_source=whatsapp&utm_medium=share&utm_campaign=kiez';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${BASE}/login?redirect=%2Fmarketplace`);
  await page.fill('input[type="email"]', 'admin@mahalle-dev.test');
  await page.fill('input[type="password"]', fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim());
  await page.click('button[type="submit"]');
  await page.waitForURL('**/marketplace', { timeout: 20000 });
  // Body shape per ListingCreateSchema (src/schemas/listing.schema.ts): description may be a plain
  // string; descriptionPlainText ≥ 20 chars; images ≥ 1 valid URL (admin skips image moderation);
  // 'gift' listings carry no price; delivery enum is German; specs is a required (empty) object.
  const desc = `Abholung hier beschrieben: ${LONG} — bitte melden.`;
  const c = await page.request.post(`${BASE}/api/listings/create`, { data: {
    title: 'Link-Probe Regal', description: desc, descriptionPlainText: desc,
    listingType: 'gift', category: 'moebel', delivery: 'abholung', specs: {},
    images: ['https://res.cloudinary.com/demo/image/upload/sample.jpg']
  } });
  const json = await c.json(); const id = json.listing?._id;
  console.log('create', c.status(), id);
  if (c.status() >= 300 || !id) { console.log(JSON.stringify(json).slice(0, 300)); process.exit(1); }
  await page.goto(`${BASE}/marketplace/${id}`);
  await page.waitForSelector('main');
  const a = page.locator('main a[href^="https://www.berlin.de"]').first();
  console.log('label:', JSON.stringify((await a.textContent()).trim()));
  console.log('title attr:', (await a.getAttribute('title') || '').length, 'chars');
  console.log('href:', (await a.getAttribute('href')).length, 'chars');
  await page.locator('main').first().screenshot({ path: 'scratchpad/mkt-links-detail.png' });
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() });
  await m.goto(`${BASE}/marketplace/${id}`); await m.waitForSelector('main'); await m.waitForTimeout(400);
  await m.screenshot({ path: 'scratchpad/mkt-links-mobile.png' });
  const del = await page.request.delete(`${BASE}/api/listings/delete/${id}`); console.log('cleanup', del.status());
  await browser.close();
})().catch((e) => { console.error(e.message.split('\n')[0]); process.exit(1); });
```

The body above was checked against `ListingCreateSchema` on 2026-09-14; if the create call still returns 400, print the Zod message and correct the body — never change the schema. The cleanup route is `DELETE /api/listings/delete/[id]`; leaving a test listing in the dev DB is not acceptable.

Run:

```bash
(pnpm dev --port 4655 > scratchpad/dev-4655.log 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}" http://localhost:4655/login | grep -q 200 && break; sleep 2; done
NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/mkt-links-probe.cjs
```

Expected BEFORE the fix: `label:` is the full 152-char URL, `title attr: 0 chars`.

- [ ] **Step 2: Change the shell**

In `src/pages/marketplace/[id].astro` line 8 replace

```ts
import { linkifySegments } from '../../lib/linkify';
```

with

```ts
import { linkifySegments, displayUrl } from '../../lib/linkify';
```

and replace lines 100–102 (the whole `.map()` expression inside the description `<p>`) with:

```astro
        {linkifySegments(bodyText).map((seg) => seg.type === 'link'
          ? <a href={seg.value} title={seg.value} target="_blank" rel="noopener noreferrer" style="color: var(--k-wine, #b23a5b); text-decoration: underline; text-underline-offset: 2px; overflow-wrap: break-word;">{displayUrl(seg.value)}<span aria-hidden="true" style="font-size: 0.8em; margin-left: 2px;">↗</span></a>
          : seg.value)}
```

Nothing else on the page changes.

- [ ] **Step 3: Re-run the probe**

```bash
NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/mkt-links-probe.cjs
```

Expected AFTER: `label: "berlin.de/ba-neukoelln/aktuelles…↗"`, `title attr: 152 chars`, `href: 152 chars`, `cleanup 200`. Look at both screenshots (`scratchpad/mkt-links-detail.png`, `scratchpad/mkt-links-mobile.png`): the label is one short underlined run with the arrow; no horizontal overflow on mobile.

- [ ] **Step 4: Gates**

```bash
pnpm type-check 2>&1 | grep -c "error TS"      # expected: 26
npx -y svelte-check@4 > scratchpad/svelte-check.log 2>&1; tail -1 scratchpad/svelte-check.log   # expected: … 92 ERRORS …
npx tsx src/lib/linkify.test.ts 2>&1 | grep -E "^# (pass|fail)"   # expected: pass 6, fail 0
fuser -k 4655/tcp
```

- [ ] **Step 5: Close the docs note**

In `src/components/marketplace/kiosk/CLAUDE.md`, replace

```
OPEN until the shell gets the same `displayUrl()` label.)
```

with

```
FIXED 2026-09-14: the shell's `.map()` now renders the same `displayUrl()` label, `title`, `↗` and `overflow-wrap: break-word` — both render sites match again.)
```

- [ ] **Step 6: Commit**

```bash
git add 'src/pages/marketplace/[id].astro' src/components/marketplace/kiosk/CLAUDE.md
git commit -m "fix(marketplace): short link labels in the SSR description shell"
git log -1 --format=%B   # must be exactly the one line above
```

Do not push. Report the two screenshot paths and the three gate numbers.

---

## Self-review

- Coverage: the only requirement (shell matches the island's anchor contract) is Task 1 Step 2; the docs gotcha is closed in Step 5; verification is Steps 1/3/4.
- Placeholders: none — the probe body was verified against `ListingCreateSchema` (string description + `descriptionPlainText`, `images` ≥ 1, `delivery: 'abholung'`, `specs: {}`) and the delete route (`/api/listings/delete/[id]`).
- Type consistency: `displayUrl(url: string, max = 40)` matches `src/lib/linkify.ts`; `linkifySegments` signature unchanged.
