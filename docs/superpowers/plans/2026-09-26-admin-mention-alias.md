# „@admin" Mention Alias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@admin` in a forum post or comment mentions the member who holds the admin role, without that member giving up their own handle; the autocomplete offers the alias to every non-admin member.

**Architecture:** Mentions are resolved on SAVE by `resolveMentions(db, text)` and stored as `{ handle, userId }`; rendering (`splitMentions`) matches the TEXT token against the stored `handle` and links by `userId` (`/nachbarn/id/<userId>`); notification (`pickMentionRecipients`) works by `userId`. So the alias is purely a resolver concern: when the text contains `@admin` and no member owns the handle `admin`, the resolver stores `{ handle: 'admin', userId: <admin's id> }`. Nothing downstream changes. The autocomplete endpoint reports `admin: true` when the query is a prefix of „admin" and the caller is not the admin; the popup prepends a synthetic row like it already does for „@alle".

**Tech Stack:** Astro 5 API routes, Svelte 5 island, MongoDB driver, node:test via `npx tsx --test`.

**Spec:** none — user request 2026-09-26 23:48 („is it possible to add @admin as an alias to my handle?" → „ok, build the @admin alias"). Decisions from the conversation: he keeps `@atakee`; the alias resolves to whoever holds the admin role (not a hardcoded name); shown as a distinct entry in the autocomplete, never as a real member card.

## Global Constraints

- No regex lookbehind in `src/lib/mentions/mentions.ts` (Safari < 16.4 — the file is imported by islands).
- `MentionPopup.svelte` has NO `<style>` block (nested-island stylesheet orphaning) — Tailwind classes only.
- `mentionsResolve.ts` imports only the `mongodb` package + pure modules (node:test loads it without env).
- A real member's handle always wins over the alias (never shadow a member).
- The alias resolves to the OLDEST admin account (`sort: { _id: 1 }`), excluding tombstoned accounts; a single ref, one `userId`.
- Gates: `npx tsc --noEmit` errors ≤ 23, `npx -y svelte-check@4` errors ≤ 89 (ratchet — never higher).
- Commits: one-line messages, no attribution footer. Stage only named files. Never `git add scratchpad/` or `.superpowers/`.
- Never print `.env` values or passwords; probes read `scratchpad/devpw.txt` straight into request bodies.
- UI copy in the popup row is a DRAFT the user will reword; flag it in the report.

## Review Focus

1. A member whose handle is literally `admin` (impossible via signup — `chosenHandleProblem('admin')` = reserved — but a legacy slug could exist): the real member must win, no alias ref. Test in Task 1.
2. `@admin` written by the admin themself: resolves to self; `pickMentionRecipients` skips the actor, so no self-notification. Covered by the existing recipients test + probe check.
3. `@admin` and `@atakee` in the same text: two refs, one `userId` → exactly one notification (`pickMentionRecipients` dedupes by id). Test in Task 1.
4. No admin account at all (dev db without seed, or role removed): `@admin` stays plain text, no ref, no crash. Test in Task 1.
5. The autocomplete row must never be offered to the admin (self) and must appear for `a`, `ad`, `adm`, `admi`, `admin` but not `adminx` or `b`. Probe in Task 2.

---

### Task 1: Server — resolver alias, reserved handle, autocomplete flag

**Files:**
- Modify: `src/lib/mentions/mentions.ts` (add one exported constant)
- Modify: `src/lib/mentions/mentionsResolve.ts` (`resolveMentions`)
- Modify: `src/lib/mentions/mentionsResolve.test.ts` (fake db gains `findOne`; 4 new tests)
- Modify: `src/lib/profile/handle.ts` (`RESERVED_HANDLES` + `'admin'`)
- Modify: `src/lib/profile/handleChoice.test.ts` (one handle added to the reserved list test)
- Modify: `src/pages/api/users/mention-search.ts` (response field `admin`)

**Interfaces:**
- Produces: `ADMIN_ALIAS = 'admin'` exported from `src/lib/mentions/mentions.ts` (dependency-pure; Task 2's island imports it).
- Produces: `GET /api/users/mention-search?q=` response gains `admin: boolean` next to the existing `users` and `broadcast`.
- Stored mention shape unchanged: `{ handle: 'admin', userId: '<admin ObjectId as string>' }`.

- [ ] **Step 1: Export the alias constant**

In `src/lib/mentions/mentions.ts`, directly after `export const MAX_MENTIONS = 10;`:

```ts
/** „@admin" (2026-09-26): an alias for whoever holds the admin role — resolved
 *  server-side in mentionsResolve.ts; the popup offers it as a synthetic row. */
export const ADMIN_ALIAS = 'admin';
```

- [ ] **Step 2: Write the failing resolver tests**

In `src/lib/mentions/mentionsResolve.test.ts`, replace the `fakeDb` helper with one that also answers `findOne` (the alias lookup queries `{ role: 'admin', anonymized: { $ne: true } }` with `sort: { _id: 1 }`), and add four tests:

```ts
const fakeDb = (users: Array<Record<string, any>>) => ({
  collection: () => ({
    find: (filter: any) => ({
      toArray: async () => users.filter((u) => filter.handle.$in.includes(u.handle) && u.anonymized !== true),
    }),
    findOne: async (filter: any, opts: any) => {
      assert.deepEqual(filter, { role: 'admin', anonymized: { $ne: true } });
      assert.deepEqual(opts?.sort, { _id: 1 });
      const admins = users.filter((u) => u.role === 'admin' && u.anonymized !== true).sort((a, b) => (a._id < b._id ? -1 : 1));
      return admins[0] ?? null;
    },
  }),
}) as any;

test('@admin resolves to the oldest admin account, in text order', async () => {
  const db = fakeDb([
    { _id: 'u5', handle: 'zweiter_admin', role: 'admin' }, { _id: 'u1', handle: 'atakee', role: 'admin' }, { _id: 'u2', handle: 'petra2' },
  ]);
  assert.deepEqual(await resolveMentions(db, 'Hi @petra2, @admin bitte schauen'), [
    { handle: 'petra2', userId: 'u2' }, { handle: 'admin', userId: 'u1' },
  ]);
});

test('a real member owning the handle „admin" wins over the alias', async () => {
  const db = fakeDb([{ _id: 'u7', handle: 'admin' }, { _id: 'u1', handle: 'atakee', role: 'admin' }]);
  assert.deepEqual(await resolveMentions(db, '@admin hallo'), [{ handle: 'admin', userId: 'u7' }]);
});

test('no admin account → @admin stays plain text', async () => {
  const db = fakeDb([{ _id: 'u2', handle: 'petra2' }]);
  assert.deepEqual(await resolveMentions(db, '@admin und @petra2'), [{ handle: 'petra2', userId: 'u2' }]);
});

test('@admin and the admin\'s own handle in one text → two refs, one recipient', async () => {
  const db = fakeDb([{ _id: 'u1', handle: 'atakee', role: 'admin' }]);
  const mentions = await resolveMentions(db, '@atakee oder @admin, egal');
  assert.deepEqual(mentions, [{ handle: 'atakee', userId: 'u1' }, { handle: 'admin', userId: 'u1' }]);
  assert.deepEqual(pickMentionRecipients({ mentions, actorId: 'x', alreadyNotified: [] }), ['u1']);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/mentions/mentionsResolve.test.ts`
Expected: the four new tests FAIL (`admin` ref missing); the three existing tests still pass.

- [ ] **Step 4: Implement the alias in the resolver**

In `src/lib/mentions/mentionsResolve.ts`, import the constant and extend `resolveMentions`:

```ts
import { ADMIN_ALIAS, extractMentionHandles, type MentionRef } from './mentions';

// „@admin" (2026-09-26): an alias for the member who holds the admin role. A
// real member owning the handle „admin" always wins (signup refuses it, but a
// legacy slug could exist). Oldest admin account by _id; tombstones never.
export async function resolveMentions(db: MentionDb, text: string): Promise<MentionRef[]> {
  const handles = extractMentionHandles(text);
  if (handles.length === 0) return [];
  const users = await db.collection('users')
    .find({ handle: { $in: handles }, anonymized: { $ne: true } }, { projection: { handle: 1 } })
    .toArray();
  const idByHandle = new Map(users.map((u) => [String(u.handle), String(u._id)]));
  if (handles.includes(ADMIN_ALIAS) && !idByHandle.has(ADMIN_ALIAS)) {
    const admin = await db.collection('users')
      .findOne({ role: 'admin', anonymized: { $ne: true } }, { projection: { _id: 1 }, sort: { _id: 1 } });
    if (admin) idByHandle.set(ADMIN_ALIAS, String(admin._id));
  }
  return handles.filter((h) => idByHandle.has(h)).map((h) => ({ handle: h, userId: idByHandle.get(h)! }));
}
```

- [ ] **Step 5: Run the resolver tests to verify they pass**

Run: `npx tsx --test src/lib/mentions/mentionsResolve.test.ts src/lib/mentions/mentions.test.ts`
Expected: all PASS.

- [ ] **Step 6: Reserve the handle explicitly**

In `src/lib/profile/handle.ts`, add `'admin'` as the first entry of `RESERVED_HANDLES` (it is already refused by the protected-name check; the explicit entry documents the alias). In `src/lib/profile/handleChoice.test.ts`, add `'admin'` to the list the test „reserved: team words, mention keywords, lookalikes" iterates over.

Run: `npx tsx --test src/lib/profile/handleChoice.test.ts`
Expected: PASS.

- [ ] **Step 7: Autocomplete flag**

In `src/pages/api/users/mention-search.ts`, after the `broadcast` line:

```ts
// „@admin" alias (2026-09-26): every NON-admin member gets a synthetic row when
// the query could still be typing „admin". The admin never sees it (self).
const admin = session.user.role !== 'admin' && ADMIN_ALIAS.startsWith(q.toLowerCase());
```

with `import { ADMIN_ALIAS } from '../../../lib/mentions/mentions';` at the top, and add `admin` to the JSON payload next to `broadcast`.

- [ ] **Step 8: Gates**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → must be ≤ 23 (it is 23 today; report the number).

- [ ] **Step 9: Commit**

```bash
git add src/lib/mentions/mentions.ts src/lib/mentions/mentionsResolve.ts src/lib/mentions/mentionsResolve.test.ts src/lib/profile/handle.ts src/lib/profile/handleChoice.test.ts src/pages/api/users/mention-search.ts
git commit -m "mentions: @admin resolves to the admin account (alias, real handle wins), autocomplete flag" -- src/lib/mentions/mentions.ts src/lib/mentions/mentionsResolve.ts src/lib/mentions/mentionsResolve.test.ts src/lib/profile/handle.ts src/lib/profile/handleChoice.test.ts src/pages/api/users/mention-search.ts
```

---

### Task 2: Popup row, docs, dev probe

**Files:**
- Modify: `src/components/forum/kiosk/compose/MentionPopup.svelte`
- Modify: `src/components/forum/kiosk/CLAUDE.md` (Mentions section, one bullet after „Autocomplete")
- Modify: `CLAUDE.md` (root, Forum patterns paragraph: one clause)
- Create: `scratchpad/e2e-admin-alias.mts` (gitignored, dev only)

**Interfaces:**
- Consumes: `ADMIN_ALIAS` from `src/lib/mentions/mentions.ts`; `admin: boolean` from `GET /api/users/mention-search`.

- [ ] **Step 1: Synthetic popup row**

In `MentionPopup.svelte`, import `ADMIN_ALIAS` next to the existing import from `mentions`, and replace the `items = data.broadcast === true ? … : hits;` assignment with:

```ts
// „@admin" alias (2026-09-26): non-admins get a synthetic row that inserts
// „@admin "; the server resolves it to the admin account. „@alle" (admins
// only) and „@admin" (non-admins only) never coexist, order is defensive.
const extra: Hit[] = [];
if (data.broadcast === true) extra.push({ id: 'alle', name: 'alle aktiven Nachbar:innen', handle: 'alle', image: null });
if (data.admin === true) extra.push({ id: ADMIN_ALIAS, name: 'Admin · Mahalle-Team', handle: ADMIN_ALIAS, image: null });
items = [...extra, ...hits];
```

The row label „Admin · Mahalle-Team" is a DRAFT (user words his own copy). `KioskAvatar` renders initials from the name, same as the „alle" row.

- [ ] **Step 2: svelte-check gate**

Run: `npx -y svelte-check@4 2>&1 | tail -1` → errors must be ≤ 89 (89 today; report the number).

- [ ] **Step 3: Dev probe (API, dev :4655, dev db only)**

Create `scratchpad/e2e-admin-alias.mts` modelled on `scratchpad/e2e-mentions.mts` (same `login()`/`api()`/`store()` helpers, same dev-db interlock, password from `scratchpad/devpw.txt` straight into the form body, never printed). Checks:

1. login as `jonas@mahalle-dev.test`; `GET /api/users/mention-search?q=ad` → 200, `admin === true`, no `users` row with handle `admin`.
2. `q=admin` → `admin === true`; `q=adminx` → `admin === false`; `q=b` → `admin === false`.
3. login as the dev admin (`findOne({ role: 'admin' })` → email); `q=ad` → `admin === false`.
4. as jonas: delete `rateLimits` rows with `baseKey` `mention:<jonasId>`; find one approved topic authored by the ADMIN (`findOne({ author: adminId, moderationStatus: 'approved' })` in `topics`; if none, create one as the admin first — admin content is approved instantly, no OpenAI cost); `POST /api/comments/create` `{ body: '@admin kannst du dir das bitte ansehen?', topicId, collectionType: 'topics' }` → 201; the response comment's `mentions` deep-equals `[{ handle: 'admin', userId: <adminId> }]` (mentions are stored even when moderation holds the comment).
5. read the comment back from the db: `mentions[0].userId === adminId`; if `moderationStatus === 'approved'`, the admin has exactly ONE `notifications` row `{ type: 'mention', 'meta.sourceId': commentId }`; if pending, print „(pending — notification deferred to approval, expected)" and count that check as passed.
6. as the admin: comment `@admin test` on the same topic → 201, `mentions` deep-equals `[{ handle: 'admin', userId: adminId }]`, and NO new mention notification for the admin (self).
7. cleanup in `finally`: delete both comments, their `notifications` rows (`meta.sourceId` in the two ids), pull the comment ids from the topic's `comments` array if the schema keeps one, delete a topic the probe created; close the client. Print `PASS`/`FAIL` per check and a final count.

Run: `npx tsx scratchpad/e2e-admin-alias.mts` (the dev server on 4655 is already running; if `curl -s -o /dev/null -w '%{http_code}' http://localhost:4655/login` is not 200, report BLOCKED — do not start a server).
Expected: all checks PASS. Note the check count in the report.

- [ ] **Step 4: Docs**

`src/components/forum/kiosk/CLAUDE.md`, Mentions section, insert directly after the „Autocomplete" bullet:

```
- **„@admin" alias (2026-09-26, user request — „enable people to take my attention to a specific thing")**: `ADMIN_ALIAS = 'admin'` (`mentions.ts`). `resolveMentions()` stores `{ handle: 'admin', userId: <oldest admin account by _id> }` when the text says `@admin` and NO member owns that handle (a real handle always wins; signup refuses `admin` via `RESERVED_HANDLES` + the protected-name check). Nothing downstream changes: `splitMentions()` links the text token by the stored `userId` (`/nachbarn/id/<id>`), `pickMentionRecipients()` dedupes by id (`@admin` + `@atakee` in one text = one notification), the admin's own `@admin` is a silent self-mention. `GET /api/users/mention-search` answers `admin: true` for every NON-admin caller while the query is a prefix of „admin" and the popup prepends a synthetic „Admin · Mahalle-Team" row (draft copy) that inserts `@admin `. Not in `@alle` (admin-only) — the two rows never coexist. Tests: `mentionsResolve.test.ts` (4 alias cases). Probe: `scratchpad/e2e-admin-alias.mts` (dev :4655).
```

Root `CLAUDE.md`, the Forum patterns paragraph („**`@handle` mentions in posts and comments since 2026-09-21** …"): after „autocomplete after „@")" add „, `@admin` alias for the admin account since 2026-09-26".

- [ ] **Step 5: Commit**

```bash
git add src/components/forum/kiosk/compose/MentionPopup.svelte src/components/forum/kiosk/CLAUDE.md CLAUDE.md
git commit -m "mentions: @admin row in the autocomplete for members, docs" -- src/components/forum/kiosk/compose/MentionPopup.svelte src/components/forum/kiosk/CLAUDE.md CLAUDE.md
```

---

## Self-review record

- Coverage: resolver + reserved handle + endpoint flag (T1), popup + docs + probe (T2). Rendering/notification need no change (linked and deduped by `userId`) — stated in the architecture, verified by reading `splitMentions()` and `pickMentionRecipients()`.
- Types: `ADMIN_ALIAS` defined in T1 step 1, consumed in T1 step 7 and T2 step 1. `admin` response field named identically in T1 step 7 and T2 step 1/3.
- Review Focus 1–4 pinned in T1 step 2, 5 in T2 step 3.
- No placeholders.
