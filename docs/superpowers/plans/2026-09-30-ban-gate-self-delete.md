# Ban-gate the self-delete routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A banned member can no longer delete their own public content — the six self-delete routes (topics, announcements, recommendations, events, comments, listings) go through the existing `requireMemberSession()` helper, so a ban means read-only, deletes included.

**Architecture:** No new logic. Each of the six routes replaces its hand-written `getSession` → 401 block with the three-line `requireMemberSession()` prelude that the 22 create/edit routes already use (session → 401 with the identical legacy body, then a LIVE `rejectIfBanned` → 403 `account_banned`). Check ORDER inside each route stays as it is today (id validation before or after the session, exactly where it sits now); the only behaviour change is the inserted ban check, plus the helper's existing tightening (a session without `user.id` → 401 instead of a crash/`undefined` author compare).

**Tech Stack:** Astro 5 `APIRoute`, `requireMemberSession(request): Promise<MemberGate>` from `src/lib/auth.ts` (core `gateMember()` in `src/lib/auth/memberGate.ts`, already tested), `rejectIfBanned` in `src/lib/auth/banGuard.ts`, Playwright (global `@playwright/cli` bundle) + `tsx` for the smoke.

**Spec:** No separate spec. Policy decision by the user on 2026-09-30 („lets do the #1"): the note „a banned member can still delete their own content" becomes a defect. This REVERSES the launch-time decision recorded in `src/components/auth/kiosk/CLAUDE.md` („Deliberately NOT guarded: deletes (own-content removal) …") — that sentence is rewritten in Task 3.

**Scope rulings (recorded here so nobody widens the batch):**
- IN: `topics/delete/[id]`, `announcements/delete/[id]`, `recommendations/delete/[id]`, `events/delete/[id]`, `comments/delete/[commentId]`, `listings/delete/[id]` — the six routes that remove PUBLIC content.
- OUT, unchanged: `posts/drafts/[id]` DELETE (its comment says „Deliberately NOT ban-guarded: a banned member may still clean up their drafts" — forum drafts are private), `listings/[id]/save` (a bookmark toggle, read-side like `events/save`, `news/save`, `posts/save`), `listings/my-listings` (a GET). Known asymmetry accepted: a banned member can delete a forum draft (`postDrafts`) but not a listing draft, because listing drafts are deleted through `listings/delete/[id]` — cost if wrong: one `status !== 'draft'` condition around a hand-written ban check in that route, later.
- OUT: client copy. `ForumPostDetail.svelte` and `forumMutations.ts` surface `err.error` verbatim, so a banned member who somehow reaches a delete button sees the string `account_banned`; the other four callers show their generic „Löschen fehlgeschlagen" toast. Acceptable: banned members already see the app-wide non-dismissible danger banner (`mahalle-ban-checked-ok` check) and cannot log in again. Not in this plan.

## Global Constraints

- The 401 body stays byte-identical: `{"error":"Unauthorized - Please login"}`, status 401, `Content-Type: application/json` (the helper produces exactly this).
- The 403 body is the banGuard's: `{ error: 'account_banned', message: 'Dein Konto ist gesperrt. Du kannst mitlesen, aber nichts mehr posten.' }`, status 403.
- Check ORDER per route stays as today: five routes validate the path id BEFORE the session (`announcements`, `events`, `recommendations`, `topics`: `ObjectId.isValid` → 400 `Invalid … ID`; `comments`: `!commentId` → 400), `listings` checks the session FIRST and the id after. The helper call goes exactly where the old `getSession` call was.
- Nothing else in the six files changes: ownership compare, cascade, `flaggedContent.contentDeleted` stamping, listing `canMutateListing`, Cloudinary cleanup, response bodies — all untouched.
- `session` is not used below the prelude in any of the six routes (verified by grep on `95c8175c`) — destructure `{ userId }` only; do not bind an unused `session`.
- Imports: delete the `import { getSession } from 'auth-astro/server';` line, add `import { requireMemberSession } from '<rel>/lib/auth';` in its place (`src/lib/auth.ts` is SERVER-ONLY, which these routes are).
- Gates: `pnpm type-check` must stay at 16 errors (CI budget `tsc ≤16`); no `.svelte` file changes, so svelte-check stays 81 — do not run it.
- Commit messages plain and concise, NO „Generated with Claude Code" line, NO `Co-Authored-By` trailer (user rule). Never push from a subagent; the USER merges.
- Never print any `.env` value; the dev password lives in `scratchpad/devpw.txt` and is read by the smoke script only — never echoed, never snapshotted.
- The ban-flip script (Task 4) writes to the DEV database only: it must refuse any database name that does not contain `dev` (same interlock as `scripts/seed-dev-db.ts`).

## Review Focus

1. **Banned member, valid id of someone else's content** → 403 `account_banned`, not 403 `not the author` and not 404 — the ban check runs before the lookup in all six routes (Task 4 probe 4 pins it with a nonexistent valid id on `topics/delete`, probe 5 on `comments/delete`).
2. **Banned member, own listing draft** → 403 (Task 4 probe 3) — and after un-ban the same DELETE → 200 (probe 7), proving the gate is live-read, not cached in the session.
3. **Logged-out DELETE** → still 401 `{ error: 'Unauthorized' }` from the middleware on the six gated prefixes, the route's own 401 unreachable from outside (probe 8; the route body is pinned by the helper's unit tests).
4. **Malformed id on the id-first routes** (`/api/topics/delete/not-an-id`, logged in) → still 400 `Invalid topic ID`, i.e. the gate did NOT move ahead of the id check (probe 6).
5. **Session without `user.id`** → 401 (helper behaviour, pinned by `src/lib/auth/memberGate.test.ts` case 3; before this plan the five id-first routes would have compared the author against `undefined` and answered 403 `not the author`). No new test — existing test covers it.

---

### Task 1: Gate the five forum + calendar delete routes

**Files (modify only; line numbers as of main `95c8175c`):**

| # | File | `getSession` import | Session block to replace | `const userId` line |
|---|---|---|---|---|
| 1 | `src/pages/api/announcements/delete/[id].ts` | 2 | 18–26 | 28 |
| 2 | `src/pages/api/events/delete/[id].ts` | 2 | 18–26 | 28 |
| 3 | `src/pages/api/recommendations/delete/[id].ts` | 2 | 18–26 | 28 |
| 4 | `src/pages/api/topics/delete/[id].ts` | 2 | 19–27 | 29 |
| 5 | `src/pages/api/comments/delete/[commentId].ts` | 2 | 26–34 | 36 |

Relative import path for all five: `'../../../../lib/auth'`.

**Interfaces:**
- Consumes: `requireMemberSession(request: Request): Promise<MemberGate>` from `src/lib/auth.ts`; `MemberGate = { ok: true; userId: string; session: Session } | { ok: false; response: Response }`.
- Produces: nothing new — the six routes keep their exported `DELETE` handlers and response contracts.

- [ ] **Step 1: Pre-flight grep per file (stop-and-report rule)**

For each of the five files run:

```bash
grep -n "getSession\|session\b\|userId" 'src/pages/api/announcements/delete/[id].ts'
```

Expected in every file: `getSession` appears exactly twice (import + call), `session` appears only inside the block in the table (the `if (!session?.user)` test and `const userId = session.user.id;`), `userId` appears in the author compare below. If `session` is referenced anywhere BELOW the `const userId` line in a file, STOP and report — do not improvise.

- [ ] **Step 2: Replace the session block (identical shape in all five)**

The block today (files 1–4 at 18–28, file 5 at 26–36; the comment line and the blank line belong to it):

```ts
    // Get session from NextAuth
    const session = await getSession(request);

    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized - Please login' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const userId = session.user.id;
```

becomes, in the same place (the id check above it stays above it):

```ts
    // Session + LIVE ban check (401 / 403 pre-shaped) — a banned member
    // may read but not remove their content either. See requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { userId } = gate;
```

- [ ] **Step 3: Fix the import in each file**

Line 2 `import { getSession } from 'auth-astro/server';` becomes `import { requireMemberSession } from '../../../../lib/auth';`.

- [ ] **Step 4: Verify the diff shape**

```bash
git diff --stat
grep -rn "getSession" src/pages/api/announcements/delete src/pages/api/events/delete src/pages/api/recommendations/delete src/pages/api/topics/delete src/pages/api/comments/delete
```

Expected: five files, each `+5 −11` give or take the comment line; the grep prints nothing.

- [ ] **Step 5: Type-check**

```bash
pnpm type-check 2>&1 | grep -c "error TS"
```

Expected: `16` (unchanged budget).

- [ ] **Step 6: Commit**

```bash
git add 'src/pages/api/announcements/delete/[id].ts' 'src/pages/api/events/delete/[id].ts' 'src/pages/api/recommendations/delete/[id].ts' 'src/pages/api/topics/delete/[id].ts' 'src/pages/api/comments/delete/[commentId].ts'
git commit -m "api: ban-gate the forum, calendar and comment self-delete routes via requireMemberSession()"
```

---

### Task 2: Gate the listing delete route (session-first shape)

**Files (modify only; line numbers as of main `95c8175c`):**
- Modify: `src/pages/api/listings/delete/[id].ts` — import line 2, session block 11–18, `const userId` line 29.

**Interfaces:**
- Consumes: `requireMemberSession(request)` as in Task 1.
- Produces: nothing new.

- [ ] **Step 1: Pre-flight grep**

```bash
grep -n "getSession\|session\b\|userId" 'src/pages/api/listings/delete/[id].ts'
```

Expected: `getSession` twice (lines 2, 11), `session` only at 11–13 and 29, `userId` at 29 and in the `canMutateListing(existingListing as any, userId, …)` call at 48. Anything else → STOP and report.

- [ ] **Step 2: Replace the session block — this route checks the session BEFORE the id, keep that order**

Lines 11–18 today:

```ts
    const session = await getSession(request);

    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized - Please login' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
```

become:

```ts
    // Session + LIVE ban check (401 / 403 pre-shaped) — a banned member
    // may read but not remove their content either. See requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { userId } = gate;
```

Then DELETE the now-duplicate line 29 `const userId = session.user.id;` (it sits after the id check; the blank line around it may go too). The id check block (`if (!id || !isValidObjectId(id))`) stays between the gate and the DB code, exactly where it is.

- [ ] **Step 3: Fix the import**

Line 2 `import { getSession } from 'auth-astro/server';` becomes `import { requireMemberSession } from '../../../../lib/auth';`.

- [ ] **Step 4: Verify the diff shape**

```bash
git diff 'src/pages/api/listings/delete/[id].ts' | grep -c "^[-+][^-+]"
grep -n "getSession\|session\." 'src/pages/api/listings/delete/[id].ts'
```

Expected: about 16 changed lines; the grep prints nothing.

- [ ] **Step 5: Type-check**

```bash
pnpm type-check 2>&1 | grep -c "error TS"
```

Expected: `16`.

- [ ] **Step 6: Commit**

```bash
git add 'src/pages/api/listings/delete/[id].ts'
git commit -m "api: ban-gate the listing self-delete route via requireMemberSession()"
```

---

### Task 3: Docs (orchestrator or a cheap implementer — three files, exact edits)

**Files:**
- Modify: `CLAUDE.md` (root) lines 86, 100, 146.
- Modify: `src/components/auth/kiosk/CLAUDE.md` lines 196–208 (the „Writes" bullet).
- Modify: `src/lib/auth/banGuard.ts` usage comment (lines 22–24) — one word.

**Interfaces:** none.

- [ ] **Step 1: Root `CLAUDE.md` line 86 (Member gate helper bullet)**

Replace `Used by the 22 member write routes — see „API Routes" below.` with `Used by the 28 member write routes (22 create/edit/… since 2026-09-30, the 6 self-delete routes since 2026-10-01 — a ban is read-only, deletes included) — see „API Routes" below.`

- [ ] **Step 2: Root `CLAUDE.md` line 100 (API Routes intro)**

Replace `(create/edit/upload/draft/submit/report/move, 22 files since 2026-09-30)` with `(create/edit/upload/draft/submit/report/move, 22 files since 2026-09-30; plus the 6 self-delete routes since 2026-10-01)`.

- [ ] **Step 3: Root `CLAUDE.md` line 146 (Strike system bullet)**

Replace `and on all content-write APIs (403 \`account_banned\` via \`src/lib/auth/banGuard.ts\`); banned users keep read access` with `and on all content-write APIs INCLUDING own-content deletes since 2026-10-01 (403 \`account_banned\` via \`src/lib/auth/banGuard.ts\`; before that a banned member could still delete their posts, comments, events and listings — user decision 09-30 to close it); banned users keep read access, bookmarks and forum-draft cleanup`.

- [ ] **Step 4: Auth area file `src/components/auth/kiosk/CLAUDE.md`, the „Writes" bullet**

Replace the sentence `NOT ban-gated (user-noted 09-30, policy open): the self-delete routes, \`listings/[id]/save\`, \`my-listings\` — a banned member can still delete their own content.` with `Since 2026-10-01 the six self-delete routes (topics/announcements/recommendations/events/comments/listings) go through the same helper — a ban is read-only, deletes included (user decision 09-30, reversing the launch rule below). Still NOT ban-gated on purpose: \`listings/[id]/save\` (a bookmark), \`my-listings\` (a GET), \`posts/drafts/[id]\` DELETE (private draft cleanup) — a banned member's LISTING draft, deleted through \`listings/delete/[id]\`, is the one asymmetry.`

Then in the sentence `Deliberately NOT guarded: deletes (own-content removal), bookmarks/saves, view counters, and the anonymous listing contact relay …` delete `deletes (own-content removal), ` so it reads `Deliberately NOT guarded: bookmarks/saves, view counters, and the anonymous listing contact relay …`.

- [ ] **Step 5: `src/lib/auth/banGuard.ts` comment**

In the doc comment above `rejectIfBanned`, `Write-endpoint guard.` becomes `Write- and delete-endpoint guard.`

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md src/components/auth/kiosk/CLAUDE.md src/lib/auth/banGuard.ts
git commit -m "docs: a ban is read-only, self-deletes included"
```

---

### Task 4: Build, preview smoke with a real mid-session ban (orchestrator task — needs `scratchpad/devpw.txt`, `.env` with the DEV `MONGODB_URI`, the Vercel CLI)

**Files:**
- Create: `scratchpad/ban-flip.mts` (gitignored) — flips `users.isBanned` for the dev account `ayse@mahalle-dev.test` on the DEV database only.
- Create: `scratchpad/ban-delete-smoke.cjs` (gitignored) — eight probes against the preview URL.

**Interfaces:**
- Consumes: the preview deployment of the branch; the shared `mahalle-dev` database (local scripts and Vercel Preview both use it, so a local flip is visible to the preview).
- Produces: the smoke report lines for the user.

- [ ] **Step 1: Build**

```bash
pnpm build 2>&1 | tail -3
```

Expected: `Complete!`, no error lines.

- [ ] **Step 2: Write the ban-flip script**

`scratchpad/ban-flip.mts`:

```ts
// npx tsx scratchpad/ban-flip.mts on|off   — DEV database only (name must contain "dev")
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const mode = process.argv[2];
if (mode !== 'on' && mode !== 'off') { console.error('usage: ban-flip.mts on|off'); process.exit(2); }
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI missing'); process.exit(2); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db();
if (!/dev/i.test(db.databaseName)) { console.error(`refusing: database name must contain "dev"`); await client.close(); process.exit(2); }
const r = await db.collection('users').updateOne(
  { email: 'ayse@mahalle-dev.test' },
  mode === 'on' ? { $set: { isBanned: true } } : { $unset: { isBanned: '' } }
);
console.log(`ban ${mode}: matched ${r.matchedCount}, modified ${r.modifiedCount}`);
await client.close();
```

Dry check before use:

```bash
npx tsx scratchpad/ban-flip.mts off
```

Expected: `ban off: matched 1, modified 0` (the account is not banned today). Never print the URI.

- [ ] **Step 3: Write the smoke script**

`scratchpad/ban-delete-smoke.cjs` (run: `NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/ban-delete-smoke.cjs <previewUrl>`):

```js
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const BASE = process.argv[2];
const PW = fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim();
const ZERO = '000000000000000000000000';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} — ${detail}`); };
const flip = (mode) => execSync(`npx tsx scratchpad/ban-flip.mts ${mode}`, { stdio: 'inherit' });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'ayse@mahalle-dev.test');
  await page.fill('input[type="password"]', PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
  const call = (method, path, body) => page.evaluate(async ([base, method, path, body]) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body });
    return { status: res.status, text: (await res.text()).slice(0, 160) };
  }, [BASE, method, path, body]);
  let draftId = null;
  try {
    // 1. a listing draft to delete later (a real write, needs no moderation)
    const draft = await call('POST', '/api/listings/draft', JSON.stringify({ title: 'Smoke-Entwurf ban-delete ' + Date.now() }));
    draftId = (() => { try { return JSON.parse(draft.text).draftId; } catch { return null; } })(); // draft.ts answers { draftId, message }
    check('1 logged-in listings/draft saves', (draft.status === 200 || draft.status === 201) && !!draftId, `status ${draft.status} id ${draftId}`);
    // 2. ban mid-session (the JWT stays valid — that is the whole point)
    flip('on');
    // 3. own listing draft → 403 account_banned
    let r = await call('DELETE', `/api/listings/delete/${draftId}`);
    check('3 banned: own listing delete is 403 account_banned', r.status === 403 && r.text.includes('"account_banned"'), `status ${r.status} ${r.text}`);
    // 4./5. ban before lookup: a nonexistent VALID id answers 403, not 404
    r = await call('DELETE', `/api/topics/delete/${ZERO}`);
    check('4 banned: topics/delete on a nonexistent id is 403 (ban before lookup)', r.status === 403 && r.text.includes('"account_banned"'), `status ${r.status} ${r.text}`);
    r = await call('DELETE', `/api/comments/delete/${ZERO}`);
    check('5 banned: comments/delete on a nonexistent id is 403', r.status === 403 && r.text.includes('"account_banned"'), `status ${r.status} ${r.text}`);
    // 6. id check still first on the id-first routes
    r = await call('DELETE', '/api/topics/delete/not-an-id');
    check('6 banned: topics/delete/not-an-id is still 400 (id before gate)', r.status === 400 && r.text.includes('Invalid topic ID'), `status ${r.status} ${r.text}`);
  } finally {
    flip('off');
  }
  // 7. un-banned: the same delete now passes (live read, nothing cached)
  const r7 = await call('DELETE', `/api/listings/delete/${draftId}`);
  check('7 un-banned: own listing delete is 200 (gate is live)', r7.status === 200, `status ${r7.status} ${r7.text}`);
  await browser.close();
  // 8. logged-out: the middleware still answers first on the gated prefix
  const r8 = await fetch(BASE + `/api/topics/delete/${ZERO}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
  check('8 logged-out topics/delete is 401 from the middleware', r8.status === 401 && (await r8.text()) === '{"error":"Unauthorized"}', `status ${r8.status}`);
  const fails = results.filter((x) => !x.ok).length;
  console.log(fails ? `FAILS: ${fails}` : 'ALL OK');
  process.exit(fails ? 1 : 0);
})();
```

`draftId` must be declared with `let` OUTSIDE the `try` (probe 7 reuses it after the `finally`); `src/pages/api/listings/draft.ts` answers `{ draftId, message }` on `95c8175c` (line 105). The `finally` guarantees the un-ban even if a probe throws.

- [ ] **Step 4: Push the branch, wait for the preview**

```bash
git push -u origin chore/ban-gate-self-delete
vercel ls 2>/dev/null | head -3
```

Then poll `vercel ls` every 30 s until the newest row says `● Ready` (never `vercel inspect | grep` loops); note the preview URL. If no build appears within two minutes, push an empty commit (`git commit --allow-empty -m "chore: trigger preview"`).

- [ ] **Step 5: Run the smoke**

```bash
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/ban-delete-smoke.cjs https://<preview-host>
```

Expected: eight `OK` lines and `ALL OK`. On any FAIL: confirm `npx tsx scratchpad/ban-flip.mts off` printed `matched 1` (the account must never stay banned), then read the failing route before touching anything — do not fix forward blind.

- [ ] **Step 6: Report to the user** — commit SHAs, tsc 16, build green, preview URL, the eight smoke lines, and the confirmation that `ayse@mahalle-dev.test` is un-banned. The USER merges (fast-forward) — never merge in this plan.
