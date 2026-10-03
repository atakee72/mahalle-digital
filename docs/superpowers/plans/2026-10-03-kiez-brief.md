# Kiez-Brief (weekly member e-mail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Sunday evening, every verified member gets one e-mail with the week's new forum posts, next week's events, new listings and blog posts — automatically, once, with a switch in the app and an unsubscribe link in every mail.

**Architecture:** Three layers like the forum digest: pure rules (`kiezBriefRules.ts`, tested), a database layer that takes a `Db` (`kiezBriefStore.ts`, tested with an in-memory double, also behind the dev dry-run script), and a never-throw sender (`kiezBrief.ts`: render once with React Email, substitute each member's unsubscribe link, one Resend batch call). The issue is claimed per ISO week BEFORE sending (`kiezBriefIssues`). Trigger: GitHub Actions on Sunday 16:00 UTC → `GET /api/cron/kiez-brief`; the Monday 06:00 UTC cron sends it if Sunday's run never claimed the week. Unsubscribe = HMAC token link + RFC 8058 one-click POST; Astro's own cross-site form check moves into our middleware so that ONE route can be exempt.

**Tech Stack:** Astro 5 SSR + Svelte 5 islands, MongoDB driver, React Email (`@react-email/components`, `@react-email/render`), Resend SDK 6 (`batch.send`), node:crypto HMAC, node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-10-03-kiez-brief-newsletter-design.md`. Every code block below was run on a throwaway branch (`scratch/kiez-brief`, commit `ee55aba4`): 23 new tests green, tsc 16 / svelte-check 81 / 359 tests, browser probe 16/16 on the local production build, a dev dry run rendered the real issue.

## Global Constraints

- Error budgets stay EXACTLY at `pnpm type-check` 16 errors and `npx -y svelte-check@4` 81 errors; `pnpm test` stays green (336 before this plan, 359 after).
- Commit messages: plain and concise. NO „🤖 Generated with Claude Code" line, NO „Co-Authored-By" footer.
- Never stage secrets; never print any `.env` value (names only). The dev password lives in `scratchpad/devpw.txt`, read by probes, never printed.
- `kiezBriefRules.ts` has NO imports (the panel island imports from it). `kiezBriefStore.ts` takes a `Db` and must not import `connectDB`, the mailer, Sentry or anything reading `import.meta.env` (it runs under plain `tsx`). `unsubToken.ts` is server-only (node:crypto).
- The HMAC secret is the Auth.js secret: `NEXTAUTH_SECRET`, `JWT_SECRET` as its fallback (`unsubSecret()`) — the project has no `AUTH_SECRET` variable despite the root CLAUDE.md's env list.
- German only in the mail; panel copy DE + EN in `src/lib/kiosk-i18n.ts` (draft copy). Styles for the panel row already exist (`.nc-pref*` in `global.css`).
- `MAX_RECIPIENTS = 95`; recipients = `emailVerified: true`, not anonymized, not banned, `newsletter != 'off'`, e-mail is a string.
- Astro's `security.checkOrigin` is switched OFF and replaced by `isCrossSiteForm()` in the middleware with exactly one exempt path, `/api/newsletter/unsubscribe`. Never re-enable Astro's check while that exemption is needed (it runs before the middleware).

## Review Focus

1. Sunday's GitHub run AND the Monday fallback must never both send — pinned by the `issueWeek` test „Sunday evening and the Monday-morning fallback share one issue key" (Task 1) and the claim test (Task 2).
2. A member who unsubscribed by link, by one-click or by the switch must not receive the next issue — `loadRecipients` filter test (Task 2); probe steps „jonas is off after the link / after one-click" (Task 5).
3. A cross-site form POST to any OTHER route must still be refused after Astro's check moved — `isCrossSiteForm` tests (Task 3) and the probe's „a cross-site form POST elsewhere is still refused" (Task 5).
4. A quiet week sends nothing but still claims the week; more than 95 recipients sends nothing and alerts — `isQuiet` test (Task 1), the `sendKiezBrief` branches (Task 2, read by the reviewer; the dry run cannot reach them).
5. The rendered mail must leave no `%%UNSUB%%` behind and each member's link must be their own — `mailsFor` substitution (Task 2); probe „admin preview renders the issue" asserts the placeholder is gone (Task 5).

---

### Task 1: Pure rules + the unsubscribe token

**Files:**
- Create: `src/lib/newsletter/kiezBriefRules.ts`, `src/lib/newsletter/unsubToken.ts`
- Test: `src/lib/newsletter/kiezBriefRules.test.ts`, `src/lib/newsletter/unsubToken.test.ts`

**Interfaces:**
- Produces: `NEWSLETTER_MODES`, `NewsletterMode`, `storedNewsletterMode`, `MAX_RECIPIENTS`, `UNSUB_PLACEHOLDER`, `isoWeek`, `issueWeek`, `weekLabel`, `windowFor`, `BriefData` (+ `BriefPost/Event/Listing/BlogPost/Air`), `POST_KIND_LABEL`, `LISTING_KIND_LABEL`, `AIR_LABEL`, `arrangeData`, `isQuiet`, `subjectFor`, `preheaderFor`, `withUtm`, `fmtEventWhen`, `fmtPrice`, `unsubscribeHeaders`; `makeUnsubToken(userId, secret)`, `verifyUnsubToken(token, secret)`, `unsubSecret()`.

- [ ] **Step 1: Write the failing tests**

`src/lib/newsletter/kiezBriefRules.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  storedNewsletterMode, isoWeek, issueWeek, weekLabel, windowFor, arrangeData, isQuiet, subjectFor,
  preheaderFor, withUtm, fmtEventWhen, fmtPrice, unsubscribeHeaders, MAX_POSTS, MAX_EVENTS, MAX_LISTINGS, WINDOW_MS,
  type BriefData,
} from './kiezBriefRules';

const SUN_18 = Date.parse('2026-10-11T16:00:00.000Z'); // Sunday 18:00 CEST, ISO week 41
const MON_06 = Date.parse('2026-10-12T06:00:00.000Z'); // Monday 08:00 CEST — the fallback, ISO week 42

const empty = (): BriefData => ({ week: '2026-W41', posts: [], events: [], listings: [], blog: [], air: null });
const post = (id: string, h: number): BriefData['posts'][number] => ({ id, kind: 'topic', title: `T${id}`, author: 'A', comments: 0, dateMs: SUN_18 - h * 3_600_000 });

test('the stored preference falls back to weekly', () => {
  assert.equal(storedNewsletterMode('off'), 'off');
  for (const v of [undefined, null, '', 'weekly', 'OFF', 1]) assert.equal(storedNewsletterMode(v), 'weekly');
});

test('ISO week of a Berlin day, around the year boundary too', () => {
  assert.equal(isoWeek(SUN_18), '2026-W41');
  assert.equal(isoWeek(MON_06), '2026-W42');
  assert.equal(isoWeek(Date.parse('2026-01-01T12:00:00.000Z')), '2026-W01');
  assert.equal(isoWeek(Date.parse('2027-01-03T12:00:00.000Z')), '2026-W53'); // Sunday 3 Jan 2027 is still ISO week 53 of 2026
  assert.equal(isoWeek(Date.parse('2026-10-11T22:30:00.000Z')), '2026-W42'); // 00:30 Berlin Monday
});

test('Sunday evening and the Monday-morning fallback share one issue key', () => {
  assert.equal(issueWeek(SUN_18), '2026-W41');
  assert.equal(issueWeek(MON_06), '2026-W41');
  assert.equal(issueWeek(Date.parse('2026-10-13T06:00:00.000Z')), '2026-W42'); // Tuesday: next issue
  assert.equal(weekLabel('2026-W05'), 'KW 5');
});

test('the window looks seven days back and seven days ahead', () => {
  assert.deepEqual(windowFor(SUN_18), { fromMs: SUN_18 - WINDOW_MS, toMs: SUN_18, aheadMs: SUN_18 + WINDOW_MS });
});

test('sections are ordered and capped, an invalid air grade is dropped', () => {
  const d = empty();
  d.posts = Array.from({ length: MAX_POSTS + 3 }, (_, i) => post(String(i), i));
  d.events = [{ id: 'b', title: 'B', startMs: 2, allDay: false, location: null }, { id: 'a', title: 'A', startMs: 1, allDay: true, location: 'Platz' }];
  d.listings = Array.from({ length: MAX_LISTINGS + 1 }, (_, i) => ({ id: String(i), title: 'L', kind: 'sell' as const, price: 1, createdMs: i }));
  d.air = { lqi: 7 };
  const a = arrangeData(d);
  assert.equal(a.posts.length, MAX_POSTS);
  assert.equal(a.posts[0].id, '0'); // newest first
  assert.deepEqual(a.events.map((e) => e.id), ['a', 'b']); // nearest first
  assert.equal(a.listings.length, MAX_LISTINGS);
  assert.equal(a.listings[0].id, String(MAX_LISTINGS)); // newest first
  assert.equal(a.air, null);
  assert.deepEqual(arrangeData({ ...empty(), air: { lqi: 2 } }).air, { lqi: 2 });
  assert.equal(MAX_EVENTS, 8);
});

test('a quiet week is one without content; the air line alone does not count', () => {
  assert.equal(isQuiet(empty()), true);
  assert.equal(isQuiet({ ...empty(), air: { lqi: 1 } }), true);
  assert.equal(isQuiet({ ...empty(), blog: [{ slug: 's', title: 't', description: 'd', pubMs: 1 }] }), false);
});

test('the subject names the two biggest counts, singular and plural', () => {
  const d = empty();
  d.posts = [post('1', 1), post('2', 2), post('3', 3)];
  d.events = [{ id: 'e', title: 'E', startMs: 1, allDay: false, location: null }];
  d.listings = [{ id: 'l', title: 'L', kind: 'gift', price: null, createdMs: 1 }];
  assert.equal(subjectFor(d), 'Kiez-Brief · KW 41 · 3 neue Beiträge, 1 Termin');
  d.listings.push({ id: 'l2', title: 'L', kind: 'gift', price: null, createdMs: 2 });
  assert.equal(subjectFor(d), 'Kiez-Brief · KW 41 · 3 neue Beiträge, 2 neue Anzeigen'); // the two biggest counts
  assert.equal(subjectFor({ ...empty(), posts: [post('1', 1)] }), 'Kiez-Brief · KW 41 · 1 neuer Beitrag');
  assert.equal(subjectFor(empty()), 'Kiez-Brief · KW 41');
});

test('the preheader prefers the newest post, then the next event', () => {
  assert.equal(preheaderFor({ ...empty(), posts: [post('9', 1)] }), 'T9');
  assert.equal(preheaderFor({ ...empty(), events: [{ id: 'e', title: 'Flohmarkt', startMs: 1, allDay: true, location: null }] }), 'Flohmarkt');
  assert.equal(preheaderFor(empty()), 'Neues aus dem Schillerkiez');
});

test('links carry the source; Berlin times and prices print the German way', () => {
  assert.equal(withUtm('https://x/topics/1'), 'https://x/topics/1?utm_source=kiez-brief');
  assert.equal(withUtm('https://x/calendar?x=1'), 'https://x/calendar?x=1&utm_source=kiez-brief');
  assert.equal(fmtEventWhen(Date.parse('2026-10-13T17:00:00.000Z'), false), 'Di. 13.10. · 19:00');
  assert.equal(fmtEventWhen(Date.parse('2026-10-17T00:00:00.000Z'), true), 'Sa. 17.10. · ganztägig');
  assert.equal(fmtEventWhen(Date.parse('2026-12-01T18:30:00.000Z'), false), 'Di. 1.12. · 19:30'); // CET
  assert.equal(fmtPrice(12), '12 €');
  assert.equal(fmtPrice(12.5), '12,50 €');
  assert.equal(fmtPrice(null), null);
});

test('the one-click headers follow RFC 8058', () => {
  assert.deepEqual(unsubscribeHeaders('https://x/api/newsletter/unsubscribe?t=abc', 'admin@x'), {
    'List-Unsubscribe': '<https://x/api/newsletter/unsubscribe?t=abc>, <mailto:admin@x?subject=unsubscribe>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
});
```

`src/lib/newsletter/unsubToken.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUnsubToken, verifyUnsubToken } from './unsubToken';

const ID = '6abfe378539f08486ac89c2a';
const SECRET = 'test-secret-not-a-real-one';

test('a token round-trips to its user id', () => {
  const t = makeUnsubToken(ID, SECRET);
  assert.match(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(verifyUnsubToken(t, SECRET), ID);
});

test('a token is bound to the secret and to the user id', () => {
  const t = makeUnsubToken(ID, SECRET);
  assert.equal(verifyUnsubToken(t, 'other-secret'), null);
  const other = makeUnsubToken('6abfe378539f08486ac89c2b', SECRET);
  const swapped = t.split('.')[0] + '.' + other.split('.')[1];
  assert.equal(verifyUnsubToken(swapped, SECRET), null);
});

test('garbage is refused without throwing', () => {
  for (const bad of [null, undefined, 42, '', '.', 'abc', 'abc.', '.abc', 'not-hex.sig', Buffer.from('zz').toString('base64url') + '.x']) {
    assert.equal(verifyUnsubToken(bad, SECRET), null);
  }
  assert.equal(verifyUnsubToken(makeUnsubToken(ID, SECRET), ''), null);
  assert.throws(() => makeUnsubToken('', SECRET));
});
```

- [ ] **Step 2: Run them to see them fail** — `npx tsx --test src/lib/newsletter/*.test.ts` → `Cannot find module`.

- [ ] **Step 3: Write the rules**

`src/lib/newsletter/kiezBriefRules.ts`:

```ts
/**
 * Kiez-Brief — the weekly member e-mail. Pure rules, NO imports: the panel island imports the
 * mode type, the server the rest. Design: docs/superpowers/specs/2026-10-03-kiez-brief-newsletter-design.md
 */
export const NEWSLETTER_MODES = ['weekly', 'off'] as const;
export type NewsletterMode = (typeof NEWSLETTER_MODES)[number];

export function storedNewsletterMode(v: unknown): NewsletterMode {
  return v === 'off' ? 'off' : 'weekly';
}

/** Resend Free sends 100 mails per UTC day; the auth mails of that day need the rest. */
export const MAX_RECIPIENTS = 95;

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WINDOW_MS = 7 * DAY_MS;

/** Caps per section (the mail is a glance, not an archive). */
export const MAX_POSTS = 8;
export const MAX_EVENTS = 8;
export const MAX_LISTINGS = 6;

/** The placeholder the template prints for the unsubscribe link; replaced per recipient. */
export const UNSUB_PLACEHOLDER = '%%UNSUB%%';

// ── Berlin calendar helpers (no Intl option objects shared across calls) ────────────────

function berlinParts(ms: number): { y: number; m: number; d: number; wd: number; hh: number; mm: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), wd, hh: Number(get('hour')) % 24, mm: Number(get('minute')) };
}

/** ISO week key ('2026-W41') of a Berlin calendar day. */
export function isoWeek(ms: number): string {
  const { y, m, d } = berlinParts(ms);
  // ISO week maths on a UTC date built from the Berlin calendar day (time of day is irrelevant).
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // Thursday of this ISO week
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The key of the issue a run belongs to: the ISO week of `now − 24 h`. Sunday 18:00 and the
 * Monday 06:00 UTC fallback must land on the SAME key — Monday already belongs to the next ISO
 * week, so a naive isoWeek(now) would let the fallback send a second mail.
 */
export function issueWeek(nowMs: number): string {
  return isoWeek(nowMs - DAY_MS);
}

/** „KW 41" for the subject. */
export function weekLabel(week: string): string {
  return `KW ${Number(week.slice(-2))}`;
}

export interface IssueWindow {
  fromMs: number; // posts/listings/blog since here …
  toMs: number;   // … up to the run
  aheadMs: number; // events up to here
}

export function windowFor(nowMs: number): IssueWindow {
  return { fromMs: nowMs - WINDOW_MS, toMs: nowMs, aheadMs: nowMs + WINDOW_MS };
}

// ── Issue data ────────────────────────────────────────────────────────────────────────

export type BriefPostKind = 'topic' | 'announcement' | 'recommendation';
export interface BriefPost { id: string; kind: BriefPostKind; title: string; author: string | null; comments: number; dateMs: number }
export interface BriefEvent { id: string; title: string; startMs: number; allDay: boolean; location: string | null }
export interface BriefListing { id: string; title: string; kind: 'sell' | 'exchange' | 'gift'; price: number | null; createdMs: number }
export interface BriefBlogPost { slug: string; title: string; description: string; pubMs: number }
export interface BriefAir { lqi: number }

export interface BriefData {
  week: string;
  posts: BriefPost[];
  events: BriefEvent[];
  listings: BriefListing[];
  blog: BriefBlogPost[];
  air: BriefAir | null;
}

export const POST_KIND_LABEL: Record<BriefPostKind, string> = {
  topic: 'Diskussion', announcement: 'Ankündigung', recommendation: 'Empfehlung',
};
export const LISTING_KIND_LABEL: Record<BriefListing['kind'], string> = {
  sell: 'Verkaufen', exchange: 'Tausch', gift: 'Verschenken',
};
export const AIR_LABEL: Record<number, string> = { 1: 'sehr gut', 2: 'gut', 3: 'mäßig', 4: 'schlecht', 5: 'sehr schlecht' };

/** Order and cap the sections: newest post first, nearest event first, newest listing/blog first. */
export function arrangeData(d: BriefData): BriefData {
  return {
    ...d,
    posts: [...d.posts].sort((a, b) => b.dateMs - a.dateMs || a.id.localeCompare(b.id)).slice(0, MAX_POSTS),
    events: [...d.events].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id)).slice(0, MAX_EVENTS),
    listings: [...d.listings].sort((a, b) => b.createdMs - a.createdMs || a.id.localeCompare(b.id)).slice(0, MAX_LISTINGS),
    blog: [...d.blog].sort((a, b) => b.pubMs - a.pubMs || a.slug.localeCompare(b.slug)),
    air: d.air && Number.isInteger(d.air.lqi) && d.air.lqi >= 1 && d.air.lqi <= 5 ? d.air : null,
  };
}

/** A quiet week has nothing in the four content sections (the air line alone is no reason to write). */
export function isQuiet(d: BriefData): boolean {
  return d.posts.length === 0 && d.events.length === 0 && d.listings.length === 0 && d.blog.length === 0;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** „Kiez-Brief · KW 41 · 3 neue Beiträge, 2 Termine" — the two biggest non-empty counts. */
export function subjectFor(d: BriefData): string {
  const parts: [number, string][] = [
    [d.posts.length, plural(d.posts.length, 'neuer Beitrag', 'neue Beiträge')],
    [d.events.length, plural(d.events.length, 'Termin', 'Termine')],
    [d.listings.length, plural(d.listings.length, 'neue Anzeige', 'neue Anzeigen')],
    [d.blog.length, plural(d.blog.length, 'Beilage-Artikel', 'Beilage-Artikel')],
  ];
  const named = parts.filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, s]) => s); // biggest first, stable
  return [`Kiez-Brief · ${weekLabel(d.week)}`, ...(named.length ? [named.join(', ')] : [])].join(' · ');
}

/** The hidden preview line: the newest forum title, else the next event, else the newest listing. */
export function preheaderFor(d: BriefData): string {
  return d.posts[0]?.title ?? d.events[0]?.title ?? d.listings[0]?.title ?? d.blog[0]?.title ?? 'Neues aus dem Schillerkiez';
}

/** Deep links carry the source so a visit from the mail is visible in the visitor counter later. */
export function withUtm(href: string): string {
  return href + (href.includes('?') ? '&' : '?') + 'utm_source=kiez-brief';
}

const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** „Di. 7.10. · 19:00" or „Sa. 11.10. · ganztägig" in Berlin time. */
export function fmtEventWhen(startMs: number, allDay: boolean): string {
  const p = berlinParts(startMs);
  const day = `${WEEKDAY[p.wd]}. ${p.d}.${p.m}.`;
  return allDay ? `${day} · ganztägig` : `${day} · ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

/** „12 €" / „12,50 €"; null for exchange/gift. */
export function fmtPrice(price: number | null): string | null {
  if (price === null || !Number.isFinite(price)) return null;
  const s = Number.isInteger(price) ? String(price) : price.toFixed(2).replace('.', ',');
  return `${s} €`;
}

/** RFC 8058 one-click headers; the mailto: is the fallback for clients without the POST path. */
export function unsubscribeHeaders(postUrl: string, mailto: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${postUrl}>, <mailto:${mailto}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
```

- [ ] **Step 4: Write the token helper**

`src/lib/newsletter/unsubToken.ts`:

```ts
/**
 * Unsubscribe token: `base64url(userId).base64url(HMAC-SHA256(secret, 'kiez-brief:' + userId))`.
 * Stateless, no expiry (the link must work from a months-old mail); all it can do is turn the
 * mail off. SERVER-ONLY (node:crypto).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'kiez-brief:';

/** The HMAC secret: the Auth.js secret (NEXTAUTH_SECRET, JWT_SECRET as its fallback — the same pair auth.config.ts reads). */
export function unsubSecret(): string {
  return import.meta.env.NEXTAUTH_SECRET || import.meta.env.JWT_SECRET || '';
}

function sig(userId: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(PREFIX + userId).digest();
}

export function makeUnsubToken(userId: string, secret: string): string {
  if (!userId || !secret) throw new Error('unsub token needs a user id and a secret');
  return `${Buffer.from(userId, 'utf8').toString('base64url')}.${sig(userId, secret).toString('base64url')}`;
}

/** The user id the token stands for, or null for anything that is not a valid token. */
export function verifyUnsubToken(token: unknown, secret: string): string | null {
  if (typeof token !== 'string' || !secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  let userId: string;
  let given: Buffer;
  try {
    userId = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    given = Buffer.from(token.slice(dot + 1), 'base64url');
  } catch {
    return null;
  }
  if (!/^[a-f0-9]{24}$/.test(userId)) return null;
  const expected = sig(userId, secret);
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? userId : null;
}
```

- [ ] **Step 5: Run the tests** → `ℹ tests 13` / `ℹ pass 13`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/newsletter/kiezBriefRules.ts src/lib/newsletter/kiezBriefRules.test.ts src/lib/newsletter/unsubToken.ts src/lib/newsletter/unsubToken.test.ts
git commit -m "feat: Kiez-Brief rules — issue week, sections, subject, unsubscribe token"
```

---

### Task 2: Database layer, mailer batch, the mail template, the sender

**Files:**
- Create: `src/lib/newsletter/kiezBriefStore.ts`, `src/emails/KiezBriefEmail.tsx`, `src/lib/newsletter/kiezBrief.ts`
- Modify: `src/lib/email/mailer.ts`
- Test: `src/lib/newsletter/kiezBriefStore.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `KIEZ_BRIEF_COLLECTION = 'kiezBriefIssues'`, `claimIssue(db, week, nowMs, fallback) → boolean`, `markIssue(db, week, patch)`, `loadIssueData(db, week, nowMs, blog: BlogInput[]) → BriefData`, `loadRecipients(db) → Recipient[]`; `MailInput.headers?`, `sendMailBatch(inputs, idempotencyKey)`; `KiezBriefEmail({ data, baseUrl })`; `buildIssue(nowMs?)`, `renderIssue(data, baseUrl)`, `mailsFor(html, subject, recipients, baseUrl, secret)`, `kiezBriefBaseUrl()`, `sendKiezBrief({ fallback?, now? }) → SendResult` (never throws).

- [ ] **Step 1: Write the failing store test**

`src/lib/newsletter/kiezBriefStore.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from 'mongodb';
import { claimIssue, markIssue, loadIssueData, loadRecipients, KIEZ_BRIEF_COLLECTION } from './kiezBriefStore';

const NOW = Date.parse('2026-10-11T16:00:00.000Z'); // Sunday 18:00 CEST
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** In-memory Db double for the handful of calls the store makes. */
function fakeDb(seed: Record<string, any[]> = {}) {
  const data: Record<string, any[]> = { ...seed };
  const calls: { collection: string; op: string; filter?: any; update?: any }[] = [];
  const rows = (n: string) => (data[n] ??= []);
  const db = {
    collection: (name: string) => ({
      find: (filter: any) => {
        calls.push({ collection: name, op: 'find', filter });
        let list = [...rows(name)];
        if (filter?._id?.$in) list = list.filter((r) => filter._id.$in.some((id: any) => String(id) === String(r._id)));
        const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => list };
        return cursor;
      },
      insertOne: async (doc: any) => {
        if (rows(name).some((r) => r._id === doc._id)) throw Object.assign(new Error('dup'), { code: 11000 });
        rows(name).push(doc);
      },
      updateOne: async (filter: any, update: any) => { calls.push({ collection: name, op: 'updateOne', filter, update }); },
    }),
  } as unknown as Db;
  return { db, data, calls };
}

test('an issue is claimed once; the second claim of the same week loses', async () => {
  const { db, data } = fakeDb();
  assert.equal(await claimIssue(db, '2026-W41', NOW, false), true);
  assert.equal(await claimIssue(db, '2026-W41', NOW + 14 * HOUR, true), false);
  assert.equal(data[KIEZ_BRIEF_COLLECTION].length, 1);
  assert.deepEqual(data[KIEZ_BRIEF_COLLECTION][0].windowFrom, new Date(NOW - 7 * DAY));
  assert.equal(data[KIEZ_BRIEF_COLLECTION][0].fallback, false);
});

test('a database error other than the duplicate key is passed on', async () => {
  const db = { collection: () => ({ insertOne: async () => { throw Object.assign(new Error('down'), { code: 91 }); } }) } as unknown as Db;
  await assert.rejects(() => claimIssue(db, '2026-W41', NOW, false), /down/);
});

test('markIssue patches the claim row', async () => {
  const { db, calls } = fakeDb();
  await markIssue(db, '2026-W41', { recipients: 3, sentAt: new Date(NOW) });
  assert.deepEqual(calls[0].filter, { _id: '2026-W41' });
  assert.deepEqual(calls[0].update, { $set: { recipients: 3, sentAt: new Date(NOW) } });
});

test('issue data: public posts of the week with author names, next week\'s events, new listings, blog in window', async () => {
  const { db, calls } = fakeDb({
    topics: [{ _id: 't1', title: 'Frage', author: '6abfe378539f08486ac89c2a', comments: ['c1', 'c2'], date: NOW - 2 * HOUR }],
    announcements: [],
    recommendations: [{ _id: 'r1', title: 'Tipp', author: 'kaputt', comments: [], date: NOW - DAY }],
    events: [{ _id: 'e1', title: 'Flohmarkt', startDate: new Date(NOW + 2 * DAY), allDay: true, location: ' Herrfurthplatz ' }],
    listings: [{ _id: 'l1', title: 'Lampe', listingType: 'sell', price: 12.5, createdAt: new Date(NOW - 3 * DAY) }, { _id: 'l2', title: 'Stuhl', listingType: 'gift', price: 0, createdAt: new Date(NOW - HOUR) }],
    users: [{ _id: '6abfe378539f08486ac89c2a', name: 'Ayşe' }],
    schillerkiez_air_daily: [],
    schillerkiez_air_log: [{ ts: new Date(NOW - HOUR), lqi: 2 }],
  });
  const blog = [
    { slug: 'neu', title: 'Neu', description: 'd', pubDate: new Date(NOW - DAY) },
    { slug: 'alt', title: 'Alt', description: 'd', pubDate: new Date(NOW - 30 * DAY) },
    { slug: 'entwurf', title: 'E', description: 'd', pubDate: new Date(NOW - DAY), draft: true },
  ];
  const d = await loadIssueData(db, '2026-W41', NOW, blog);
  assert.equal(d.week, '2026-W41');
  assert.deepEqual(d.posts.map((p) => [p.id, p.kind, p.author, p.comments]), [['t1', 'topic', 'Ayşe', 2], ['r1', 'recommendation', null, 0]]);
  assert.deepEqual(d.events, [{ id: 'e1', title: 'Flohmarkt', startMs: NOW + 2 * DAY, allDay: true, location: 'Herrfurthplatz' }]);
  assert.deepEqual(d.listings.map((l) => [l.id, l.kind, l.price]), [['l2', 'gift', null], ['l1', 'sell', 12.5]]);
  assert.deepEqual(d.blog.map((b) => b.slug), ['neu']);
  assert.deepEqual(d.air, { lqi: 2 });
  const topics = calls.find((c) => c.collection === 'topics')!.filter;
  assert.deepEqual(topics.date, { $gt: NOW - 7 * DAY, $lte: NOW });
  assert.deepEqual(topics.isOfficial, { $ne: true });
  assert.deepEqual(topics.hasWarningLabel, { $ne: true });
  const events = calls.find((c) => c.collection === 'events')!.filter;
  assert.deepEqual(events.startDate, { $gte: new Date(NOW), $lt: new Date(NOW + 7 * DAY) });
  const listings = calls.find((c) => c.collection === 'listings')!.filter;
  assert.deepEqual(listings.status, { $in: ['available', 'reserved'] });
  const users = calls.find((c) => c.collection === 'users')!.filter;
  assert.equal(users._id.$in.length, 1); // the unreadable author id is not looked up
});

test('a failing air lookup leaves the air line out, nothing else', async () => {
  const base = fakeDb({ topics: [], announcements: [], recommendations: [], events: [], listings: [] });
  const db = {
    collection: (name: string) => (name.startsWith('schillerkiez_air') ? { find: () => { throw new Error('air down'); } } : base.db.collection(name)),
  } as unknown as Db;
  const d = await loadIssueData(db, '2026-W41', NOW, []);
  assert.equal(d.air, null);
  assert.equal(d.posts.length, 0);
});

test('recipients: verified, not anonymized, not banned, not off, with an e-mail string', async () => {
  const { db, calls } = fakeDb({ users: [{ _id: 'u1', email: 'a@b.c', name: 'A' }, { _id: 'u2', email: 'd@e.f' }] });
  assert.deepEqual(await loadRecipients(db), [{ id: 'u1', email: 'a@b.c', name: 'A' }, { id: 'u2', email: 'd@e.f', name: null }]);
  assert.deepEqual(calls[0].filter, {
    emailVerified: true, anonymized: { $ne: true }, isBanned: { $ne: true }, newsletter: { $ne: 'off' }, email: { $type: 'string' },
  });
});
```

- [ ] **Step 2: Run it to see it fail** → `Cannot find module './kiezBriefStore'`.

- [ ] **Step 3: Write the store**

`src/lib/newsletter/kiezBriefStore.ts`:

```ts
/**
 * Kiez-Brief — database side. Takes a Db, imports no env and no Astro module (tests use an
 * in-memory double, the dev dry-run script the real dev db). Sending lives in kiezBrief.ts.
 */
import { ObjectId, type Db } from 'mongodb';
import { PUBLIC_AUTHOR_PROJECTION } from '../publicAuthor';
import { getAirHistory } from '../kiez/airLog';
import {
  windowFor, arrangeData,
  type BriefData, type BriefPost, type BriefPostKind, type BriefEvent, type BriefListing, type BriefBlogPost,
} from './kiezBriefRules';

export const KIEZ_BRIEF_COLLECTION = 'kiezBriefIssues';

export interface IssueDoc {
  _id: string; // issue week, e.g. '2026-W41'
  windowFrom: Date;
  windowTo: Date;
  claimedAt: Date;
  fallback: boolean;
  recipients?: number;
  skipped?: 'quiet' | 'quota';
  sentAt?: Date;
}

/** Claim the issue BEFORE anything is rendered or sent; null = already claimed (at-most-once). */
export async function claimIssue(db: Db, week: string, nowMs: number, fallback: boolean): Promise<boolean> {
  const w = windowFor(nowMs);
  try {
    await db.collection<IssueDoc>(KIEZ_BRIEF_COLLECTION).insertOne({
      _id: week, windowFrom: new Date(w.fromMs), windowTo: new Date(w.toMs), claimedAt: new Date(nowMs), fallback,
    });
    return true;
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) return false;
    throw err;
  }
}

export async function markIssue(db: Db, week: string, patch: Partial<Pick<IssueDoc, 'recipients' | 'skipped' | 'sentAt'>>): Promise<void> {
  await db.collection<IssueDoc>(KIEZ_BRIEF_COLLECTION).updateOne({ _id: week }, { $set: patch });
}

const PUBLIC = { $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }], hasWarningLabel: { $ne: true } };
const POST_COLLECTIONS: Record<BriefPostKind, string> = { topic: 'topics', announcement: 'announcements', recommendation: 'recommendations' };

const toMs = (v: unknown): number => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** Blog posts come from the Astro content collection — the caller passes them in (no astro:content here). */
export interface BlogInput { slug: string; title: string; description: string; pubDate: unknown; draft?: boolean }

export async function loadIssueData(db: Db, week: string, nowMs: number, blog: BlogInput[]): Promise<BriefData> {
  const w = windowFor(nowMs);
  const kinds = Object.keys(POST_COLLECTIONS) as BriefPostKind[];
  const [postLists, eventDocs, listingDocs, air] = await Promise.all([
    Promise.all(kinds.map(async (kind) => {
      const docs = await db.collection(POST_COLLECTIONS[kind])
        .find({ ...PUBLIC, date: { $gt: w.fromMs, $lte: w.toMs }, isOfficial: { $ne: true } },
          { projection: { title: 1, author: 1, comments: 1, date: 1 } })
        .toArray();
      return docs.map((d) => ({ kind, doc: d }));
    })),
    db.collection('events')
      .find({ ...PUBLIC, startDate: { $gte: new Date(w.toMs), $lt: new Date(w.aheadMs) } },
        { projection: { title: 1, startDate: 1, allDay: 1, location: 1 } })
      .toArray(),
    db.collection('listings')
      .find({ ...PUBLIC, createdAt: { $gt: new Date(w.fromMs), $lte: new Date(w.toMs) }, status: { $in: ['available', 'reserved'] } },
        { projection: { title: 1, listingType: 1, price: 1, createdAt: 1 } })
      .toArray(),
    getAirHistory(db, new Date(nowMs)).catch(() => null),
  ]);

  // Author names: one join through the public allowlist (tombstone-safe), never a stored name.
  const flat = postLists.flat();
  const authorIds = [...new Set(flat.map((p) => String(p.doc.author ?? '')).filter((id) => /^[a-f0-9]{24}$/.test(id)))];
  const users = authorIds.length
    ? await db.collection('users').find({ _id: { $in: authorIds.map((id) => new ObjectId(id)) } }, { projection: PUBLIC_AUTHOR_PROJECTION }).toArray()
    : [];
  const nameOf = new Map(users.map((u) => [String(u._id), typeof u.name === 'string' ? u.name : null]));

  const posts: BriefPost[] = flat.map(({ kind, doc }) => ({
    id: String(doc._id), kind, title: String(doc.title ?? ''),
    author: nameOf.get(String(doc.author ?? '')) ?? null,
    comments: Array.isArray(doc.comments) ? doc.comments.length : 0,
    dateMs: toMs(doc.date),
  }));
  const events: BriefEvent[] = eventDocs.map((e) => ({
    id: String(e._id), title: String(e.title ?? ''), startMs: toMs(e.startDate), allDay: e.allDay === true,
    location: typeof e.location === 'string' && e.location.trim() ? e.location.trim() : null,
  }));
  const listings: BriefListing[] = listingDocs.map((l) => ({
    id: String(l._id), title: String(l.title ?? ''),
    kind: l.listingType === 'exchange' || l.listingType === 'gift' ? l.listingType : 'sell',
    price: l.listingType === 'sell' && typeof l.price === 'number' ? l.price : null,
    createdMs: toMs(l.createdAt),
  }));
  const blogPosts: BriefBlogPost[] = blog
    .filter((b) => !b.draft)
    .map((b) => ({ slug: b.slug, title: b.title, description: b.description, pubMs: toMs(b.pubDate) }))
    .filter((b) => b.pubMs > w.fromMs && b.pubMs <= w.toMs);

  return arrangeData({
    week, posts, events, listings, blog: blogPosts,
    air: air?.lastReading ? { lqi: air.lastReading.lqi } : null,
  });
}

export interface Recipient { id: string; email: string; name: string | null }

/** Verified, reachable members who did not turn the mail off. One query, allowlist projection. */
export async function loadRecipients(db: Db): Promise<Recipient[]> {
  const users = await db.collection('users')
    .find({ emailVerified: true, anonymized: { $ne: true }, isBanned: { $ne: true }, newsletter: { $ne: 'off' }, email: { $type: 'string' } },
      { projection: { _id: 1, email: 1, name: 1 } })
    .toArray();
  return users.map((u) => ({ id: String(u._id), email: String(u.email), name: typeof u.name === 'string' ? u.name : null }));
}
```

- [ ] **Step 4: Run the store test** → `ℹ tests 6` / `ℹ pass 6`.

- [ ] **Step 5: Mailer — headers on every mail, one batch call**

```diff
diff --git a/src/lib/email/mailer.ts b/src/lib/email/mailer.ts
index fab2b2d2..2377fcc2 100644
--- a/src/lib/email/mailer.ts
+++ b/src/lib/email/mailer.ts
@@ -43,6 +43,8 @@ export interface MailInput {
   subject: string;
   html: string;
   replyTo?: string;
+  /** Extra headers (e.g. List-Unsubscribe for the Kiez-Brief). */
+  headers?: Record<string, string>;
 }
 
 // The Resend SDK rides a bare fetch with no timeout — a hung provider would
@@ -97,6 +99,7 @@ export async function sendMail(input: MailInput): Promise<void> {
         subject: input.subject,
         html: input.html,
         ...(replyTo ? { replyTo } : {}),
+        ...(input.headers ? { headers: input.headers } : {}),
       });
       return;
     }
@@ -109,6 +112,7 @@ export async function sendMail(input: MailInput): Promise<void> {
           subject: input.subject,
           html: input.html,
           ...(replyTo ? { replyTo } : {}),
+          ...(input.headers ? { headers: input.headers } : {}),
         }),
         RESEND_TIMEOUT_MS,
         'Resend send'
@@ -129,3 +133,41 @@ export async function sendMail(input: MailInput): Promise<void> {
     throw err;
   }
 }
+
+/**
+ * Several mails in one go (the Kiez-Brief). Resend: ONE call to its batch endpoint (up to 100
+ * mails) with an Idempotency-Key, so a duplicated HTTP call inside a run cannot send twice.
+ * SMTP/dev: sequential sendMail (the batch is a Resend feature, not a contract). Throws like
+ * sendMail; the caller decides what a failure means.
+ */
+export async function sendMailBatch(inputs: MailInput[], idempotencyKey: string): Promise<void> {
+  if (!inputs.length) return;
+  if (inputs.length > 100) throw new Error('sendMailBatch: at most 100 mails per batch');
+  if (!smtpConfigured && RESEND_API_KEY) {
+    try {
+      const resend = new Resend(RESEND_API_KEY);
+      const { error } = await withTimeout(
+        resend.batch.send(
+          inputs.map((input) => ({
+            from: SENDING_FROM,
+            to: punycodeEmailDomain(input.to),
+            subject: input.subject,
+            html: input.html,
+            ...(input.replyTo ? { replyTo: punycodeEmailDomain(input.replyTo) } : {}),
+            ...(input.headers ? { headers: input.headers } : {}),
+          })),
+          { idempotencyKey },
+        ),
+        RESEND_TIMEOUT_MS * 3,
+        'Resend batch send'
+      );
+      if (error) throw new Error(`Resend batch failed: ${error.name}: ${error.message}`);
+      return;
+    } catch (err) {
+      Sentry.captureException(err, { tags: { feature: 'mailer-batch' } });
+      try { await Sentry.flush(2000); } catch { /* best-effort */ }
+      throw err;
+    }
+  }
+  for (const input of inputs) await sendMail(input);
+}
```

- [ ] **Step 6: The template**

`src/emails/KiezBriefEmail.tsx`:

```tsx
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Link, Hr,
} from '@react-email/components';
import * as React from 'react';
import {
  AIR_LABEL, LISTING_KIND_LABEL, POST_KIND_LABEL, UNSUB_PLACEHOLDER, fmtEventWhen, fmtPrice, preheaderFor,
  weekLabel, withUtm, type BriefData,
} from '../lib/newsletter/kiezBriefRules';

interface KiezBriefEmailProps {
  data: BriefData;
  /** Absolute origin (NEXTAUTH_URL) — never hardcode the domain here. */
  baseUrl: string;
}

const POST_PATH = { topic: 'topics', announcement: 'announcements', recommendation: 'recommendations' } as const;

// The weekly member mail. Rendered ONCE per issue; the unsubscribe link prints the
// UNSUB_PLACEHOLDER and the sender substitutes each recipient's token. German only, like push.
// Reads well linearised on purpose: Resend derives the text part from this HTML.
export default function KiezBriefEmail({ data, baseUrl }: KiezBriefEmailProps) {
  const url = (path: string) => withUtm(`${baseUrl}${path}`);
  return (
    <Html lang="de">
      <Head />
      <Preview>{preheaderFor(data)}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Text style={kicker}>MAHALLE · SCHILLERKIEZ · KIEZ-BRIEF · {weekLabel(data.week).toUpperCase()}</Text>
          <Heading style={h1}>Das war die Woche im Kiez</Heading>

          {data.posts.length > 0 && (
            <Section>
              <Heading as="h2" style={h2}>Im Forum</Heading>
              {data.posts.map((p) => (
                <Text key={p.id} style={item}>
                  <span style={tag}>{POST_KIND_LABEL[p.kind]}</span>{' '}
                  <Link href={url(`/${POST_PATH[p.kind]}/${p.id}`)} style={link}>{p.title}</Link>
                  <span style={meta}>{p.author ? ` · ${p.author}` : ''}{p.comments > 0 ? ` · ${p.comments} ${p.comments === 1 ? 'Antwort' : 'Antworten'}` : ''}</span>
                </Text>
              ))}
            </Section>
          )}

          {data.events.length > 0 && (
            <Section>
              <Heading as="h2" style={h2}>Nächste Woche im Kiez</Heading>
              {data.events.map((e) => (
                <Text key={e.id} style={item}>
                  <span style={meta}>{fmtEventWhen(e.startMs, e.allDay)}</span><br />
                  <Link href={url('/calendar')} style={link}>{e.title}</Link>
                  {e.location ? <span style={meta}> · {e.location}</span> : null}
                </Text>
              ))}
            </Section>
          )}

          {data.listings.length > 0 && (
            <Section>
              <Heading as="h2" style={h2}>Neu auf dem Markt</Heading>
              {data.listings.map((l) => (
                <Text key={l.id} style={item}>
                  <span style={tag}>{LISTING_KIND_LABEL[l.kind]}</span>{' '}
                  <Link href={url(`/marketplace/${l.id}`)} style={link}>{l.title}</Link>
                  {fmtPrice(l.price) ? <span style={meta}> · {fmtPrice(l.price)}</span> : null}
                </Text>
              ))}
            </Section>
          )}

          {data.blog.length > 0 && (
            <Section>
              <Heading as="h2" style={h2}>In der Beilage</Heading>
              {data.blog.map((b) => (
                <Text key={b.slug} style={item}>
                  <Link href={url(`/blog/${b.slug}`)} style={link}>{b.title}</Link>
                  <br /><span style={meta}>{b.description}</span>
                </Text>
              ))}
            </Section>
          )}

          {data.air ? (
            <Text style={muted}>Luftqualität heute: {AIR_LABEL[data.air.lqi]} (LQI {data.air.lqi}) · Station Nansenstraße</Text>
          ) : null}

          <Hr style={hr} />
          <Text style={muted}>
            Du bekommst diesen Brief einmal die Woche, weil du Mitglied bei Mahalle bist.{' '}
            <Link href={UNSUB_PLACEHOLDER} style={mutedLink}>Abbestellen</Link> ·{' '}
            <Link href={url('/forum')} style={mutedLink}>Mitteilungen einstellen</Link> ·{' '}
            <Link href={`${baseUrl}/impressum`} style={mutedLink}>Impressum</Link> ·{' '}
            <Link href={`${baseUrl}/datenschutz`} style={mutedLink}>Datenschutz</Link>
          </Text>
          <Text style={muted}>Mahalle · Schillerkiez · Neukölln</Text>
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle = { backgroundColor: '#f3ead8', fontFamily: 'Georgia, serif', padding: '24px' };
const containerStyle = { backgroundColor: '#f7f0de', border: '1.5px solid #1b1a17', borderRadius: '12px', padding: '32px', maxWidth: '520px' };
const kicker = { color: '#a3552e', fontFamily: 'Menlo, Consolas, monospace', fontSize: '10px', letterSpacing: '0.14em', margin: '0 0 8px' };
const h1 = { color: '#1b1a17', fontSize: '24px', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 18px' };
const h2 = { color: '#1b1a17', fontSize: '15px', fontWeight: 700, letterSpacing: '0.02em', textTransform: 'uppercase' as const, borderTop: '1.5px solid #1b1a17', paddingTop: '12px', margin: '22px 0 8px' };
const item = { color: '#3a362e', fontSize: '15px', lineHeight: '1.5', margin: '0 0 10px' };
const tag = { color: '#b23a5b', fontFamily: 'Menlo, Consolas, monospace', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase' as const };
const link = { color: '#1b1a17', fontWeight: 700, textDecoration: 'underline' };
const meta = { color: '#7a7264', fontSize: '13px' };
const muted = { color: '#7a7264', fontSize: '12px', lineHeight: '1.5', margin: '8px 0 0' };
const mutedLink = { color: '#7a7264', textDecoration: 'underline' };
const hr = { borderColor: '#c9bea3', margin: '20px 0' };
```

- [ ] **Step 7: The sender**

`src/lib/newsletter/kiezBrief.ts`:

```ts
/**
 * Kiez-Brief — the sending side. SERVER-ONLY, NEVER-THROW (Sentry capture + flush): a failed
 * issue must not fail the cron request it rides in. Rules: kiezBriefRules.ts · db: kiezBriefStore.ts.
 */
import React from 'react';
import { render } from '@react-email/render';
import * as Sentry from '@sentry/astro';
import { getCollection } from 'astro:content';
import { connectDB } from '../mongodb';
import { isMailerConfigured, sendMailBatch } from '../email/mailer';
import KiezBriefEmail from '../../emails/KiezBriefEmail';
import { makeUnsubToken, unsubSecret } from './unsubToken';
import {
  UNSUB_PLACEHOLDER, MAX_RECIPIENTS, issueWeek, isQuiet, subjectFor, unsubscribeHeaders, type BriefData,
} from './kiezBriefRules';
import { claimIssue, loadIssueData, loadRecipients, markIssue, type BlogInput, type Recipient } from './kiezBriefStore';

const REPLY_TO = 'admin@mahalle.digital';

async function capture(err: unknown): Promise<void> {
  console.error('[kiez-brief] failed:', err);
  try {
    Sentry.captureException(err);
    await Sentry.flush(2000);
  } catch {
    /* best-effort */
  }
}

/** The trusted absolute origin for the mail's links — never a request host. */
export function kiezBriefBaseUrl(): string {
  return (import.meta.env.NEXTAUTH_URL || '').replace(/\/+$/, '');
}

async function blogPosts(): Promise<BlogInput[]> {
  const posts = await getCollection('blog');
  return posts.map((p) => ({ slug: p.id, title: p.data.title, description: p.data.description, pubDate: p.data.pubDate, draft: p.data.draft }));
}

/** This week's data (no claim, no send) — the admin preview and the sender share it. */
export async function buildIssue(nowMs = Date.now()): Promise<BriefData> {
  const db = await connectDB();
  return loadIssueData(db, issueWeek(nowMs), nowMs, await blogPosts());
}

/** The mail's HTML with the unsubscribe placeholder still inside. */
export async function renderIssue(data: BriefData, baseUrl: string): Promise<string> {
  return render(React.createElement(KiezBriefEmail, { data, baseUrl }));
}

export function unsubscribeUrl(baseUrl: string, userId: string, secret: string): string {
  return `${baseUrl}/newsletter/abmelden?t=${makeUnsubToken(userId, secret)}`;
}

export function oneClickUrl(baseUrl: string, userId: string, secret: string): string {
  return `${baseUrl}/api/newsletter/unsubscribe?t=${makeUnsubToken(userId, secret)}`;
}

/** One rendered issue → one MailInput per recipient (only the unsubscribe links differ). */
export function mailsFor(html: string, subject: string, recipients: Recipient[], baseUrl: string, secret: string) {
  return recipients.map((r) => ({
    to: r.email,
    subject,
    html: html.replaceAll(UNSUB_PLACEHOLDER, unsubscribeUrl(baseUrl, r.id, secret)),
    replyTo: REPLY_TO,
    headers: unsubscribeHeaders(oneClickUrl(baseUrl, r.id, secret), REPLY_TO),
  }));
}

export interface SendResult {
  week: string;
  outcome: 'sent' | 'claimed-elsewhere' | 'quiet' | 'quota' | 'not-configured' | 'failed';
  recipients: number;
}

/**
 * Send this week's issue, once. `fallback` marks the Monday run (it only sends when Sunday's never
 * arrived — the claim decides). Never throws.
 */
export async function sendKiezBrief(opts: { fallback?: boolean; now?: number } = {}): Promise<SendResult> {
  const nowMs = opts.now ?? Date.now();
  const week = issueWeek(nowMs);
  try {
    const baseUrl = kiezBriefBaseUrl();
    const secret = unsubSecret();
    if (!baseUrl || !secret) throw new Error('kiez-brief: NEXTAUTH_URL and NEXTAUTH_SECRET are required');
    const db = await connectDB();
    if (!(await claimIssue(db, week, nowMs, opts.fallback === true))) return { week, outcome: 'claimed-elsewhere', recipients: 0 };

    const data = await loadIssueData(db, week, nowMs, await blogPosts());
    if (isQuiet(data)) {
      await markIssue(db, week, { skipped: 'quiet', recipients: 0 });
      return { week, outcome: 'quiet', recipients: 0 };
    }
    const recipients = await loadRecipients(db);
    if (recipients.length > MAX_RECIPIENTS) {
      await markIssue(db, week, { skipped: 'quota', recipients: 0 });
      Sentry.captureMessage('kiez-brief: more recipients than the daily mail quota allows — upgrade the Resend plan', {
        level: 'warning', extra: { recipients: recipients.length, max: MAX_RECIPIENTS, week },
      });
      await Sentry.flush(2000);
      return { week, outcome: 'quota', recipients: recipients.length };
    }
    if (!isMailerConfigured()) {
      console.log(`[kiez-brief] (dev) no mail transport — would send ${week} to ${recipients.length} members`);
      await markIssue(db, week, { recipients: 0 });
      return { week, outcome: 'not-configured', recipients: recipients.length };
    }
    const html = await renderIssue(data, baseUrl);
    await sendMailBatch(mailsFor(html, subjectFor(data), recipients, baseUrl, secret), `kiez-brief-${week}`);
    await markIssue(db, week, { recipients: recipients.length, sentAt: new Date() });
    console.log(`[kiez-brief] ${week} sent to ${recipients.length} members`);
    return { week, outcome: 'sent', recipients: recipients.length };
  } catch (err) {
    await capture(err);
    return { week, outcome: 'failed', recipients: 0 };
  }
}
```

- [ ] **Step 8: Budgets** — `pnpm type-check 2>&1 | grep -c "error TS"` → 16 (a `.catch()` on `Sentry.flush` is a tsc error: use `try { await Sentry.flush(2000); } catch {}` as the file does).

- [ ] **Step 9: Commit**

```bash
git add src/lib/newsletter/kiezBriefStore.ts src/lib/newsletter/kiezBriefStore.test.ts src/lib/email/mailer.ts src/emails/KiezBriefEmail.tsx src/lib/newsletter/kiezBrief.ts
git commit -m "feat: Kiez-Brief store, template and sender; mailer batch send"
```

---

### Task 3: Routes, the unsubscribe page, and the cross-site form check

**Files:**
- Create: `src/lib/security/crossSiteForm.ts`, `src/pages/api/cron/kiez-brief.ts`, `src/pages/api/newsletter/unsubscribe.ts`, `src/pages/newsletter/abmelden.astro`, `src/pages/api/profile/newsletter.ts`, `src/pages/api/admin/kiez-brief/preview.ts`
- Modify: `src/middleware.ts`, `astro.config.mjs`
- Test: `src/lib/security/crossSiteForm.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `isCrossSiteForm(input)`, `CROSS_SITE_FORM_EXEMPT`; `GET /api/cron/kiez-brief` (Bearer `CRON_SECRET`, 503 without it); `POST /api/newsletter/unsubscribe?t=` (200/400/429, no body); `GET /newsletter/abmelden?t=`; `GET/POST /api/profile/newsletter` (`{ mode: 'weekly' | 'off' }`, weekly ⇒ `$unset`); `GET /api/admin/kiez-brief/preview` (HTML) / `POST` (one copy to the admin's own address).

Why the middleware change: Astro's `security.checkOrigin` refuses every form-typed POST whose Origin is not ours BEFORE any middleware runs — and Gmail's one-click unsubscribe is exactly that (found on the prototype: 403). Astro has no exemption list, so the same rule moves into `src/middleware.ts` with one exempt path.

- [ ] **Step 1: Write the failing test**

`src/lib/security/crossSiteForm.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCrossSiteForm, CROSS_SITE_FORM_EXEMPT } from './crossSiteForm';

const site = 'https://mahalle.digital';
const base = { method: 'POST', pathname: '/api/profile/newsletter', siteOrigin: site };

test('safe methods and same-origin requests pass', () => {
  assert.equal(isCrossSiteForm({ ...base, method: 'GET', origin: null, contentType: null }), false);
  assert.equal(isCrossSiteForm({ ...base, origin: site, contentType: 'application/x-www-form-urlencoded' }), false);
  assert.equal(isCrossSiteForm({ ...base, origin: site, contentType: null }), false);
});

test('a foreign form POST is refused, like Astro did', () => {
  assert.equal(isCrossSiteForm({ ...base, origin: 'https://evil.example', contentType: 'application/x-www-form-urlencoded' }), true);
  assert.equal(isCrossSiteForm({ ...base, origin: null, contentType: 'multipart/form-data; boundary=x' }), true);
  assert.equal(isCrossSiteForm({ ...base, origin: null, contentType: 'Text/Plain' }), true);
  assert.equal(isCrossSiteForm({ ...base, origin: null, contentType: null }), true);
});

test('a JSON POST without Origin passes (the cron routes with a Bearer header)', () => {
  assert.equal(isCrossSiteForm({ ...base, pathname: '/api/cron/kiez-brief', origin: null, contentType: 'application/json' }), false);
});

test('the one-click unsubscribe endpoint is exempt — and only it', () => {
  assert.deepEqual([...CROSS_SITE_FORM_EXEMPT], ['/api/newsletter/unsubscribe']);
  assert.equal(isCrossSiteForm({ ...base, pathname: '/api/newsletter/unsubscribe', origin: null, contentType: 'application/x-www-form-urlencoded' }), false);
  assert.equal(isCrossSiteForm({ ...base, pathname: '/api/newsletter/unsubscribe/', origin: null, contentType: 'application/x-www-form-urlencoded' }), true);
});
```

- [ ] **Step 2: Run it to see it fail** → `Cannot find module './crossSiteForm'`.

- [ ] **Step 3: Write the rule**

`src/lib/security/crossSiteForm.ts`:

```ts
/**
 * Astro's built-in cross-site form check (`security.checkOrigin`), re-implemented so ONE route can
 * be exempt: the RFC 8058 one-click unsubscribe endpoint, which Gmail/Yahoo POST to as
 * `application/x-www-form-urlencoded` from their own servers — no Origin header, by design.
 * Everything else keeps the same rule Astro applied: a non-safe method with a form-like (or
 * missing) content type and an Origin that is not ours is refused with 403. Pure, tested.
 */
const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/** Paths that may receive cross-site form POSTs (exact match). */
export const CROSS_SITE_FORM_EXEMPT = ['/api/newsletter/unsubscribe'] as const;

export function isCrossSiteForm(input: {
  method: string;
  pathname: string;
  origin: string | null; // the request's Origin header
  contentType: string | null;
  siteOrigin: string; // url.origin of the request
}): boolean {
  if (SAFE_METHODS.includes(input.method.toUpperCase())) return false;
  if ((CROSS_SITE_FORM_EXEMPT as readonly string[]).includes(input.pathname)) return false;
  const sameOrigin = input.origin === input.siteOrigin;
  if (sameOrigin) return false;
  if (input.contentType === null) return true; // Astro: no content type + foreign origin → refused
  const ct = input.contentType.toLowerCase();
  return FORM_CONTENT_TYPES.some((t) => ct.includes(t));
}
```

- [ ] **Step 4: Run the test** → `ℹ tests 4` / `ℹ pass 4`.

- [ ] **Step 5: Middleware + Astro config**

```diff
diff --git a/src/middleware.ts b/src/middleware.ts
index ee5315de..6c233028 100644
--- a/src/middleware.ts
+++ b/src/middleware.ts
@@ -12,6 +12,7 @@ import { defineMiddleware } from "astro:middleware";
 import '../sentry.server.config';
 import * as Sentry from '@sentry/astro';
 import { safeInternalPath } from './lib/auth/safeRedirect';
+import { isCrossSiteForm } from './lib/security/crossSiteForm';
 
 export const onRequest = defineMiddleware(async (context, next) => {
   try {
@@ -25,6 +26,17 @@ export const onRequest = defineMiddleware(async (context, next) => {
       return await next();
     }
 
+    // Cross-site form check — Astro's own (`security.checkOrigin`) is OFF in astro.config.mjs
+    // because it has no exemption list, and the Kiez-Brief one-click unsubscribe endpoint must
+    // accept a form POST from Gmail's servers (RFC 8058). Same rule, one exempt path.
+    if (!context.isPrerendered && isCrossSiteForm({
+      method: context.request.method, pathname,
+      origin: context.request.headers.get('origin'), contentType: context.request.headers.get('content-type'),
+      siteOrigin: context.url.origin,
+    })) {
+      return new Response(`Cross-site ${context.request.method} form submissions are forbidden`, { status: 403 });
+    }
+
     // Skip session fetching for prerendered routes (no request headers available)
     if (context.isPrerendered) {
       context.locals.user = null;
```

```diff
diff --git a/astro.config.mjs b/astro.config.mjs
index 6d374248..3088ac47 100644
--- a/astro.config.mjs
+++ b/astro.config.mjs
@@ -13,6 +13,12 @@ export default defineConfig({
 
   output: 'server', // Server mode for Vercel serverless functions
 
+  // The cross-site form check lives in src/middleware.ts (same rule, one exempt path for the
+  // Kiez-Brief one-click unsubscribe — Gmail POSTs it as a form without an Origin). Never
+  // switch this back on without removing that exemption's need: Astro's check runs BEFORE the
+  // middleware and would 403 the endpoint again.
+  security: { checkOrigin: false },
+
   adapter: vercel({
     webAnalytics: {
       enabled: true
```

- [ ] **Step 6: The five routes/pages**

`src/pages/api/cron/kiez-brief.ts`:

```ts
import type { APIRoute } from 'astro';
import { sendKiezBrief } from '../../../lib/newsletter/kiezBrief';

// Sunday-evening trigger of the weekly member mail, rung by .github/workflows/kiez-brief.yml
// (GitHub Actions — both Vercel Hobby cron slots are taken). FAIL-CLOSED like process-deletions:
// without CRON_SECRET nobody can ring it. The issue is claimed per week inside sendKiezBrief(),
// so a second ring (or the Monday fallback in fetch-daily) sends nothing.
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function handle(request: Request): Promise<Response> {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) return json({ error: 'cron_disabled' }, 503);
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return json({ error: 'Unauthorized' }, 401);
  const result = await sendKiezBrief();
  return json(result);
}

export const GET: APIRoute = ({ request }) => handle(request);
```

`src/pages/api/newsletter/unsubscribe.ts`:

```ts
import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../lib/mongodb';
import { unsubSecret, verifyUnsubToken } from '../../../lib/newsletter/unsubToken';
import { clientIpFrom, consumeRateLimit, hashIp } from '../../../lib/auth/rateLimit';

// RFC 8058 one-click unsubscribe: Gmail/Yahoo POST here from their own „Abbestellen" button
// (body `List-Unsubscribe=One-Click`). The token is the secret; the IP limit only blunts scanning.
// Answers 200 with no body on success, 400 on a bad token — never a page, never a redirect.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ip = clientIpFrom(request, clientAddress);
  const limit = await consumeRateLimit(`unsub:${hashIp(ip)}`, 60, 60 * 60 * 1000).catch(() => ({ limited: false }));
  if (limit.limited) return new Response(null, { status: 429 });

  const token = new URL(request.url).searchParams.get('t');
  const userId = verifyUnsubToken(token, unsubSecret());
  if (!userId) return new Response(null, { status: 400 });

  const db = await connectDB();
  await db.collection('users').updateOne({ _id: new ObjectId(userId) }, { $set: { newsletter: 'off' } });
  return new Response(null, { status: 200 });
};
```

`src/pages/newsletter/abmelden.astro`:

```astro
---
// Unsubscribe landing page of the Kiez-Brief (the link in the mail's footer). Works without a
// login — the link may be opened anywhere. The token names the member; a valid one turns the
// mail off on the spot, an invalid one gets a neutral answer (no oracle).
import { ObjectId } from 'mongodb';
import LandingLayout from '../../layouts/LandingLayout.astro';
import { connectDB } from '../../lib/mongodb';
import { unsubSecret, verifyUnsubToken } from '../../lib/newsletter/unsubToken';

const token = new URL(Astro.request.url).searchParams.get('t');
const userId = verifyUnsubToken(token, unsubSecret());
if (userId) {
  const db = await connectDB();
  await db.collection('users').updateOne({ _id: new ObjectId(userId) }, { $set: { newsletter: 'off' } });
}
Astro.response.headers.set('Cache-Control', 'no-store');
---

<LandingLayout title="Kiez-Brief abbestellen | Mahalle" description="Kiez-Brief abbestellen.">
  <div class="lgl-wrap">
    <a href="/" class="lgl-back font-dmmono">← Mahalle</a>
    {userId ? (
      <>
        <h1 class="font-bricolage">Abbestellt.</h1>
        <p>Du bekommst den Kiez-Brief nicht mehr. Deine Mitteilungen in der App bleiben, wie sie sind.</p>
        <p>Wieder einschalten kannst du ihn jederzeit in Mahalle: Glocke antippen, dann „Kiez-Brief · wöchentlich".</p>
      </>
    ) : (
      <>
        <h1 class="font-bricolage">Dieser Link ist ungültig.</h1>
        <p>Den Kiez-Brief stellst du in Mahalle ein: Glocke antippen, dann „Kiez-Brief · aus".</p>
      </>
    )}
  </div>
</LandingLayout>

<style>
  .lgl-wrap { max-width: 680px; margin: 0 auto; padding: 40px 22px 60px; }
  .lgl-back { display: inline-block; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--k-ink-soft); margin-bottom: 18px; }
  .lgl-wrap h1 { font-size: 34px; font-weight: 800; letter-spacing: -0.03em; margin: 0 0 20px; }
  .lgl-wrap p { font-size: 15px; line-height: 1.55; color: var(--k-ink-soft); margin: 0 0 12px; }
</style>
```

`src/pages/api/profile/newsletter.ts`:

```ts
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../lib/mongodb';
import { NEWSLETTER_MODES, storedNewsletterMode } from '../../../lib/newsletter/kiezBriefRules';

// The member's Kiez-Brief preference (users.newsletter; absent = 'weekly').
// Not ban-gated: turning a mail off must always be possible.
const BodySchema = z.object({ mode: z.enum(NEWSLETTER_MODES) });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) return json({ error: 'Unauthorized' }, 401);
  const db = await connectDB();
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(session.user.id) },
    { projection: { newsletter: 1, emailVerified: 1 } },
  );
  return json({ mode: storedNewsletterMode(user?.newsletter), emailVerified: user?.emailVerified === true });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) return json({ error: 'Unauthorized' }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid mode' }, 400);
  const { mode } = parsed.data;

  const db = await connectDB();
  await db.collection('users').updateOne(
    { _id: new ObjectId(session.user.id) },
    mode === 'weekly' ? { $unset: { newsletter: '' } } : { $set: { newsletter: mode } },
  );
  return json({ mode });
};
```

`src/pages/api/admin/kiez-brief/preview.ts`:

```ts
import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { requireAdminSession } from '../../../../lib/auth';
import { connectDB } from '../../../../lib/mongodb';
import { isMailerConfigured, sendMail } from '../../../../lib/email/mailer';
import { buildIssue, kiezBriefBaseUrl, mailsFor, renderIssue } from '../../../../lib/newsletter/kiezBrief';
import { unsubSecret } from '../../../../lib/newsletter/unsubToken';
import { isQuiet, subjectFor } from '../../../../lib/newsletter/kiezBriefRules';

// The owner's look at THIS week's issue: GET renders the HTML in the browser (no claim, no send);
// POST sends one copy to the admin's own address — the way to see it in a real mail client before
// the first Sunday and after any template change. The send is a POST on purpose: a GET that sends
// mail could be triggered by any link the admin is lured to click.
async function issueForAdmin(request: Request, userId: string) {
  const data = await buildIssue();
  const baseUrl = kiezBriefBaseUrl() || new URL(request.url).origin;
  const [mine] = mailsFor(await renderIssue(data, baseUrl), subjectFor(data), [{ id: userId, email: 'preview', name: null }], baseUrl, unsubSecret());
  return { data, mine }; // mine.html carries the admin's own unsubscribe link
}

export const GET: APIRoute = async ({ request }) => {
  const gate = await requireAdminSession(request);
  if (!gate.ok) return gate.response;
  const { data, mine } = await issueForAdmin(request, gate.userId);
  return new Response(mine.html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Kiez-Brief-Quiet': String(isQuiet(data)) },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const gate = await requireAdminSession(request);
  if (!gate.ok) return gate.response;
  const db = await connectDB();
  const admin = await db.collection('users').findOne({ _id: new ObjectId(gate.userId) }, { projection: { email: 1 } });
  if (!admin || typeof admin.email !== 'string') return new Response(JSON.stringify({ error: 'no_email' }), { status: 400 });
  if (!isMailerConfigured()) return new Response(JSON.stringify({ error: 'mailer_not_configured' }), { status: 503 });
  const { data, mine } = await issueForAdmin(request, gate.userId);
  await sendMail({ ...mine, to: admin.email, subject: `[Vorschau] ${subjectFor(data)}` });
  return new Response(JSON.stringify({ sent: true, to: admin.email, quiet: isQuiet(data) }), { headers: { 'Content-Type': 'application/json' } });
};
```

- [ ] **Step 7: Budgets** → tsc 16, `pnpm test` green (23 new tests so far).

- [ ] **Step 8: Commit**

```bash
git add src/lib/security/crossSiteForm.ts src/lib/security/crossSiteForm.test.ts src/middleware.ts astro.config.mjs src/pages/api/cron/kiez-brief.ts src/pages/api/newsletter/unsubscribe.ts src/pages/newsletter/abmelden.astro src/pages/api/profile/newsletter.ts src/pages/api/admin/kiez-brief/preview.ts
git commit -m "feat: Kiez-Brief routes — cron trigger, unsubscribe (link + one-click), preference, admin preview"
```

---

### Task 4: The switch, the copy, the legal sentences, the fallback, the tombstone, the workflow

**Files:**
- Modify: `src/components/forum/kiosk/NotificationPanel.svelte`, `src/lib/kiosk-i18n.ts`, `src/pages/datenschutz.astro`, `src/lib/auth/accountDeletion.ts`, `src/pages/api/news/fetch-daily.ts`
- Create: `.github/workflows/kiez-brief.yml`

**Interfaces:**
- Consumes: `NEWSLETTER_MODES`, `storedNewsletterMode`, `NewsletterMode` (Task 1), `GET/POST /api/profile/newsletter` (Task 3), `sendKiezBrief` (Task 2).

- [ ] **Step 1: Panel row under the forum row (same `.nc-pref` styling, optimistic with rollback)**

```diff
diff --git a/src/components/forum/kiosk/NotificationPanel.svelte b/src/components/forum/kiosk/NotificationPanel.svelte
index 7a41576b..4431c3fc 100644
--- a/src/components/forum/kiosk/NotificationPanel.svelte
+++ b/src/components/forum/kiosk/NotificationPanel.svelte
@@ -8,6 +8,7 @@
   import { detectPushState, subscribeToPush, unsubscribeFromPush, type PushUiState } from '../../../lib/pushClient';
   import { showError } from '../../../utils/toast';
   import { storedForumNotify, type ForumNotifyMode } from '../../../lib/forum/forumNotifyRules';
+  import { NEWSLETTER_MODES, storedNewsletterMode, type NewsletterMode } from '../../../lib/newsletter/kiezBriefRules';
 
   let { onClose } = $props<{ onClose: (restoreFocus: boolean) => void }>();
 
@@ -78,6 +79,39 @@
     }
   }
 
+  // Kiez-Brief preference (weekly · off), same shape as the forum row.
+  let newsMode = $state<NewsletterMode | null>(null);
+  let newsBusy = $state(false);
+
+  $effect(() => {
+    let alive = true;
+    fetch('/api/profile/newsletter')
+      .then((r) => (r.ok ? r.json() : null))
+      .then((d) => { if (alive && d) newsMode = storedNewsletterMode(d.mode); })
+      .catch(() => {});
+    return () => { alive = false; };
+  });
+
+  async function setNewsMode(mode: NewsletterMode) {
+    if (newsBusy || mode === newsMode) return;
+    const previous = newsMode;
+    newsMode = mode; // optimistic
+    newsBusy = true;
+    try {
+      const res = await fetch('/api/profile/newsletter', {
+        method: 'POST',
+        headers: { 'Content-Type': 'application/json' },
+        body: JSON.stringify({ mode }),
+      });
+      if (!res.ok) throw new Error(String(res.status));
+    } catch {
+      newsMode = previous;
+      showError($t['nc.newsletter.error']);
+    } finally {
+      newsBusy = false;
+    }
+  }
+
   let items = $state<NotificationItem[] | null>(null);
   let failed = $state(false);
   // Ids that were unread at fetch time — POST /read marks them server-side,
@@ -306,6 +340,22 @@
         </span>
       </div>
     {/if}
+    {#if newsMode !== null}
+      <div class="nc-pref" role="group" aria-busy={newsBusy} aria-label={$t['nc.newsletter.label']}>
+        <span class="nc-pref-label font-dmmono">{$t['nc.newsletter.label']}</span>
+        <span class="nc-pref-opts">
+          {#each NEWSLETTER_MODES as mode (mode)}
+            <button
+              type="button"
+              class="nc-pref-opt font-dmmono"
+              class:nc-pref-on={newsMode === mode}
+              aria-pressed={newsMode === mode}
+              onclick={() => setNewsMode(mode)}
+            >{$t[`nc.newsletter.${mode}`]}</button>
+          {/each}
+        </span>
+      </div>
+    {/if}
     {#if failed}
       <div class="nc-empty font-instrument">{$t['nc.error']}</div>
     {:else if items === null}
```

- [ ] **Step 2: Copy — the four `nc.newsletter.*` keys in both dicts and the register note (the legal notice at the point of registration)**

```diff
diff --git a/src/lib/kiosk-i18n.ts b/src/lib/kiosk-i18n.ts
index 336c0a0e..37b7aaf7 100644
--- a/src/lib/kiosk-i18n.ts
+++ b/src/lib/kiosk-i18n.ts
@@ -147,6 +147,10 @@ const de = {
   'nc.forumNotify.each': 'jeden',
   'nc.forumNotify.off': 'aus',
   'nc.forumNotify.error': 'Die Einstellung konnte nicht gespeichert werden.',
+  'nc.newsletter.label': 'Kiez-Brief (E-Mail)',
+  'nc.newsletter.weekly': 'wöchentlich',
+  'nc.newsletter.off': 'aus',
+  'nc.newsletter.error': 'Die Einstellung konnte nicht gespeichert werden.',
   'nc.push.enable': 'Push-Mitteilungen aktivieren',
   'nc.push.active': 'Push aktiv auf diesem Gerät',
   'nc.push.disable': 'deaktivieren',
@@ -1294,7 +1298,7 @@ const de = {
   'auth.register.terms.termsLink': 'Nutzungsbedingungen',
   'auth.register.terms.mid': ' und ',
   'auth.register.terms.privacyLink': 'Datenschutz',
-  'auth.register.note': 'Kein Klarname nötig. Ohne Eingabe vergeben wir deinen @Namen automatisch. Dein „Verifiziert im Kiez“-Abzeichen vergibt das Team später separat.',
+  'auth.register.note': 'Kein Klarname nötig. Ohne Eingabe vergeben wir deinen @Namen automatisch. Dein „Verifiziert im Kiez“-Abzeichen vergibt das Team später separat. Als Mitglied bekommst du einmal die Woche den Kiez-Brief per E-Mail — abbestellbar jederzeit in der App oder über den Link im Brief.',
   'auth.register.alt': 'Schon dabei? ',
   'auth.register.altLink': 'Anmelden',
   'auth.register.successTitle': 'Konto erstellt — willkommen im Kiez',
@@ -2254,6 +2258,10 @@ const en: Dict = {
   'nc.forumNotify.each': 'each one',
   'nc.forumNotify.off': 'off',
   'nc.forumNotify.error': 'The setting could not be saved.',
+  'nc.newsletter.label': 'Kiez-Brief (e-mail)',
+  'nc.newsletter.weekly': 'weekly',
+  'nc.newsletter.off': 'off',
+  'nc.newsletter.error': 'The setting could not be saved.',
   'nc.push.enable': 'Enable push notifications',
   'nc.push.active': 'Push active on this device',
   'nc.push.disable': 'disable',
@@ -3322,7 +3330,7 @@ const en: Dict = {
   'auth.register.terms.termsLink': 'Terms of Use',
   'auth.register.terms.mid': ' and ',
   'auth.register.terms.privacyLink': 'Privacy Policy',
-  'auth.register.note': 'No legal name required. Leave the @name empty and we assign one automatically. Your “Verified in the Kiez” badge is granted separately by the team later.',
+  'auth.register.note': 'No legal name required. Leave the @name empty and we assign one automatically. Your “Verified in the Kiez” badge is granted separately by the team later. As a member you receive the weekly Kiez-Brief by e-mail — unsubscribe any time in the app or via the link in the mail.',
   'auth.register.alt': 'Already here? ',
   'auth.register.altLink': 'Sign in',
   'auth.register.successTitle': 'Account created — welcome to the Kiez',
```

- [ ] **Step 3: Datenschutz sentence (§ 7 Abs. 3 UWG)**

```diff
diff --git a/src/pages/datenschutz.astro b/src/pages/datenschutz.astro
index cad12e82..2d1fed7f 100644
--- a/src/pages/datenschutz.astro
+++ b/src/pages/datenschutz.astro
@@ -40,7 +40,11 @@ const zipCity = import.meta.env.IMPRESSUM_ZIP_CITY || 'Berlin';
       (Art. 6 Abs. 1 lit. b DSGVO), zur Missbrauchs- und Spamabwehr einschließlich
       automatisierter Inhaltsprüfung (Art. 6 Abs. 1 lit. f DSGVO) sowie zum Versand
       funktionaler E-Mails wie Verifizierung und Passwort-Zurücksetzen
-      (Art. 6 Abs. 1 lit. b DSGVO).
+      (Art. 6 Abs. 1 lit. b DSGVO). Mitglieder erhalten außerdem einmal
+      wöchentlich den „Kiez-Brief" per E-Mail mit den neuen Beiträgen, Terminen
+      und Anzeigen der Plattform (§ 7 Abs. 3 UWG, Art. 6 Abs. 1 lit. f DSGVO);
+      du kannst ihn jederzeit in der App oder über den Link in jeder Ausgabe
+      abbestellen.
     </p>
 
     <h2 class="font-bricolage">4. Auftragsverarbeiter und Empfänger</h2>
```

- [ ] **Step 4: Tombstone unsets the preference; Monday fallback in the morning cron**

```diff
diff --git a/src/lib/auth/accountDeletion.ts b/src/lib/auth/accountDeletion.ts
index 019bcd5a..0be5a341 100644
--- a/src/lib/auth/accountDeletion.ts
+++ b/src/lib/auth/accountDeletion.ts
@@ -448,6 +448,7 @@ export async function runDeletionPipeline(
           tourHelloDismissedAt: '',
           lastVisit: '',
           forumNotify: '',
+          newsletter: '',
           deletionClaimedAt: '',
         },
       }
```

```diff
diff --git a/src/pages/api/news/fetch-daily.ts b/src/pages/api/news/fetch-daily.ts
index c99efd06..1caf1774 100644
--- a/src/pages/api/news/fetch-daily.ts
+++ b/src/pages/api/news/fetch-daily.ts
@@ -4,6 +4,7 @@ import { connectDB } from '../../../lib/mongodb';
 import { checkAirLoggerFreshness } from '../../../lib/kiez/airFreshness';
 import { announceNewBlogPosts } from '../../../lib/blog/blogNotify';
 import { sendForumDigest } from '../../../lib/forum/forumNotify';
+import { sendKiezBrief } from '../../../lib/newsletter/kiezBrief';
 import type { NewsItem } from '../../../types';
 import { decodeHtmlEntities } from '../../../utils/decodeHtmlEntities';
 import crypto from 'crypto';
@@ -359,6 +360,11 @@ export const GET: APIRoute = async ({ request }) => {
   // run of this route finds the day claimed), never throws.
   await sendForumDigest();
 
+  // Monday fallback of the weekly member mail: sends only when Sunday's GitHub run never
+  // claimed this issue week (the key is the ISO week of now − 24 h, so Monday morning still
+  // belongs to Sunday's issue). Never throws.
+  await sendKiezBrief({ fallback: true });
+
     const openaiKey = import.meta.env.OPENAI_API_KEY;
     const newsDataKey = import.meta.env.NEWSDATA_API_KEY;
 
```

- [ ] **Step 5: The Sunday workflow (GET like the other workflows — a bodiless POST without a content type trips the form check)**

`.github/workflows/kiez-brief.yml`:

```yaml
name: Kiez-Brief (weekly member mail)
# Rings GET /api/cron/kiez-brief on Sunday evening (GET like the other workflows — a bodiless
# POST without a content type trips the cross-site form check). Vercel Hobby allows one cron run a day and
# both vercel.json slots are taken (fetch-daily 06:00 UTC, process-deletions 05:30 UTC), so —
# like kiez-air-logger.yml and news-afternoon-fetch.yml — GitHub Actions rings the route.
# 16:00 UTC = 18:00 Berlin in summer (CEST) / 17:00 in winter (CET); GitHub starts scheduled runs
# 0–4 h late, so "Sunday evening" is the promise. The issue is claimed per ISO week inside the
# app: if this run never arrives, the Monday 06:00 UTC cron (fetch-daily) sends it instead.
# Requires repo secret CRON_SECRET (same value as the Vercel env).
on:
  schedule:
    - cron: '0 16 * * 0'
  workflow_dispatch:

jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger the Kiez-Brief
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
          # Canonical domain — never the *.vercel.app origin (308 redirect; curl drops the
          # Authorization header across hosts, see kiez-air-logger.yml).
          APP_ORIGIN: https://mahalle.digital
        run: |
          code=$(curl -s -o /tmp/resp.json -w '%{http_code}' \
            -H "Authorization: Bearer $CRON_SECRET" \
            "$APP_ORIGIN/api/cron/kiez-brief")
          cat /tmp/resp.json; echo
          if [ "$code" != "200" ]; then
            echo "kiez-brief trigger failed with HTTP $code"
            exit 1
          fi
```

- [ ] **Step 6: Budgets** → tsc 16, svelte-check 81, `pnpm test` green (359).

- [ ] **Step 7: Commit**

```bash
git add src/components/forum/kiosk/NotificationPanel.svelte src/lib/kiosk-i18n.ts src/pages/datenschutz.astro src/lib/auth/accountDeletion.ts src/pages/api/news/fetch-daily.ts .github/workflows/kiez-brief.yml
git commit -m "feat: Kiez-Brief switch, copy, legal notice, Monday fallback, Sunday workflow"
```

---

### Task 5: Dev dry run, browser gate, docs

**Files:**
- Scripts (gitignored, on disk in the main checkout): `scratchpad/kiez-brief/dry-run.mts` (dev DB only; `cleanup` resets issues + preferences), `token.mts <email>` (prints a member's unsubscribe token — a derived value, never the secret), `probe.cjs <base> <jonas-token>`.
- Modify: `CLAUDE.md` (root), `src/components/forum/kiosk/CLAUDE.md`, `src/pages/api/news/CLAUDE.md`, `docs/runbooks/web-push-smoke.md` is NOT touched; add `docs/runbooks/kiez-brief.md`.

- [ ] **Step 1: Dry run on dev** — `npx tsx --env-file=.env scratchpad/kiez-brief/dry-run.mts` → JSON with `week`, `subject`, section titles, `recipients`, `placeholderLeft: true`; the HTML lands in `scratchpad/kiez-brief/issue.html`.

- [ ] **Step 2: Build + serve** (`npx astro build --config scratchpad/astro.config.preview.mjs`; `PORT=4655 HOST=127.0.0.1 node --env-file=.env dist/server/entry.mjs` in the background).

- [ ] **Step 3: Probe**

```bash
npx tsx --env-file=.env scratchpad/kiez-brief/token.mts jonas@mahalle-dev.test 2>/dev/null | tail -1 > scratchpad/kiez-brief/jonas-token.txt
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/kiez-brief/probe.cjs http://127.0.0.1:4655 "$(tr -d '\n' < scratchpad/kiez-brief/jonas-token.txt)"
```
Expected `ALL PASS` (16): bad token → neutral page and 400 on one-click; weekly by default; unknown mode 400; the panel row „Kiez-Brief (E-Mail) · wöchentlich | aus" under the forum row; off/weekly saved; the valid link says „Abbestellt." and sets off; one-click POST → 200 and sets off; admin preview renders (no `%%UNSUB%%` left), member 403, cron without secret 401, a cross-site form POST elsewhere still 403. Then `fuser -k 4655/tcp` (own call) and `dry-run.mts cleanup`.

- [ ] **Step 4: Docs**

Root `CLAUDE.md`: `users` gains `newsletter?: 'off'` (absent = weekly; `GET/POST /api/profile/newsletter`; set by the link/one-click routes; unset by the tombstone); new collection bullet `kiezBriefIssues` after `forumDigests` (`{ _id: <ISO week of now−24h>, windowFrom, windowTo, claimedAt, fallback, recipients?, skipped?: 'quiet'|'quota', sentAt? }`, claim-by-insert before anything is sent, never delete a row in prod); the Newsboard „Second daily fetch" paragraph gets the Monday fallback clause; a new sub-bullet under „Outgoing Email": `sendMailBatch()` + `MailInput.headers`; under „Astro Script + ViewTransitions" or a new „Cross-site form check" note: Astro's `checkOrigin` is OFF, the rule lives in the middleware with one exempt path, why. `src/components/forum/kiosk/CLAUDE.md`: section „Kiez-Brief (2026-10-03)" (what, when, who, the switch, the unsubscribe paths, the register/Datenschutz notice, probes). `src/pages/api/news/CLAUDE.md`: the fallback call after the digest. `docs/runbooks/kiez-brief.md`: first-Sunday checklist (repo secret `CRON_SECRET` present → `gh secret list`; `workflow_dispatch` once by hand; `GET /api/admin/kiez-brief/preview` in the browser and `POST` (e.g. `curl -X POST -H 'Content-Type: application/json' -b <cookie>`) to your own address; verify your own prod e-mail; what to do when Sentry says „quota"; GitHub run lateness; how to re-send on dev only).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md src/components/forum/kiosk/CLAUDE.md src/pages/api/news/CLAUDE.md docs/runbooks/kiez-brief.md
git commit -m "docs: Kiez-Brief — the weekly member e-mail"
```
