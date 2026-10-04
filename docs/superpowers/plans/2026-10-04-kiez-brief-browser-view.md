# Kiez-Brief Browser View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Kiez-Brief mail gets an „Im Browser ansehen" link; a logged-in member can read that issue — and every earlier sent issue — in the browser.

**Architecture:** No copy of the mail is stored. Each issue's `kiezBriefIssues` row already holds the time window it was built for, so the browser view REBUILDS the issue from today's data for that window (`findSentIssue` → `loadSentIssue`, which is `loadIssueData` at the stored `windowTo`) and renders the existing mail template with a `web` flag. `/kiez-brief/<week>` answers with the mail's own HTML (no app chrome), `/kiez-brief` is a small list page in the kiosk layout; both sit behind the middleware's member gate.

**Tech Stack:** Astro 5 SSR (one endpoint, one page), one Svelte 5 island, MongoDB driver, React Email (`@react-email/components`, `@react-email/render`), node:test via tsx.

**Spec:** the Kiez-Brief spec `docs/superpowers/specs/2026-10-03-kiez-brief-newsletter-design.md` (the mail itself) plus the „Design decisions" section below (this add-on has no spec of its own; those seven lines are binding). Every code block below was run on a throwaway branch (`scratch/kiez-brief-web`, commits `d77ed03b` · `b909929c` · `c008c759` · `d6dd93e3` on top of main `ebf7cc15`): 10 new tests green, tsc 16 / svelte-check 81 / 379 tests, browser probe 29/29 on the local production build against the dev database.

## Design decisions

1. **No snapshot.** The page is rebuilt from live data for the stored window. A post deleted since is gone from the old issue too, a member who left reads „Ehemaliges Mitglied", a sold listing is out, reply counts are today's. This is wanted (deletion and anonymisation reach the archive without extra code), not a gap.
2. **Only a SENT issue has a page:** the row's `sentAt` is a date. Skipped weeks (`quiet`, `quota`), failed sends, never-sent weeks, unknown weeks and malformed keys all redirect to the list.
3. **The issue page is the mail's HTML,** not a kiosk page: same template, `web: true`. The only difference is the top line (mail: „Im Browser ansehen" → the page; page: „← Alle Ausgaben" → the list).
4. **The viewer, not the recipient:** language, name in the greeting and unsubscribe link come from the logged-in member who opens the page. A forwarded mail never shows the sender's name or link.
5. **Members only, in no menu.** `/kiez-brief` joins `GATED_PAGES`. The way in is the mail, then „Alle Ausgaben".
6. **No air line** in the browser view: „Luftqualität heute" would print another day's reading.
7. **Relative links and a strict CSP** on the issue page: base `''` instead of `NEXTAUTH_URL`; `default-src 'none'`, images and inline styles only — member text sits in a same-origin document.

## Global Constraints

- Error budgets stay EXACTLY at `pnpm type-check` 16 errors and `npx -y svelte-check@4` 81 errors; `pnpm test` stays green (369 before this plan, 379 after).
- Commit messages: plain and concise. NO „🤖 Generated with Claude Code" line, NO „Co-Authored-By" footer.
- Never stage secrets; never print any `.env` value (names only). The dev password lives in `scratchpad/devpw.txt`, read by probes, never printed.
- `kiezBriefRules.ts` has NO imports. `kiezBriefStore.ts` takes a `Db` and must not import `connectDB`, the mailer, Sentry or anything reading `import.meta.env` (it runs under plain `tsx`).
- Never delete a `kiezBriefIssues` row in prod. The seed script touches the dev database only and refuses a database whose name lacks „dev".
- The new island has no `<style>` block (Tailwind classes only). Its copy lives in `src/lib/kiosk-i18n.ts` under `kiezBrief.*`, DE + EN, DRAFT.
- No menu item, no link in the notification panel, no public archive.
- Apply every ```diff block with `git apply` from the repo root; a block introduced by a line ending in `` `path`: `` is the WHOLE file.

## Review Focus

1. The week in the address is member input. A malformed or operator-shaped value must never reach the database and must end on the list — `isIssueWeekKey` test and the „never reaches the database" assertion in the `findSentIssue` test (Task 1); probe „malformed / operator-shaped week → the list" (Task 4).
2. A week nobody received (skipped, failed, never sent) must have no page and no list row — `findSentIssue` and `listSentIssues` tests (Task 1); probe (Task 4).
3. An old issue opened weeks later must show ITS week, not this one, and no air reading of today — the two `loadSentIssue` tests (Task 1).
4. A logged-out request must get no issue HTML, only the login redirect with the target kept — probe „logged out: no issue HTML in the answer (302)" (Task 4).
5. The mail every member receives changes too (top line, viewport, title). It must still carry both placeholders, escape member text, and link to its OWN week — the template tests (Task 2); probe „mail: Im Browser ansehen → /kiez-brief/<current week>" (Task 4).

---

### Task 1: Find, list and rebuild a sent issue

**Files:**
- Modify: `src/lib/newsletter/kiezBriefRules.ts`, `src/lib/newsletter/kiezBriefStore.ts`
- Test: `src/lib/newsletter/kiezBriefRules.test.ts`, `src/lib/newsletter/kiezBriefStore.test.ts`

**Interfaces:**
- Consumes (already on main): `issueWeek`, `windowFor`, `MAIL_COPY`, `IssueDoc`, `loadIssueData(db, week, nowMs, blog, opts)`, `BlogInput`, `KIEZ_BRIEF_COLLECTION`.
- Produces:
  - `isIssueWeekKey(v: unknown): v is string` (rules)
  - `MAIL_COPY.de|en.viewInBrowser`, `MAIL_COPY.de|en.allIssues` (rules)
  - `interface LoadOptions { cloud?: string | null; air?: boolean }` — `loadIssueData`'s last parameter (store)
  - `findSentIssue(db: Db, week: unknown): Promise<IssueDoc | null>` (store)
  - `loadSentIssue(db: Db, doc: IssueDoc, blog: BlogInput[], opts?: LoadOptions): Promise<BriefData>` (store)
  - `interface IssueListItem { week: string; sentAtMs: number }`, `listSentIssues(db: Db, limit = 60): Promise<IssueListItem[]>` (store)

- [ ] **Step 1: Write the failing tests** (the store test's in-memory database double learns `findOne`, the `sentAt` filter, `sort` and `limit`)

```diff
diff --git a/src/lib/newsletter/kiezBriefRules.test.ts b/src/lib/newsletter/kiezBriefRules.test.ts
index 45cc4a62..27b527da 100644
--- a/src/lib/newsletter/kiezBriefRules.test.ts
+++ b/src/lib/newsletter/kiezBriefRules.test.ts
@@ -3,7 +3,7 @@ import assert from 'node:assert/strict';
 import {
   storedNewsletterMode, isoWeek, issueWeek, weekLabel, windowFor, arrangeData, isQuiet, subjectFor,
   preheaderFor, withUtm, berlinWeekday, fmtEventWhen, fmtPrice, unsubscribeHeaders, excerptOf, thumb, inert, personalize, LISTING_KIND_SYMBOL,
-  storedMailLocale, escapeHtml, MAIL_COPY, NAME_PLACEHOLDER, MAX_POSTS, MAX_EVENTS, MAX_LISTINGS, WINDOW_MS,
+  storedMailLocale, escapeHtml, isIssueWeekKey, MAIL_COPY, NAME_PLACEHOLDER, MAX_POSTS, MAX_EVENTS, MAX_LISTINGS, WINDOW_MS,
   type BriefData,
 } from './kiezBriefRules';
 
@@ -200,3 +200,17 @@ test('a name is escaped before it goes into rendered HTML', () => {
   assert.equal(escapeHtml('Ayşe'), 'Ayşe');
 });
 
+
+test('isIssueWeekKey: exactly the keys issueWeek() produces', () => {
+  for (const ok of ['2026-W41', '2026-W01', '2026-W53', '2031-W09', issueWeek(SUN_18), issueWeek(MON_06)]) assert.equal(isIssueWeekKey(ok), true, ok);
+  for (const bad of ['', '2026-W0', '2026-W00', '2026-W54', '2026-W411', '26-W41', '2026-w41', '2026W41', '2026-W41 ', '2026-W41\n', '2026-W41/x', '..', 41, null, undefined, ['2026-W41'], { $gt: '' }]) {
+    assert.equal(isIssueWeekKey(bad), false, String(bad));
+  }
+});
+
+test('the mail copy names the browser view and the list in both languages', () => {
+  assert.equal(MAIL_COPY.de.viewInBrowser, 'Im Browser ansehen');
+  assert.equal(MAIL_COPY.de.allIssues, 'Alle Ausgaben');
+  assert.equal(MAIL_COPY.en.viewInBrowser, 'View in browser');
+  assert.equal(MAIL_COPY.en.allIssues, 'All issues');
+});
```

```diff
diff --git a/src/lib/newsletter/kiezBriefStore.test.ts b/src/lib/newsletter/kiezBriefStore.test.ts
index ce874767..7484d6ae 100644
--- a/src/lib/newsletter/kiezBriefStore.test.ts
+++ b/src/lib/newsletter/kiezBriefStore.test.ts
@@ -1,7 +1,10 @@
 import { test } from 'node:test';
 import assert from 'node:assert/strict';
 import type { Db } from 'mongodb';
-import { claimIssue, markIssue, loadIssueData, loadRecipients, KIEZ_BRIEF_COLLECTION } from './kiezBriefStore';
+import {
+  claimIssue, markIssue, loadIssueData, loadRecipients, findSentIssue, loadSentIssue, listSentIssues, KIEZ_BRIEF_COLLECTION,
+  type IssueDoc,
+} from './kiezBriefStore';
 
 const NOW = Date.parse('2026-10-11T16:00:00.000Z'); // Sunday 18:00 CEST
 const HOUR = 3_600_000;
@@ -18,9 +21,22 @@ function fakeDb(seed: Record<string, any[]> = {}) {
         calls.push({ collection: name, op: 'find', filter });
         let list = [...rows(name)];
         if (filter?._id?.$in) list = list.filter((r) => filter._id.$in.some((id: any) => String(id) === String(r._id)));
-        const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => list };
+        if (filter?.sentAt?.$type === 'date') list = list.filter((r) => r.sentAt instanceof Date);
+        const cursor = {
+          sort: (spec: Record<string, 1 | -1> = {}) => {
+            const [key, dir] = Object.entries(spec)[0] ?? [];
+            if (key) list.sort((a, b) => (Number(a[key]) - Number(b[key])) * (dir as number));
+            return cursor;
+          },
+          limit: (n: number) => { list = list.slice(0, n); return cursor; },
+          toArray: async () => list,
+        };
         return cursor;
       },
+      findOne: async (filter: any) => {
+        calls.push({ collection: name, op: 'findOne', filter });
+        return rows(name).find((r) => r._id === filter._id && (filter.sentAt?.$type !== 'date' || r.sentAt instanceof Date)) ?? null;
+      },
       insertOne: async (doc: any) => {
         if (rows(name).some((r) => r._id === doc._id)) throw Object.assign(new Error('dup'), { code: 11000 });
         rows(name).push(doc);
@@ -107,3 +123,69 @@ test('recipients: verified, not anonymized, not banned, not off, not in deletion
     emailVerified: true, anonymized: { $ne: true }, isBanned: { $ne: true }, newsletter: { $ne: 'off' }, deletionScheduledAt: { $exists: false }, email: { $type: 'string' },
   });
 });
+
+const issue = (week: string, patch: Partial<IssueDoc> = {}): IssueDoc => ({
+  _id: week, windowFrom: new Date(NOW - 7 * DAY), windowTo: new Date(NOW), claimedAt: new Date(NOW), fallback: false, ...patch,
+});
+
+test('findSentIssue: only a sent week; skipped, unsent, unknown and malformed keys are null', async () => {
+  const { db, calls } = fakeDb({
+    [KIEZ_BRIEF_COLLECTION]: [
+      issue('2026-W41', { recipients: 12, sentAt: new Date(NOW + 60_000) }),
+      issue('2026-W40', { skipped: 'quiet', recipients: 0 }),
+      issue('2026-W39', { recipients: 0 }), // claimed, never sent (failed send or no transport)
+    ],
+  });
+  assert.equal((await findSentIssue(db, '2026-W41'))?._id, '2026-W41');
+  assert.equal(await findSentIssue(db, '2026-W40'), null);
+  assert.equal(await findSentIssue(db, '2026-W39'), null);
+  assert.equal(await findSentIssue(db, '2026-W38'), null);
+  assert.deepEqual(calls[0].filter, { _id: '2026-W41', sentAt: { $type: 'date' } });
+  const before = calls.length;
+  for (const bad of ['', '2026-W00', '2026-W54', '2026-w41', '2026-W41/..', ' 2026-W41', '../admin', undefined, null, 41, { $ne: null }]) {
+    assert.equal(await findSentIssue(db, bad), null);
+  }
+  assert.equal(calls.length, before); // a malformed key never reaches the database
+});
+
+test('loadSentIssue: the STORED window, not today\'s; no air lookup at all', async () => {
+  const LATER = NOW + 30 * DAY; // the member opens the issue a month later
+  const { db, calls } = fakeDb({
+    topics: [{ _id: 't1', title: 'Frage', author: 'x', comments: [], date: NOW - HOUR }],
+    announcements: [], recommendations: [], events: [], listings: [],
+    schillerkiez_air_log: [{ ts: new Date(LATER), lqi: 4 }],
+  });
+  const d = await loadSentIssue(db, issue('2026-W41', { sentAt: new Date(NOW) }), [{ slug: 'neu', title: 'Neu', description: 'd', pubDate: new Date(NOW - DAY) }, { slug: 'spaeter', title: 'S', description: 'd', pubDate: new Date(LATER - DAY) }], { cloud: 'demo' });
+  assert.equal(d.week, '2026-W41');
+  assert.equal(d.air, null);
+  assert.equal(calls.some((c) => c.collection.startsWith('schillerkiez_air')), false);
+  assert.deepEqual(calls.find((c) => c.collection === 'topics')!.filter.date, { $gt: NOW - 7 * DAY, $lte: NOW });
+  assert.deepEqual(calls.find((c) => c.collection === 'events')!.filter.startDate, { $gte: new Date(NOW), $lt: new Date(NOW + 7 * DAY) });
+  assert.deepEqual(d.blog.map((b) => b.slug), ['neu']); // a post published after the issue is not in it
+});
+
+test('loadSentIssue: the caller cannot switch the air line back on', async () => {
+  const { db, calls } = fakeDb({ topics: [], announcements: [], recommendations: [], events: [], listings: [], schillerkiez_air_log: [{ ts: new Date(NOW), lqi: 2 }] });
+  const d = await loadSentIssue(db, issue('2026-W41', { sentAt: new Date(NOW) }), [], { air: true });
+  assert.equal(d.air, null);
+  assert.equal(calls.some((c) => c.collection.startsWith('schillerkiez_air')), false);
+});
+
+test('listSentIssues: sent weeks only, newest first, capped', async () => {
+  const { db, calls } = fakeDb({
+    [KIEZ_BRIEF_COLLECTION]: [
+      issue('2026-W40', { sentAt: new Date(NOW - 7 * DAY) }),
+      issue('2026-W42', { sentAt: new Date(NOW + 7 * DAY) }),
+      issue('2026-W41', { skipped: 'quota', recipients: 0 }),
+      issue('2026-W39', { sentAt: new Date(NOW - 14 * DAY) }),
+    ],
+  });
+  assert.deepEqual(await listSentIssues(db), [
+    { week: '2026-W42', sentAtMs: NOW + 7 * DAY },
+    { week: '2026-W40', sentAtMs: NOW - 7 * DAY },
+    { week: '2026-W39', sentAtMs: NOW - 14 * DAY },
+  ]);
+  assert.deepEqual(calls[0].filter, { sentAt: { $type: 'date' } });
+  assert.deepEqual((await listSentIssues(db, 2)).map((i) => i.week), ['2026-W42', '2026-W40']);
+  assert.deepEqual(await listSentIssues(fakeDb().db), []);
+});
```

- [ ] **Step 2: Run them to see them fail** — `npx tsx --test src/lib/newsletter/*.test.ts` → both changed files fail to load (`does not provide an export named 'isIssueWeekKey'` / `'findSentIssue'`).

- [ ] **Step 3: Rules — the key check and the two copy lines**

```diff
diff --git a/src/lib/newsletter/kiezBriefRules.ts b/src/lib/newsletter/kiezBriefRules.ts
index 0aa8cc02..2c0d1219 100644
--- a/src/lib/newsletter/kiezBriefRules.ts
+++ b/src/lib/newsletter/kiezBriefRules.ts
@@ -51,6 +51,7 @@ export const MAIL_COPY = {
     why: 'Du bekommst diesen Brief einmal die Woche, weil du Mitglied bei Mahalle bist.',
     unsubscribe: 'Abbestellen', settings: 'Mitteilungen einstellen', imprint: 'Impressum', privacy: 'Datenschutz',
     preheaderFallback: 'Neues aus dem Schillerkiez', week: 'KW',
+    viewInBrowser: 'Im Browser ansehen', allIssues: 'Alle Ausgaben',
   },
   en: {
     title: 'The week in the Kiez',
@@ -64,6 +65,7 @@ export const MAIL_COPY = {
     why: 'You get this letter once a week because you are a member of Mahalle.',
     unsubscribe: 'Unsubscribe', settings: 'Notification settings', imprint: 'Imprint', privacy: 'Privacy',
     preheaderFallback: 'News from the Schillerkiez', week: 'CW',
+    viewInBrowser: 'View in browser', allIssues: 'All issues',
   },
 } as const;
 
@@ -105,6 +107,11 @@ export function issueWeek(nowMs: number): string {
   return isoWeek(nowMs - DAY_MS);
 }
 
+/** A well-formed issue key ('2026-W41'). The browser view takes it from the address — member input. */
+export function isIssueWeekKey(v: unknown): v is string {
+  return typeof v === 'string' && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(v);
+}
+
 /** „KW 41" (German) / „CW 41" (English) for the subject and the masthead. */
 export function weekLabel(week: string, locale: MailLocale = 'de'): string {
   return `${MAIL_COPY[locale].week} ${Number(week.slice(-2))}`;
```

- [ ] **Step 4: Store — the air option, the lookup, the rebuild, the list**

```diff
diff --git a/src/lib/newsletter/kiezBriefStore.ts b/src/lib/newsletter/kiezBriefStore.ts
index c6bd8bb3..34a60744 100644
--- a/src/lib/newsletter/kiezBriefStore.ts
+++ b/src/lib/newsletter/kiezBriefStore.ts
@@ -6,7 +6,7 @@ import { ObjectId, type Db } from 'mongodb';
 import { PUBLIC_AUTHOR_PROJECTION } from '../publicAuthor';
 import { getAirHistory } from '../kiez/airLog';
 import {
-  windowFor, arrangeData, excerptOf, thumb, storedMailLocale, type MailLocale,
+  windowFor, arrangeData, excerptOf, thumb, storedMailLocale, isIssueWeekKey, type MailLocale,
   type BriefData, type BriefPost, type BriefPostKind, type BriefEvent, type BriefListing, type BriefBlogPost,
 } from './kiezBriefRules';
 
@@ -52,7 +52,14 @@ const toMs = (v: unknown): number => {
 /** Blog posts come from the Astro content collection — the caller passes them in (no astro:content here). */
 export interface BlogInput { slug: string; title: string; description: string; pubDate: unknown; draft?: boolean; cover?: string | null }
 
-export async function loadIssueData(db: Db, week: string, nowMs: number, blog: BlogInput[], opts: { cloud?: string | null } = {}): Promise<BriefData> {
+export interface LoadOptions {
+  /** Our Cloudinary cloud name; without it no thumbnail passes. */
+  cloud?: string | null;
+  /** false = no air line (the browser view of a past issue: „today's" reading would be the wrong day). */
+  air?: boolean;
+}
+
+export async function loadIssueData(db: Db, week: string, nowMs: number, blog: BlogInput[], opts: LoadOptions = {}): Promise<BriefData> {
   const w = windowFor(nowMs);
   const kinds = Object.keys(POST_COLLECTIONS) as BriefPostKind[];
   const [postLists, eventDocs, listingDocs, air] = await Promise.all([
@@ -71,7 +78,7 @@ export async function loadIssueData(db: Db, week: string, nowMs: number, blog: B
       .find({ ...PUBLIC, createdAt: { $gt: new Date(w.fromMs), $lte: new Date(w.toMs) }, status: { $in: ['available', 'reserved'] } },
         { projection: { title: 1, listingType: 1, price: 1, createdAt: 1, images: 1 } })
       .toArray(),
-    getAirHistory(db, new Date(nowMs)).catch(() => null),
+    opts.air === false ? null : getAirHistory(db, new Date(nowMs)).catch(() => null),
   ]);
 
   // Author names: one join through the public allowlist (tombstone-safe), never a stored name.
@@ -112,6 +119,36 @@ export async function loadIssueData(db: Db, week: string, nowMs: number, blog: B
   });
 }
 
+/** A SENT issue by its week key; null for a malformed key and for unknown, skipped or never-sent weeks. */
+export async function findSentIssue(db: Db, week: unknown): Promise<IssueDoc | null> {
+  if (!isIssueWeekKey(week)) return null;
+  const doc = await db.collection<IssueDoc>(KIEZ_BRIEF_COLLECTION).findOne({ _id: week, sentAt: { $type: 'date' } });
+  return doc && doc.windowTo instanceof Date ? doc : null;
+}
+
+/**
+ * A sent issue for the browser view, rebuilt from TODAY's data for the window stored at its claim.
+ * Deliberately no snapshot of the mail: a post deleted since is gone here too, a member who left
+ * reads „Ehemaliges Mitglied", a sold listing is out. No air line (see LoadOptions.air).
+ */
+export async function loadSentIssue(db: Db, doc: IssueDoc, blog: BlogInput[], opts: LoadOptions = {}): Promise<BriefData> {
+  return loadIssueData(db, doc._id, doc.windowTo.getTime(), blog, { ...opts, air: false });
+}
+
+export interface IssueListItem { week: string; sentAtMs: number }
+
+/** The sent issues, newest first — the list page. Skipped (quiet, quota) and failed weeks have no `sentAt`. */
+export async function listSentIssues(db: Db, limit = 60): Promise<IssueListItem[]> {
+  const docs = await db.collection<IssueDoc>(KIEZ_BRIEF_COLLECTION)
+    .find({ sentAt: { $type: 'date' } }, { projection: { sentAt: 1 } })
+    .sort({ sentAt: -1 })
+    .limit(limit)
+    .toArray();
+  return docs
+    .filter((d) => isIssueWeekKey(d._id) && d.sentAt instanceof Date)
+    .map((d) => ({ week: d._id, sentAtMs: (d.sentAt as Date).getTime() }));
+}
+
 export interface Recipient { id: string; email: string; name: string | null; locale: MailLocale }
 
 /** Verified, reachable members who did not turn the mail off. One query, allowlist projection. */
```

- [ ] **Step 5: Run the tests** — `npx tsx --test src/lib/newsletter/*.test.ts` → `ℹ tests 35` / `ℹ pass 35`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/newsletter/kiezBriefRules.ts src/lib/newsletter/kiezBriefRules.test.ts src/lib/newsletter/kiezBriefStore.ts src/lib/newsletter/kiezBriefStore.test.ts
git commit -m "feat: Kiez-Brief — find, list and rebuild a sent issue"
```

---

### Task 2: The link in the mail and the template's browser variant

**Files:**
- Modify: `src/emails/KiezBriefEmail.tsx`, `src/lib/newsletter/kiezBrief.ts`
- Test (create): `src/emails/KiezBriefEmail.test.ts`

**Interfaces:**
- Consumes from Task 1: `MAIL_COPY[locale].viewInBrowser`, `.allIssues`; `findSentIssue`, `loadSentIssue`.
- Produces:
  - `KiezBriefEmail` prop `web?: boolean` (default `false`); `baseUrl` may be `''` (relative links)
  - `renderIssue(data: BriefData, baseUrl: string, locale: MailLocale = 'de', web = false): Promise<string>` (`kiezBrief.ts`; the existing three-argument callers keep working)
  - `buildSentIssue(week: unknown): Promise<BriefData | null>` (`kiezBrief.ts`; `null` = no such sent issue)

- [ ] **Step 1: Write the failing test** (the first render test of a mail template; `pnpm test` picks it up through `src/**/*.test.ts`)

`src/emails/KiezBriefEmail.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from '@react-email/render';
import KiezBriefEmail from './KiezBriefEmail';
import { NAME_PLACEHOLDER, UNSUB_PLACEHOLDER, type BriefData } from '../lib/newsletter/kiezBriefRules';

const BASE = 'https://mahalle.example';
const data: BriefData = {
  week: '2026-W41',
  posts: [{ id: 'p1', kind: 'topic', title: 'Wer kennt einen <b>Schuster</b>?', author: 'Ayşe', comments: 2, dateMs: 1, excerpt: null, image: null }],
  events: [], listings: [], blog: [], air: null,
};
const html = (props: { locale?: 'de' | 'en'; web?: boolean; baseUrl?: string } = {}) => render(React.createElement(KiezBriefEmail, { data, baseUrl: BASE, ...props }));

test('the mail links to its own browser view, in the reader\'s language', async () => {
  const de = await html();
  assert.match(de, /href="https:\/\/mahalle\.example\/kiez-brief\/2026-W41\?utm_source=kiez-brief"[^>]*>Im Browser ansehen</);
  assert.doesNotMatch(de, /Alle Ausgaben/);
  const en = await html({ locale: 'en' });
  assert.match(en, />View in browser</);
  assert.doesNotMatch(en, /translate=1"[^>]*>View in browser/); // our own page, nothing to translate
});

test('the browser view links to the list, not to itself', async () => {
  const web = await html({ web: true });
  assert.match(web, /href="https:\/\/mahalle\.example\/kiez-brief"[^>]*target="_self"[^>]*>← Alle Ausgaben</); // same tab: it is a way back
  assert.doesNotMatch(web, /Im Browser ansehen/);
  assert.doesNotMatch(web, /kiez-brief\/2026-W41/);
  assert.match(await html({ web: true, locale: 'en' }), />← All issues</);
});

test('both variants: phone viewport, a tab title, placeholders intact, member text escaped', async () => {
  for (const out of [await html(), await html({ web: true })]) {
    assert.match(out, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
    assert.match(out, /<title>Kiez-Brief · KW 41<\/title>/);
    assert.ok(out.includes(UNSUB_PLACEHOLDER));
    assert.ok(out.includes(NAME_PLACEHOLDER));
    assert.ok(out.includes('Wer kennt einen &lt;b&gt;Schuster&lt;/b&gt;?'));
    assert.doesNotMatch(out, /<script/i);
  }
});

test('the browser view with an empty base prints relative links only', async () => {
  const out = await html({ web: true, baseUrl: '' });
  assert.match(out, /href="\/kiez-brief"[^>]*>← Alle Ausgaben</);
  assert.match(out, /href="\/topics\/p1\?utm_source=kiez-brief"/);
  assert.match(out, /src="\/icons\/icon-192\.png"/);
  assert.doesNotMatch(out, /(href|src)="https?:/);
});
```

- [ ] **Step 2: Run it to see it fail** — `npx tsx --test src/emails/KiezBriefEmail.test.ts` → 4 failing (no „Im Browser ansehen", no viewport meta).

- [ ] **Step 3: The template** — a real `<Head>` (viewport + title, both variants) and the top line. The arrow and the label are ONE string (`{`← ${c.allIssues}`}`): two JSX children would put a `<!-- -->` between them.

```diff
diff --git a/src/emails/KiezBriefEmail.tsx b/src/emails/KiezBriefEmail.tsx
index 6a5b220a..09857794 100644
--- a/src/emails/KiezBriefEmail.tsx
+++ b/src/emails/KiezBriefEmail.tsx
@@ -9,10 +9,12 @@ import {
 
 interface KiezBriefEmailProps {
   data: BriefData;
-  /** Absolute origin (NEXTAUTH_URL) — never hardcode the domain here. */
+  /** Absolute origin (NEXTAUTH_URL) for the mail — never hardcode the domain here. '' for the browser view (relative links). */
   baseUrl: string;
   /** The member's stored app language (users.locale); German when absent. */
   locale?: MailLocale;
+  /** true = the browser view (/kiez-brief/<week>): the top line links to the list instead of to itself. */
+  web?: boolean;
 }
 
 const POST_PATH = { topic: 'topics', announcement: 'announcements', recommendation: 'recommendations' } as const;
@@ -52,8 +54,8 @@ function berlin(ms: number, locale: MailLocale) {
 // excerpts) stays as written; in the English mail the post links ask the page to open translated.
 // Images are optional garnish: Gmail/Outlook show them only after the reader allows images,
 // so every row reads complete without them. Reads well linearised on purpose (Resend derives
-// the text part from this HTML).
-export default function KiezBriefEmail({ data, baseUrl, locale = 'de' }: KiezBriefEmailProps) {
+// the text part from this HTML). The same markup is the browser view (`web`): only the top line differs.
+export default function KiezBriefEmail({ data, baseUrl, locale = 'de', web = false }: KiezBriefEmailProps) {
   const c = MAIL_COPY[locale];
   const url = (path: string) => withUtm(`${baseUrl}${path}`);
   /** content links: the English mail asks the post page for its translation */
@@ -61,9 +63,18 @@ export default function KiezBriefEmail({ data, baseUrl, locale = 'de' }: KiezBri
   const abs = (src: string) => (src.startsWith('http') ? src : `${baseUrl}${src}`);
   return (
     <Html lang={locale}>
-      <Head />
+      <Head>
+        {/* phones open the browser view: without it the 520 px card renders on a 980 px canvas */}
+        <meta name="viewport" content="width=device-width, initial-scale=1" />
+        <title>{`Kiez-Brief · ${weekLabel(data.week, locale)}`}</title>
+      </Head>
       <Preview>{preheaderFor(data, locale)}</Preview>
       <Body style={bodyStyle}>
+        <Text style={topLine}>
+          {web
+            ? <Link href={`${baseUrl}/kiez-brief`} target="_self" style={mutedLink}>{`← ${c.allIssues}`}</Link>
+            : <Link href={url(`/kiez-brief/${data.week}`)} style={mutedLink}>{c.viewInBrowser}</Link>}
+        </Text>
         <Container style={containerStyle}>
           {/* Masthead: the app's disc + wordmark on a rust band */}
           <Section style={mast}>
@@ -204,6 +215,7 @@ function EventRow({ e, href, locale }: { e: BriefEvent; href: string; locale: Ma
 
 const bodyStyle = { backgroundColor: PAPER, fontFamily: 'Georgia, serif', padding: '24px 12px' };
 const containerStyle = { backgroundColor: '#f7f0de', border: `1.5px solid ${INK}`, borderRadius: '12px', maxWidth: '520px', overflow: 'hidden' as const };
+const topLine = { color: '#7a7264', fontSize: '12px', textAlign: 'center' as const, margin: '0 0 10px' };
 const mast = { backgroundColor: RUST, padding: '14px 24px', borderBottom: `1.5px solid ${INK}` };
 const wordmark = { color: PAPER, fontFamily: 'Georgia, serif', fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', margin: 0, lineHeight: '1.1' };
 const mastKicker = { color: PAPER, fontFamily: 'Menlo, Consolas, monospace', fontSize: '9px', letterSpacing: '0.14em', margin: '2px 0 0', opacity: 0.85 };
```

- [ ] **Step 4: The sender module** — `buildSentIssue` and the `web` parameter of `renderIssue`

```diff
diff --git a/src/lib/newsletter/kiezBrief.ts b/src/lib/newsletter/kiezBrief.ts
index 345220ee..44abc168 100644
--- a/src/lib/newsletter/kiezBrief.ts
+++ b/src/lib/newsletter/kiezBrief.ts
@@ -14,7 +14,7 @@ import {
   personalize, MAIL_LOCALES, MAX_RECIPIENTS, berlinWeekday, issueWeek, isQuiet,
   subjectFor, unsubscribeHeaders, type BriefData, type MailLocale,
 } from './kiezBriefRules';
-import { claimIssue, loadIssueData, loadRecipients, markIssue, type BlogInput, type Recipient } from './kiezBriefStore';
+import { claimIssue, findSentIssue, loadIssueData, loadRecipients, loadSentIssue, markIssue, type BlogInput, type Recipient } from './kiezBriefStore';
 
 const REPLY_TO = 'admin@mahalle.digital';
 
@@ -44,9 +44,17 @@ export async function buildIssue(nowMs = Date.now()): Promise<BriefData> {
   return loadIssueData(db, issueWeek(nowMs), nowMs, await blogPosts(), { cloud: import.meta.env.CLOUD_NAME });
 }
 
-/** The mail's HTML in one language, with the unsubscribe and name placeholders still inside. */
-export async function renderIssue(data: BriefData, baseUrl: string, locale: MailLocale = 'de'): Promise<string> {
-  return render(React.createElement(KiezBriefEmail, { data, baseUrl, locale }));
+/** A sent issue for the browser view (rebuilt from today's data, see loadSentIssue); null = no such sent issue. */
+export async function buildSentIssue(week: unknown): Promise<BriefData | null> {
+  const db = await connectDB();
+  const doc = await findSentIssue(db, week);
+  if (!doc) return null;
+  return loadSentIssue(db, doc, await blogPosts(), { cloud: import.meta.env.CLOUD_NAME });
+}
+
+/** The mail's HTML in one language, with the unsubscribe and name placeholders still inside. `web` = the browser view. */
+export async function renderIssue(data: BriefData, baseUrl: string, locale: MailLocale = 'de', web = false): Promise<string> {
+  return render(React.createElement(KiezBriefEmail, { data, baseUrl, locale, web }));
 }
 
 export interface RenderedIssue { html: Record<MailLocale, string>; subject: Record<MailLocale, string> }
```

- [ ] **Step 5: Run the test** — `npx tsx --test src/emails/KiezBriefEmail.test.ts` → `ℹ tests 4` / `ℹ pass 4`.

- [ ] **Step 6: Budgets** — `pnpm type-check 2>&1 | grep -c "error TS"` → 16.

- [ ] **Step 7: Commit**

```bash
git add src/emails/KiezBriefEmail.tsx src/emails/KiezBriefEmail.test.ts src/lib/newsletter/kiezBrief.ts
git commit -m "feat: Kiez-Brief — browser link in the mail, web variant of the template"
```

---

### Task 3: The issue page, the list page, the gate

**Files:**
- Create: `src/pages/kiez-brief/[week].ts`, `src/pages/kiez-brief/index.astro`, `src/components/newsletter/KiezBriefArchive.svelte`
- Modify: `src/lib/kiosk-i18n.ts`, `src/middleware.ts`

**Interfaces:**
- Consumes from Task 1: `listSentIssues`, `IssueListItem`; from Task 2: `buildSentIssue`, `renderIssue(data, '', locale, true)`; already on main: `unsubscribeUrl(baseUrl, userId, secret)`, `unsubSecret()`, `personalize(html, name, unsubUrl, locale)`, `storedMailLocale`, `tStr(template, vars)`.
- Produces: `GET /kiez-brief/<week>` (HTML or a 302 to `/kiez-brief`), `GET /kiez-brief` (list), copy keys `kiezBrief.kicker|title.prefix|title.accent|intro|week|sent|read|empty`.

- [ ] **Step 1: The gate** — `/kiez-brief` is a member page (prefix match covers the list and every issue; the cron route lives under `/api/cron` and is untouched)

```diff
diff --git a/src/middleware.ts b/src/middleware.ts
index 388b4d40..a1ac4047 100644
--- a/src/middleware.ts
+++ b/src/middleware.ts
@@ -90,6 +90,7 @@ export const onRequest = defineMiddleware(async (context, next) => {
       '/forum', '/topics', '/announcements', '/recommendations',
       '/calendar', '/events', '/newsboard', '/marketplace',
       '/bookmarks', '/search', '/steckbrief', '/nachbarn', '/entwuerfe',
+      '/kiez-brief', // list + browser view of sent Kiez-Brief issues (the cron lives under /api/cron)
     ];
     // List/read APIs of gated surfaces — without this the page gate is
     // cosmetic (data stays scrapable). Write endpoints already self-gate.
```

- [ ] **Step 2: The issue page** — an endpoint, not an `.astro` page: the answer is the mail's own document

`src/pages/kiez-brief/[week].ts`:

```ts
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../lib/mongodb';
import { buildSentIssue, renderIssue, unsubscribeUrl } from '../../lib/newsletter/kiezBrief';
import { unsubSecret } from '../../lib/newsletter/unsubToken';
import { personalize, storedMailLocale } from '../../lib/newsletter/kiezBriefRules';

// The browser view of one SENT Kiez-Brief issue („Im Browser ansehen" in the mail). Members only
// (middleware: /kiez-brief is a gated page). The answer is the mail's own HTML — no app chrome —
// rebuilt from today's data for the issue's stored window, in the VIEWER's language and with the
// viewer's name and unsubscribe link (a forwarded mail never shows the sender's). Every link is
// RELATIVE (base '' instead of NEXTAUTH_URL): the reader stays on the host they are on.
// An unknown, skipped or never-sent week goes to the list.
const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex',
  // Member text sits in this same-origin document: no script, no frame, no form, whatever it contains.
  'Content-Security-Policy': "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export const GET: APIRoute = async ({ params, request, redirect }) => {
  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId || !ObjectId.isValid(userId)) return redirect('/login?redirect=/kiez-brief');

  const data = await buildSentIssue(params.week);
  if (!data) return redirect('/kiez-brief');

  const db = await connectDB();
  const me = await db.collection('users').findOne({ _id: new ObjectId(userId) }, { projection: { name: 1, locale: 1 } });
  const locale = storedMailLocale(me?.locale);
  const html = personalize(
    await renderIssue(data, '', locale, true),
    typeof me?.name === 'string' ? me.name : null,
    unsubscribeUrl('', userId, unsubSecret()),
    locale,
  );
  return new Response(html, { headers: HEADERS });
};
```

- [ ] **Step 3: The list — copy, island, page**

```diff
diff --git a/src/lib/kiosk-i18n.ts b/src/lib/kiosk-i18n.ts
index 37b7aaf7..e86bd630 100644
--- a/src/lib/kiosk-i18n.ts
+++ b/src/lib/kiosk-i18n.ts
@@ -151,6 +151,15 @@ const de = {
   'nc.newsletter.weekly': 'wöchentlich',
   'nc.newsletter.off': 'aus',
   'nc.newsletter.error': 'Die Einstellung konnte nicht gespeichert werden.',
+  // Kiez-Brief list page (/kiez-brief) — DRAFT copy
+  'kiezBrief.kicker': 'Kiez-Brief',
+  'kiezBrief.title.prefix': 'Alle',
+  'kiezBrief.title.accent': 'Ausgaben',
+  'kiezBrief.intro': 'Der Kiez-Brief kommt einmal die Woche per E-Mail. Hier liest du die bisherigen Ausgaben nach. Jede zeigt den Stand von heute: Was inzwischen gelöscht wurde, fehlt.',
+  'kiezBrief.week': 'KW {n} · {year}',
+  'kiezBrief.sent': 'verschickt am {date}',
+  'kiezBrief.read': 'lesen',
+  'kiezBrief.empty': 'Noch ist keine Ausgabe verschickt worden.',
   'nc.push.enable': 'Push-Mitteilungen aktivieren',
   'nc.push.active': 'Push aktiv auf diesem Gerät',
   'nc.push.disable': 'deaktivieren',
@@ -2262,6 +2271,15 @@ const en: Dict = {
   'nc.newsletter.weekly': 'weekly',
   'nc.newsletter.off': 'off',
   'nc.newsletter.error': 'The setting could not be saved.',
+  // Kiez-Brief list page (/kiez-brief) — DRAFT copy
+  'kiezBrief.kicker': 'Kiez-Brief',
+  'kiezBrief.title.prefix': 'All',
+  'kiezBrief.title.accent': 'issues',
+  'kiezBrief.intro': 'The Kiez-Brief arrives by e-mail once a week. Here you can read the past issues. Each one shows today\'s state: what has been deleted since is missing.',
+  'kiezBrief.week': 'CW {n} · {year}',
+  'kiezBrief.sent': 'sent on {date}',
+  'kiezBrief.read': 'read',
+  'kiezBrief.empty': 'No issue has been sent yet.',
   'nc.push.enable': 'Enable push notifications',
   'nc.push.active': 'Push active on this device',
   'nc.push.disable': 'disable',
```

`src/components/newsletter/KiezBriefArchive.svelte`:

```svelte
<script lang="ts">
  // The list of sent Kiez-Brief issues (/kiez-brief). Rows link to the browser view, which is the
  // mail's own HTML and not an Astro page — hence `data-astro-reload` (no ClientRouter swap).
  // No <style> block on purpose: Tailwind classes only.
  import { t, tStr, locale } from '../../lib/kiosk-i18n';
  import type { IssueListItem } from '../../lib/newsletter/kiezBriefStore';

  let { issues = [] } = $props<{ issues?: IssueListItem[] }>();

  const sentOn = (ms: number, loc: string) =>
    new Date(ms).toLocaleDateString(loc === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' });
</script>

<div data-kiez-brief-archive class="px-4 md:px-9 lg:px-10 pt-5 md:pt-6 pb-10">
  <section class="mb-5 pb-4 border-b border-dashed border-rule">
    <p class="font-dmmono text-[11px] uppercase tracking-[0.18em] mb-2" style="color: var(--k-accent);">{$t['kiezBrief.kicker']}</p>
    <h1 class="font-bricolage font-extrabold text-[34px] min-[380px]:text-4xl md:text-5xl tracking-tight leading-[0.95] text-ink">
      {$t['kiezBrief.title.prefix']}
      <em class="font-instrument italic font-normal" style="color: var(--k-accent);">{$t['kiezBrief.title.accent']}</em>
    </h1>
    <p class="mt-3 font-instrument italic text-[15px] text-ink-soft max-w-[60ch]">{$t['kiezBrief.intro']}</p>
  </section>

  {#if issues.length}
    <ul class="flex flex-col gap-2">
      {#each issues as issue (issue.week)}
        <li>
          <a
            href={`/kiez-brief/${issue.week}`}
            data-astro-reload
            data-kiez-brief-issue={issue.week}
            class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-3 min-h-[44px] rounded-lg border-[1.5px] border-ink bg-paper-warm hover:bg-paper"
          >
            <span class="font-bricolage font-bold text-[16px] text-ink">{tStr($t['kiezBrief.week'] as string, { n: Number(issue.week.slice(-2)), year: issue.week.slice(0, 4) })}</span>
            <span class="font-dmmono text-[11px] text-ink-mute">{tStr($t['kiezBrief.sent'] as string, { date: sentOn(issue.sentAtMs, $locale) })}</span>
            <span class="ml-auto font-dmmono text-[11px] uppercase tracking-[0.1em] underline" style="color: var(--k-accent);">{$t['kiezBrief.read']}</span>
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <p data-kiez-brief-empty class="py-10 text-center font-instrument italic text-[17px] text-ink-soft">{$t['kiezBrief.empty']}</p>
  {/if}
</div>
```

`src/pages/kiez-brief/index.astro`:

```astro
---
// /kiez-brief — the list of sent Kiez-Brief issues, newest first. Members only (middleware gate;
// the check below is the same belt-and-braces as /entwuerfe). Each row opens the browser view
// (`[week].ts`). Not in any menu: the way in is „Im Browser ansehen" in the mail, then „Alle Ausgaben".
import KioskLayout from '../../layouts/KioskLayout.astro';
import KiezBriefArchive from '../../components/newsletter/KiezBriefArchive.svelte';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../lib/mongodb';
import { listSentIssues } from '../../lib/newsletter/kiezBriefStore';

const session = await getSession(Astro.request);
if (!session?.user?.id) {
  return Astro.redirect('/login?redirect=/kiez-brief');
}
Astro.response.headers.set('Cache-Control', 'no-store');
const issues = await listSentIssues(await connectDB());
---

<KioskLayout title="Mahalle · Kiez-Brief" description="Alle Ausgaben des Kiez-Briefs." page="profile" tour={false} noindex>
  <!-- Same centred 1280 px page column as every main section. -->
  <div class="mx-auto w-full max-w-[1280px]">
    <KiezBriefArchive client:only="svelte" issues={issues} />
  </div>
</KioskLayout>
```

- [ ] **Step 4: Budgets** — `pnpm type-check 2>&1 | grep -c "error TS"` → 16; `npx -y svelte-check@4 2>&1 | tail -1` → `81 ERRORS`; `pnpm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → 379 / 379 / 0.

- [ ] **Step 5: Commit**

```bash
git add "src/pages/kiez-brief/[week].ts" src/pages/kiez-brief/index.astro src/components/newsletter/KiezBriefArchive.svelte src/lib/kiosk-i18n.ts src/middleware.ts
git commit -m "feat: Kiez-Brief — issue page and list of sent issues, members only"
```

---

### Task 4: Browser gate on the local production build, docs

**Files:**
- Scripts (gitignored, on disk in the main checkout): `scratchpad/kiez-brief/web-seed.mts seed|cleanup` (dev DB only; writes four MARKED rows — two sent, one skipped, one never sent — and prints their week keys as JSON), `scratchpad/kiez-brief/web-probe.cjs <base> '<that JSON>'`.
- Modify: `CLAUDE.md` (root), `src/components/forum/kiosk/CLAUDE.md`, `docs/runbooks/kiez-brief.md`

- [ ] **Step 1: Seed** — `npx tsx --env-file=.env scratchpad/kiez-brief/web-seed.mts seed 2>/dev/null > scratchpad/kiez-brief/web-weeks.json` → one JSON line with `current`, `older`, `skipped`, `unsent`.

- [ ] **Step 2: Build + serve** — `npx astro build --config scratchpad/astro.config.preview.mjs`; then `PORT=4655 HOST=127.0.0.1 node --env-file=.env dist/server/entry.mjs` in the background.

- [ ] **Step 3: Probe**

```bash
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/kiez-brief/web-probe.cjs http://127.0.0.1:4655 "$(cat scratchpad/kiez-brief/web-weeks.json)"
```
Expected: 29 × `PASS`, last line `all passed`. It covers: logged out → login with the target kept and no issue HTML in the 302; a member lands on the issue straight from the login; `text/html`, `no-store`, `noindex`, the strict CSP; no placeholder left, the viewer's name and own unsubscribe link; „← Alle Ausgaben" and no „Im Browser ansehen"; no air line, no script, no console error, no sideways scroll at 390 px, tab title; the list shows the two sent weeks newest first with rows ≥ 44 px at the 16 px inset; a row opens its issue; skipped, never-sent, unknown, malformed and operator-shaped weeks end on the list; an English member reads the issue in English; the mail variant (admin preview) links to `/kiez-brief/<current week>` and has no list link. Look at the four screenshots it writes (`scratchpad/kiez-brief/web-issue-390.png`, `web-list-390.png`, `web-issue-1280.png`, `web-list-1280.png`).

- [ ] **Step 4: Clean up** — `npx tsx --env-file=.env scratchpad/kiez-brief/web-seed.mts cleanup` → `cleanup: 4 probe rows`; stop the server with `fuser -k 4655/tcp` (its own command).

- [ ] **Step 5: Docs**

```diff
diff --git a/src/components/forum/kiosk/CLAUDE.md b/src/components/forum/kiosk/CLAUDE.md
index 4b9e6609..7c1400b1 100644
--- a/src/components/forum/kiosk/CLAUDE.md
+++ b/src/components/forum/kiosk/CLAUDE.md
@@ -398,5 +398,6 @@ Spec `docs/superpowers/specs/2026-10-03-kiez-brief-newsletter-design.md`; code `
 - **Unsubscribe, two paths, no token table:** HMAC link `/newsletter/abmelden?t=` (`makeUnsubToken`/`verifyUnsubToken`; `unsubSecret()` = `NEXTAUTH_SECRET`, fallback `JWT_SECRET`; no expiry; invalid token = neutral page, no oracle; the page only CONFIRMS on GET — „Kiez-Brief abbestellen?" + an „Abbestellen" button that POSTs the same URL — because mail link scanners prefetch GET links) and the RFC 8058 one-click `POST /api/newsletter/unsubscribe?t=` with `List-Unsubscribe` + `List-Unsubscribe-Post` headers on every mail (the only route exempt from the cross-site form check, see root CLAUDE.md). Rotating the secret kills every old link.
 - **Legal notice:** § 7 Abs. 3 UWG soft opt-in (EuGH C-654/23, 2025-11-13: a free account counts as a service sale) — one sentence on the register form (`auth.register.note`) and in Datenschutz, plus the footer link of every mail.
 - **Admin preview:** `GET /api/admin/kiez-brief/preview` (admin session) renders this week's issue as HTML, no claim, no send; `POST` sends ONE copy to the admin's own address.
+- **Browser view + list (2026-10-04, plan `docs/superpowers/plans/2026-10-04-kiez-brief-browser-view.md`):** every mail opens with a small „Im Browser ansehen" link to `/kiez-brief/<week>` (`src/pages/kiez-brief/[week].ts`); that page's top line reads „← Alle Ausgaben" and leads to `/kiez-brief` (`index.astro` + `src/components/newsletter/KiezBriefArchive.svelte`, copy `kiezBrief.*`, DRAFT). Members only (`/kiez-brief` is in `GATED_PAGES`; logged out → login, target kept) and in no menu — the way in is the mail. **No snapshot of the mail is stored:** the page is REBUILT from today's data for the window saved in the issue's `kiezBriefIssues` row (`findSentIssue` → `loadSentIssue`, i.e. `loadIssueData` at `windowTo`), so a post deleted since is gone here too, a member who left reads „Ehemaliges Mitglied", a sold listing is out, reply counts are today's. Rules that bite: only a SENT issue has a page (`sentAt` is a date; skipped, failed and never-sent weeks, unknown and malformed keys all redirect to the list — `isIssueWeekKey()` runs before the database); no air line (`LoadOptions.air: false` — „today's" reading would be another day's); the HTML is the mail template with `web: true`, rendered in the VIEWER's stored language with the viewer's name and unsubscribe link (never the original recipient's), all links RELATIVE (base `''`, not `NEXTAUTH_URL`); the answer is `no-store`, `noindex` and carries its own strict CSP (`default-src 'none'`, images and inline styles only) because member text sits in a same-origin document; the list's rows carry `data-astro-reload` (the issue is not an Astro page, the ClientRouter must not try to swap it). The template's `<Head>` gained a viewport meta and a `<title>` for both variants. Tests: `kiezBriefStore.test.ts`, `kiezBriefRules.test.ts`, `src/emails/KiezBriefEmail.test.ts` (the first render test of a mail template). Probe: `scratchpad/kiez-brief/web-seed.mts seed|cleanup` (marked rows, dev DB only) + `web-probe.cjs <base> '<json of the seed>'` (29 checks).
 - **Honest gaps:** GitHub's scheduled-run jitter (mail lands 18:00–~22:00 Berlin, Monday 08:00 if skipped); bounces are not fed back (`email.bounced` → `newsletter: 'off'` is the later fix); a member who verified after Sunday waits a week; a failed batch is a Sentry issue, never re-sent.
 - **Probes** (gitignored, dev DB only): `scratchpad/kiez-brief/dry-run.mts` (full issue + `cleanup` removes the claim and preferences), `token.mts <email>` (prints a derived unsubscribe token, never the secret), `probe.cjs <base> <token>` (16 checks, expects ALL PASS).
```

```diff
diff --git a/docs/runbooks/kiez-brief.md b/docs/runbooks/kiez-brief.md
index 38bee2be..fc7dafe9 100644
--- a/docs/runbooks/kiez-brief.md
+++ b/docs/runbooks/kiez-brief.md
@@ -29,3 +29,10 @@ More than `MAX_RECIPIENTS` (95, in `kiezBriefRules.ts`) members qualify. Resend
 
 - **Prod: never.** Never delete a `kiezBriefIssues` row — the issue would be sent to every member again.
 - **Dev only:** `npx tsx --env-file=.env scratchpad/kiez-brief/dry-run.mts cleanup` removes the claim and resets preferences; run `dry-run.mts` again. Probes: `token.mts`, `probe.cjs` (16 checks).
+
+## Browser view
+
+- Every mail links to `/kiez-brief/<week>` („Im Browser ansehen"); `/kiez-brief` lists the sent issues. Members only, in no menu.
+- The page is rebuilt from today's data for the window stored in the issue's row — nothing of the mail is stored. An old issue therefore shows less than the mail did once posts were deleted or listings sold. That is intended.
+- Only an issue with `sentAt` has a page. If a send succeeded but the `sentAt` write failed (Sentry issue of that evening), the link in that mail leads to the list. Repair, prod, by hand and only then: set `sentAt` (a date) and `recipients` on that one row — never delete the row.
+- Dev probe: `npx tsx --env-file=.env scratchpad/kiez-brief/web-seed.mts seed` prints four week keys (two sent, one skipped, one never sent); pass that JSON to `web-probe.cjs` on the local build (29 checks); `web-seed.mts cleanup` afterwards.
```

```diff
diff --git a/CLAUDE.md b/CLAUDE.md
index d9cb87d4..b731637a 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -28,7 +28,7 @@ pnpm type-check   # TypeScript validation
 pnpm test         # all lib tests (src/**/*.test.ts, node:test via tsx) — also a step in checks.yml since 2026-10-02
 npx -y svelte-check@4  # Svelte diagnostics sweep — dev-only warnings (e.g. state_referenced_locally) never appear in `pnpm build` output
 # CI (checks.yml) runs on Node 24 — its `node-version` (and `schillerkiez-stats.yml`'s) must follow `engines.node` in package.json: after the 2026-10-01 bump to >=24 both workflows still installed Node 20, `pnpm install` refused (ERR_PNPM_UNSUPPORTED_ENGINE) and every checks run failed for a day while Vercel kept deploying; fixed `f36dca6d`. After a push that touches package.json or a workflow, look at the run: `gh run list --workflow=checks.yml --limit 1`.
-# CI (checks.yml) also runs `pnpm test` (336 lib tests as of 2026-10-03) as its last step since 2026-10-02 — a failing test fails the job. Actions are on Node 24 majors: `actions/checkout@v7`, `actions/setup-node@v7`, `gitleaks/gitleaks-action@v3`, and `pnpm/action-setup@v5` (NOT v6: v6 installs pnpm 11 first and self-updates down to the `packageManager` version — open upstream issues with pnpm 10 projects; move to v6 only together with pnpm 11).
+# CI (checks.yml) also runs `pnpm test` (379 lib tests as of 2026-10-04) as its last step since 2026-10-02 — a failing test fails the job. Actions are on Node 24 majors: `actions/checkout@v7`, `actions/setup-node@v7`, `gitleaks/gitleaks-action@v3`, and `pnpm/action-setup@v5` (NOT v6: v6 installs pnpm 11 first and self-updates down to the `packageManager` version — open upstream issues with pnpm 10 projects; move to v6 only together with pnpm 11).
 # CI (checks.yml) gates PRs on ratchet-only error budgets: tsc ≤16, svelte-check ≤81 (27/94→26/93 on 09-06 when the contact-form i18n fix cleared an untyped record, 93→92 on 09-10 with the shared initialsOf helper, 26/92→23/89 on 09-21 when the three unused legacy `/api/*/all` routes were deleted, 23/89→16/81 on 09-30 when the dead legacy React/dark-glass cluster was deleted — lower them when errors get fixed, never raise them)
 # Dead-code sweep (read-only, never installed, never `fix`): `npx -y knip@latest --include files` (text mode — the JSON reporter hides unused files) and `npx -y fallow@latest dead-code` / `fallow dupes`. Both are blind to `scripts/`, `.github/` and `scratchpad/`, so grep those before removing a package (dotenv, exceljs, @astrojs/node are used only there); their false positives here: `auth.config.ts` (loaded by auth-astro by convention), every `*.test.ts` (run by hand with `npx tsx`), all of `src/styles/*.css` (`.astro` frontmatter imports + `global.css` `@import`s), `design/handoffs/**`. Phase 1 (22 dead React/dark-glass files) landed 2026-09-30 (`9f7b92dc`); Phase 2 (19 zero-import packages + the `netlify:*` scripts + the `mongoose` SSR external) landed 2026-09-30; Phase 3 (`requireMemberSession()` in 22 member write routes) landed 2026-09-30 — the file/package sweep is closed; the remainder (unused exports and types, 9 unread Svelte props, the duplicate `ModerationDecision`/`ReportReason`, the `global.css` glass block) landed 2026-10-01 with `docs/superpowers/plans/2026-10-01-unused-exports-sweep.md`. What the tools still report afterwards is the KEEP list in that plan's inventory file (symbols used only by `scripts/`, `scratchpad/`, tests or root configs). Four names stay on that list: `PLR_CODES` (generator output of `scripts/simplify-plr.js`), `AIR_DAILY_COLLECTION` + `recomputeDailyRollup` (`scratchpad/repair-air-sentinel.mts`), the `COMMENT_MAX_LEN` re-export in `comment.schema.ts` (`scratchpad/comment-len-check.mts`). `jsonwebtoken` + `@types/jsonwebtoken` left the same day (`5fb4173a`) once the legacy token helpers in `src/lib/auth.ts` were gone — the `JWT_SECRET` env var STAYS, `auth.config.ts` reads it as the fallback Auth.js secret. Left on purpose, it needs a decision: `ModeratingModal` cannot be dismissed by the member (its `onDismiss` was never called and is gone). (The write-only `lastSubmittedAt` store and the stale `ADM_REPORT_REASONS` comment were removed on 2026-10-02.) When running a per-symbol name search for such a sweep, restrict it to code files and exclude your own analysis output (`scratchpad/sweep/*.json` held every name and made 142 of 164 symbols look used).
 ```
@@ -91,7 +91,7 @@ src/
 ### Landing + login gating (Aug 2026)
 - `/` is the public landing page; any request with a session is SSR-redirected to `/forum` before render (members never see the landing). Logged-out visitors get the landing, `/forum` and the other member surfaces bounce to login.
 - **Gate lives in `src/middleware.ts`**, runs only for SSR (non-prerendered) requests, ahead of the pre-existing protected-routes block:
-  - `GATED_PAGES` (prefix match, → `302 /login?redirect=<path+search>`): `/forum`, `/topics`, `/announcements`, `/recommendations`, `/calendar`, `/events`, `/newsboard`, `/marketplace`, `/bookmarks`, `/search`, `/steckbrief`, `/nachbarn`, `/entwuerfe`.
+  - `GATED_PAGES` (prefix match, → `302 /login?redirect=<path+search>`): `/forum`, `/topics`, `/announcements`, `/recommendations`, `/calendar`, `/events`, `/newsboard`, `/marketplace`, `/bookmarks`, `/search`, `/steckbrief`, `/nachbarn`, `/entwuerfe`, `/kiez-brief` (list + browser view of sent Kiez-Brief issues, since 2026-10-04).
   - `GATED_APIS` (prefix match, → `401 { error: 'Unauthorized' }`): `/api/topics`, `/api/announcements`, `/api/recommendations`, `/api/events`, `/api/news`, `/api/comments`, `/api/listings`, `/api/users`, `/api/search`.
   - `API_ALLOWLIST`: `/api/news/fetch-daily` — the daily news cron authenticates via its own `CRON_SECRET` Bearer header and must keep working without a session.
 - **Marketplace gated since 2026-08-25** (user decision: inner-community, not a public market — this closed the formerly pending "keep it public for SEO" question); `/profile` stays ungated (it renders its own logged-out state rather than redirecting).
@@ -205,7 +205,7 @@ See `src/pages/api/news/CLAUDE.md` — full notes load when working in that subt
 - `translationCache` - 90d-TTL cache of DeepL translations (`{ key (unique: contentType:contentId:lang:contentHash), contentType, contentId, targetLang, contentHash, title, body, detectedSource, createdAt }`). Content-hash keying means edits miss the cache naturally (no invalidation hook needed); stale rows for edited content just age out via TTL. Translations of later-DELETED content also persist until TTL — accepted TTL-bounded residue, same precedent as `kiezKontextCache` snapshots. Indexes via `scripts/create-translation-indexes.ts`. Written by `src/lib/translation/translateContent.ts` (server-authoritative: visibility-checked content only, never client-supplied text). Blog posts (repo MDX, not Mongo) use the same collection through `src/lib/translation/translateBlog.ts` — key `blog:<slug>:<lang>:<hash>`, a `blocks` array instead of `body` (2026-09-26).
 - `blogAnnouncements` - Once-only record of blog posts already announced to members (`{ _id: <post slug>, announcedAt }`, since 2026-10-02). The `_id` IS the uniqueness guard — no extra index. Written by `claimNewBlogPosts()` (`src/lib/blog/blogAnnounce.ts`); a slug is claimed BEFORE anything is sent, so a duplicate-key loser stays silent (at-most-once, a failed send is never retried). Never delete a row in prod — the post would be announced again. Details: `src/components/blog/CLAUDE.md` → „New-post notifications".
 - `forumDigests` - Once-per-Berlin-day record of the forum digest (`{ _id: <Berlin day 'YYYY-MM-DD'>, until: Date, sentAt: Date }`, since 2026-10-03). Claim-by-insert BEFORE anything is sent (the `_id` is the uniqueness guard), so it is at-most-once per day: a duplicate-key loser — e.g. the afternoon GitHub run — stays silent and a failed send is never retried. The digest window runs from the previous row's `until` (24 h on the first run, never more than 48 h). Never delete today's row in prod — the digest would go out again. Written by `sendForumDigest()` (`src/lib/forum/forumNotify.ts`); rules in `src/components/forum/kiosk/CLAUDE.md` → „Forum notifications".
-- `kiezBriefIssues` - Once-per-issue-week record of the weekly Kiez-Brief e-mail (`{ _id: <ISO week of now−24h, e.g. '2026-W41'>, windowFrom, windowTo, claimedAt, fallback, recipients?, skipped?: 'quiet' | 'quota', sentAt? }`, since 2026-10-03). Claim-by-insert BEFORE rendering or sending (the `_id` is the uniqueness guard), so it is at-most-once per issue: a duplicate-key loser stays silent and a failed send is never retried. Sunday's GitHub run and the Monday fallback (Berlin Mondays only — on any other day the daily route's call is `not-due`, since `now − 24 h` from Tuesday already names the next week) share the key (the issue week is taken from `now − 24 h` so Monday 06:00 UTC still belongs to Sunday's week). `skipped: 'quiet'` = no content that week, `'quota'` = more than `MAX_RECIPIENTS` (95) recipients. Never delete a row in prod — the issue would go out again (dev: `scratchpad/kiez-brief/dry-run.mts cleanup`). Written by `sendKiezBrief()` (`src/lib/newsletter/kiezBrief.ts`); rules in `src/components/forum/kiosk/CLAUDE.md` → „Kiez-Brief“.
+- `kiezBriefIssues` - Once-per-issue-week record of the weekly Kiez-Brief e-mail (`{ _id: <ISO week of now−24h, e.g. '2026-W41'>, windowFrom, windowTo, claimedAt, fallback, recipients?, skipped?: 'quiet' | 'quota', sentAt? }`, since 2026-10-03). Claim-by-insert BEFORE rendering or sending (the `_id` is the uniqueness guard), so it is at-most-once per issue: a duplicate-key loser stays silent and a failed send is never retried. Sunday's GitHub run and the Monday fallback (Berlin Mondays only — on any other day the daily route's call is `not-due`, since `now − 24 h` from Tuesday already names the next week) share the key (the issue week is taken from `now − 24 h` so Monday 06:00 UTC still belongs to Sunday's week). `skipped: 'quiet'` = no content that week, `'quota'` = more than `MAX_RECIPIENTS` (95) recipients. Never delete a row in prod — the issue would go out again (dev: `scratchpad/kiez-brief/dry-run.mts cleanup`). Written by `sendKiezBrief()` (`src/lib/newsletter/kiezBrief.ts`); rules in `src/components/forum/kiosk/CLAUDE.md` → „Kiez-Brief“. Since 2026-10-04 the row is also what the members-only browser view reads (`/kiez-brief/<week>`, list at `/kiez-brief`): a SENT row's `windowFrom`/`windowTo` is the window the page is rebuilt for from today's data — no mail content is stored, so deleted posts and tombstoned names disappear from old issues too.
 - `landingCache` - 1h in-code-TTL singleton doc (`{ _id: 'landing', payload, computedAt }`) behind `getLandingData()` (`src/lib/landing.ts`) — computes the former heartbeat rows (forum posts this ISO week, weekend events, air grade + 7-day spark, today's Kurier top 3 with `sektion`/`imageUrl`, population — the black strip left the page on 2026-09-29, the rows still feed `/api/kiez-heartbeat` and the Kiez frame's spark), plus the Schaufenster payload `schaufenster` = `forum` peek (title, tags, likes, comments, saves), `forumStats`, `calendar` (month count + day dots), `listing` peek, `marketStats` (available + reserved, like the page), `kurierStats` (issue number of the SHOWN day, counts, `today`), `kiez`; the Beilage's `blogMeta` is a page prop, not cached. Counts include warning-labelled posts (the pages show them blurred), peeks and calendar dots exclude them. `getAirHistory().lastReading` now carries the four component grades (also visible on `/api/kiez-air-history`); since 2026-09-29 the air reading is LIVE-FIRST (`fetchMc042()` → `readingFromBlume()` at compute time, log fallback, mc042 only); the Kiez replica's 7-day bars use `lqiMean` (the page uses the max). The "zero rule" (a row without life is omitted, not zeroed) is applied server-side before caching. `GET /api/kiez-heartbeat` is a thin public wrapper around the same lib call — never self-fetched by the landing SSR itself. Since 2026-09-28 the payload also carries `schaufenster` (forum/listing peeks + stats, calendar month days, Kurier stats, Kiez fields) and `kurier[].imageUrl`; a payload cached before that renders every frame in fallback mode. Since 2026-09-29 afternoon also `schaufenster.forumPeeks` (3), `listings` (3), `calendar.upcoming` (next 4 public events from the Berlin day: `dateISO,title,category,allDay,startISO`), `kiez.pop` (`period, rows[{name,residents}], total` from the latest demographics period, names via `KZ_PLR_SHORT`) — all optional, older docs render without the extra rows. `NO_WARN` now also guards the Kurier items.
 
 ## Environment Variables
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md src/components/forum/kiosk/CLAUDE.md docs/runbooks/kiez-brief.md
git commit -m "docs: Kiez-Brief browser view and list of sent issues"
```

---

## After the merge (owner)

- Tonight's issue (2026-W40) goes out with whatever is deployed at send time. If this lands after the send, the first mail with the link is next Sunday's; the page for tonight's issue works either way (its row has `sentAt`).
- Check on prod with a member session: `/kiez-brief` lists the sent issues; one opens.
