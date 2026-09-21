# Names, Handles and @Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members can tell two „Petra"s apart (`@handle` next to names), nobody can pose as the team, new members may pick their handle once at signup, and `@handle` in a forum post or comment links to that member and notifies them.

**Architecture:** Display names stay non-unique; the handle is the identity. All pure rules live in dependency-pure modules (`src/lib/profile/nameRules.ts`, `src/lib/profile/handle.ts`, `src/lib/mentions/mentions.ts`) that both server and islands import; DB work lives in one server-only store (`src/lib/mentions/mentionsStore.ts`). A mention is resolved when the text is SAVED and stored on the document as `{ handle, userId }`; the link goes by user id, so it survives any later handle change. Notifications are sent only when the content is publicly visible, through one idempotent helper that every write path may call.

**Tech Stack:** Astro 5 SSR routes, Svelte 5 islands, MongoDB driver, zod, `node:test` via `npx tsx --test`, Playwright `.cjs` probes against the own dev server on port 4655.

**Spec:** none — this plan implements the decisions of the 2026-09-21 conversation, recorded under „Decisions" below.

## Decisions (user, 2026-09-21)

1. Names may repeat; handles are unique. Existing handles stay exactly as they are. **No handle change for existing members in this version** (deferred; a user-run script covers single cases).
2. New members may choose their handle ONCE at signup, subject to rules; no choice → the existing automatic handle.
3. Mentions work in forum posts (discussion / announcement / recommendation) and forum comments only — not in listings, events or News.
4. Autocomplete after `@` is part of this version.
5. One plan for name fixes + handle choice + mentions.

## What this plan deliberately does NOT do (say it up front)

- **Mention text stays as the author typed it.** The LINK always reaches the right member (it goes by id). If a handle ever changes later, the old text `@petra2` still links correctly but still reads `@petra2`. No read-time rewriting of text.
- **Event attendees get the handle only in the avatar tooltip** (the attendee line shows first names in one compact row; tooltips do not exist on phones). The event AUTHOR slab gets a visible handle.
- **Feed cards do not show the handle** (kept calm); post detail, comments and the seller card do.
- **Official admin announcements do not parse mentions** (they already notify every member).
- A handle freed by account deletion can be registered again by someone else. Old mentions do NOT move to the new owner (they are stored by id and the deleted member's entries are removed).
- No blocking of names that merely equal ANOTHER ORDINARY member's name — only team/official lookalikes and the admins' own names are protected.

## Global Constraints

- Gates after every task, same as CI: `pnpm type-check` ≤ 26 errors, `npx -y svelte-check@4` ≤ 92 errors, `pnpm build` green.
- Tests: `node:test` + `node:assert/strict`, run with `npx tsx --test <file>`; first line of each test file is `// Run: npx tsx --test <path>`.
- Commit messages: one line, no „Generated with" line, no Co-Authored-By. `git add` named files only. Never stage anything from `scratchpad/`.
- Work on a branch `feat/names-handles-mentions`; merging/pushing to `main` is the user's call.
- Never print a value from `.env`. Prod DB writes are the user's (hand over dry-run-default scripts). Dev DB (`mahalle-dev`) writes are fine.
- A `.svelte` file that is reachable ONLY through another island gets **no `<style>` block** (prod build orphans it) — Tailwind classes only.
- No JS regex **lookbehind** in any module an island imports (Safari < 16.4 fails at parse time and the whole island dies).
- Client-visible user joins are ALLOWLIST projections, never `{ password: 0 }`.
- All new UI copy below is a PROPOSAL (DE + EN). The user words copy himself — list the new keys in the final report.
- Own dev server: `SENTRY_DSN= TELEGRAM_BOT_TOKEN= pnpm astro dev --port 4655` (never 3000). Probes run under `timeout`, output to a file.

## File map

| File | Responsibility |
|---|---|
| `src/lib/publicAuthor.ts` (new, pure) | THE allowlist of user fields that may reach a client + normaliser |
| `src/lib/profile/nameRules.ts` (new, pure) | display-name cleaning, format rule, lookalike folding, protected names |
| `src/lib/profile/handle.ts` (modify, pure) | + reserved handles, chosen-handle normalising/validation |
| `src/lib/mentions/mentions.ts` (new, pure) | find `@handle` in text, split text into mention segments, caret helpers for autocomplete |
| `src/lib/mentions/mentionsResolve.ts` (new, server, db INJECTED) | resolve handles → ids, recipient picking, comment-parent lookup, deletion cleanup — imports only the `mongodb` package, so `node:test` can load it |
| `src/lib/mentions/mentionsStore.ts` (new, SERVER-ONLY) | idempotent notify + approval hook (imports notifications, Sentry, rate limit); re-exports `mentionsResolve` |
| `src/lib/linkify.ts` (modify, pure) | `linkifySegments(text, mentions?)` gains a `'mention'` segment |
| `src/pages/api/users/mention-search.ts` (new) | autocomplete search, members only |
| `src/components/forum/kiosk/compose/MentionPopup.svelte` (new) | the suggestion list attached to a textarea |
| routes under `src/pages/api/{topics,announcements,recommendations,comments}/…`, `src/lib/reviewAction.ts`, `src/lib/auth/accountDeletion.ts`, `src/pages/api/auth/register.ts`, `src/pages/api/users/update.ts` | wiring |

---

### Task 1: One allowlist for every client-visible user join (security — ship this first, alone)

**Why first:** found while researching this plan. Thirteen places join a user with `{ projection: { password: 0 } }`, i.e. EVERYTHING except the password. Read from the code (not yet confirmed against the live site): `GET /api/news` returns the full user document (e-mail, strike data, `pendingEmail`, tour stamps …) of every member who submitted a visible news item, to any logged-in member — and the News index calls it on every load. `GET /api/comments/[postId]` does the same for comment authors; no screen calls it any more (audit 09-21: the only caller is the unused legacy hook `useCommentsQuery`), so it takes a deliberate request — still open to every member. The three legacy routes `GET /api/{topics,announcements,recommendations}/all` have no caller anywhere, apply NO moderation filter (pending and rejected posts included) and use the same join.

**Files:**
- Create: `src/lib/publicAuthor.ts`, `src/lib/publicAuthor.test.ts`
- Modify: `src/lib/topicsQuery.ts` (projection in `populateAuthors`), `src/pages/api/comments/[postId].ts`, `src/pages/api/comments/create.ts`, `src/pages/api/comments/edit/[commentId].ts`, `src/pages/api/topics/create.ts`, `src/pages/api/announcements/create.ts`, `src/pages/api/recommendations/create.ts`, `src/pages/api/events/create.ts`, `src/pages/api/admin/announcements/create.ts`, `src/pages/api/news/index.ts`, `src/lib/newsboard/newsQuery.ts`
- Delete: `src/pages/api/topics/all.ts`, `src/pages/api/announcements/all.ts`, `src/pages/api/recommendations/all.ts`

**Interfaces:**
- Produces: `PUBLIC_AUTHOR_PROJECTION`, `toPublicAuthor(u)`, type `PublicAuthor` — used by Task 5 (handle is already in the allowlist).

- [ ] **Step 1: Prove the leak on DEV before touching anything** (key NAMES only, never values)

Start the dev server, log in with the dev seed account the way `scratchpad/e2e-post-drafts.mts` does (fetch-based credentials login), then for a post that has comments:

```ts
const r = await fetch(`${BASE}/api/comments/${postId}`, { headers: { cookie } });
const j = await r.json();
console.log(Object.keys(j.comments[0].author).sort().join(','));
```

Expected BEFORE the fix: the list contains `email` (and more). Save the script as `scratchpad/author-join-keys.mts`; it is the re-check in Step 7.

- [ ] **Step 2: Write the failing test** — `src/lib/publicAuthor.test.ts`

```ts
// Run: npx tsx --test src/lib/publicAuthor.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from './publicAuthor';

test('the allowlist names exactly the public fields', () => {
  assert.deepEqual(Object.keys(PUBLIC_AUTHOR_PROJECTION).sort(),
    ['createdAt', 'handle', 'image', 'name', 'role', 'userPicture', 'verified']);
});

test('toPublicAuthor drops everything that is not public', () => {
  const out = toPublicAuthor({
    _id: { toString: () => 'abc' }, name: 'Petra', email: 'p@example.com', password: 'x',
    moderationStrikes: 2, pendingEmail: 'q@example.com', handle: 'petra2',
    userPicture: 'https://res.cloudinary.com/x/pic.jpg', verified: true, role: 'user', createdAt: '2026-01-01',
  });
  assert.deepEqual(Object.keys(out).sort(),
    ['_id', 'createdAt', 'handle', 'image', 'name', 'role', 'verified']);
  assert.equal(out._id, 'abc');
  assert.equal(out.image, 'https://res.cloudinary.com/x/pic.jpg');
  assert.equal(out.handle, 'petra2');
});

test('image falls back image → userPicture → null; handle absent → null', () => {
  assert.equal(toPublicAuthor({ _id: '1', image: 'a', userPicture: 'b' }).image, 'a');
  assert.equal(toPublicAuthor({ _id: '1' }).image, null);
  assert.equal(toPublicAuthor({ _id: '1' }).handle, null);
});
```

- [ ] **Step 3: Run it — expected FAIL** („Cannot find module './publicAuthor'")

Run: `npx tsx --test src/lib/publicAuthor.test.ts`

- [ ] **Step 4: Implement** — `src/lib/publicAuthor.ts`

```ts
// src/lib/publicAuthor.ts — dependency-pure.
// THE list of user fields that may reach a browser. Every join that ends up in
// an API response or in SSR props uses this projection — never `{ password: 0 }`,
// which ships e-mail, strike data, pendingEmail … to any logged-in member
// (found 2026-09-21: comments list + News list did exactly that).
// Widen only after checking every consumer of `.author.<field>`.

export const PUBLIC_AUTHOR_PROJECTION = {
  name: 1, image: 1, userPicture: 1, createdAt: 1, verified: 1, role: 1, handle: 1,
} as const;

export interface PublicAuthor {
  _id: string;
  name: string | null;
  image: string | null;
  createdAt: unknown;
  verified: boolean;
  role: string | null;
  handle: string | null;
}

export function toPublicAuthor(u: Record<string, any>): PublicAuthor {
  return {
    _id: String(u._id),
    name: typeof u.name === 'string' ? u.name : null,
    image: u.image || u.userPicture || null,
    createdAt: u.createdAt ?? null,
    verified: u.verified === true,
    role: typeof u.role === 'string' ? u.role : null,
    handle: typeof u.handle === 'string' ? u.handle : null,
  };
}
```

- [ ] **Step 5: Run the test — expected PASS (3 tests)**

- [ ] **Step 6: Replace every blocklist join**

In `src/lib/topicsQuery.ts` `populateAuthors`: import `PUBLIC_AUTHOR_PROJECTION` and replace the inline projection object with it (the mapping below it stays — it already normalises `image`).

In each of these files, import `{ PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from '<rel>/lib/publicAuthor'`, change `{ projection: { password: 0 } }` to `{ projection: PUBLIC_AUTHOR_PROJECTION }`, and wrap the result: `author ? toPublicAuthor(author) : <existing fallback>`:
`src/pages/api/comments/[postId].ts` (two lookups), `comments/create.ts`, `comments/edit/[commentId].ts`, `topics/create.ts`, `announcements/create.ts`, `recommendations/create.ts`, `events/create.ts`, `admin/announcements/create.ts`.

News needs only the name. In `src/pages/api/news/index.ts` and `src/lib/newsboard/newsQuery.ts` change the submitter lookup to:

```ts
{ projection: { name: 1 } }
```

and return `submitter ? { _id: String(submitter._id), name: submitter.name ?? null } : item.submittedBy`.

Then check no consumer needs more: `grep -rnE "author\??\.(email|hobbies|isBanned|moderationStrikes)|submittedBy\??\.(email|image)" src/components src/lib` → expected: no hits. Final sweep: `grep -rn "password: 0" src` → expected: only the two explanatory comments in `topicsQuery.ts` / `listingsQuery.ts`.

Delete the three `/all.ts` routes (`git rm`). Re-check callers first: `grep -rnF -e "topics/all" -e "announcements/all" -e "recommendations/all" src` → expected: no hits outside the deleted files.

- [ ] **Step 7: Re-run `scratchpad/author-join-keys.mts`** — expected now: `_id,createdAt,handle,image,name,role,verified`. Load `/forum`, a post detail with comments, `/newsboard` and `/calendar` in the browser: names and avatars still render. Run the three gates.

- [ ] **Step 8: Commit**

```bash
git add src/lib/publicAuthor.ts src/lib/publicAuthor.test.ts src/lib/topicsQuery.ts src/lib/newsboard/newsQuery.ts src/pages/api
git commit -m "user joins: one allowlist for every client-visible author, legacy /all routes removed"
```

---

### Task 2: One display-name rule for signup and profile

**Problem:** signup checks only „not empty + profanity" (a direct API call can register any length, emoji, invisible characters, line breaks). Profile edit enforces `PROFILE_NAME_REGEX` = 3–30 chars without dot or apostrophe — copying THAT to signup would refuse „Petra M.", „O'Neill" and „Jo", which signup accepts today. New single rule: **2–30 characters; letters of any script, digits, space, `. ' ’ - _`; must start with a letter or digit; invisible/control characters are stripped, whitespace collapsed.**

**Files:**
- Create: `src/lib/profile/nameRules.ts`, `src/lib/profile/nameRules.test.ts`
- Modify: `src/lib/profile/profileShared.ts` (re-export), `src/pages/api/auth/register.ts`, `src/pages/api/users/update.ts`, `src/components/profile/kiosk/PIdentityCard.svelte`, `src/components/auth/kiosk/AuthRegisterInner.svelte`, `src/lib/kiosk-i18n.ts`
- Create (scratch, not committed): `scratchpad/audit-names-handles.mts`

**Interfaces:**
- Produces: `cleanDisplayName(raw: unknown): string`, `isValidDisplayName(name: string): boolean`, `DISPLAY_NAME_REGEX`. Task 3 adds to the same file.

- [ ] **Step 1: Write the failing test** — `src/lib/profile/nameRules.test.ts`

```ts
// Run: npx tsx --test src/lib/profile/nameRules.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDisplayName, isValidDisplayName } from './nameRules';

test('cleaning trims, collapses whitespace and strips invisible characters', () => {
  assert.equal(cleanDisplayName('  Petra   M. '), 'Petra M.');
  assert.equal(cleanDisplayName('Pe​tra'), 'Petra');          // zero-width space
  assert.equal(cleanDisplayName('Petra‮nimda'), 'Petranimda'); // RTL override
  assert.equal(cleanDisplayName('Anna\nMaria'), 'Anna Maria');
  assert.equal(cleanDisplayName(42), '');
});

test('names real neighbours use are valid', () => {
  for (const n of ['Jo', 'Petra M.', "O'Neill", 'Jean-Luc', 'Emre Aydın', 'Müller_73', 'Ömer', 'Зоя'])
    assert.equal(isValidDisplayName(n), true, n);
});

test('too short, too long, emoji, leading punctuation and markup are refused', () => {
  for (const n of ['J', 'x'.repeat(31), 'Petra 🌻', '.Petra', '-Petra', '<b>Petra</b>', 'Petra@home', ''])
    assert.equal(isValidDisplayName(n), false, n);
});
```

- [ ] **Step 2: Run — expected FAIL** (module missing)

- [ ] **Step 3: Implement** — `src/lib/profile/nameRules.ts`

```ts
// src/lib/profile/nameRules.ts — dependency-pure (server routes + islands).
// ONE display-name rule for signup and profile edit (2026-09-21). Names may
// repeat — the handle is the identity; this file only keeps names readable
// and honest.

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 30;

/** Whitespace → one space, control + format characters (zero-width, RTL
 *  override, …) removed, NFC, trimmed. Accepted cost: the zero-width
 *  non-joiner some Persian names use is dropped as well. */
export function cleanDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim();
}

// First char letter/digit; last char letter/digit/mark/dot („Petra M.").
export const DISPLAY_NAME_REGEX = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._'’-]{0,28}[\p{L}\p{M}\p{N}.]$/u;

export function isValidDisplayName(name: string): boolean {
  return DISPLAY_NAME_REGEX.test(name);
}
```

- [ ] **Step 4: Run — expected PASS (3 tests)**

- [ ] **Step 5: Wire it in**

`src/lib/profile/profileShared.ts`: replace the `PROFILE_NAME_REGEX` line with

```ts
// One rule for signup and profile edit lives in nameRules.ts (2026-09-21).
export { DISPLAY_NAME_REGEX as PROFILE_NAME_REGEX } from './nameRules';
```

`src/pages/api/users/update.ts`: clean before validating —

```ts
name: z.string().transform((s) => cleanDisplayName(s)).pipe(z.string().regex(PROFILE_NAME_REGEX, 'name_invalid')).optional(),
```

(import `cleanDisplayName` from `../../../lib/profile/nameRules`).

`src/components/profile/kiosk/PIdentityCard.svelte` `handleSave()`: `const trimmed = cleanDisplayName(editName);` (import it) — the regex test line stays.

`src/pages/api/auth/register.ts`: replace the destructuring line and add the check right after the „Missing required fields" block:

```ts
const { name: rawName, email, password } = await request.json();
const name = cleanDisplayName(rawName);
```

```ts
if (!isValidDisplayName(name)) {
    return new Response(
        JSON.stringify({ error: 'name_invalid' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
}
```

The „Missing required fields" test must use `name` (the cleaned value), so a name of only spaces or invisible characters is refused there. Task 4 adds `handle: rawHandle` to this destructuring.

`src/components/auth/kiosk/AuthRegisterInner.svelte`: import `cleanDisplayName, isValidDisplayName`; in `submit()` replace the name check with

```ts
const cleanName = cleanDisplayName(name);
if (!isValidDisplayName(cleanName)) { nameErr = $t['auth.err.nameInvalid']; bad = true; }
```

send `name: cleanName`; in the `!res.ok` branch map codes before the old regex fallback:

```ts
const code = String(data?.error ?? '');
if (code === 'name_invalid') { nameErr = $t['auth.err.nameInvalid']; status = 'idle'; return; }
```

and `success={isValidDisplayName(cleanDisplayName(name))}` on the field.

i18n (`src/lib/kiosk-i18n.ts`, DE block and EN block) — PROPOSED copy:

```ts
'auth.err.nameInvalid': '2–30 Zeichen: Buchstaben, Zahlen, Leerzeichen und . \' - _',
'profile.edit.name.hint': '2–30 Zeichen · Buchstaben, Zahlen, Leerzeichen, . \' - _',
```
```ts
'auth.err.nameInvalid': '2–30 characters: letters, numbers, spaces and . \' - _',
'profile.edit.name.hint': '2–30 chars · letters, numbers, spaces, . \' - _',
```

- [ ] **Step 6: Read-only audit script** — `scratchpad/audit-names-handles.mts`

Reads `users` (projection `{ name: 1, handle: 1, anonymized: 1 }`), prints COUNTS plus the offending display names only: names failing `isValidDisplayName(cleanDisplayName(name))`, members without a handle, groups of identical cleaned names. Connection: `process.env.MONGODB_URI`, db from the URI path; `--prod` switches the path to `/mahalle` inside node (never printed). It never writes. Run it on dev now; the prod run is part of the final report („not yet checked" until run).

- [ ] **Step 7: Verify in the browser** — signup form on dev: „J" refused, „Petra M." accepted; direct call

```bash
curl -s -X POST localhost:4655/api/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"<b>x</b>","email":"t1@example.com","password":"Abcdefg1"}'
```

→ `{"error":"name_invalid"}`. Profile edit: rename to „Petra M." saves. Gates.

- [ ] **Step 8: Commit**

```bash
git add src/lib/profile/nameRules.ts src/lib/profile/nameRules.test.ts src/lib/profile/profileShared.ts src/pages/api/auth/register.ts src/pages/api/users/update.ts src/components/profile/kiosk/PIdentityCard.svelte src/components/auth/kiosk/AuthRegisterInner.svelte src/lib/kiosk-i18n.ts
git commit -m "display names: one rule for signup and profile, invisible characters stripped"
```

---

### Task 3: Protected names — nobody poses as the team

**Files:**
- Modify: `src/lib/profile/nameRules.ts`, `src/lib/profile/nameRules.test.ts`, `src/pages/api/auth/register.ts`, `src/pages/api/users/update.ts`, `src/components/auth/kiosk/AuthRegisterInner.svelte`, `src/components/profile/kiosk/PIdentityCard.svelte` (error mapping), `src/lib/kiosk-i18n.ts`
- Create: `src/lib/profile/protectedNamesStore.ts` (SERVER-ONLY)

**Interfaces:**
- Produces: `foldForCompare(s): string`, `isProtectedName(name): boolean`, `sameNameFolded(a, b): boolean` (pure); `isAdminLookalike(db, name, selfId?): Promise<boolean>` (server). Task 4 reuses `isProtectedName` for handles.

- [ ] **Step 1: Add failing tests** to `nameRules.test.ts`

```ts
import { foldForCompare, isProtectedName, sameNameFolded } from './nameRules';

test('folding removes case, accents, separators-insensitive lookalikes and leetspeak', () => {
  assert.equal(foldForCompare('Ádmin'), foldForCompare('admin'));
  assert.equal(foldForCompare('аdmin'), foldForCompare('admin')); // Cyrillic а
  assert.equal(foldForCompare('adm1n'), foldForCompare('admin'));
  assert.equal(foldForCompare('MAHALLE'), foldForCompare('mahalle'));
});

test('team and official lookalikes are protected', () => {
  for (const n of ['Admin', 'аdmin', 'Adm1n', 'Administrator', 'Mahalle', 'Mahalle Team', 'M a h a l l e',
                   'mahalle.digital', 'Moderation', 'Moderator', 'Team', 'Kiez Team', 'Support', 'Offiziell', 'Official'])
    assert.equal(isProtectedName(n), true, n);
});

test('ordinary names that merely contain the letters are not protected', () => {
  for (const n of ['Petra', 'Badminton Berlin', 'Teamgeist', 'Steamer', 'Modesta', 'Supporta', 'Emre Aydın'])
    assert.equal(isProtectedName(n), false, n);
});

test('sameNameFolded ignores case, accents, separators and lookalikes', () => {
  assert.equal(sameNameFolded('Ercan Atak', 'ercan_atak'), true);
  assert.equal(sameNameFolded('Ercan Atak', 'Еrcan  Atаk'), true); // Cyrillic Е, а
  assert.equal(sameNameFolded('Ercan Atak', 'Ercan Atay'), false);
});
```

- [ ] **Step 2: Run — expected FAIL** (exports missing)

- [ ] **Step 3: Implement** — append to `src/lib/profile/nameRules.ts`

```ts
// ─── Protected names ─────────────────────────────────────────────────
// Comparison form ONLY — never stored, never shown (UTS #39: skeletons are
// for comparing, not for normalising identifiers). A small hand-picked
// lookalike table instead of the 6,500-line Unicode confusables file: the
// threat here is „looks like the team" in a neighbourhood app, not IDN spoofing.

const LOOKALIKES: Record<string, string> = {
  // Cyrillic
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'к': 'k', 'м': 'm',
  'т': 't', 'н': 'h', 'в': 'b', 'і': 'i', 'ј': 'j', 'ѕ': 's',
  // Greek
  'α': 'a', 'ο': 'o', 'ρ': 'p', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'τ': 't', 'υ': 'u', 'χ': 'x',
  // Latin specials NFKD does not decompose
  'ı': 'i', 'ł': 'l', 'ø': 'o',
  // leetspeak
  '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's',
  // 1 / l / | / ! all read as „i" — both sides of every comparison are folded the same way
  '1': 'i', 'l': 'i', '|': 'i', '!': 'i',
};

export function foldForCompare(s: string): string {
  return Array.from(s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase())
    .map((c) => LOOKALIKES[c] ?? c)
    .join('');
}

const words = (folded: string) => folded.split(/[^a-z0-9]+/).filter(Boolean);
const squash = (folded: string) => folded.replace(/[^a-z0-9]+/g, '');

const ANYWHERE = ['mahalle'].map(foldForCompare);                                   // even spaced out
const WORD_PREFIX = ['admin', 'moderat', 'offiziel', 'official'].map(foldForCompare); // a word STARTS with it
const WHOLE_WORD = ['team', 'mod', 'support', 'system', 'redaktion', 'staff', 'betreiber'].map(foldForCompare);

export function isProtectedName(name: string): boolean {
  const f = foldForCompare(name);
  const flat = squash(f);
  if (ANYWHERE.some((t) => flat.includes(t))) return true;
  const ws = words(f);
  if (ws.some((w) => WORD_PREFIX.some((p) => w.startsWith(p)))) return true;
  return ws.some((w) => WHOLE_WORD.includes(w));
}

export function sameNameFolded(a: string, b: string): boolean {
  return squash(foldForCompare(a)) === squash(foldForCompare(b));
}
```

- [ ] **Step 4: Run — expected PASS (7 tests)**. If „Badminton Berlin" or „Teamgeist" fail, the word logic is wrong — fix the code, not the test.

- [ ] **Step 5: Server helper** — `src/lib/profile/protectedNamesStore.ts`

```ts
// SERVER-ONLY. The admins' own display names are protected too — read at
// request time (one tiny query), never hardcoded.
import type { Db } from 'mongodb';
import { sameNameFolded } from './nameRules';

export async function isAdminLookalike(db: Db, name: string, selfId?: string): Promise<boolean> {
  const admins = await db.collection('users')
    .find({ role: 'admin', anonymized: { $ne: true } }, { projection: { name: 1 } })
    .toArray();
  return admins.some((a) => String(a._id) !== selfId && typeof a.name === 'string' && sameNameFolded(a.name, name));
}
```

- [ ] **Step 6: Wire into both routes**

`register.ts`, after the `name_invalid` check and AFTER both rate limits, before the profanity check (no OpenAI call for a name we refuse anyway); the DB handle is needed, so move `const client = await clientPromise; const db = client.db();` up to here:

```ts
if (isProtectedName(name) || await isAdminLookalike(db, name)) {
    return new Response(
        JSON.stringify({ error: 'name_protected' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
}
```

`users/update.ts`, inside `if (name !== undefined)`, before `checkNameProfanity`; admins are exempt (the admin's real display name may legitimately be „Mahalle Team"); connect first:

```ts
if (session.user.role !== 'admin' && (isProtectedName(name) || await isAdminLookalike(db, name, session.user.id))) {
  return new Response(JSON.stringify({ error: 'name_protected' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}
```

Client mapping: `AuthRegisterInner.svelte` → `if (code === 'name_protected') { nameErr = $t['auth.err.nameProtected']; … }`; `PIdentityCard.svelte` `submit()`: today it shows the server's raw `error` string (`saveError = msg;`). Replace that line with explicit branches (an untyped dictionary index costs a svelte-check error):

```ts
saveError =
  msg === 'name_protected' ? $t['auth.err.nameProtected']
  : msg === 'name_invalid' ? $t['profile.edit.name.hint']
  : msg;
```

PROPOSED copy: DE `'auth.err.nameProtected': 'Dieser Name ist dem Mahalle-Team vorbehalten. Bitte wähl einen anderen.'` · EN `'auth.err.nameProtected': 'That name is reserved for the Mahalle team. Please pick another.'`

- [ ] **Step 7: Verify on dev** — `curl` register with `"name":"Mаhalle Team"` (Cyrillic а) → `name_protected`; with the dev admin's exact display name → `name_protected`; profile rename of an ordinary dev member to „Admin" → refused with the DE message; the dev ADMIN can still save the profile. Gates.

- [ ] **Step 8: Commit**

```bash
git add src/lib/profile/nameRules.ts src/lib/profile/nameRules.test.ts src/lib/profile/protectedNamesStore.ts src/pages/api/auth/register.ts src/pages/api/users/update.ts src/components/auth/kiosk/AuthRegisterInner.svelte src/components/profile/kiosk/PIdentityCard.svelte src/lib/kiosk-i18n.ts
git commit -m "protected names: team and admin lookalikes refused at signup and on rename"
```

---

### Task 4: Handle choice at signup (once; otherwise automatic)

**Files:**
- Modify: `src/lib/profile/handle.ts`, create `src/lib/profile/handle.test.ts` (if one exists, extend it), `src/pages/api/auth/register.ts`, `src/components/auth/kiosk/AuthRegisterInner.svelte`, `src/lib/auth/accountDeletion.ts`, `src/lib/kiosk-i18n.ts`

**Interfaces:**
- Produces: `RESERVED_HANDLES: ReadonlySet<string>`, `normalizeChosenHandle(raw: unknown): string`, `chosenHandleProblem(handle: string): 'format' | 'reserved' | null`. Register accepts optional body field `handle`; error codes `handle_invalid`, `handle_reserved`, `handle_taken` (409). New user field `handleChosen?: true`.

- [ ] **Step 1: Failing test** — `src/lib/profile/handle.test.ts`

```ts
// Run: npx tsx --test src/lib/profile/handle.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chosenHandleProblem, normalizeChosenHandle, RESERVED_HANDLES, HANDLE_FALLBACK } from './handle';

test('normalising strips one leading @, trims and lowercases', () => {
  assert.equal(normalizeChosenHandle('  @Petra_M '), 'petra_m');
  assert.equal(normalizeChosenHandle('@@petra'), '@petra');
  assert.equal(normalizeChosenHandle(undefined), '');
});

test('format: a-z 0-9 _ and 3–20 characters', () => {
  assert.equal(chosenHandleProblem('petra_m'), null);
  for (const h of ['pe', 'x'.repeat(21), 'petra-m', 'pétra', 'petra m', '@petra'])
    assert.equal(chosenHandleProblem(h), 'format', h);
});

test('reserved: team words, mention keywords, lookalikes', () => {
  for (const h of ['admin', 'adm1n', 'mahalle', 'mahalle_team', 'moderation', 'team', 'alle', 'everyone', 'here', 'kiez'])
    assert.equal(chosenHandleProblem(h), 'reserved', h);
  assert.equal(chosenHandleProblem('teamgeist'), null);
});

test('the automatic fallback is never reserved', () => {
  assert.equal(RESERVED_HANDLES.has(HANDLE_FALLBACK), false);
  assert.equal(chosenHandleProblem(HANDLE_FALLBACK), null);
});
```

- [ ] **Step 2: Run — expected FAIL**

- [ ] **Step 3: Implement** — append to `src/lib/profile/handle.ts`

```ts
import { isProtectedName } from './nameRules';

// Words a handle must never be: they read as the team, or as a group mention.
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'alle', 'all', 'everyone', 'here', 'channel', 'kiez', 'nachbarn', 'nachbarschaft',
  'schillerkiez', 'forum', 'kurier', 'markt', 'kalender', 'profil', 'profile', 'login', 'register',
]);

/** What the member typed → candidate handle. One leading „@" is tolerated. */
export function normalizeChosenHandle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().toLowerCase();
  return s.startsWith('@') ? s.slice(1) : s;
}

export function chosenHandleProblem(handle: string): 'format' | 'reserved' | null {
  if (!HANDLE_REGEX.test(handle)) return 'format';
  if (RESERVED_HANDLES.has(handle)) return 'reserved';
  // „mahalle_team", „adm1n" … — same protected-name logic as display names.
  if (isProtectedName(handle.replace(/_/g, ' ')) || isProtectedName(handle)) return 'reserved';
  return null;
}
```

(The import goes to the top of the file; `nameRules.ts` imports nothing, so there is no cycle. Keep the file header comment „PURE module".)

- [ ] **Step 4: Run — expected PASS (4 tests)**

- [ ] **Step 5: Register route**

Extend the body destructuring to `const { name: rawName, email, password, handle: rawHandle } = await request.json();`. After the protected-name check (Task 3) add the handle validation — still before the display-name profanity call:

```ts
const chosenHandle = normalizeChosenHandle(rawHandle);
if (chosenHandle) {
    const problem = chosenHandleProblem(chosenHandle);
    if (problem) {
        return new Response(
            JSON.stringify({ error: problem === 'format' ? 'handle_invalid' : 'handle_reserved' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }
    const taken = await db.collection('users').findOne({ handle: chosenHandle }, { projection: { _id: 1 } });
    if (taken) {
        return new Response(
            JSON.stringify({ error: 'handle_taken' }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
    }
    // Same blocklists + OpenAI safety net as the display name; „_" → space so
    // word-boundary matching works. An OpenAI outage never refuses (shortTextVerdict).
    const handleCheck = await checkNameProfanity(chosenHandle.replace(/_/g, ' '));
    if (!handleCheck.clean) {
        return new Response(
            JSON.stringify({ error: 'handle_invalid' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
```

Insert loop: a chosen handle gets ONE attempt and no suffix; the automatic base must never be a reserved word.

```ts
let baseHandle = slugifyHandle(name);
if (chosenHandleProblem(baseHandle) === 'reserved') baseHandle = HANDLE_FALLBACK;
let handleTaken = false;
const maxAttempts = chosenHandle ? 1 : 6;
for (let attempt = 0; attempt < maxAttempts && !result; attempt++) {
    const suffix = attempt === 0 ? '' : String(attempt + 1);
    const handle = chosenHandle || baseHandle.slice(0, 20 - suffix.length) + suffix;
```

In the insert object add `...(chosenHandle ? { handleChosen: true } : {}),` after `handle,`. In the `catch`: after the e-mail branch,

```ts
if (e?.keyPattern?.handle === undefined) throw e;
if (chosenHandle) { handleTaken = true; break; } // lost the race for a chosen handle
```

and after the loop, before `if (!result)`: `if (handleTaken) return 409 { error: 'handle_taken' }`. The existing e-mail 409 must keep its body (the form keys on status 409 today — see Step 6).

`src/lib/auth/accountDeletion.ts` tombstone `$unset`: add `handleChosen: '',` next to `handle: '',`.

- [ ] **Step 6: Signup form** — `AuthRegisterInner.svelte`

State: `let handle = $state(''); let handleErr = $state<string | null>(null);`. Imports: `slugifyHandle, normalizeChosenHandle, chosenHandleProblem` from `../../../lib/profile/handle`.

```ts
const autoHandle = $derived(cleanDisplayName(name).length >= 2 ? slugifyHandle(cleanDisplayName(name)) : '');
const chosen = $derived(normalizeChosenHandle(handle));
```

In `submit()`: `handleErr = null;` with the other resets, and

```ts
if (chosen) {
  const p = chosenHandleProblem(chosen);
  if (p) { handleErr = $t[p === 'format' ? 'auth.err.handleInvalid' : 'auth.err.handleReserved']; bad = true; }
}
```

Body: `JSON.stringify({ name: cleanName, email: email.trim(), password, ...(chosen ? { handle: chosen } : {}) })`.

Error mapping — the 409 branch must distinguish BEFORE it assumes „e-mail taken":

```ts
if (res.status === 409 && code === 'handle_taken') { handleErr = $t['auth.err.handleTaken']; status = 'idle'; return; }
if (code === 'handle_invalid') { handleErr = $t['auth.err.handleInvalid']; status = 'idle'; return; }
if (code === 'handle_reserved') { handleErr = $t['auth.err.handleReserved']; status = 'idle'; return; }
```

(`const code = String(data?.error ?? '')` must be computed above the 409 check.)

Field, directly under the name field:

```svelte
<AuthField label={$t['auth.register.handle']} placeholder={autoHandle ? `@${autoHandle}` : $t['auth.register.handlePh']}
  name="handle" autocomplete="off" value={handle} error={handleErr}
  hint={$t['auth.register.handleHint']}
  success={!!chosen && !chosenHandleProblem(chosen)} oninput={(v) => { handle = v; handleErr = null; }} />
```

PROPOSED copy —
DE: `'auth.register.handle': 'Dein @Name (optional)'`, `'auth.register.handlePh': '@dein_name'`, `'auth.register.handleHint': 'einmalig wählbar'`, `'auth.err.handleInvalid': '3–20 Zeichen: a–z, 0–9 und _'`, `'auth.err.handleReserved': 'Dieser @Name ist reserviert.'`, `'auth.err.handleTaken': 'Dieser @Name ist schon vergeben.'`
EN: `'Your @name (optional)'`, `'@your_name'`, `'can be chosen once'`, `'3–20 characters: a–z, 0–9 and _'`, `'That @name is reserved.'`, `'That @name is already taken.'`
Also extend `auth.register.note` so the member learns what happens without a choice — PROPOSED DE addition: „Ohne Eingabe vergeben wir deinen @Namen automatisch." / EN: “Leave it empty and we assign your @name automatically.”

Check `AuthField`'s `hint` rendering (right of the label) at 390 px: label + hint must fit one line; if not, shorten the hint.

- [ ] **Step 7: Verify on dev** — register (a) without handle → automatic as before; (b) with `@Petra_Test` → stored `petra_test` + `handleChosen: true` (dev DB read); (c) same handle again with another e-mail → „schon vergeben" on the HANDLE field, no account created; (d) `admin` → reserved. Screenshot the form at 390 and 1280 px into `scratchpad/`. Gates.

- [ ] **Step 8: Commit**

```bash
git add src/lib/profile/handle.ts src/lib/profile/handle.test.ts src/pages/api/auth/register.ts src/components/auth/kiosk/AuthRegisterInner.svelte src/lib/auth/accountDeletion.ts src/lib/kiosk-i18n.ts
git commit -m "signup: optional one-time handle choice, reserved handles, automatic handle as fallback"
```

---

### Task 5: Show `@handle` next to names

House style (precedent `AvatarMenu.svelte`): `font-dmmono`, ~10 px, `text-ink-mute`, `@` prefix. A missing handle renders nothing.

**Files:**
- Modify: `src/lib/listingsQuery.ts`, `src/types/listing.ts`, `src/components/marketplace/kiosk/detail/MarketDetailInner.svelte`, `src/components/marketplace/kiosk/detail/SellerCard.svelte`, `src/pages/api/users/profiles.ts`, `src/lib/userProfilesQueries.ts`, `src/components/calendar/kiosk/AttendeeStack.svelte`, `src/components/calendar/kiosk/EventDetailModal.svelte`, `src/components/forum/kiosk/ForumComment.svelte`, `src/components/forum/kiosk/ForumPostDetail.svelte`

**Interfaces:**
- Consumes: `author.handle` from Task 1's allowlist. Produces: `sellerHandle` on `Listing`, `handle` on `UserProfile`.

- [ ] **Step 1: Sellers** — `listingsQuery.ts`: `SELLER_PROJECTION = { name: 1, image: 1, userPicture: 1, verified: 1, handle: 1 }`; in the mapper add `sellerHandle: typeof u?.handle === 'string' ? u.handle : null,`. `src/types/listing.ts`: `sellerHandle?: string | null;` next to `sellerName`. `MarketDetailInner.svelte`: pass `sellerHandle={listing.sellerHandle}`. `SellerCard.svelte`: new prop `sellerHandle?: string | null`, and

```ts
const metaLine = $derived(
  [sellerHandle ? `@${sellerHandle}` : null, sinceLabel, listingsLabel].filter(Boolean).join(' · ') || null
);
```

- [ ] **Step 2: Attendees + event author** — `profiles.ts`: projection `+ handle: 1`, DTO `handle: typeof d.handle === 'string' ? d.handle : null`. `userProfilesQueries.ts` `UserProfile`: `handle: string | null`. `AttendeeStack.svelte`: type gets `handle?: string | null`; tooltip `title={u.handle ? `${u.name} · @${u.handle}` : u.name}`. `EventDetailModal.svelte` author slab, after the name link/div:

```svelte
{#if typeof event?.author === 'object' && event?.author !== null && (event.author as any).handle}
  <div class="font-dmmono text-[10px] text-ink-mute">@{(event.author as any).handle}</div>
{/if}
```

- [ ] **Step 3: Forum comment** — `ForumComment.svelte`: author type gets `handle?: string | null`; derived

```ts
const commentAuthorHandle = $derived(typeof comment.author === 'object' ? (comment.author?.handle ?? null) : null);
```

markup directly after the name `{/if}` and before the OP badge:

```svelte
{#if commentAuthorHandle}
  <span class="font-dmmono text-[10px] text-ink-mute">@{commentAuthorHandle}</span>
{/if}
```

- [ ] **Step 4: Post detail** — `ForumPostDetail.svelte`: `const authorHandle = $derived(topic.author?.handle ?? null);` and replace the `memberSince` block with

```svelte
{#if authorHandle || memberSince}
  <span class="font-dmmono text-[10px] tracking-[0.05em] text-ink-mute">
    {#if authorHandle}<span class="normal-case">@{authorHandle}</span>{/if}{#if authorHandle && memberSince}{' · '}{/if}{#if memberSince}<span class="uppercase">{memberSince}</span>{/if}
  </span>
{/if}
```

(the handle must NOT be uppercased — it is an identifier).

- [ ] **Step 5: Verify** — dev, 390 + 1280 px: a post detail with comments from two members, a listing detail, an event with attendees. A freshly posted comment and the same comment after reload show the SAME header (both paths use the allowlist since Task 1). Long handle (20 chars) + long name must not push the row off screen at 390 px (`flex-wrap` is already on the comment header). Screenshots to `scratchpad/`. Gates.

- [ ] **Step 6: Commit**

```bash
git add src/lib/listingsQuery.ts src/types/listing.ts src/components/marketplace/kiosk/detail src/pages/api/users/profiles.ts src/lib/userProfilesQueries.ts src/components/calendar/kiosk/AttendeeStack.svelte src/components/calendar/kiosk/EventDetailModal.svelte src/components/forum/kiosk/ForumComment.svelte src/components/forum/kiosk/ForumPostDetail.svelte
git commit -m "handles next to names: comments, post detail, seller card, event author, attendee tooltip"
```

---

### Task 6: Mentions — pure text logic

**Files:**
- Create: `src/lib/mentions/mentions.ts`, `src/lib/mentions/mentions.test.ts`
- Modify: `src/lib/linkify.ts`, `src/lib/linkify.test.ts`

**Interfaces:**
- Produces:
  - `MAX_MENTIONS = 10`
  - `interface MentionRef { handle: string; userId: string }`
  - `extractMentionHandles(text: string, max?: number): string[]` — unique, lowercase, order of appearance
  - `splitMentions(text: string, mentions: readonly MentionRef[]): Array<{ type: 'text' | 'mention'; value: string; userId?: string }>`
  - `activeMentionQuery(value: string, caret: number): { start: number; query: string } | null`
  - `applyMention(value: string, start: number, caret: number, handle: string): { value: string; caret: number }`
  - `linkifySegments(text: string, mentions?: readonly MentionRef[]): LinkifySegment[]`, `LinkifySegment.type` gains `'mention'` (+ optional `userId`)

- [ ] **Step 1: Failing tests** — `src/lib/mentions/mentions.test.ts`

```ts
// Run: npx tsx --test src/lib/mentions/mentions.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeMentionQuery, applyMention, extractMentionHandles, splitMentions } from './mentions';

test('handles are found, lowercased, unique, in order', () => {
  assert.deepEqual(extractMentionHandles('Hallo @Petra2 und @emre_aydin, nochmal @petra2!'), ['petra2', 'emre_aydin']);
});

test('e-mail addresses, URLs and glued text are not mentions', () => {
  assert.deepEqual(extractMentionHandles('mail petra@example.com'), []);
  assert.deepEqual(extractMentionHandles('https://social.example/@petra2'), []);
  assert.deepEqual(extractMentionHandles('abc@petra2 und @@petra2'), []);
  assert.deepEqual(extractMentionHandles('@pe ist zu kurz'), []);
  assert.deepEqual(extractMentionHandles('(@petra2) „@emre_aydin“'), ['petra2', 'emre_aydin']);
});

test('a handle followed by more handle characters is a different handle', () => {
  assert.deepEqual(extractMentionHandles('@petra2x'), ['petra2x']);
  assert.deepEqual(extractMentionHandles('@' + 'a'.repeat(21)), []);
});

test('the cap keeps the first N', () => {
  const text = Array.from({ length: 14 }, (_, i) => `@user_${i}`).join(' ');
  assert.equal(extractMentionHandles(text).length, 10);
  assert.equal(extractMentionHandles(text, 3).length, 3);
});

test('splitMentions links only resolved handles', () => {
  const segs = splitMentions('Frag @petra2 oder @niemand.', [{ handle: 'petra2', userId: 'u1' }]);
  assert.deepEqual(segs, [
    { type: 'text', value: 'Frag ' },
    { type: 'mention', value: 'petra2', userId: 'u1' },
    { type: 'text', value: ' oder @niemand.' },
  ]);
});

test('activeMentionQuery sees the token left of the caret', () => {
  assert.deepEqual(activeMentionQuery('Hallo @pe', 9), { start: 6, query: 'pe' });
  assert.deepEqual(activeMentionQuery('@', 1), { start: 0, query: '' });
  assert.equal(activeMentionQuery('Hallo @pe tra', 13), null);
  assert.equal(activeMentionQuery('mail@pe', 7), null);
  assert.equal(activeMentionQuery('Hallo', 5), null);
});

test('applyMention replaces the token and leaves one space', () => {
  assert.deepEqual(applyMention('Hallo @pe und', 6, 9, 'petra2'), { value: 'Hallo @petra2 und', caret: 14 });
  assert.deepEqual(applyMention('@pe', 0, 3, 'petra2'), { value: '@petra2 ', caret: 8 });
});
```

Add to `src/lib/linkify.test.ts`:

```ts
test('mentions are linked inside text, never inside a URL', () => {
  const segs = linkifySegments('@petra2 siehe https://x.example/@petra2', [{ handle: 'petra2', userId: 'u1' }]);
  assert.deepEqual(segs.map((s) => s.type), ['mention', 'text', 'link']);
  assert.equal(segs[0].userId, 'u1');
});

test('without mentions the output is unchanged', () => {
  assert.deepEqual(linkifySegments('Hallo @petra2'), [{ type: 'text', value: 'Hallo @petra2' }]);
});
```

- [ ] **Step 2: Run both — expected FAIL**

- [ ] **Step 3: Implement** — `src/lib/mentions/mentions.ts`

```ts
// src/lib/mentions/mentions.ts — dependency-pure (server + islands).
// NO regex lookbehind here: Safari < 16.4 rejects it at parse time and the
// importing island would never mount. The character BEFORE „@" is matched as
// group 1 instead.

export const MAX_MENTIONS = 10;

export interface MentionRef { handle: string; userId: string }
export interface MentionSegment { type: 'text' | 'mention'; value: string; userId?: string }

// „@" must not follow a letter, digit, „_", „@", „." or „/" (e-mail, URL path, „@@").
const MENTION_SRC = '(^|[^\\p{L}\\p{N}_@./])@([a-z0-9_]{3,20})(?![a-z0-9_])';
const mentionRe = () => new RegExp(MENTION_SRC, 'giu');

export function extractMentionHandles(text: string, max = MAX_MENTIONS): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(mentionRe())) {
    const h = m[2].toLowerCase();
    if (!out.includes(h)) out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

export function splitMentions(text: string, mentions: readonly MentionRef[]): MentionSegment[] {
  if (mentions.length === 0) return [{ type: 'text', value: text }];
  const byHandle = new Map(mentions.map((m) => [m.handle, m.userId]));
  const segs: MentionSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(mentionRe())) {
    const handle = m[2].toLowerCase();
    const userId = byHandle.get(handle);
    if (!userId) continue;
    const at = (m.index ?? 0) + m[1].length; // position of „@"
    if (at > last) segs.push({ type: 'text', value: text.slice(last, at) });
    segs.push({ type: 'mention', value: handle, userId });
    last = at + 1 + m[2].length;
  }
  if (last < text.length) segs.push({ type: 'text', value: text.slice(last) });
  return segs;
}

/** The „@token" directly left of the caret, or null. `query` may be ''. */
export function activeMentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const left = value.slice(0, caret);
  const at = left.lastIndexOf('@');
  if (at < 0) return null;
  const query = left.slice(at + 1);
  if (!/^[a-z0-9_]{0,20}$/i.test(query)) return null;
  if (at > 0 && /[\p{L}\p{N}_@./]/u.test(left[at - 1])) return null;
  return { start: at, query: query.toLowerCase() };
}

export function applyMention(value: string, start: number, caret: number, handle: string): { value: string; caret: number } {
  const before = value.slice(0, start);
  const after = value.slice(caret);
  const insert = `@${handle}`;
  const spacer = after.startsWith(' ') ? '' : ' ';
  const next = before + insert + spacer + after;
  return { value: next, caret: before.length + insert.length + 1 };
}
```

`src/lib/linkify.ts`: import `{ splitMentions, type MentionRef } from './mentions/mentions'`; widen the segment —

```ts
export interface LinkifySegment {
  type: 'text' | 'link' | 'mention';
  value: string;      // mention: the bare handle
  userId?: string;    // mention only
}
```

change the signature to `linkifySegments(text: string, mentions: readonly MentionRef[] = [])` and replace BOTH `segments.push({ type: 'text', value: … })` lines by a helper that splits text further:

```ts
const pushText = (value: string) => {
  if (mentions.length === 0) segments.push({ type: 'text', value });
  else segments.push(...splitMentions(value, mentions));
};
```

`shortenUrlsInText` stays as is (mention segments carry the bare handle — it must map them back): change its mapper to
`seg.type === 'link' ? displayUrl(seg.value, max) : seg.type === 'mention' ? `@${seg.value}` : seg.value` (defensive; it passes no mentions today).

- [ ] **Step 4: Run all three test files — expected PASS** (`mentions.test.ts` 7, `linkify.test.ts` existing + 2). Verify `applyMention` caret numbers by hand if a test fails — fix the code, not the expectation, unless the expectation is arithmetically wrong.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mentions/mentions.ts src/lib/mentions/mentions.test.ts src/lib/linkify.ts src/lib/linkify.test.ts
git commit -m "mentions: pure parsing, mention segments in linkify, caret helpers"
```

---

### Task 7: Mentions — store on save, notify when public

**Rules:** resolve on every save (create + edit); store `mentions: MentionRef[]` on the document; notify only when the content is publicly visible (`approved`, including approved-with-warning); never the author; never twice for the same source (idempotent → create, edit and approval may all call it); in comments the parent post's author already gets the „replied" notification → no second one; 20 mention-notifying saves per member per hour, above that the mention is still stored and linked but silent.

**Files:**
- Create: `src/lib/mentions/mentionsResolve.ts`, `src/lib/mentions/mentionsResolve.test.ts`, `src/lib/mentions/mentionsStore.ts`
- Modify: `src/types/notification.ts`, `src/types/index.ts` (`Topic`, `Announcement`, `Recommendation`, `Comment` get `mentions?: MentionRef[]`), `src/lib/push.ts`, `src/components/forum/kiosk/NotificationPanel.svelte`, `src/lib/kiosk-i18n.ts`, `src/pages/api/topics/create.ts`, `src/pages/api/announcements/create.ts`, `src/pages/api/recommendations/create.ts`, `src/pages/api/topics/edit/[id].ts`, `src/pages/api/announcements/edit/[id].ts`, `src/pages/api/recommendations/edit/[id].ts`, `src/pages/api/comments/create.ts`, `src/pages/api/comments/edit/[commentId].ts`, `src/lib/reviewAction.ts`, `src/lib/auth/accountDeletion.ts`

**Interfaces:**
- Consumes: `extractMentionHandles`, `MentionRef`; `notify`, `commentTarget`, `moderationTarget` from `src/lib/notifications.ts`; `consumeRateLimit(baseKey, max, windowMs)` → `{ limited }`.
- Produces:
  - `resolveMentions(db: MentionDb, text: string): Promise<MentionRef[]>`
  - `pickMentionRecipients(args: { mentions; actorId; skipUserIds?; alreadyNotified }): string[]` (pure, exported for the test)
  - `notifyMentions(db, args: { actorId: string; mentions: MentionRef[]; sourceId: string; kind: 'post' | 'comment'; target: NotificationTarget; skipUserIds?: string[] }): Promise<number>` — never throws
  - `findCommentParent(db, postId: string): Promise<{ collection: string; author: string | null; title: string } | null>`
  - `notifyMentionsOnApproval(db, flagged: { contentType: string; contentId?: string; authorId: string; source?: string }): Promise<void>` — never throws; skips `source === 'user_report'`
  - `removeMentionsOf(db, userId: string): Promise<number>`
  - `NotificationType` gains `'mention'`; `NotificationMeta` gains `sourceId?: string`

**Why two files (audit 09-21):** `src/lib/mongodb.ts` throws at IMPORT time when `import.meta.env.MONGODB_URI` is missing, and `notifications.ts` / `rateLimit.ts` import it — a test that imports them dies before the first assertion. The existing DB-shaped tests (`movePost.test.ts`, `cascade.test.ts`) work because their modules import only the `mongodb` PACKAGE and take the db as an argument. So everything testable lives in `mentionsResolve.ts` (db injected), and only the two notify functions live in `mentionsStore.ts`.

- [ ] **Step 1: Failing test** — `src/lib/mentions/mentionsResolve.test.ts` (in-memory fake Db, same style as `src/lib/forum/movePost.test.ts`)

```ts
// Run: npx tsx --test src/lib/mentions/mentionsResolve.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMentionRecipients, resolveMentions } from './mentionsResolve';

const fakeDb = (users: Array<Record<string, any>>) => ({
  collection: () => ({
    find: (filter: any) => ({
      toArray: async () => users.filter((u) => filter.handle.$in.includes(u.handle) && u.anonymized !== true),
    }),
  }),
}) as any;

test('resolveMentions keeps text order, drops unknown and tombstoned handles', async () => {
  const db = fakeDb([
    { _id: 'u2', handle: 'emre_aydin' }, { _id: 'u1', handle: 'petra2' }, { _id: 'u9', handle: 'weg', anonymized: true },
  ]);
  assert.deepEqual(await resolveMentions(db, 'Hi @petra2, @niemand, @weg und @emre_aydin'), [
    { handle: 'petra2', userId: 'u1' }, { handle: 'emre_aydin', userId: 'u2' },
  ]);
});

test('no „@" in the text → no query at all', async () => {
  const db = { collection: () => { throw new Error('must not query'); } } as any;
  assert.deepEqual(await resolveMentions(db, 'ganz normaler Text'), []);
});

test('recipients: not the author, not skipped ids, not already notified, each once', () => {
  const mentions = [
    { handle: 'a', userId: 'author' }, { handle: 'b', userId: 'u1' }, { handle: 'c', userId: 'u2' },
    { handle: 'd', userId: 'u3' }, { handle: 'b', userId: 'u1' },
  ];
  assert.deepEqual(
    pickMentionRecipients({ mentions, actorId: 'author', skipUserIds: ['u2'], alreadyNotified: ['u3'] }),
    ['u1'],
  );
});
```

- [ ] **Step 2: Run — expected FAIL**

- [ ] **Step 3: Implement** — the code block below is written as ONE listing for readability; split it on save:
  - `src/lib/mentions/mentionsResolve.ts` ← `MentionDb`, `PARENT_COLLECTIONS`, `resolveMentions`, `pickMentionRecipients`, `findCommentParent`, `removeMentionsOf`. Imports: `import { ObjectId, type Db } from 'mongodb';` and `./mentions` — NOTHING else.
  - `src/lib/mentions/mentionsStore.ts` ← `POST_COLLECTION`, `NOTIFYING_SAVES_PER_HOUR`, `capture`, `notifyMentions`, `notifyMentionsOnApproval`, plus `export * from './mentionsResolve';` as its last line, so routes import everything from `mentionsStore`.

```ts
// src/lib/mentions/mentionsStore.ts — SERVER-ONLY (imports mongodb + Sentry).
// Mentions are resolved when a text is SAVED and stored as { handle, userId }.
// The link goes by userId, so a later handle change never breaks it, and an
// „@word" in older text never becomes a link or a notification after the fact.
import * as Sentry from '@sentry/astro';
import { ObjectId, type Db } from 'mongodb';
import { consumeRateLimit } from '../auth/rateLimit';
import { notify, commentTarget, moderationTarget } from '../notifications';
import type { NotificationTarget } from '../../types/notification';
import { extractMentionHandles, type MentionRef } from './mentions';

export type MentionDb = Pick<Db, 'collection'>;

const POST_COLLECTION: Record<string, string> = {
  topic: 'topics', announcement: 'announcements', recommendation: 'recommendations',
};
const PARENT_COLLECTIONS = ['topics', 'announcements', 'recommendations', 'events'] as const;
const NOTIFYING_SAVES_PER_HOUR = 20;

async function capture(err: unknown): Promise<void> {
  console.error('[mentions]', err);
  Sentry.captureException(err);
  await Sentry.flush(2000);
}

export async function resolveMentions(db: MentionDb, text: string): Promise<MentionRef[]> {
  const handles = extractMentionHandles(text);
  if (handles.length === 0) return [];
  const users = await db.collection('users')
    .find({ handle: { $in: handles }, anonymized: { $ne: true } }, { projection: { handle: 1 } })
    .toArray();
  const idByHandle = new Map(users.map((u) => [String(u.handle), String(u._id)]));
  return handles.filter((h) => idByHandle.has(h)).map((h) => ({ handle: h, userId: idByHandle.get(h)! }));
}

export function pickMentionRecipients(args: {
  mentions: readonly MentionRef[]; actorId: string; skipUserIds?: readonly string[]; alreadyNotified: readonly string[];
}): string[] {
  const skip = new Set<string>([args.actorId, ...(args.skipUserIds ?? []), ...args.alreadyNotified]);
  return [...new Set(args.mentions.map((m) => m.userId))].filter((id) => !skip.has(id));
}

/** Idempotent per (sourceId, recipient): create, edit and approval may all call it. Never throws. */
export async function notifyMentions(db: Db, args: {
  actorId: string; mentions: MentionRef[]; sourceId: string; kind: 'post' | 'comment';
  target: NotificationTarget; skipUserIds?: string[];
}): Promise<number> {
  try {
    if (args.mentions.length === 0) return 0;
    const candidates = [...new Set(args.mentions.map((m) => m.userId))];
    const seen = await db.collection('notifications')
      .find({ userId: { $in: candidates }, type: 'mention', 'meta.sourceId': args.sourceId }, { projection: { userId: 1 } })
      .toArray();
    const recipients = pickMentionRecipients({
      mentions: args.mentions, actorId: args.actorId, skipUserIds: args.skipUserIds,
      alreadyNotified: seen.map((n) => String(n.userId)),
    });
    if (recipients.length === 0) return 0;
    const cap = await consumeRateLimit(`mention:${args.actorId}`, NOTIFYING_SAVES_PER_HOUR, 60 * 60 * 1000);
    if (cap.limited) return 0; // stored + linked, but silent
    for (const userId of recipients) {
      await notify({
        userId, type: 'mention', actorId: args.actorId, target: args.target,
        meta: { sourceId: args.sourceId, contentKind: args.kind },
      });
    }
    return recipients.length;
  } catch (err) {
    await capture(err);
    return 0;
  }
}

/** A comment stores only `relevantPostId` — find which collection the parent lives in. */
export async function findCommentParent(db: MentionDb, postId: string):
  Promise<{ collection: string; author: string | null; title: string } | null> {
  if (!ObjectId.isValid(postId)) return null;
  const _id = new ObjectId(postId);
  for (const collection of PARENT_COLLECTIONS) {
    const doc = await db.collection(collection).findOne({ _id }, { projection: { author: 1, title: 1 } });
    if (doc) return { collection, author: doc.author ? String(doc.author) : null, title: String(doc.title ?? '') };
  }
  return null;
}

/** Called by processReviewAction after a NON-rejection. Reads the LIVE doc (the flagged snapshot can be stale). Never throws. */
export async function notifyMentionsOnApproval(db: Db, flagged: { contentType: string; contentId?: string; authorId: string; source?: string }): Promise<void> {
  try {
    // A user REPORT is reviewed on content that was already public (and already
    // notified at publish time). The per-source check below would catch it too,
    // but only within the notifications' 90-day TTL — so skip it outright.
    if (flagged.source === 'user_report') return;
    if (!flagged.contentId || !ObjectId.isValid(flagged.contentId)) return;
    const _id = new ObjectId(flagged.contentId);
    const postCollection = POST_COLLECTION[flagged.contentType];
    if (postCollection) {
      const doc = await db.collection(postCollection).findOne({ _id }, { projection: { mentions: 1, title: 1 } });
      if (!doc?.mentions?.length) return;
      await notifyMentions(db, {
        actorId: flagged.authorId, mentions: doc.mentions, sourceId: flagged.contentId, kind: 'post',
        target: moderationTarget(flagged.contentType, flagged.contentId, String(doc.title ?? '')),
      });
      return;
    }
    if (flagged.contentType === 'comment') {
      const c = await db.collection('comments').findOne({ _id }, { projection: { mentions: 1, relevantPostId: 1 } });
      if (!c?.mentions?.length || !c.relevantPostId) return;
      const parent = await findCommentParent(db, String(c.relevantPostId));
      if (!parent) return;
      await notifyMentions(db, {
        actorId: flagged.authorId, mentions: c.mentions, sourceId: flagged.contentId, kind: 'comment',
        target: commentTarget(parent.collection, String(c.relevantPostId), parent.title),
        skipUserIds: parent.author ? [parent.author] : [],
      });
    }
  } catch (err) {
    await capture(err);
  }
}

/** Account deletion: the deleted member's „@handle" in others' texts becomes plain text again. */
export async function removeMentionsOf(db: MentionDb, userId: string): Promise<number> {
  let n = 0;
  for (const c of ['topics', 'announcements', 'recommendations', 'comments']) {
    const r = await db.collection(c).updateMany({ 'mentions.userId': userId }, { $pull: { mentions: { userId } } } as any);
    n += r.modifiedCount ?? 0;
  }
  return n;
}
```

Check the Sentry import spelling against `src/lib/notifications.ts` and copy it exactly.

- [ ] **Step 4: Run — expected PASS (3 tests)**. Then prove the split did its job: `npx tsx -e "import('./src/lib/mentions/mentionsResolve.ts').then(() => console.log('loads without env'))"` → prints the line.

- [ ] **Step 5: Notification type + copy**

`src/types/notification.ts`: `export type NotificationType = 'comment' | 'moderation' | 'official' | 'market_contact' | 'mention';` and in `NotificationMeta`:

```ts
/** mention only: the id of the post/comment that contains the mention (idempotency key;
 *  target.contentId is the PARENT page for comments, so it cannot serve). */
sourceId?: string;
```

`src/lib/push.ts`, new case before `default` (escape sequences for the German quotes, like the neighbours):

```ts
case 'mention':
  body = meta?.contentKind === 'comment'
    ? `Du wurdest in einem Kommentar erwähnt: ‚${t}‘`
    : `Du wurdest erwähnt: ‚${t}‘`;
  break;
```

`NotificationPanel.svelte`: GLYPH `mention: { g: '@', c: 'var(--k-ink)' },` and in `rowText`:

```ts
case 'mention': {
  const actor = it.actorName ?? $t['nc.tombstone'];
  return tStr($t[it.meta?.contentKind === 'comment' ? 'nc.mention.comment' : 'nc.mention.post'], { actor, title });
}
```

i18n PROPOSED — DE: `'nc.mention.post': '{actor} hat dich erwähnt: ‚{title}‘'`, `'nc.mention.comment': '{actor} hat dich in einem Kommentar erwähnt: ‚{title}‘'` · EN: `'{actor} mentioned you in ‘{title}’'`, `'{actor} mentioned you in a comment on ‘{title}’'`.

`src/types/index.ts`: `import type { MentionRef } from '../lib/mentions/mentions';` and `mentions?: MentionRef[];` on `Topic`, `Announcement`, `Recommendation`, `Comment`.

- [ ] **Step 6: Wire the three CREATE routes** (`topics`, `announcements`, `recommendations` — identical shape; do all three)

Before the `new…` object: `const mentions = await resolveMentions(db, body);`. In the object: `mentions,` after `images`. After the admin-alert block:

```ts
// Mentions notify only once the post is public; a pending post is picked up
// by notifyMentionsOnApproval() in reviewAction.ts.
if (!mergedResult) {
  await notifyMentions(db, {
    actorId: userId, mentions, sourceId: result.insertedId.toString(), kind: 'post',
    target: moderationTarget('topic', result.insertedId.toString(), title),
  });
}
```

(`'announcement'` / `'recommendation'` in the other two; import `moderationTarget` from `lib/notifications` and both helpers from `lib/mentions/mentionsStore`.) Check in each file that `db` is in scope at that point; if the route only holds a collection handle, get the db the way the file already does.

- [ ] **Step 7: Wire the three post EDIT routes**

All three routes already hold `const db = await connectDB();` and the id as `topicId` / `announcementId` / `recommendationId` (= `params.id`, typed `string | undefined` → wrap in `String(…)`).

`topics/edit/[id].ts`: `updateData.mentions = await resolveMentions(db, body);` next to the other fields; after the update, `if (newModerationStatus === 'approved') await notifyMentions(db, { actorId: userId, mentions: updateData.mentions, sourceId: String(topicId), kind: 'post', target: moderationTarget('topic', String(topicId), title) });`.

`announcements/edit/[id].ts` and `recommendations/edit/[id].ts` (no moderation there; the gate above guarantees `approved`): compute `const mentions = await resolveMentions(db, body);`, add `mentions,` to `$set`, and after the `!updateResult` check call `notifyMentions` with `'announcement'` / `'recommendation'` and the route's id variable.

- [ ] **Step 8: Wire comments**

`comments/create.ts`: `const mentions = await resolveMentions(db, body);` after `connectDB()`, `mentions,` in `newComment`. In the approved `else` branch, after the parent `notify` block:

```ts
await notifyMentions(db, {
  actorId: userId, mentions, sourceId: result.insertedId.toString(), kind: 'comment',
  target: commentTarget(parentCollection, topicId, parentDoc?.title ?? ''),
  skipUserIds: parentDoc?.author ? [String(parentDoc.author)] : [],
});
```

`comments/edit/[commentId].ts`: `const mentions = await resolveMentions(db, body);` before the update, `mentions` in `$set`; after the `!updateResult` check:

```ts
if (newModerationStatus === 'approved' && mentions.length > 0 && existingComment.relevantPostId) {
  const parent = await findCommentParent(db, String(existingComment.relevantPostId));
  if (parent) {
    await notifyMentions(db, {
      actorId: userId, mentions, sourceId: commentId, kind: 'comment',
      target: commentTarget(parent.collection, String(existingComment.relevantPostId), parent.title),
      skipUserIds: parent.author ? [parent.author] : [],
    });
  }
}
```

- [ ] **Step 9: Approval hook** — `src/lib/reviewAction.ts`, directly after the block that updates the original content (after the comment-parent handling, before the strike logic), one call:

```ts
// Mentions were held back while the item was pending (create/edit notify only
// when public). Idempotent, never throws.
if (!isRejection) {
  await notifyMentionsOnApproval(db, flaggedContent);
}
```

- [ ] **Step 10: Account deletion** — `src/lib/auth/accountDeletion.ts`, new step right after the `postDrafts` step, same try/`fail()` shape:

```ts
try {
  steps.mentions = await removeMentionsOf(db, userId);
} catch (err) {
  fail('mentions', err);
}
```

Read how `steps` is typed there and add the key the way `postDrafts` was added.

- [ ] **Step 11: End-to-end on the DEV db** — `scratchpad/e2e-mentions.mts`, login helper and cleanup copied from `scratchpad/e2e-post-drafts.mts`; two dev members A (author) and B (mentioned), both with handles. Assertions (each prints PASS/FAIL, exit 1 on any FAIL):
1. A creates a topic with `@<B>` → stored `mentions` = `[{ handle, userId: B }]`; B has exactly 1 `mention` notification with `meta.sourceId` = topic id, `meta.contentKind` = `post`.
2. A edits the topic, same mention → still 1 notification.
3. A comments on OWN topic with `@<B>` → B gets a second `mention` (kind `comment`), its `target.href` is the topic page.
4. A comments on B's topic with `@<B>` → B gets the `comment` notification and NO `mention` for that comment id.
5. `@<A>` by A (self) → none. `@niemand_hier` → `mentions` empty.
6. `GET /api/notifications` as B → items of type `mention` carry `actorName` = A's name.
7. Cleanup deletes the created topics, comments and notifications.

The pending→approved path is checked by hand on dev: post a text that the blocklist flags (as a NON-admin dev member) containing `@<B>`, confirm B has no notification, approve it in `/admin/moderation`, confirm B now has one.

- [ ] **Step 12: Gates, then commit**

```bash
git add src/lib/mentions/mentionsResolve.ts src/lib/mentions/mentionsResolve.test.ts src/lib/mentions/mentionsStore.ts src/types/notification.ts src/types/index.ts src/lib/push.ts src/components/forum/kiosk/NotificationPanel.svelte src/lib/kiosk-i18n.ts src/pages/api/topics src/pages/api/announcements src/pages/api/recommendations src/pages/api/comments src/lib/reviewAction.ts src/lib/auth/accountDeletion.ts
git commit -m "mentions: resolved on save, stored by id, notified once when public"
```

---

### Task 8: Mentions — links in post bodies and comments

**Files:**
- Modify: `src/components/forum/kiosk/ForumPostDetail.svelte`, `src/components/forum/kiosk/ForumComment.svelte`

- [ ] **Step 1: Post detail** — both paragraph loops: `linkifySegments(para, topic.mentions ?? [])`, and in the `{#if seg.type === 'link'} … {:else}` chain add a branch before `{:else}`:

```svelte
{:else if seg.type === 'mention'}<a href={`/nachbarn/id/${seg.userId}`} class="font-semibold text-wine hover:underline underline-offset-2">@{seg.value}</a>
```

Keep the loop on ONE line as it is today (`whitespace-pre-line` would otherwise render the template's line breaks).

- [ ] **Step 2: Comment** — `comment` prop type gets `mentions?: { handle: string; userId: string }[];`; the loop becomes `linkifySegments(body, comment.mentions ?? [])` with the same `mention` branch.

Note: a translated body (`translation?.body`) runs through the same loop; if DeepL altered a handle it simply stays plain text.

- [ ] **Step 3: Verify in the browser** (dev, 390 + 1280): mention is a wine link, opens B's public profile; `@niemand` stays plain; an e-mail address in a comment is untouched; after editing a comment to add a mention the link appears without reload. Feed card excerpt shows `@petra2` as plain text. Screenshot. Gates.

- [ ] **Step 4: Commit**

```bash
git add src/components/forum/kiosk/ForumPostDetail.svelte src/components/forum/kiosk/ForumComment.svelte
git commit -m "mentions: links in post bodies and comments"
```

---

### Task 9: Autocomplete after „@"

**Files:**
- Create: `src/pages/api/users/mention-search.ts`, `src/components/forum/kiosk/compose/MentionPopup.svelte`
- Modify: `src/components/forum/kiosk/compose/ComposeForm.svelte`, `CommentComposer.svelte`, `CommentComposerMobile.svelte`, `src/components/forum/kiosk/ForumComment.svelte` (edit box), `src/lib/kiosk-i18n.ts`

**Interfaces:**
- Consumes: `activeMentionQuery`, `applyMention` (Task 6).
- Produces: `GET /api/users/mention-search?q=<1–20 chars>` → `200 { users: [{ id, name, handle, image }] }` (max 6), `400 bad_query`, `401`, `429 throttled`; component props `{ textarea: HTMLTextAreaElement | null; onPick: (next: string) => void; placement?: 'below' | 'above' }`.

- [ ] **Step 1: Search route** — `src/pages/api/users/mention-search.ts`

```ts
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../lib/mongodb';
import { consumeRateLimit } from '../../../lib/auth/rateLimit';

// Autocomplete for „@". Members only (middleware gates /api/users too; the
// session is needed here for the rate limit and to leave the caller out).
// ALLOWLIST projection; tombstoned accounts and members without a handle never
// appear. The query is escaped before it becomes a regex.

const LIMIT_PER_HOUR = 600; // one request per typing pause
const MAX_HITS = 6;
const Q_RE = /^[\p{L}\p{N}_ .'-]{1,20}$/u;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request);
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);

  const q = (url.searchParams.get('q') ?? '').trim();
  if (!Q_RE.test(q)) return json({ error: 'bad_query' }, 400);

  const cap = await consumeRateLimit(`mentionsearch:${session.user.id}`, LIMIT_PER_HOUR, 60 * 60 * 1000);
  if (cap.limited) return json({ error: 'throttled' }, 429);

  const esc = escapeRe(q);
  const self = ObjectId.isValid(session.user.id) ? new ObjectId(session.user.id) : null;
  const db = await connectDB();
  const docs = await db.collection('users')
    .find(
      {
        anonymized: { $ne: true },
        handle: { $type: 'string' },
        ...(self ? { _id: { $ne: self } } : {}),
        $or: [
          { handle: { $regex: `^${escapeRe(q.toLowerCase())}` } },
          { name: { $regex: `(^|\\s)${esc}`, $options: 'i' } },
        ],
      },
      { projection: { name: 1, handle: 1, image: 1, userPicture: 1 } },
    )
    .sort({ handle: 1 })
    .limit(MAX_HITS)
    .toArray();

  return json({
    users: docs.map((u) => ({
      id: String(u._id),
      name: typeof u.name === 'string' ? u.name : '',
      handle: String(u.handle),
      image: u.image || u.userPicture || null,
    })),
  }, 200);
};
```

Check with curl on dev (logged-in cookie): `q=pe` → hits; `q=.*` → `bad_query`… note `.` alone is allowed by `Q_RE` and is escaped — confirm `q=.` returns no regex error and no „everything" result; logged out → 401.

- [ ] **Step 2: The popup** — `src/components/forum/kiosk/compose/MentionPopup.svelte` (NO `<style>` block — reachable only through other islands)

```svelte
<script lang="ts">
  import { tick } from 'svelte';
  import KioskAvatar from '../KioskAvatar.svelte';
  import { activeMentionQuery, applyMention } from '../../../../lib/mentions/mentions';

  type Hit = { id: string; name: string; handle: string; image: string | null };

  let { textarea, onPick, placement = 'below' }: {
    textarea: HTMLTextAreaElement | null;
    onPick: (next: string) => void;
    placement?: 'below' | 'above';
  } = $props();

  let items = $state<Hit[]>([]);
  let open = $state(false);
  let active = $state(0);
  let token: { start: number; query: string } | null = null;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function close() { open = false; items = []; seq++; clearTimeout(timer); }
  // Belt and braces for browsers that blur anyway: the click on a row must win.
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  function closeSoon() { clearTimeout(blurTimer); blurTimer = setTimeout(close, 200); }

  function refresh() {
    if (!textarea) return;
    token = activeMentionQuery(textarea.value, textarea.selectionStart ?? 0);
    if (!token || token.query.length < 1) { close(); return; }
    const q = token.query;
    const my = ++seq;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/mention-search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
        if (my !== seq) return; // a newer keystroke won
        if (!res.ok) { close(); return; }
        const data = await res.json();
        items = Array.isArray(data.users) ? data.users : [];
        active = 0;
        open = items.length > 0;
      } catch { close(); }
    }, 180);
  }

  async function pick(hit: Hit) {
    if (!textarea || !token) return;
    const r = applyMention(textarea.value, token.start, textarea.selectionStart ?? 0, hit.handle);
    onPick(r.value);
    clearTimeout(blurTimer);
    close();
    await tick();
    textarea.focus();
    textarea.setSelectionRange(r.caret, r.caret);
  }

  // Registered directly on the textarea: Svelte delegates `onkeydown` to the
  // root, so stopping propagation HERE keeps Enter/Escape away from the host's
  // own handlers (Cmd-Enter submit, the comment edit box's window-level Escape).
  function onKeydown(e: KeyboardEvent) {
    if (!open) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    if (e.key === 'ArrowDown') { stop(); active = (active + 1) % items.length; }
    else if (e.key === 'ArrowUp') { stop(); active = (active - 1 + items.length) % items.length; }
    else if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') { stop(); pick(items[active]); }
    else if (e.key === 'Escape') { stop(); close(); }
  }

  $effect(() => {
    const el = textarea;
    if (!el) return;
    el.addEventListener('input', refresh);
    el.addEventListener('click', refresh);
    el.addEventListener('keydown', onKeydown, true);
    el.addEventListener('blur', closeSoon);
    return () => {
      el.removeEventListener('input', refresh);
      el.removeEventListener('click', refresh);
      el.removeEventListener('keydown', onKeydown, true);
      el.removeEventListener('blur', closeSoon);
      clearTimeout(timer);
      clearTimeout(blurTimer);
    };
  });
</script>

{#if open}
  <ul
    role="listbox"
    data-mention-popup
    class={`absolute left-0 right-0 z-40 ${placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'} max-h-60 overflow-y-auto bg-paper-warm border-[1.5px] border-ink rounded-md shadow-[3px_3px_0_var(--k-ink)]`}
  >
    {#each items as hit, i (hit.id)}
      <li role="option" aria-selected={i === active}>
        <!-- mousedown (NOT pointerdown) is cancelled so the textarea keeps focus: focus moves on
             mousedown, also for the mouse events a touch synthesises. -->
        <button
          type="button"
          onmousedown={(e) => e.preventDefault()}
          onclick={() => pick(hit)}
          class={`w-full min-h-[44px] flex items-center gap-2 px-3 py-1.5 text-left ${i === active ? 'bg-paper-soft' : ''}`}
        >
          <KioskAvatar name={hit.name} image={hit.image} size="sm" />
          <span class="min-w-0 flex-1 truncate font-bricolage text-[13px] font-bold text-ink">{hit.name}</span>
          <span class="shrink-0 font-dmmono text-[10px] text-ink-mute">@{hit.handle}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
```

Svelte 5 trap (documented in the forum area file): the `$effect` reads ONLY `textarea`; `refresh`/`onKeydown` run at event time, so they add no dependencies. Do not call `refresh()` inside the effect.

- [ ] **Step 3: Attach it to the four textareas.** Each host: the textarea's direct wrapper becomes `relative`, the textarea gets `bind:this`, the popup sits right after it.

`ComposeForm.svelte`: `let bodyEl = $state<HTMLTextAreaElement | null>(null);` · wrap the `<textarea>` in `<div class="relative">…</div>` · `bind:this={bodyEl}` · `<MentionPopup textarea={bodyEl} onPick={(v) => (body = v)} />`.

`CommentComposer.svelte`: the existing `<div class="flex-1 min-w-0">` gets `relative`; `let taEl = $state<HTMLTextAreaElement | null>(null);` · `bind:this={taEl}` · `<MentionPopup textarea={taEl} onPick={(v) => (body = v)} />`.

`CommentComposerMobile.svelte` (fixed bar above the bottom nav → opens UPWARD): reuse the existing `textareaEl`; make the textarea's parent `relative` and add `<MentionPopup textarea={textareaEl} onPick={(v) => (body = v)} placement="above" />`. Check the parent is not `overflow-hidden`; if it is, move the popup one level up to the bar's root (which must then be `relative`).

`ForumComment.svelte` edit box: `let editEl = $state<HTMLTextAreaElement | null>(null);` · wrap in `<div class="relative">` · `bind:this={editEl}` · `<MentionPopup textarea={editEl} onPick={(v) => (draft = v)} />`.

- [ ] **Step 4: The tip line stops lying** — `compose.body.tip` has promised mentions since the prototype. PROPOSED: DE `'tipp · @ und ein Name erwähnt jemanden im Kiez'` · EN `'tip · @ and a name mentions someone in the kiez'`.

- [ ] **Step 5: Probe** — `scratchpad/mention-autocomplete-probe.cjs` (Playwright, dev :4655, redirect-bounce login, widths 390 + 1280, run under `timeout 180`, output to a file). Checks:
1. Compose body: type `Hallo @` + first two letters of B's handle → `[data-mention-popup]` visible with B; ArrowDown/Enter inserts `@<handle> ` and the caret sits after the space; popup closed.
2. Escape closes the popup and the compose page is still there (no navigation, text kept).
3. Desktop comment composer: pick by CLICK → inserted, textarea still focused.
4. 390 px mobile composer: popup's bottom edge is ABOVE the textarea's top edge, fully inside the viewport.
5. Comment edit box: open popup, press Escape → popup closes, edit mode STILL open; second Escape cancels the edit.
6. Cmd/Ctrl-Enter with the popup closed still submits a comment.
7. `mail@pe` opens no popup.
8. Page has no horizontal scroll at 390 px with the popup open.

- [ ] **Step 6: Prod-build check for the nested island** — `pnpm build`, then confirm the popup needs no orphaned stylesheet: `grep -c "data-mention-popup" -r .vercel/output/static/_astro/*.js` ≥ 1 and the component has no `<style>`. Gates.

- [ ] **Step 7: Commit**

```bash
git add src/pages/api/users/mention-search.ts src/components/forum/kiosk/compose/MentionPopup.svelte src/components/forum/kiosk/compose/ComposeForm.svelte src/components/forum/kiosk/compose/CommentComposer.svelte src/components/forum/kiosk/compose/CommentComposerMobile.svelte src/components/forum/kiosk/ForumComment.svelte src/lib/kiosk-i18n.ts
git commit -m "mentions: autocomplete after @ in the post composer and all comment inputs"
```

---

### Task 10: Docs, handle backfill hand-over, final verification

**Files:**
- Modify: root `CLAUDE.md` (users bullet: `handleChosen`, one name rule, protected names; notifications bullet: type `mention`, `meta.sourceId`; `rateLimits` bullet: `mention:<userId>` 20/h, `mentionsearch:<userId>` 600/h; „Server-only modules" section: pointer to `publicAuthor.ts`), `src/components/forum/kiosk/CLAUDE.md` (new section „Mentions": resolve-on-save, stored by id, idempotent notify, approval hook, the four textareas, no-lookbehind rule, test commands, probes), `src/components/auth/kiosk/CLAUDE.md` (handle choice, error codes), `src/components/profile/kiosk/CLAUDE.md` (name rule moved to `nameRules.ts`), `src/pages/datenschutz.astro` ONLY if the user wants a sentence about mentions (ask; do not write legal copy unasked).

- [ ] **Step 1: Members without a handle cannot be mentioned.** Hand the user the existing script: `pnpm tsx scripts/backfill-user-handles.ts` — read it first and report whether it has a dry-run default and a prod switch; if it lacks a dry-run default, add one (dry-run default, `--apply` to write, refuses a non-dev db without `--prod`) in this task. The PROD run is the user's.
- [ ] **Step 2: Prod read-only audit** — `scratchpad/audit-names-handles.mts --prod` (reads only): report counts — names failing the new rule, members without handle, identical-name groups.
- [ ] **Step 3: All unit tests** — `npx tsx --test src/lib/publicAuthor.test.ts src/lib/profile/nameRules.test.ts src/lib/profile/handle.test.ts src/lib/mentions/mentions.test.ts src/lib/mentions/mentionsResolve.test.ts src/lib/linkify.test.ts src/lib/forum/movePost.test.ts` → all green. Re-run `scratchpad/e2e-mentions.mts` and the autocomplete probe. Regression probes that touch the same files: `scratchpad/compose-kind-probe.cjs`, `scratchpad/forum-drafts-probe.cjs`, `scratchpad/photo-preview-and-errors-probe.cjs`.
- [ ] **Step 4: Gates** (26 / 92 / build), then commit docs:

```bash
git add CLAUDE.md src/components/forum/kiosk/CLAUDE.md src/components/auth/kiosk/CLAUDE.md src/components/profile/kiosk/CLAUDE.md
git commit -m "docs: names, handle choice, mentions"
```

- [ ] **Step 5: Final report to the user** — what is verified and what is NOT (prod: nothing that writes was tested; web push text not seen on a device), the list of new i18n keys for his wording, the open decisions below.

## Observed during the audit — NOT part of this plan (no go)

- `comments/edit/[commentId].ts`: an edit that the AI flags sets the comment to `pending` and alerts the admin, but writes NO `flaggedContent` record — such a comment never appears in the review queue (topics/edit does write one). Consequence here: the approval hook can never fire for it.
- `src/schemas/auth.schema.ts` `RegisterSchema` still describes a „Username" of 3–30 `[a-zA-Z0-9_-]`; nothing uses it (the register route validates by hand). Stale, misleading.
- `ensureHandle()` and `scripts/backfill-user-handles.ts` do not skip reserved words (a legacy member named „Forum" would get `@forum`). Only matters for accounts that still lack a handle.
- A signup attempt with a chosen handle tells an outsider whether that handle exists (409). Bounded by the signup limits (40/h per IP, 3/h per e-mail); accepted.

## Open decisions for the user (none blocks Task 1)

1. **Delete the three unused `/all` routes** (Task 1) — **DECIDED 09-21 18:35: „delete 'em".** Was: planned as deletion; alternative: keep them and only fix the join + add the moderation filter.
2. **Two-character names** stay allowed (signup has always allowed them); the profile hint changes from „3–30" to „2–30".
3. **Privacy page**: one sentence about mentions/notifications — yes or no, and his wording.
4. **Member discoverability**: the autocomplete lets any logged-in member find every member with a handle by typing a prefix (name, handle, avatar — nothing else), including members who never posted. Today a silent member is invisible. **DECIDED 09-21 18:32 („all, including members who never posted"): every member with a handle is findable.**
5. **Approved WITH a warning label** still notifies the mentioned members (the content is public, behind the blur). **DECIDED 09-21 18:32: yes.**
6. **Deploy timing**: Task 1 is a privacy fix and can ship alone today; the rest is a feature — before or after the stand on Sat 26 Sept?
