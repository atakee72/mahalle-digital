# One Drafts Page (Forum + Markt) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One page, `/entwuerfe`, lists ALL of a member's unfinished things — forum drafts and marketplace draft listings — with „weiterschreiben" and „löschen"; the account-menu row „Meine Entwürfe" and a link in the profile's Archive lead there.

**Architecture:** A read-only union page. Both kinds already have storage, a resume URL and a delete route (`postDrafts` + `/api/posts/drafts/<id>` since 2026-09-21; `listings` with `status:'draft'` + `/api/listings/delete/<id>`). A pure mapper turns both shapes into one `UnifiedDraft` row; the `.astro` page SSR-fetches both lists (each in its own `try`, so one failing source never blanks the page) and hands the merged list to one Svelte island. Nothing about saving, publishing or the two existing in-place sections (forum „Meine", market „Meine") changes.

**Tech Stack:** Astro 5 SSR page, Svelte 5 island (`client:only="svelte"`, like every kiosk island — the locale lives in localStorage, so server-rendering the texts would flash German at English readers), MongoDB driver (server only), Tailwind, `node:test` via `npx tsx --test`, standalone Playwright probe.

**Spec:** none — decided in chat on 2026-09-21. User: „you put it under the my drafts menu item - but it brings one to forum again -- what about draft listing?" → I named two fixes → user: „that ‚the menu row points at only one of them' is not good ui" → `/superpowers:writing-plans do the better option: a single drafts page with both kinds`. The „Design decisions" below are the binding authority.

## Design decisions (binding)

1. Route `/entwuerfe` (German slug, like `/steckbrief`, `/nachbarn`). Login-gated in `src/middleware.ts` (`GATED_PAGES`) AND in the page's frontmatter (`/login?redirect=/entwuerfe`), same belt-and-braces as `/bookmarks`.
2. One merged list, newest change first. Each row: source chip („FORUM" wine / „MARKT" wine-outline — the market shares the forum's wine by the accent rule, so the chips differ by fill, not colour) · kind word (Diskussion / Empfehlung / Ankündigung · Verkaufen / Tausch / Verschenken) · optional 44 px thumbnail (first image) · title or „Ohne Titel" · „zuletzt geändert <relTime>" · „weiterschreiben" (link) · „löschen" (button, `confirmAction`, `variant: 'danger'`).
3. Resume: forum → `/topics/create?draft=<id>`; market → `/marketplace/create?draft=<id>`. Delete: forum → `DELETE /api/posts/drafts/<id>`; market → `DELETE /api/listings/delete/<id>` (the route the market's own drafts section already uses). A `404` on delete counts as done (the draft is gone either way).
4. No „veröffentlichen" button on this page — publishing needs the form (validation, moderation modal). The market's own section keeps its publish pill; this page does not copy it.
5. Empty state: one sentence + two buttons („+ neues Thema" → `/topics/create`, „+ neue Anzeige" → `/marketplace/create`).
6. If ONE source fails on the server, the page shows the other and a one-line note („Ein Teil der Entwürfe ließ sich gerade nicht laden."); if both fail, the note plus the empty-state buttons. Never a 500 page for a list.
7. Accent: ochre (`page="profile"` — it is a personal page). The tour must NOT run here: `CHAPTERS_BY_PAGE['profile']` would show the „Neu hier?" offer for the Profil chapter although none of its anchors exist on this page (starting it does nothing). `KioskLayout` gets an optional prop `tour` (default `true`); `/entwuerfe` passes `tour={false}`. (`/bookmarks` and `/search` have the same latent problem with `page="forum"` — NOT in this plan, recorded as an observation.) Known cost: the account menu's „Führung" row calls `window.__mahalleTourStart?.()`, which does not exist without the controller, so on `/entwuerfe` that row does nothing — exactly what it already does on every page without tour anchors (detail pages, compose pages, `/bookmarks`, `/search`: `startChapter()` returns when no stop is available). Not made worse, not fixed here.
8. Layout rules of the house: the 1280 px column (`<div class="mx-auto w-full max-w-[1280px]">`), side inset `px-4 md:px-9 lg:px-10`, kicker 20/24 px under the masthead (`pt-5 md:pt-6`), title 34 px below 380 px / 36 px from 380 px / larger from `md`.
9. Entry points: account menu „Meine Entwürfe" → `/entwuerfe` (was `/forum?kind=mine`); profile Archive, own view only: a link chip „Entwürfe →" after „◈ Gespeichert" → `/entwuerfe` (a LINK, not a data filter — the ledger's API stays untouched). The forum's and the market's own „Entwürfe" sections stay where they are.
10. After „als Entwurf speichern" the forum still goes to `/forum?kind=mine&draft_saved=1` (its toast says „du findest ihn hier unter ‚Meine'" and that stays true). No change to either compose flow.
11. Out of scope: drafts for calendar and News, counts/badges anywhere, bulk delete, a data filter inside the profile ledger, fixing the tour offer on `/bookmarks` + `/search`.

## Global Constraints

- Commit messages: one line, no „Generated with Claude Code", no Co-Authored-By. `git add` named files only; never `.env`, never `scratchpad/`.
- Branch `feat/drafts-page`; merge and push only on the user's word.
- Never print a value from `.env`; never echo `scratchpad/devpw.txt`.
- Dev database only. Own dev server: `SENTRY_DSN= TELEGRAM_BOT_TOKEN= pnpm astro dev --port 4655`; stop with `fuser -k 4655/tcp`.
- Gates before each commit of app code, numbers must not rise: `pnpm type-check > /tmp/tsc.log 2>&1; grep -c 'error TS' /tmp/tsc.log` ≤ 26 · `pnpm exec svelte-check --output machine 2>/dev/null | grep ' COMPLETED '` ≤ 92 errors · `pnpm build` exits 0.
- A file imported by both server and client stays dependency-pure (no `mongodb`).
- UI copy is an OFFER; list every new key in the final report.
- Probes never read a Playwright response body for DELETE calls (it hung on 2026-09-21) — assert on the DOM and on a follow-up `fetch` inside the page.

---

### Task 1: One row shape for both kinds

**Files:**
- Create: `src/lib/drafts/unifiedDrafts.ts`
- Create: `src/lib/drafts/unifiedDrafts.test.ts`

**Interfaces:**
- Consumes: `PostDraftDTO` from `src/lib/forum/postDrafts.ts`, `draftResumeHref(id)`.
- Produces: `type UnifiedDraft`, `fromPostDraft(d: PostDraftDTO): UnifiedDraft`, `fromListingDraft(l: ListingDraftLike): UnifiedDraft`, `mergeDrafts(...lists: UnifiedDraft[][]): UnifiedDraft[]`.

- [ ] **Step 1: Failing test** — `src/lib/drafts/unifiedDrafts.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromListingDraft, fromPostDraft, mergeDrafts } from './unifiedDrafts';

const post = { id: '64f000000000000000000001', kind: 'announcement' as const, title: ' Kiez-Daten ', body: 'x', tags: [], images: [{ url: 'https://res.cloudinary.com/x/mahalle/posts/a.jpg', publicId: 'mahalle/posts/a' }], createdAt: '2026-09-21T08:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z' };

test('a forum draft becomes a row', () => {
  assert.deepEqual(fromPostDraft(post), {
    id: '64f000000000000000000001', source: 'forum', kindKey: 'chip.announcement', title: 'Kiez-Daten',
    updatedAt: '2026-09-21T10:00:00.000Z', thumb: 'https://res.cloudinary.com/x/mahalle/posts/a.jpg',
    resumeHref: '/topics/create?draft=64f000000000000000000001', deleteUrl: '/api/posts/drafts/64f000000000000000000001'
  });
});

test('a draft listing becomes a row — ObjectId-like id, Date, missing fields', () => {
  const row = fromListingDraft({ _id: { toString: () => '64f0000000000000000000aa' }, title: undefined, listingType: 'gift', images: [], updatedAt: new Date('2026-09-20T09:00:00.000Z'), createdAt: new Date('2026-09-19T09:00:00.000Z') });
  assert.deepEqual(row, {
    id: '64f0000000000000000000aa', source: 'markt', kindKey: 'market.filter.kind.verschenken', title: '',
    updatedAt: '2026-09-20T09:00:00.000Z', thumb: null,
    resumeHref: '/marketplace/create?draft=64f0000000000000000000aa', deleteUrl: '/api/listings/delete/64f0000000000000000000aa'
  });
  assert.equal(fromListingDraft({ _id: 'a'.repeat(24), listingType: 'exchange', images: ['https://res.cloudinary.com/x/l.jpg'], createdAt: '2026-09-01T00:00:00.000Z' }).kindKey, 'market.filter.kind.tausch');
  assert.equal(fromListingDraft({ _id: 'a'.repeat(24), createdAt: '2026-09-01T00:00:00.000Z' }).kindKey, 'market.filter.kind.verkaufen'); // default type = sell
  assert.equal(fromListingDraft({ _id: 'a'.repeat(24), createdAt: '2026-09-01T00:00:00.000Z' }).updatedAt, '2026-09-01T00:00:00.000Z'); // falls back to createdAt
});

test('merge: newest change first, across both kinds', () => {
  const a = fromPostDraft(post);
  const b = fromListingDraft({ _id: 'b'.repeat(24), title: 'Fahrrad', updatedAt: '2026-09-21T12:00:00.000Z' });
  const c = fromListingDraft({ _id: 'c'.repeat(24), title: 'Alt', updatedAt: '2026-08-01T12:00:00.000Z' });
  assert.deepEqual(mergeDrafts([a], [c, b]).map((d) => d.title), ['Fahrrad', 'Kiez-Daten', 'Alt']);
  assert.deepEqual(mergeDrafts(), []);
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx tsx --test src/lib/drafts/unifiedDrafts.test.ts` → module not found.

- [ ] **Step 3: Implement** — `src/lib/drafts/unifiedDrafts.ts`:

```ts
// One row shape for everything a member has left unfinished — forum drafts
// (`postDrafts`) and marketplace draft listings (`listings`, status 'draft').
// Dependency-pure: imported by the /entwuerfe page (server) AND its island.
import { draftResumeHref, type PostDraftDTO } from '../forum/postDrafts';

export type UnifiedDraft = {
  id: string;
  source: 'forum' | 'markt';
  /** kiosk-i18n key of the kind word (existing keys, nothing new to translate). */
  kindKey: string;
  title: string;
  updatedAt: string; // ISO
  thumb: string | null;
  resumeHref: string;
  deleteUrl: string;
};

const POST_KIND_KEY = { discussion: 'chip.discussion', announcement: 'chip.announcement', recommendation: 'chip.recommendation' } as const;
const LISTING_KIND_KEY: Record<string, string> = { sell: 'market.filter.kind.verkaufen', exchange: 'market.filter.kind.tausch', gift: 'market.filter.kind.verschenken' };

export function fromPostDraft(d: PostDraftDTO): UnifiedDraft {
  return {
    id: d.id,
    source: 'forum',
    kindKey: POST_KIND_KEY[d.kind],
    title: d.title.trim(),
    updatedAt: d.updatedAt,
    thumb: d.images[0]?.url ?? null,
    resumeHref: draftResumeHref(d.id),
    deleteUrl: `/api/posts/drafts/${d.id}`
  };
}

/** The fields of a `listings` document this page needs — typed loosely so the
 *  mapper never imports mongodb (an ObjectId only has to stringify). */
export type ListingDraftLike = {
  _id: { toString(): string } | string;
  title?: string;
  listingType?: string;
  images?: string[];
  updatedAt?: Date | string;
  createdAt?: Date | string;
};

const iso = (v: Date | string | undefined): string => (v ? new Date(v).toISOString() : new Date(0).toISOString());

export function fromListingDraft(l: ListingDraftLike): UnifiedDraft {
  const id = String(l._id);
  return {
    id,
    source: 'markt',
    kindKey: LISTING_KIND_KEY[l.listingType ?? 'sell'] ?? LISTING_KIND_KEY.sell,
    title: (l.title ?? '').trim(),
    updatedAt: iso(l.updatedAt ?? l.createdAt),
    thumb: l.images?.[0] ?? null,
    resumeHref: `/marketplace/create?draft=${id}`,
    deleteUrl: `/api/listings/delete/${id}`
  };
}

export function mergeDrafts(...lists: UnifiedDraft[][]): UnifiedDraft[] {
  return lists.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
```

- [ ] **Step 4: Run, expect PASS (3 tests).**

- [ ] **Step 5: Commit**

```bash
git add src/lib/drafts/unifiedDrafts.ts src/lib/drafts/unifiedDrafts.test.ts
git commit -m "drafts page: one row shape for forum drafts and draft listings"
```

---

### Task 2: The page

**Files:**
- Modify: `src/layouts/KioskLayout.astro` (new optional prop `tour`)
- Modify: `src/middleware.ts` (`GATED_PAGES`)
- Create: `src/pages/entwuerfe.astro`
- Create: `src/components/drafts/DraftsPage.svelte`
- Modify: `src/lib/kiosk-i18n.ts`

**Interfaces:**
- Consumes: `listDrafts(userId)` (`src/lib/forum/postDraftsStore.ts`), `connectDB()`, `fromPostDraft`, `fromListingDraft`, `mergeDrafts`, `UnifiedDraft`, `relTime`, `confirmAction` / `showError` (`src/utils/toast.ts`), `KioskBtn`.
- Produces: route `/entwuerfe`; island props `{ initialDrafts: UnifiedDraft[]; partial: boolean }`; DOM hooks `[data-drafts-page]`, `[data-draft-row][data-source]`, `[data-draft-resume]`, `[data-draft-delete]`, `[data-drafts-empty]`, `[data-drafts-partial]`.

- [ ] **Step 1: `tour` prop** — in `src/layouts/KioskLayout.astro`: add `tour?: boolean;` to the `Props` interface (next to `page?:`), destructure `tour = true` where `page` is destructured, and wrap the controller:

```astro
    {tour && <TourController client:load user={session?.user ?? null} page={page} />}
```

Read the file first: keep the exact existing `TourController` line and only wrap it. Every other page keeps the default.

- [ ] **Step 2: Gate** — in `src/middleware.ts` add `'/entwuerfe'` to `GATED_PAGES` (end of the last line of the array, before the closing `];`).

- [ ] **Step 3: The page** — `src/pages/entwuerfe.astro`:

```astro
---
// /entwuerfe — everything the member has left unfinished: forum drafts
// (`postDrafts`) and marketplace draft listings (`listings`, status 'draft').
// A read-only union: saving, resuming and deleting use the two existing flows.
// Each source is fetched in its own try — one failing must not blank the page.
// Plan: docs/superpowers/plans/2026-09-21-drafts-page.md
import KioskLayout from '../layouts/KioskLayout.astro';
import DraftsPage from '../components/drafts/DraftsPage.svelte';
import { getSession } from 'auth-astro/server';
import * as Sentry from '@sentry/astro';
import { connectDB } from '../lib/mongodb';
import { listDrafts } from '../lib/forum/postDraftsStore';
import { fromListingDraft, fromPostDraft, mergeDrafts, type UnifiedDraft } from '../lib/drafts/unifiedDrafts';

const session = await getSession(Astro.request);
if (!session?.user?.id) {
  return Astro.redirect('/login?redirect=/entwuerfe');
}
const userId = session.user.id;

let forum: UnifiedDraft[] = [];
let markt: UnifiedDraft[] = [];
let partial = false;

try {
  forum = (await listDrafts(userId)).map(fromPostDraft);
} catch (err) {
  partial = true;
  // Swallowed on purpose (decision 6) — so it must reach Sentry itself, or the
  // page degrades in silence; flush, Vercel freezes the function after the response.
  Sentry.captureException(err, { extra: { where: 'entwuerfe.forumDrafts' } });
}
try {
  const db = await connectDB();
  const rows = await db
    .collection('listings')
    .find({ sellerId: userId, status: 'draft' }, { projection: { title: 1, listingType: 1, images: 1, updatedAt: 1, createdAt: 1 } })
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray();
  markt = rows.map((r) => fromListingDraft(r as any));
} catch (err) {
  partial = true;
  Sentry.captureException(err, { extra: { where: 'entwuerfe.draftListings' } });
}
if (partial) await Sentry.flush(2000);

const initialDrafts = mergeDrafts(forum, markt);
---

<KioskLayout title="Mahalle · Entwürfe" description="Deine gespeicherten Entwürfe." page="profile" tour={false} noindex>
  <!-- Same centred 1280 px page column as every main section. -->
  <div class="mx-auto w-full max-w-[1280px]">
    <DraftsPage client:only="svelte" initialDrafts={initialDrafts} partial={partial} />
  </div>
</KioskLayout>
```

Audited: `/bookmarks` sets no cache header and no `noindex`. This page is per-member, so add `Astro.response.headers.set('Cache-Control', 'no-store');` right after the session check, and pass `noindex` (a `KioskLayout` prop, default `false`).

- [ ] **Step 4: The island** — `src/components/drafts/DraftsPage.svelte` (imported directly by a page, so a `<style>` block would be safe — it still uses Tailwind only, like its sibling `ForumDraftsSection`):

```svelte
<script lang="ts">
  // The member's unfinished things, both kinds in one list. Plan:
  // docs/superpowers/plans/2026-09-21-drafts-page.md
  import { t, locale } from '../../lib/kiosk-i18n';
  import { relTime } from '../../lib/relTime';
  import { confirmAction, showError } from '../../utils/toast';
  import KioskBtn from '../forum/kiosk/KioskBtn.svelte';
  import { optimizeCloudinary } from '../../utils/cloudinary';
  import type { UnifiedDraft } from '../../lib/drafts/unifiedDrafts';

  let { initialDrafts = [], partial = false } = $props<{ initialDrafts?: UnifiedDraft[]; partial?: boolean }>();

  // svelte-ignore state_referenced_locally
  let drafts = $state<UnifiedDraft[]>(initialDrafts);
  let deleting = $state<string | null>(null);

  async function remove(d: UnifiedDraft) {
    if (deleting) return;
    const ok = await confirmAction($t['drafts.delete.confirm'] as string, { variant: 'danger', confirmLabel: $t['drafts.delete'] as string });
    if (!ok) return;
    deleting = d.id;
    try {
      const res = await fetch(d.deleteUrl, { method: 'DELETE', credentials: 'include' });
      if (!res.ok && res.status !== 404) throw new Error(); // 404 = already gone
      drafts = drafts.filter((x) => !(x.id === d.id && x.source === d.source));
    } catch {
      showError($t['drafts.delete.error'] as string);
    } finally {
      deleting = null;
    }
  }
</script>

<!-- A <div>, not <main>: KioskLayout already wraps the slot in <main class="flex-1">
     (BookmarksPage nests a second <main> — do not copy that). -->
<div data-drafts-page class="px-4 md:px-9 lg:px-10 pt-5 md:pt-6 pb-10">
  <section class="mb-5 pb-4 border-b border-dashed border-rule">
    <p class="font-dmmono text-[11px] uppercase tracking-[0.18em] mb-2" style="color: var(--k-accent);">{$t['draftsPage.kicker']}</p>
    <h1 class="font-bricolage font-extrabold text-[34px] min-[380px]:text-4xl md:text-5xl tracking-tight leading-[0.95] text-ink">
      {$t['draftsPage.title.prefix']}
      <em class="font-instrument italic font-normal" style="color: var(--k-accent);">{$t['draftsPage.title.accent']}</em>
    </h1>
    <p class="mt-3 font-instrument italic text-[15px] text-ink-soft max-w-[60ch]">{$t['draftsPage.intro']}</p>
  </section>

  {#if partial}
    <p data-drafts-partial class="mb-4 px-3 py-2 rounded-md border border-dashed border-warn font-dmmono text-[11px] text-ink-soft">{$t['draftsPage.partial']}</p>
  {/if}

  {#if drafts.length}
    <ul class="flex flex-col gap-2">
      {#each drafts as d (d.source + d.id)}
        <li data-draft-row data-source={d.source} class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg border-[1.5px] border-dashed border-ink/50 bg-paper-warm">
          {#if d.thumb}
            <img src={optimizeCloudinary(d.thumb)} alt="" loading="lazy" class="shrink-0 w-11 h-11 rounded-md object-cover border border-ink" />
          {/if}
          <span class={`shrink-0 px-[9px] py-[3px] rounded-lg border border-wine font-dmmono text-[10px] font-medium tracking-[0.08em] ${d.source === 'forum' ? 'bg-wine text-paper' : 'bg-transparent text-wine'}`}>
            {$t[d.source === 'forum' ? 'draftsPage.source.forum' : 'draftsPage.source.markt']}
          </span>
          <span class="shrink-0 font-dmmono text-[10px] uppercase tracking-[0.08em] text-ink-mute">{$t[d.kindKey as keyof typeof $t]}</span>
          <a href={d.resumeHref} class="min-w-0 flex-1 basis-[12rem] inline-flex items-center min-h-[36px] font-bricolage font-bold text-[15px] text-ink hover:underline">
            <span class="truncate">{d.title || $t['drafts.untitled']}</span>
          </a>
          <span class="shrink-0 font-dmmono text-[10px] text-ink-mute">{$t['drafts.changed']} {relTime(d.updatedAt, $locale)}</span>
          <a href={d.resumeHref} data-draft-resume class="shrink-0 inline-flex items-center min-h-[36px] font-dmmono text-[11px] uppercase tracking-[0.1em] text-wine underline">{$t['drafts.resume']}</a>
          <button type="button" data-draft-delete onclick={() => remove(d)} disabled={deleting === d.id}
            class="shrink-0 inline-flex items-center min-h-[36px] font-dmmono text-[11px] uppercase tracking-[0.1em] text-ink-mute underline disabled:opacity-50">{$t['drafts.delete']}</button>
        </li>
      {/each}
    </ul>
  {:else}
    <div data-drafts-empty class="py-10 text-center">
      <p class="font-instrument italic text-[17px] text-ink-soft mb-5">{$t['draftsPage.empty']}</p>
      <div class="flex flex-wrap justify-center gap-3">
        <KioskBtn href="/topics/create">{$t['forum.cta.newTopic']}</KioskBtn>
        <KioskBtn variant="secondary" href="/marketplace/create">{$t['market.cta.newListing']}</KioskBtn>
      </div>
    </div>
  {/if}
</div>
```

Audited: both button texts exist already — `forum.cta.newTopic` („+ neues thema") and `market.cta.newListing` („+ neue anzeige"), same lower-case style, so the empty state needs no new button key; `grep -n "border-warn\|warn:" tailwind.config.*` (the `warn` colour exists — the forum's own-status wrappers use `border-warn`); `KioskBtn` accepts `href` + `variant` (it does — `NewsTitleBlock.svelte` uses both).

- [ ] **Step 5: Copy (OFFER)** — add next to the `drafts.*` keys, both dictionaries:

```ts
  'draftsPage.kicker': 'Profil · Entwürfe',
  'draftsPage.title.prefix': 'Deine',
  'draftsPage.title.accent': 'Entwürfe',
  'draftsPage.intro': 'Alles, was du angefangen und noch nicht veröffentlicht hast — aus dem Forum und vom Markt. Nur du siehst es.',
  'draftsPage.source.forum': 'FORUM',
  'draftsPage.source.markt': 'MARKT',
  'draftsPage.partial': 'Ein Teil der Entwürfe ließ sich gerade nicht laden. Lade die Seite später noch einmal.',
  'draftsPage.empty': 'Hier liegt gerade nichts. Was du als Entwurf speicherst, findest du hier wieder.',
```

```ts
  'draftsPage.kicker': 'Profile · Drafts',
  'draftsPage.title.prefix': 'Your',
  'draftsPage.title.accent': 'drafts',
  'draftsPage.intro': 'Everything you started and have not published yet — from the forum and the market. Only you can see it.',
  'draftsPage.source.forum': 'FORUM',
  'draftsPage.source.markt': 'MARKET',
  'draftsPage.partial': 'Some of your drafts could not be loaded just now. Please reload the page later.',
  'draftsPage.empty': 'Nothing here right now. Whatever you save as a draft shows up here.',
```

- [ ] **Step 6: Gates, then commit**

```bash
git add src/layouts/KioskLayout.astro src/middleware.ts src/pages/entwuerfe.astro src/components/drafts/DraftsPage.svelte src/lib/kiosk-i18n.ts
git commit -m "drafts page: /entwuerfe lists forum drafts and draft listings together"
```

---

### Task 3: Entry points, probe, docs

**Files:**
- Modify: `src/components/forum/kiosk/AvatarMenu.svelte` (one `href`)
- Modify: `src/components/profile/kiosk/PActivityLedger.svelte` (one link after the „Gespeichert" chip)
- Modify: `src/lib/kiosk-i18n.ts` (one key)
- Modify: `CLAUDE.md` (`GATED_PAGES` list in „Landing + login gating"; one sentence in the `postDrafts` bullet), `src/components/forum/kiosk/CLAUDE.md` („Drafts" section), `src/components/marketplace/kiosk/CLAUDE.md` („Server-side drafts"), `src/components/profile/kiosk/CLAUDE.md`
- Create (scratch): `scratchpad/drafts-page-probe.cjs`

- [ ] **Step 1: Account menu** — in `AvatarMenu.svelte` change the row added on 2026-09-21 from `href="/forum?kind=mine"` to `href="/entwuerfe"` (label key `nav.menu.entwuerfe` stays).

- [ ] **Step 2: Profile Archive link** — in `PActivityLedger.svelte`, inside the `{#if !isPublic}` block, directly after the „◈ Gespeichert" `PFilterChip`:

```svelte
      <!-- Not a filter: drafts are not activity. A plain link to the one drafts
           page (forum + market), styled like the neighbouring chips. -->
      <a href="/entwuerfe" data-profile-drafts-link class="shrink-0 kiosk-tap-box" style="display: inline-flex; align-items: center; text-decoration: none;">
        <span style="padding: 5px 13px; font-family: var(--k-font-display); font-size: 12.5px; font-weight: 600; background: transparent; color: var(--k-ink); border: 1.5px dashed var(--k-ink); border-radius: var(--k-radius-pill); display: inline-flex; align-items: center; white-space: nowrap;">{$t['profile.filter.entwuerfe']}</span>
      </a>
```

Audited: these are `PFilterChip`'s own span values (padding 5px 13px, 12.5px / 600, `--k-radius-pill`, inline-flex centred); the dashed border is the one deliberate difference („leads elsewhere"). Keys: `'profile.filter.entwuerfe': 'Entwürfe →'` / `'Drafts →'`.

- [ ] **Step 3: Probe** — `scratchpad/drafts-page-probe.cjs` (standalone Playwright, `NODE_PATH="$(npm root -g)/@playwright/cli/node_modules"`, dev :4655, `PROBE_WIDTHS` default `1280,390`, run under `timeout 280`). Setup inside the page after login as `admin@mahalle-dev.test`: delete every existing draft of the account (`GET /api/posts/drafts` + `GET /api/listings/my-listings` → delete each), then create through the APIs one forum draft (`POST /api/posts/drafts` `{kind:'announcement', title:'Probe Forum-Entwurf <ts>', body:'', tags:[], images:[]}`), wait 1.1 s, one draft listing (`POST /api/listings/draft` `{title:'Probe Anzeigen-Entwurf <ts>', listingType:'gift'}`). Checks:
  1. logged out: `GET /entwuerfe` ends on `/login` with `redirect=%2Fentwuerfe` in the URL.
  2. the page shows exactly 2 rows; the FIRST is the listing (newer), `data-source="markt"`, kind word „Verschenken"; the second `data-source="forum"`, „Ankündigung".
  3. kicker and the italic title accent compute to the ochre accent colour (compare with `getComputedStyle(document.documentElement).getPropertyValue('--k-ochre')`), and the tour is structurally absent: `document.querySelector('astro-island[component-url*="TourController"]') === null` (a text check for „Neu hier" would pass vacuously for an account that has already seen the Profil chapter), while the same selector DOES match on `/profile`.
  4. „weiterschreiben" of the listing row → URL `/marketplace/create?draft=<id>` and the title field holds the probe title; back; „weiterschreiben" of the forum row → `/topics/create?draft=<id>` with the title restored.
  5. delete the forum row (confirm dialog → confirm) → 1 row left; `fetch('/api/posts/drafts')` inside the page lists 0.
  6. delete the listing row → `[data-drafts-empty]` visible with two links (`/topics/create`, `/marketplace/create`); `my-listings` reports 0 drafts.
  7. heading left edge: 40 px at 1280, 16 px at 390; no sideways scroll; every control in a row ≥ 36 px high at 390.
  8. account menu „Meine Entwürfe" → `href="/entwuerfe"`; on `/profile` the link `[data-profile-drafts-link]` exists, points to `/entwuerfe`, and sits within 3 px of the „Gespeichert" chip's vertical centre.
  9. regression: `/forum?kind=mine` still shows its own „Entwürfe" section when a forum draft exists (create one, check, delete it).
Expected: all PASS at both widths.

- [ ] **Step 4: Regression probes** — `forum-drafts-probe.cjs` (its check 9 asserts the old menu target `/forum?kind=mine` — update that ONE assertion to `/entwuerfe` first), `fab-probe.cjs` (26), `forum-tags-chip-probe.cjs` (14). Gates.

- [ ] **Step 5: Docs**
  - Root `CLAUDE.md`: add `/entwuerfe` to the `GATED_PAGES` list in „Landing + login gating"; in the `postDrafts` bullet add: „One page lists them together with the marketplace's draft listings: `/entwuerfe` (`src/pages/entwuerfe.astro` + `src/components/drafts/DraftsPage.svelte`, pure row mapper `src/lib/drafts/unifiedDrafts.ts`); the account menu and the profile Archive link there."
  - `src/components/forum/kiosk/CLAUDE.md` „Drafts": the menu row now points to `/entwuerfe`; why (user, 2026-09-21: a row called „Meine Entwürfe" that shows only forum drafts and drops you into the forum „is not good ui"); `KioskLayout`'s `tour={false}` and the reason; the observation that `/bookmarks` + `/search` still show a tour offer without anchors.
  - `src/components/marketplace/kiosk/CLAUDE.md` „Server-side drafts": one line — draft listings also appear on `/entwuerfe`; resume and delete use the same two routes as the market's own section.
  - `src/components/profile/kiosk/CLAUDE.md`: the Archive's „Entwürfe →" is a LINK, not an `ActivityFilter` — do not add it to `FILTERS` or the activity API.

- [ ] **Step 6: Commit**

```bash
git add src/components/forum/kiosk/AvatarMenu.svelte src/components/profile/kiosk/PActivityLedger.svelte src/lib/kiosk-i18n.ts CLAUDE.md src/components/forum/kiosk/CLAUDE.md src/components/marketplace/kiosk/CLAUDE.md src/components/profile/kiosk/CLAUDE.md
git commit -m "drafts page: account menu and profile archive link to /entwuerfe, docs"
```

- [ ] **Step 7: Hand over** — what was built, the new copy keys (`draftsPage.*`, `profile.filter.entwuerfe`) for the user's wording, the three observations (tour offer on `/bookmarks` + `/search`; the menu's „Führung" row is dead on every anchor-less page; deleting a LISTING — draft or published — never destroys its Cloudinary images, audited in `src/pages/api/listings/delete/[id].ts`; change none of them), and that merge + push wait for his word. After deploy: read-only prod check — logged-out `/entwuerfe` → 302 to login; with `atakee+lasttest@gmail.com` the page renders its empty state (no write).

---

## Self-review record

- **Coverage:** both kinds on one page (T1/T2), resume + delete for both (T2, decision 3), menu row fixed (T3), profile entry (T3), existing in-place sections untouched (decision 9, probe check 9), gate (T2 step 2 + probe check 1), house layout rules (decision 8, probe check 7), tour trap (decision 7, probe check 3).
- **Names used identically everywhere:** `UnifiedDraft`, `ListingDraftLike`, `fromPostDraft`, `fromListingDraft`, `mergeDrafts`, `initialDrafts`, `partial`, `data-draft-row`, `data-draft-resume`, `data-draft-delete`, `data-drafts-empty`, `data-drafts-partial`, `data-profile-drafts-link`.
- **Verified against the code while planning:** `GET /api/listings/my-listings` returns `{ listings, drafts, stats }`; the market deletes a draft with `DELETE /api/listings/delete/<id>` and resumes with `/marketplace/create?draft=<id>`; `listingType` is `sell | exchange | gift` with labels `market.filter.kind.verkaufen|tausch|verschenken`; listing `images` are plain URL strings, forum draft images are `{url, publicId}`; `KioskLayout`'s `page` union has no drafts value and `[data-page="profile"]` sets the ochre accent; `TourController` shows the offer for ANY page whose name has a chapter, whether or not the anchors exist; `/bookmarks` is the closest existing page (SSR list + island, own redirect).
- **Audit, same hour (fixed in place):** the island had its own `<main>` inside `KioskLayout`'s `<main>` (copied from `BookmarksPage`, which has that flaw) → a `<div>`; the page is per-member → `no-store` + `noindex`; the profile link now carries `PFilterChip`'s exact span values. Confirmed: `KioskLayout` destructures `page` and renders `TourController` on one line (easy to wrap); `warn` and `--k-accent` exist; `BookmarksPage` is mounted `client:only="svelte"` with SSR-fetched props — this page does the same (my first draft said `client:load`; wrong, and it would have server-rendered the German texts for English readers).
- **Second audit (user: „audit the plan"), fixed in place:** (1) the two swallowed database failures only `console.error`ed — against the house rule that a graceful degradation must reach Sentry and be flushed → `captureException` + `flush(2000)`. (2) The tour check in the probe would have passed for any account that had already seen the Profil chapter → structural check on the island. (3) A new button key duplicated the market's own `market.cta.newListing` → reused. (4) Thumbnails now go through `optimizeCloudinary` like everywhere else. (5) `tour={false}` leaves the menu's „Führung" row without effect on this page — same as on every anchor-less page today; recorded, not fixed. Confirmed: the listing field is `listingType` (`sell|exchange|gift`), draft listings carry `updatedAt`, `POST /api/listings/draft` needs only a title (ban-guarded), the delete route lets an owner delete a draft freely (`canMutateListing`), cascades `listingContacts`, stamps `flaggedContent.contentDeleted` — and does NOT destroy the listing's Cloudinary images (pre-existing, for published listings too; observation for the hand-over).
- **To verify while executing:** nothing left open.
