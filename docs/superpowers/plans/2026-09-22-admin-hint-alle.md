# „@alle" Admin-Hinweis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin writes `@alle` (optionally `@alle -handle -handle`) in a forum post or comment; every member active in the last 90 days, minus the excluded ones, gets an „Admin-Hinweis" notification (bell + push) that links to that post or comment; readers see an „Admin-Hinweis" tag on the content but never the token; the admin sees the token muted.

**Architecture:** The token is parsed on the SERVER when the text is saved (like `@handle` mentions, `src/lib/mentions/*`). The span `@alle -x -y` is REMOVED from the stored `body` and kept on the document as `broadcast: { token, excludedHandles, notifiedAt }` — so every place that shows a body (detail, comments, feed excerpts, search, translation, related rail) hides it with zero renderer changes, and the author's edit box restores it by prefixing `token` to the body. Recipients are computed at send time from activity signals (`lastSeenAt` stamp — new, written by the JWT callback — plus content, read notifications, push subscriptions, signup date), never stored. Notifications are a new type `'admin_hint'`, idempotent per (`meta.sourceId`, recipient), no rate limit (user decision: „it is up to my auto-control").

**Tech Stack:** Astro 5 SSR routes, Svelte 5 islands, MongoDB driver, `node:test` via `npx tsx --test <file>` (first line of each test file: `// Run: npx tsx --test <path>`), Playwright `.cjs` probes and `tsx` e2e scripts against the own dev server on port 4655.

**Spec:** the chat decisions of 2026-09-22 01:26–01:50, recorded verbatim in „Global Constraints" below. There is no separate spec file.

## Global Constraints

- Handle is `@alle` (German, like the app). `all`, `alle`, `everyone`, `here`, `channel` are already reserved handles (`RESERVED_HANDLES`, `src/lib/profile/handle.ts`) — never remove them.
- **Admins only.** For a non-admin author `@alle` is plain text: stored as written, shown as written, no notification, no tag. The gate is `session.user.role === 'admin'` on the server; islands do not know the role.
- Works in **forum posts (topics, announcements, recommendations) AND comments**. Not in events, listings, News, official admin announcements (those already broadcast as `'official'`).
- **Exclusions:** `@alle -atakee -anna` — one space before each `-handle`; the group ends at the first token that is not `-[a-z0-9_]{3,20}`. Unknown handles are ignored silently (user accepted that a typo excludes nobody).
- **Recipients:** members active in the **last 90 days**, minus the author, minus excluded handles, minus tombstones (`anonymized: true`). „Active" = any of: `users.lastSeenAt ≥ since` (new stamp), `users.createdAt ≥ since` (`createdAt` may be an ISO STRING — `register.ts` writes `new Date().toISOString()` — or a Date; match both), authored a topic/announcement/recommendation/comment/event/listing with `createdAt ≥ since`, read a notification (`notifications.readAt ≥ since`), or a push subscription with `updatedAt ≥ since`.
- **No rate limit**, no daily cap.
- **Hidden, not secret:** the token is removed from the stored `body`; `broadcast.token` / `excludedHandles` stay on the document and may appear in API responses. Never put anything private into an exclusion list (documented, not enforced).
- **Author view:** the admin sees the token muted (`text-ink-mute font-dmmono text-[0.85em]`) above the body. Everyone sees the tag „Admin-Hinweis" (key `forum.adminHint.tag`, DE „Admin-Hinweis", EN „Admin note") on the comment / post header line.
- **Notification copy (DE proposals, the user words copy — keys are final, texts may change):** `nc.adminHint.post` „Admin-Hinweis zu ‚{title}‘", `nc.adminHint.comment` „Admin-Hinweis in einem Kommentar zu ‚{title}‘"; EN `Admin note on ‘{title}’` / `Admin note in a comment on ‘{title}’`. Push (German only, `src/lib/push.ts`): the same two texts. Panel glyph `!` in plum (`var(--k-plum, #6f2f59)`), like `moderation` — the admin speaks.
- **Idempotent:** one notification per (source document, recipient), ever — an edit that keeps `@alle` re-notifies nobody; an edit that ADDS `@alle` later notifies then; an edit that REMOVES it clears `broadcast` (tag disappears), notifications already sent stay.
- **Only when public:** admin content skips moderation and is `approved` at once; the notify call still runs only when the saved status is `'approved'` (belt and braces; `processReviewAction` does NOT need an approval hook for this type).
- **Comment deep link:** `href = <parent href>#comment-<commentId>`; `ForumComment.svelte` gets `id="comment-{id}"` and the detail page scrolls to it after the comments have rendered.
- **Edit prefill:** the token is placed at the START of the text when the author edits (the original position is not kept — documented).
- `movePost` (kind change) spreads the source document (`buildMovedDoc`), so `broadcast` travels with a moved post — no change needed, but the e2e checks it.
- No regex lookbehind in any module an island imports (Safari < 16.4 fails at parse time).
- `src/lib/mongodb.ts` throws at import time without the app env: anything a `node:test` file imports must take the db as an argument (pattern: `mentionsResolve.ts`).
- Gates: `pnpm type-check` errors ≤ 23, `npx -y svelte-check@4` ≤ 89, `pnpm build` green. Commit messages one line, no attribution lines; `git add` named files only; `scratchpad/` is gitignored; never print `.env` or password files; dev DB only (`mahalle-dev`); never push (the user pushes).
- Dev server: `SENTRY_DSN= TELEGRAM_BOT_TOKEN= SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY= nohup pnpm astro dev --port 4655 --force > scratchpad/dev-4655.log 2>&1 &`; stop with `fuser -k 4655/tcp` (never `pkill -f "astro dev …"` — it kills the calling shell). A `pnpm build` invalidates the dev dependency cache → restart with `--force`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/mentions/broadcast.ts` (new, PURE) | find the `@alle -x -y` span, strip it, restore it for editing |
| `src/lib/mentions/broadcast.test.ts` (new) | tests for the pure module |
| `src/lib/mentions/activeMembers.ts` (new, db INJECTED) | `findActiveMemberIds(db, since)` from the activity signals |
| `src/lib/mentions/activeMembers.test.ts` (new) | tests with an in-memory fake db |
| `src/lib/mentions/mentionsStore.ts` (modify, SERVER) | `applyBroadcast()` + `notifyAdminHint()` |
| `src/types/notification.ts`, `src/types/index.ts` | type `'admin_hint'`, `BroadcastRef`, `broadcast?` on Topic/Announcement/Recommendation/Comment |
| `src/lib/push.ts`, `src/lib/kiosk-i18n.ts`, `src/components/forum/kiosk/NotificationPanel.svelte` | copy + glyph |
| `auth.config.ts` | `lastSeenAt` stamp in the 5-minute JWT recheck |
| 8 API routes (`topics|announcements|recommendations` create + edit, `comments` create + edit) | parse, store, notify |
| `src/pages/api/users/mention-search.ts`, `compose/MentionPopup.svelte` | autocomplete row for admins |
| `ForumComment.svelte`, `ForumPostDetail.svelte`, `ForumCommentList.svelte` (anchor scroll) | tag, muted token, edit prefill, anchor |
| `scratchpad/e2e-admin-hint.mts` | dev e2e (gitignored) |
| `CLAUDE.md`, `src/components/forum/kiosk/CLAUDE.md`, `docs/runbooks/debut-event-readiness.md` | docs |

---

### Task 1: Pure parser `broadcast.ts`

**Files:**
- Create: `src/lib/mentions/broadcast.ts`
- Test: `src/lib/mentions/broadcast.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const BROADCAST_HANDLE = 'alle';
  export interface BroadcastRef { token: string; excludedHandles: string[]; notifiedAt?: Date | string; recipients?: number }
  export function parseBroadcast(text: string): { body: string; token: string; excludedHandles: string[] } | null
  export function restoreBroadcastText(body: string, broadcast?: Pick<BroadcastRef, 'token'> | null): string
  ```

- [ ] **Step 1: Write the failing test**

```ts
// Run: npx tsx --test src/lib/mentions/broadcast.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBroadcast, restoreBroadcastText } from './broadcast';

test('finds @alle, strips it, keeps the rest intact', () => {
  const r = parseBroadcast('Hallo zusammen, @alle bitte lesen.');
  assert.deepEqual(r, { body: 'Hallo zusammen, bitte lesen.', token: '@alle', excludedHandles: [] });
});

test('exclusions: „-handle" tokens directly after @alle, one space each', () => {
  const r = parseBroadcast('@alle -atakee -anna_m das gilt für euch nicht.');
  assert.deepEqual(r, { body: 'das gilt für euch nicht.', token: '@alle -atakee -anna_m', excludedHandles: ['atakee', 'anna_m'] });
});

test('the group ends at the first token that is not -handle', () => {
  const r = parseBroadcast('@alle -petra - nicht -x -1234 Ende');
  assert.equal(r?.token, '@alle -petra');
  assert.deepEqual(r?.excludedHandles, ['petra']);
  assert.equal(r?.body, '- nicht -x -1234 Ende');
});

test('handles are lowercased and deduplicated, self-mention @alle inside a word or e-mail is not a token', () => {
  assert.deepEqual(parseBroadcast('@alle -Petra -petra x')?.excludedHandles, ['petra']);
  assert.equal(parseBroadcast('mail an x@alle.de'), null);
  assert.equal(parseBroadcast('@aller Anfang'), null);
  assert.equal(parseBroadcast('kein token hier'), null);
});

test('only the FIRST @alle counts; a second one stays text', () => {
  const r = parseBroadcast('@alle eins @alle zwei');
  assert.equal(r?.body, 'eins @alle zwei');
});

test('restoreBroadcastText puts the token at the start', () => {
  assert.equal(restoreBroadcastText('bitte lesen.', { token: '@alle -anna' }), '@alle -anna bitte lesen.');
  assert.equal(restoreBroadcastText('bitte lesen.', null), 'bitte lesen.');
  assert.equal(restoreBroadcastText('', { token: '@alle' }), '@alle');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/mentions/broadcast.test.ts`
Expected: FAIL — cannot find module `./broadcast`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/mentions/broadcast.ts — dependency-pure (server + islands).
// „@alle" (2026-09-22, admin-only broadcast): the SERVER strips the span
// „@alle -handle -handle" from the stored body and keeps it as
// `broadcast: { token, excludedHandles }` on the document, so no renderer
// ever shows it; the author's edit box restores it at the START of the text.
// Same boundary rule as @handle mentions and NO lookbehind (Safari < 16.4).
export const BROADCAST_HANDLE = 'alle';

export interface BroadcastRef {
  token: string;              // canonical „@alle -a -b" as stored
  excludedHandles: string[];  // lowercase, unique
  notifiedAt?: Date | string; // set once the notifications went out
  recipients?: number;        // how many were notified (for the admin's own eyes)
}

// group 1 = the character before „@" (or start); group 2 = the „-handle" run.
const SRC = `(^|[^\\p{L}\\p{N}_@./])@${BROADCAST_HANDLE}(?![a-z0-9_])((?: -[a-z0-9_]{3,20}(?![a-z0-9_]))*)`;

export function parseBroadcast(text: string): { body: string; token: string; excludedHandles: string[] } | null {
  const m = new RegExp(SRC, 'iu').exec(text);
  if (!m) return null;
  const at = (m.index ?? 0) + m[1].length;
  const rawRun = m[2] ?? '';
  const excludedHandles = [...new Set(rawRun.trim().split(/\s+/).filter(Boolean).map((t) => t.slice(1).toLowerCase()))];
  const token = excludedHandles.length ? `@${BROADCAST_HANDLE} ${excludedHandles.map((h) => '-' + h).join(' ')}` : `@${BROADCAST_HANDLE}`;
  const end = at + 1 + BROADCAST_HANDLE.length + rawRun.length;
  const body = (text.slice(0, at) + text.slice(end)).replace(/[ \t]{2,}/g, ' ').replace(/^ +| +$/g, '');
  return { body, token, excludedHandles };
}

export function restoreBroadcastText(body: string, broadcast?: Pick<BroadcastRef, 'token'> | null): string {
  if (!broadcast?.token) return body;
  return body ? `${broadcast.token} ${body}` : broadcast.token;
}
```

- [ ] **Step 4: Run the test**

Run: `npx tsx --test src/lib/mentions/broadcast.test.ts`
Expected: 6 pass. If the third test fails on `body`, check that the trailing-space trim only touches line ends (`^ +| +$` without the `m` flag is fine: the whole string).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mentions/broadcast.ts src/lib/mentions/broadcast.test.ts
git commit -m "admin-hint: pure parser for @alle with exclusions"
```

---

### Task 2: Active members (db injected) + `lastSeenAt` stamp

**Files:**
- Create: `src/lib/mentions/activeMembers.ts`, `src/lib/mentions/activeMembers.test.ts`
- Modify: `auth.config.ts` (the `PWD_RECHECK_MS` block, ~line 129–150)
- Modify: `src/types/next-auth.d.ts` only if the compiler complains (it should not — no token field is added)

**Interfaces:**
- Produces: `export const ACTIVE_WINDOW_DAYS = 90; export function activeSince(now?: Date): Date; export async function findActiveMemberIds(db: MentionDb, since: Date): Promise<string[]>` — `MentionDb` from `./mentionsResolve`.

- [ ] **Step 1: Write the failing test** (an in-memory fake with just enough of the driver surface)

```ts
// Run: npx tsx --test src/lib/mentions/activeMembers.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findActiveMemberIds, activeSince, ACTIVE_WINDOW_DAYS } from './activeMembers';

const NOW = new Date('2026-09-22T00:00:00Z');
const since = activeSince(NOW);
const old = new Date('2026-05-01T00:00:00Z');
const fresh = new Date('2026-09-01T00:00:00Z');

// Minimal fake: each collection answers find(filter, {projection}).toArray() by
// applying only the operators this module uses ($gte, $ne, $in, $or).
function fakeDb(data: Record<string, any[]>) {
  const matches = (doc: any, f: any): boolean => Object.entries(f).every(([k, v]: [string, any]) => {
    if (k === '$or') return v.some((sub: any) => matches(doc, sub));
    const val = doc[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$gte' in v) return val !== undefined && val !== null && (typeof val === 'string' ? val >= String(v.$gte instanceof Date ? v.$gte.toISOString() : v.$gte) : new Date(val) >= new Date(v.$gte));
      if ('$ne' in v) return val !== v.$ne;
      if ('$in' in v) return v.$in.map(String).includes(String(val));
    }
    return val === v;
  });
  return { collection: (name: string) => ({ find: (f: any) => ({ toArray: async () => (data[name] ?? []).filter((d) => matches(d, f)) }) }) } as any;
}

test('activeSince is 90 days before now', () => {
  assert.equal(Math.round((NOW.getTime() - since.getTime()) / 86400000), ACTIVE_WINDOW_DAYS);
});

test('every activity signal counts, tombstones never, silent old accounts never', async () => {
  const db = fakeDb({
    users: [
      { _id: 'u_seen', lastSeenAt: fresh },
      { _id: 'u_new_iso', createdAt: '2026-09-10T10:00:00.000Z' },
      { _id: 'u_new_date', createdAt: fresh },
      { _id: 'u_author', createdAt: old },
      { _id: 'u_reader', createdAt: old },
      { _id: 'u_push', createdAt: old },
      { _id: 'u_silent', createdAt: '2026-01-01T00:00:00.000Z' },
      { _id: 'u_tomb', lastSeenAt: fresh, anonymized: true },
    ],
    comments: [{ author: 'u_author', createdAt: fresh }],
    notifications: [{ userId: 'u_reader', readAt: fresh }],
    pushSubscriptions: [{ userId: 'u_push', updatedAt: fresh }],
  });
  const ids = (await findActiveMemberIds(db, since)).sort();
  assert.deepEqual(ids, ['u_author', 'u_new_date', 'u_new_iso', 'u_push', 'u_reader', 'u_seen']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/mentions/activeMembers.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/mentions/activeMembers.ts — server code with the db INJECTED (testable).
// „Active in the last 90 days" for the @alle Admin-Hinweis (user decision
// 2026-09-22). Computed at SEND time from signals that already exist, plus the
// `users.lastSeenAt` stamp the JWT callback writes since the same day (before
// that day nobody has the stamp — hence the other signals).
import type { MentionDb } from './mentionsResolve';

export const ACTIVE_WINDOW_DAYS = 90;

export function activeSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

const AUTHORED = ['topics', 'announcements', 'recommendations', 'comments', 'events', 'listings'] as const;

export async function findActiveMemberIds(db: MentionDb, since: Date): Promise<string[]> {
  const sinceIso = since.toISOString();
  const ids = new Set<string>();
  // register.ts stores createdAt as an ISO STRING; older docs may carry a Date.
  const users = await db.collection('users')
    .find({ anonymized: { $ne: true }, $or: [{ lastSeenAt: { $gte: since } }, { createdAt: { $gte: since } }, { createdAt: { $gte: sinceIso } }] }, { projection: { _id: 1 } })
    .toArray();
  for (const u of users) ids.add(String(u._id));
  for (const c of AUTHORED) {
    const rows = await db.collection(c).find({ createdAt: { $gte: since } }, { projection: { author: 1, sellerId: 1 } }).toArray();
    for (const r of rows) { const a = r.author ?? r.sellerId; if (a) ids.add(String(a)); }
  }
  const read = await db.collection('notifications').find({ readAt: { $gte: since } }, { projection: { userId: 1 } }).toArray();
  for (const n of read) ids.add(String(n.userId));
  const pushes = await db.collection('pushSubscriptions').find({ updatedAt: { $gte: since } }, { projection: { userId: 1 } }).toArray();
  for (const p of pushes) ids.add(String(p.userId));
  // Tombstones can enter through content/notification rows — drop them.
  const tombs = await db.collection('users').find({ _id: { $in: [...ids].filter((id) => /^[0-9a-f]{24}$/.test(id)).map((id) => new (require('mongodb').ObjectId)(id)) }, anonymized: true }, { projection: { _id: 1 } }).toArray();
  for (const t of tombs) ids.delete(String(t._id));
  return [...ids];
}
```

The `require('mongodb')` line is ugly — replace it with a top-level `import { ObjectId } from 'mongodb';` and `new ObjectId(id)`; the fake db in the test ignores the `_id` filter type anyway because it compares `String(val)`. `listings` stores the seller as `sellerId` (a plain string; `src/lib/listingsQuery.ts` line 36) — the `r.author ?? r.sellerId` fallback covers it.

- [ ] **Step 4: Run the test** — Expected: 2 pass.

- [ ] **Step 5: Stamp `lastSeenAt` in the JWT callback.** In `auth.config.ts`, inside the existing `PWD_RECHECK_MS` block where `users.findOne({ _id }, { projection: { passwordChangedAt: 1 } })` runs (it runs at most every 5 minutes per token), add ONE write right after that read, best-effort:

```ts
// „Active in the last 90 days" for the @alle Admin-Hinweis (2026-09-22):
// one stamp per token per 5 minutes, never fails the callback.
client.db().collection('users').updateOne({ _id: userObjectId }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
```

Use whatever variable the block already uses for the user's `_id` (read the block first; it builds an `ObjectId` from `token.sub` or `token.id`). Do not `await` it inside the hot path if the surrounding code returns the token synchronously after the read — but if the block already awaits the read, awaiting the write too is fine.

- [ ] **Step 6: Gates and commit**

Run `pnpm type-check 2>&1 | grep -c "error TS"` (≤ 23).

```bash
git add src/lib/mentions/activeMembers.ts src/lib/mentions/activeMembers.test.ts auth.config.ts
git commit -m "admin-hint: active members of the last 90 days + lastSeenAt stamp"
```

---

### Task 3: Notification type `'admin_hint'`, copy, glyph, `notifyAdminHint`

**Files:**
- Modify: `src/types/notification.ts` (the `NotificationType` union only — `meta.sourceId` and `meta.contentKind` already exist), `src/types/index.ts` (`broadcast?: BroadcastRef` on `Topic`, `Announcement`, `Recommendation`, `Comment` — import the type from `../lib/mentions/broadcast`)
- Modify: `src/lib/push.ts` (case), `src/lib/kiosk-i18n.ts` (DE + EN keys), `src/components/forum/kiosk/NotificationPanel.svelte` (glyph + `rowText` case)
- Modify: `src/lib/mentions/mentionsStore.ts` (add `applyBroadcast`, `notifyAdminHint`)

**Interfaces:**
- Produces:
  ```ts
  export function applyBroadcast(text: string, isAdmin: boolean): { body: string; broadcast: { token: string; excludedHandles: string[] } | null }
  export async function notifyAdminHint(db: Db, args: { actorId: string; sourceId: string; kind: 'post' | 'comment'; target: NotificationTarget; excludedHandles: string[] }): Promise<number>
  ```

- [ ] **Step 1: Types.** `NotificationType = 'comment' | 'moderation' | 'official' | 'market_contact' | 'mention' | 'admin_hint'`. In `src/types/index.ts` add to each of `Topic`, `Announcement`, `Recommendation`, `Comment` right after `mentions?: MentionRef[]`:

```ts
  /** „@alle" Admin-Hinweis (admin only): the token is stripped from `body` and kept here — see src/lib/mentions/broadcast.ts. */
  broadcast?: BroadcastRef;
```

- [ ] **Step 2: Copy.** `src/lib/kiosk-i18n.ts` — after `'nc.mention.comment'` in the DE block (line ~107):

```ts
  'nc.adminHint.post': 'Admin-Hinweis zu ‚{title}‘',
  'nc.adminHint.comment': 'Admin-Hinweis in einem Kommentar zu ‚{title}‘',
  'forum.adminHint.tag': 'Admin-Hinweis',
```

and after the EN `'nc.mention.comment'` (line ~2124):

```ts
  'nc.adminHint.post': 'Admin note on ‘{title}’',
  'nc.adminHint.comment': 'Admin note in a comment on ‘{title}’',
  'forum.adminHint.tag': 'Admin note',
```

`src/lib/push.ts`, after the `case 'mention':` block:

```ts
    case 'admin_hint':
      body = meta?.contentKind === 'comment'
        ? `Admin-Hinweis in einem Kommentar zu ‚${t}‘`
        : `Admin-Hinweis zu ‚${t}‘`;
      break;
```

`NotificationPanel.svelte`: `GLYPH` gets `admin_hint: { g: '!', c: 'var(--k-plum, #6f2f59)' },` and `rowText` gets

```ts
      case 'admin_hint':
        return tStr(it.meta?.contentKind === 'comment' ? $t['nc.adminHint.comment'] : $t['nc.adminHint.post'], { title });
```

- [ ] **Step 3: Store functions.** In `mentionsStore.ts` add the imports `import { parseBroadcast } from './broadcast'; import { findActiveMemberIds, activeSince } from './activeMembers'; import { sendPushToUsers, buildPushPayload } from '../push';` (check `buildPushPayload` is exported — `grep -n "export function buildPushPayload" src/lib/push.ts`; it is) and `import type { NotificationDoc } from '../../types/notification';`. Then:

```ts
/** Server-side gate for „@alle": only an admin's text is parsed; anyone else's stays as written. */
export function applyBroadcast(text: string, isAdmin: boolean): { body: string; broadcast: { token: string; excludedHandles: string[] } | null } {
  if (!isAdmin) return { body: text, broadcast: null };
  const r = parseBroadcast(text);
  return r ? { body: r.body, broadcast: { token: r.token, excludedHandles: r.excludedHandles } } : { body: text, broadcast: null };
}

/** „@alle" → every member active in the last 90 days, minus author, excluded handles,
 *  tombstones and anyone already notified for this source. NO rate limit (user
 *  decision). Never throws. Returns the number notified. */
export async function notifyAdminHint(db: Db, args: {
  actorId: string; sourceId: string; kind: 'post' | 'comment'; target: NotificationTarget; excludedHandles: string[];
}): Promise<number> {
  try {
    const active = await findActiveMemberIds(db, activeSince());
    const excluded = args.excludedHandles.length
      ? (await db.collection('users').find({ handle: { $in: args.excludedHandles } }, { projection: { _id: 1 } }).toArray()).map((u) => String(u._id))
      : [];
    const seen = (await db.collection('notifications')
      .find({ type: 'admin_hint', 'meta.sourceId': args.sourceId }, { projection: { userId: 1 } }).toArray()).map((n) => String(n.userId));
    const skip = new Set<string>([args.actorId, ...excluded, ...seen]);
    const recipients = active.filter((id) => !skip.has(id));
    if (recipients.length === 0) return 0;
    const now = new Date();
    const meta = { sourceId: args.sourceId, contentKind: args.kind };
    const docs: NotificationDoc[] = recipients.map((userId) => ({
      userId, type: 'admin_hint', actorId: args.actorId, target: args.target, meta, createdAt: now, readAt: null,
    }));
    await db.collection<NotificationDoc>('notifications').insertMany(docs, { ordered: false });
    await sendPushToUsers(recipients, buildPushPayload('admin_hint', args.target, meta));
    return recipients.length;
  } catch (err) {
    await capture(err);
    return 0;
  }
}
```

- [ ] **Step 4: Gates and commit.** `pnpm type-check 2>&1 | grep -c "error TS"` ≤ 23; `npx -y svelte-check@4 2>&1 | tail -1` ≤ 89 errors.

```bash
git add src/types/notification.ts src/types/index.ts src/lib/push.ts src/lib/kiosk-i18n.ts src/components/forum/kiosk/NotificationPanel.svelte src/lib/mentions/mentionsStore.ts
git commit -m "admin-hint: notification type, copy, glyph and the notify function"
```

---

### Task 4: Wire the eight routes

**Files:**
- Modify: `src/pages/api/topics/create.ts`, `src/pages/api/announcements/create.ts`, `src/pages/api/recommendations/create.ts`, `src/pages/api/topics/edit/[id].ts`, `src/pages/api/announcements/edit/[id].ts`, `src/pages/api/recommendations/edit/[id].ts`, `src/pages/api/comments/create.ts`, `src/pages/api/comments/edit/[commentId].ts`

**Interfaces:**
- Consumes: `applyBroadcast`, `notifyAdminHint` from `../../../lib/mentions/mentionsStore` (each route already imports `resolveMentions`/`notifyMentions` from there — extend that import).

Each route follows the same three moves; do them in every file, in the file's own variable names (read the file first — the mention wiring from 2026-09-21 shows where the body is validated, where the doc is built and where `notifyMentions` is called):

- [ ] **Step 1: Parse right after validation, BEFORE moderation, mentions and the insert/update.**

```ts
    // „@alle" Admin-Hinweis (2026-09-22): admin-only broadcast. The span is
    // removed from the stored body; non-admin text is untouched.
    const isAdmin = session.user.role === 'admin';
    const { body: cleanBody, broadcast } = applyBroadcast(body, isAdmin);
```

Then use `cleanBody` everywhere the route used `body` from here on (moderation, `resolveMentions`, the document, the alert title, the response). For the three post edit routes and the announcement/recommendation edit routes remember `body` may be `undefined` (`body ?? ''` pattern from 09-21): only call `applyBroadcast` when `typeof body === 'string'`, else keep `broadcast` untouched (do not `$set`/`$unset` it).

- [ ] **Step 2: Store it.** Create routes: add `...(broadcast ? { broadcast } : {})` to the inserted document. Edit routes (when `body` is a string): `$set: { …, body: cleanBody, …, ...(broadcast ? { broadcast: { ...broadcast, notifiedAt: existing.broadcast?.notifiedAt, recipients: existing.broadcast?.recipients } } : {}) }` and, when `broadcast` is null but the existing document had one, add `$unset: { broadcast: '' }` (the tag disappears; sent notifications stay). The topics edit route uses `findOneAndUpdate` with a `$set` object — build the update object first, then add `$unset` only when needed (Mongo rejects an empty `$unset`).

- [ ] **Step 3: Notify, only when public, only once.** Right where `notifyMentions` is called (approved branch), add:

```ts
    if (broadcast && savedStatus === 'approved' && !existing?.broadcast?.notifiedAt) {
      const n = await notifyAdminHint(db, {
        actorId: userId, sourceId: String(docId), kind: 'post' /* or 'comment' */,
        target,                       // the same target object the mention call uses
        excludedHandles: broadcast.excludedHandles,
      });
      await db.collection(COLL).updateOne({ _id: docObjectId }, { $set: { 'broadcast.notifiedAt': new Date(), 'broadcast.recipients': n } });
    }
```

Use the route's real names: `savedStatus` is `moderationStatus` / `newModerationStatus`; `existing` is the pre-edit document (create routes: `undefined`); `target` for posts is `moderationTarget(contentType, id, title)`, for comments `commentTarget(parent.collection, parentId, parent.title)` with the href extended: `{ ...commentTarget(...), href: commentTarget(...).href + '#comment-' + String(commentId) }` — **only for the admin-hint target**, the mention target stays as it is. In `comments/create.ts` the parent lookup already happens in the approved branch (`findOneAndUpdate` on the parent) — reuse `parentCollection` and the returned `parentDoc.title`; in `comments/edit/[commentId].ts` the `parent` from `findCommentParent` is only fetched when `mergedResult || mentions.length > 0` — extend that condition with `|| broadcast`.

- [ ] **Step 4: Gates and commit.** tsc ≤ 23, then

```bash
git add src/pages/api/topics/create.ts src/pages/api/announcements/create.ts src/pages/api/recommendations/create.ts "src/pages/api/topics/edit/[id].ts" "src/pages/api/announcements/edit/[id].ts" "src/pages/api/recommendations/edit/[id].ts" src/pages/api/comments/create.ts "src/pages/api/comments/edit/[commentId].ts"
git commit -m "admin-hint: @alle parsed, stored and notified on the eight forum write routes"
```

---

### Task 5: Rendering — tag, muted token, edit prefill, comment anchor

**Files:**
- Modify: `src/components/forum/kiosk/ForumComment.svelte` (`<article …>` ~line 214; the body `<p>` ~line 345; `enterEdit()` ~line 131)
- Modify: `src/components/forum/kiosk/ForumPostDetail.svelte` (body render; `editBody = topic.body ?? …` ~line 333; header meta line)
- Modify: `src/components/forum/kiosk/ForumCommentList.svelte` (scroll to `#comment-<id>` once the list has rendered)

- [ ] **Step 1: Comment.** Import `restoreBroadcastText` from `'../../../lib/mentions/broadcast'` and `t` from the i18n store the file already uses. On the `<article>` add `id={`comment-${comment._id}`}`. In the header line next to the author name / handle add, for everyone:

```svelte
{#if comment.broadcast}<span class="ml-2 inline-block px-1.5 py-0.5 border border-[#6f2f59] text-[#6f2f59] font-dmmono text-[10px] uppercase tracking-wide align-middle" data-admin-hint>{$t['forum.adminHint.tag']}</span>{/if}
```

Above the body `<p>`, for the author only:

```svelte
{#if comment.broadcast && isAuthor}<p class="font-dmmono text-[0.85em] text-ink-mute mb-1" data-admin-hint-token>{comment.broadcast.token}</p>{/if}
```

(`isAuthor` exists — line ~93.) In `enterEdit()`: `draft = restoreBroadcastText(originalBody, comment.broadcast);`. Do the same three things in `ForumPostDetail.svelte` (`isAuthor` exists at ~line 80; prefill: `editBody = restoreBroadcastText(topic.body ?? topic.description ?? '', topic.broadcast);`). The `topic` prop's type is the union of the three post types — `broadcast` is optional on all three, so it type-checks.

- [ ] **Step 2: Anchor scroll.** In `ForumCommentList.svelte` after the comments render (there is an `$effect`/`onMount` around the list or the fetch — read the file): 

```ts
  // Admin-Hinweis deep link: /topics/<id>#comment-<commentId> (comments render after the page).
  $effect(() => {
    if (typeof window === 'undefined' || comments.length === 0) return;
    const m = /^#comment-([0-9a-f]{24})$/.exec(window.location.hash);
    if (!m) return;
    requestAnimationFrame(() => document.getElementById(`comment-${m[1]}`)?.scrollIntoView({ block: 'center' }));
  });
```

`ForumCommentList.svelte` receives `comments = []` as a prop (line 13), so the effect belongs there; it re-runs when the prop changes, and `scrollIntoView` on the same element twice is harmless.

- [ ] **Step 3: Browser check on dev** (start the dev server; see Global Constraints): log in as the dev admin (`db.users.findOne({ role: 'admin' })` gives the e-mail; the password file is `scratchpad/devpw.txt`, read only into `page.fill`), open a topic, write the comment `@alle -jonas Testhinweis bitte ignorieren`, save. Verify with a Playwright `.cjs` probe (pattern: `scratchpad/mention-autocomplete-probe.cjs`): the rendered comment text does NOT contain `@alle`; `[data-admin-hint]` is visible; `[data-admin-hint-token]` is visible for the admin; log in as `ayse@mahalle-dev.test`: the comment text has no `@alle`, the tag is visible, no token. Screenshots at 1280 and 390 px into `scratchpad/`. Then delete the test comment (the admin's own delete button) — or leave it for Task 7's e2e cleanup, which removes comments whose body starts with `E2E-ADMIN-HINT`; so start the comment text with that.

- [ ] **Step 4: Gates and commit.** svelte-check ≤ 89, tsc ≤ 23, `pnpm build` green (then restart dev with `--force` if you continue).

```bash
git add src/components/forum/kiosk/ForumComment.svelte src/components/forum/kiosk/ForumPostDetail.svelte src/components/forum/kiosk/ForumCommentList.svelte
git commit -m "admin-hint: tag for everyone, muted token for the author, edit prefill, comment anchor"
```

---

### Task 6: Autocomplete row for admins

**Files:**
- Modify: `src/pages/api/users/mention-search.ts`, `src/components/forum/kiosk/compose/MentionPopup.svelte`

- [ ] **Step 1: Server.** In `mention-search.ts`, after the hits are built and before the JSON response: `const broadcast = session.user.role === 'admin' && 'alle'.startsWith(q.toLowerCase());` and return `{ users, broadcast }`. Non-admins always get `broadcast: false`.

- [ ] **Step 2: Popup.** In `MentionPopup.svelte`, where `items = Array.isArray(data.users) ? data.users : []` (~line 48): when `data.broadcast === true`, prepend a synthetic row of the popup's `Hit` shape (`type Hit = { id: string; name: string; handle: string; image: string | null }`, line 14): `{ id: 'alle', name: 'alle aktiven Nachbar:innen', handle: 'alle', image: null }`. Picking it goes through the same `applyMention(value, start, caret, 'alle')`, so the text gets `@alle `. Render the row like the others; the name text is display-only and German (the popup has no i18n today — check; if it has, add key `compose.mention.alle` DE „alle aktiven Nachbar:innen" / EN „all active neighbours").

- [ ] **Step 3: Check on dev with the probe from Task 5:** as admin, type `@al` in a comment box → the first row is `@alle`; as `ayse` → no such row. Add both checks to that probe file.

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/users/mention-search.ts src/components/forum/kiosk/compose/MentionPopup.svelte
git commit -m "admin-hint: @alle in the autocomplete for admins"
```

---

### Task 7: Dev e2e for the whole flow

**Files:**
- Create: `scratchpad/e2e-admin-hint.mts` (gitignored) — header copied from `scratchpad/e2e-comment-edit-queue.mts` (dotenv, dev-db guard, cookie login helpers, `api()`, `ok()`; the password line stays exactly as it is and is never printed).

- [ ] **Step 1: Write the script.** Fixtures in the dev DB (delete in `finally`): user `E2E-INACTIVE` (`createdAt: '2026-01-01T00:00:00.000Z'`, handle `e2e_inactive`, no content, no lastSeenAt), user `E2E-EXCLUDED` (`createdAt` today, handle `e2e_excluded`), user `E2E-ACTIVE` (`createdAt` today, handle `e2e_active`). Look up the admin (`role: 'admin'`) and `jonas@mahalle-dev.test`. Steps and assertions (12):

1. Admin creates a topic titled `E2E-ADMIN-HINT Beitrag` with body `Hallo @alle -e2e_excluded bitte lesen` → 201, `topic.body === 'Hallo bitte lesen'`, `topic.broadcast.token === '@alle -e2e_excluded'`, `excludedHandles === ['e2e_excluded']`.
2. Notifications of type `admin_hint` with `meta.sourceId === topicId`: `E2E-ACTIVE` has one, `E2E-EXCLUDED` none, `E2E-INACTIVE` none, the admin none; `target.href === '/topics/<id>'`; `contentKind === 'post'`.
3. The topic document has `broadcast.notifiedAt` set and `broadcast.recipients >= 1`.
4. Admin edits the topic (same body) → the count of `admin_hint` docs for that sourceId is unchanged (idempotent).
5. Admin edits the topic to body `Hallo bitte lesen` (token removed) → the document has no `broadcast` field; notifications still there.
6. Admin comments on that topic with `@alle Kommentar-Hinweis` → 201, comment body `Kommentar-Hinweis`, `E2E-ACTIVE` has an `admin_hint` with `meta.sourceId === commentId`, `contentKind === 'comment'`, `target.href === '/topics/<id>#comment-<commentId>'`.
7. `ayse@mahalle-dev.test` (non-admin) comments `@alle bin kein Admin` → 201, the stored body still contains `@alle`, no `broadcast` field, zero new `admin_hint` docs.
8. `GET /api/users/mention-search?q=al` as admin → `broadcast === true`; as ayse → `false`.
9. Admin edits the topic once more to `@alle nochmal` (re-adding the token after step 5 removed it, `notifiedAt` included). This DOES run the notify call again — correct per the constraints — but the per-source dedupe means `E2E-ACTIVE` keeps exactly ONE `admin_hint` doc for `topicId`. Assert that count is still 1, and that `broadcast.notifiedAt` is set again.
10. Admin moves the topic to a recommendation via `POST /api/posts/move/<id>` (read `src/lib/forum/movePost.ts` for the request body); the document in `recommendations` carries `broadcast.token === '@alle'` (the move spreads the source doc).
11. Cleanup in `finally`: delete the topic/recommendation by id, comments with `relevantPostId`, `notifications` with `meta.sourceId` in the ids or `target.contentId` = topicId, the three fixture users, and `rateLimits` rows for the admin's `mention:` key.

- [ ] **Step 2: Run** `timeout 180 npx tsx scratchpad/e2e-admin-hint.mts` — Expected: all PASS. Run it a second time to prove the cleanup works (a leftover fixture user would collide on the handle index).

- [ ] **Step 3: Regression.** Run `timeout 120 npx tsx scratchpad/e2e-mentions.mts` (12) and `timeout 120 npx tsx scratchpad/e2e-comment-edit-queue.mts` (10) — both must still pass.

No commit (scratchpad is gitignored). Report the outputs.

---

### Task 8: Docs

**Files:**
- Modify: `CLAUDE.md` (the `notifications` collection bullet: add `'admin_hint'`; the `users` bullet: add `lastSeenAt?: Date`; the forum pointer sentence about mentions: add one clause), `src/components/forum/kiosk/CLAUDE.md` (a subsection under „Mentions": „`@alle` Admin-Hinweis"), `docs/runbooks/debut-event-readiness.md` (a dated record line)

- [ ] **Step 1:** Write the forum subsection with: what it is, admin-only gate, exclusions grammar, hidden-not-secret, token moved to the start on edit, active-90-days definition and the `lastSeenAt` stamp, idempotency, no rate limit, comment anchor, the probe file names, and the two user decisions („no daily limit — up to my auto-control", „add an Admin-Hinweis tag").
- [ ] **Step 2:** Commit

```bash
git add CLAUDE.md src/components/forum/kiosk/CLAUDE.md docs/runbooks/debut-event-readiness.md
git commit -m "docs: @alle Admin-Hinweis"
```

---

## Does NOT do (deliberate)

- No `@alle` for non-admins, no permission setting, no confirmation dialog (admin-only makes both unnecessary).
- No rate limit (user decision).
- No opt-out per member (nothing else in the notification centre has one either).
- No `@here`/`@aktive` variants; no group handles.
- Not in events, listings, News, official announcements.
- No re-notification when the token is edited to a different exclusion list on a document that already notified (per-source dedupe wins; documented).

## Open decisions (his)

- The DE/EN wording of `nc.adminHint.*` and `forum.adminHint.tag` — proposals above.
- Whether an admin's `@alle` in a comment on his OWN post should skip the „replied" logic — no: that logic is for the post author, who is the admin here and never notifies himself.
