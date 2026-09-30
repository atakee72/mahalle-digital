# requireMemberSession() Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the identical session-then-ban prelude that 22 member API routes copy by hand with one tested helper, `requireMemberSession(request)`, beside the existing `requireAdminSession(request)` — with byte-identical responses and unchanged check order in every route.

**Architecture:** A dependency-free core, `gateMember(session, rejectIfBanned)` in `src/lib/auth/memberGate.ts`, holds the decision logic and is unit-tested with `node:test`. `requireMemberSession()` in `src/lib/auth.ts` wires the real `getSession` (auth-astro) and `rejectIfBanned` (`src/lib/auth/banGuard.ts`) into it, exactly like `requireAdminSession()` sits there today. The 22 routes swap their 10–14-line prelude for three lines and keep everything else as it is.

**Tech Stack:** Astro 5 API routes (`APIRoute`), auth-astro `getSession`, `@auth/core/types` `Session` (augmented in `src/types/next-auth.d.ts` so `session.user.id` is a `string`), `node:test` via `npx tsx --test`.

**Spec:** No separate spec. This is phase 3 of the dead-code/duplication sweep recorded in root `CLAUDE.md` (the „Dead-code sweep" comment in *Development Commands*) — Fallow's `dupes` report flagged the prelude. The contract is fully stated in this plan (Global Constraints + Task 1).

## Global Constraints

- **Behaviour-neutral.** For every route: same HTTP status, same JSON body bytes, same `Content-Type: application/json` header, same ORDER of checks as before (two routes check the path id BEFORE the session — they keep doing so). The reviewer diffs each route against this rule.
- The 401 body of the helper is exactly `{"error":"Unauthorized - Please login"}` — the string all 22 routes use today. Routes with a different 401 text (`'Unauthorized'`, `'unauthorized'`) are OUT of scope and untouched (`likes/toggle`, `listings/[id]/bump`, `listings/[id]/status`, `profile/*`, `users/update`, `posts/drafts`).
- The ban 403 comes from the untouched `rejectIfBanned()` and is returned AS IS (same object).
- **The middleware runs first**: `src/middleware.ts` gates `/api/topics|announcements|recommendations|events|news|comments|listings|users|search` and answers `401 { error: 'Unauthorized' }` itself for session-less calls. The helper's 401 is therefore only reachable from outside on the ungated prefixes (`/api/posts/*`, `/api/reports/*`) — the smoke in Task 4 uses those; for the gated routes the helper is the second line of defence, exactly as the hand-written prelude was.
- Only `.ts` files change: `src/lib/auth.ts`, the new `src/lib/auth/memberGate.ts` + its test, the 22 routes, root `CLAUDE.md`. No `.svelte`/`.astro` files, no `package.json`, no `pnpm install`.
- Gates: `pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'` must stay **≤ 16** (the CI budget; it is 16 on main today). `pnpm build` green at the end.
- Commit messages: plain, one line, **no trailer of any kind** (no `Co-Authored-By`, no „Generated with"), even if the harness suggests one. Do NOT push — the orchestrator pushes.
- Worktree: a branch `chore/require-member-session` off `main` in the MAIN checkout (`/home/atakee/projects/fullstack-community-webApp-astro---v.3`), dev port 4655 if a dev server is ever needed (it is not for this plan).
- Tests run by path with `npx tsx --test <file>` (no test script, no glob runner); the new test file is the only one this plan adds or touches.

## Review Focus

1. **Path-id check before the session check** (`events/[id]/like.ts`, `events/[id]/rsvp.ts`): the id check stays above the helper call. It cannot be smoked from outside — `src/middleware.ts` answers `401 { error: 'Unauthorized' }` for every session-less `/api/events/*` request before the route runs — so it is pinned ONLY by the reviewer's diff check in Task 2 (step 5 lists the two files) and by the logged-in probe #5 in Task 4 (400 for a bad id).
2. **A session whose `user` has no `id`** (cannot happen with our `jwt`/`session` callbacks, which always set it, but the helper must be safe): the helper answers 401 and never calls `rejectIfBanned`. Before, such a session slipped past `!session?.user` and reached the handler with `userId === undefined`. This is the ONE deliberate tightening; it is pinned by the Task 1 unit test and noted in the CLAUDE.md line Task 4 writes.
3. **Admin exemptions read `session.user.role` AFTER the gate** (daily-limit and moderation skips in every create/edit route): the `session` the helper returns must be the very object `getSession` produced — pinned by the Task 1 identity assertion; Task 2/3 keep the routes' `session.user.role` reads untouched.
4. **The ban response passes through unchanged** (403, `error: 'account_banned'`, German message): pinned by the Task 1 test that asserts the returned `response` is the SAME object the stub produced.
5. **No route loses a second handler's session call**: all 22 files have exactly one exported handler and exactly one `getSession(` + one `rejectIfBanned(` call (verified 2026-09-30 by grep), so both imports can be dropped. The implementer re-runs that grep per file before editing (step in Task 2/3); if a file shows more than one, stop and report.

---

### Task 1: The helper — pure core + wiring + unit test

**Files:**
- Create: `src/lib/auth/memberGate.ts`
- Create: `src/lib/auth/memberGate.test.ts`
- Modify: `src/lib/auth.ts` (add one import block + one function after `requireAdminSession`, lines 1–2 and 47)

**Interfaces:**
- Consumes: `rejectIfBanned(userId: string): Promise<Response | null>` from `src/lib/auth/banGuard.ts` (exists, untouched); `getSession(request)` from `auth-astro/server` (exists).
- Produces (used by Tasks 2–4):
  ```ts
  // src/lib/auth/memberGate.ts
  export type MemberGate =
    | { ok: true; userId: string; session: Session }
    | { ok: false; response: Response };
  export const MEMBER_UNAUTHORIZED_BODY = { error: 'Unauthorized - Please login' } as const;
  export function memberUnauthorizedResponse(): Response;
  export async function gateMember(
    session: Session | null,
    rejectIfBanned: (userId: string) => Promise<Response | null>
  ): Promise<MemberGate>;

  // src/lib/auth.ts
  export async function requireMemberSession(request: Request): Promise<MemberGate>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth/memberGate.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@auth/core/types';
import { gateMember, memberUnauthorizedResponse, MEMBER_UNAUTHORIZED_BODY } from './memberGate';

const member: Session = {
  user: { id: '64f000000000000000000001', name: 'Ayşe', email: 'ayse@mahalle-dev.test', role: 'user' },
  expires: '2099-01-01T00:00:00.000Z',
};

const neverBanned = async (_userId: string) => null;
const bannedResponse = new Response(JSON.stringify({ error: 'account_banned' }), {
  status: 403,
  headers: { 'Content-Type': 'application/json' },
});
const alwaysBanned = async (_userId: string) => bannedResponse;

test('no session → 401 with the exact legacy body and JSON header', async () => {
  const gate = await gateMember(null, neverBanned);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.equal(gate.response.status, 401);
  assert.equal(gate.response.headers.get('Content-Type'), 'application/json');
  assert.equal(await gate.response.text(), JSON.stringify(MEMBER_UNAUTHORIZED_BODY));
});

test('the 401 body is byte-identical to what the routes used to write', () => {
  assert.equal(JSON.stringify(MEMBER_UNAUTHORIZED_BODY), '{"error":"Unauthorized - Please login"}');
  assert.equal(memberUnauthorizedResponse().status, 401);
});

test('a session whose user has no id → 401, ban check never runs', async () => {
  let banCalls = 0;
  const counting = async (_userId: string) => { banCalls += 1; return null; };
  const idless = { ...member, user: { ...member.user, id: undefined as unknown as string } };
  const gate = await gateMember(idless, counting);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.equal(gate.response.status, 401);
  assert.equal(banCalls, 0);
});

test('a banned member → the ban response is returned as the SAME object', async () => {
  const gate = await gateMember(member, alwaysBanned);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.equal(gate.response, bannedResponse);
  assert.equal(gate.response.status, 403);
});

test('a member in good standing → ok with userId and the SAME session object', async () => {
  let seen = '';
  const recording = async (userId: string) => { seen = userId; return null; };
  const gate = await gateMember(member, recording);
  assert.equal(gate.ok, true);
  if (!gate.ok) return;
  assert.equal(gate.userId, '64f000000000000000000001');
  assert.equal(gate.session, member);
  assert.equal(seen, '64f000000000000000000001');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/lib/auth/memberGate.test.ts`
Expected: FAIL — `Cannot find module './memberGate'` (or equivalent resolution error).

- [ ] **Step 3: Write the pure core**

Create `src/lib/auth/memberGate.ts`:

```ts
// src/lib/auth/memberGate.ts
// PURE (no imports beyond a type). The decision logic of requireMemberSession()
// — kept dependency-free so it is unit-testable with `npx tsx --test`
// (auth-astro/server cannot be loaded outside Astro). The wiring with the real
// getSession + rejectIfBanned lives in src/lib/auth.ts.
import type { Session } from '@auth/core/types';

export type MemberGate =
  | { ok: true; userId: string; session: Session }
  | { ok: false; response: Response };

/** The exact body the 22 member routes wrote by hand before 2026-09-30. Do not reword. */
export const MEMBER_UNAUTHORIZED_BODY = { error: 'Unauthorized - Please login' } as const;

export function memberUnauthorizedResponse(): Response {
  return new Response(JSON.stringify(MEMBER_UNAUTHORIZED_BODY), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Session check, then live ban check, in that order — the order every
 * member write route used. `rejectIfBanned` is injected so this stays pure.
 * A session without `user.id` is refused (401) and never reaches the ban
 * check; the jwt/session callbacks always set the id, so this only guards
 * against a malformed token.
 */
export async function gateMember(
  session: Session | null,
  rejectIfBanned: (userId: string) => Promise<Response | null>
): Promise<MemberGate> {
  const userId = session?.user?.id;
  if (!userId) return { ok: false, response: memberUnauthorizedResponse() };
  const banned = await rejectIfBanned(userId);
  if (banned) return { ok: false, response: banned };
  return { ok: true, userId, session: session as Session };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/lib/auth/memberGate.test.ts`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Wire the real helper into `src/lib/auth.ts`**

At the top of `src/lib/auth.ts` (currently lines 1–2 are the `jsonwebtoken` and `auth-astro/server` imports), add after line 2:

```ts
import { rejectIfBanned } from './auth/banGuard';
import { gateMember, type MemberGate } from './auth/memberGate';
```

Directly after the closing `}` of `requireAdminSession` (line 47 today, before `const JWT_SECRET = …`), add:

```ts
/**
 * Member guard for write endpoints: session, then LIVE ban check
 * (`rejectIfBanned`, reads the DB — the JWT snapshots at login and a ban
 * happens mid-session). Same tagged-union shape as requireAdminSession.
 *
 * Usage:
 *   const gate = await requireMemberSession(request);
 *   if (!gate.ok) return gate.response;
 *   const { session, userId } = gate;
 *
 * 401 body is exactly `{ error: 'Unauthorized - Please login' }` (the text
 * the routes used before 2026-09-30); 403 is rejectIfBanned's own response.
 * Routes that check a path id BEFORE the session keep doing so — call this
 * after that check. Decision logic + tests: src/lib/auth/memberGate.ts.
 */
export async function requireMemberSession(request: Request): Promise<MemberGate> {
  return gateMember(await getSession(request), rejectIfBanned);
}
```

- [ ] **Step 6: Type-check**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'`
Expected: `16` (unchanged). If higher, run `pnpm exec tsc --noEmit 2>&1 | grep 'error TS' | grep -E 'memberGate|lib/auth\.ts'` and fix only what those lines show.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/memberGate.ts src/lib/auth/memberGate.test.ts src/lib/auth.ts
git commit -m "auth: add requireMemberSession() beside requireAdminSession() (pure core + tests)"
```

---

### Task 2: Swap the prelude in the first 11 routes (forum + calendar + listings create/draft)

**Files (modify only; line numbers as of main `e6880781`, the prelude = the lines to replace):**

| # | File | Prelude lines | Import lines to delete | New import (relative path) | Declares `userId`? |
|---|---|---|---|---|---|
| 1 | `src/pages/api/announcements/create.ts` | 17–31 | 2, 12 | `'../../../lib/auth'` | yes |
| 2 | `src/pages/api/announcements/edit/[id].ts` | 16–30 | 3, 12 | `'../../../../lib/auth'` | yes |
| 3 | `src/pages/api/comments/create.ts` | 17–31 | 2, 10 | `'../../../lib/auth'` | yes |
| 4 | `src/pages/api/comments/edit/[commentId].ts` | 20–33 | 2, 13 | `'../../../../lib/auth'` | yes |
| 5 | `src/pages/api/events/[id]/like.ts` | 18–30 (AFTER the id check, keep lines 9–16 above it) | 2, 5 | `'../../../../lib/auth'` | no |
| 6 | `src/pages/api/events/[id]/rsvp.ts` | 23–33 (AFTER the id check, keep lines 14–21) | 2, 5 | `'../../../../lib/auth'` | no |
| 7 | `src/pages/api/events/create.ts` | 15–29 | 2, 10 | `'../../../lib/auth'` | yes |
| 8 | `src/pages/api/events/edit/[id].ts` | 20–34 | 2, 15 | `'../../../../lib/auth'` | yes |
| 9 | `src/pages/api/listings/create.ts` | 14–27 | 2, 9 | `'../../../lib/auth'` | yes |
| 10 | `src/pages/api/listings/draft.ts` | 12–25 | 2, 8 | `'../../../lib/auth'` | yes |
| 11 | `src/pages/api/listings/draft/[id]/publish.ts` | 14–25 (the `const userId` of this file sits LATER, line 36 — keep it there, or replace it: see step 3) | 2, 9 | `'../../../../../lib/auth'` | later |

**Interfaces:**
- Consumes: `requireMemberSession(request): Promise<MemberGate>` from `src/lib/auth.ts` (Task 1), `MemberGate = { ok: true; userId: string; session: Session } | { ok: false; response: Response }`.
- Produces: nothing new — the routes' public behaviour is unchanged.

- [ ] **Step 1: Pre-flight grep per file (stop-and-report rule)**

For each of the 11 files:

```bash
f='src/pages/api/announcements/create.ts'   # repeat per file
grep -c '^export const [A-Z]*: APIRoute' "$f"; grep -c 'getSession(' "$f"; grep -c 'rejectIfBanned(' "$f"
```
Expected: `1`, `1`, `1` for every file. Any other number → do not edit that file; report it.

- [ ] **Step 2: Replace the prelude (the pattern, identical in files 1–4, 7–10)**

What the prelude looks like today (comments vary slightly, the code does not):

```ts
    // Get session from NextAuth
    const session = await getSession(request);

    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized - Please login' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Ban enforcement: banned accounts are read-only (3-strike Sperre).
    const bannedRes = await rejectIfBanned(session.user.id);
    if (bannedRes) return bannedRes;

    const userId = session.user.id;
```

Replace exactly that block (from the `// Get session` comment or the `const session = await getSession(request);` line through `const userId = session.user.id;`) with:

```ts
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session, userId } = gate;
```

Everything below the prelude stays byte-identical (`session.user.role`, `session.user.name`, `userId`, …).

- [ ] **Step 3: The three shape variants**

File 5 `events/[id]/like.ts` and file 6 `events/[id]/rsvp.ts` — the id check (`const eventId = params.id; if (!eventId || !ObjectId.isValid(eventId)) { … 400 … }`) stays ABOVE; replace only the session+ban lines beneath it, and since these files never declared `userId`, destructure only the session:

```ts
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session } = gate;
```

File 11 `listings/draft/[id]/publish.ts` — the prelude (lines 14–25) has no `const userId` line; the file declares `const userId = session.user.id;` later at line 36 after its id check. Replace lines 14–25 with the four-line block INCLUDING `const { session, userId } = gate;`, then DELETE the later `const userId = session.user.id;` line (otherwise a duplicate `const` — tsc will tell you).

- [ ] **Step 4: Fix the imports per file**

Delete the two lines `import { getSession } from 'auth-astro/server';` and `import { rejectIfBanned } from '…/lib/auth/banGuard';` and add, at the place of the deleted banGuard import, `import { requireMemberSession } from '<path from the table>';`. The path is the banGuard path with `/auth/banGuard` replaced by `/auth` — e.g. `'../../../lib/auth/banGuard'` → `'../../../lib/auth'`.

- [ ] **Step 5: Verify each file's diff shape**

```bash
git diff --stat
git diff -- src/pages/api/announcements/create.ts   # repeat per file
```
Expected per file: `-2 +1` on the imports, the prelude lines removed, 4 lines added, nothing else. Also:

```bash
grep -rn "getSession\|rejectIfBanned" src/pages/api/announcements src/pages/api/comments src/pages/api/events/create.ts "src/pages/api/events/edit" "src/pages/api/events/[id]/like.ts" "src/pages/api/events/[id]/rsvp.ts" src/pages/api/listings/create.ts src/pages/api/listings/draft.ts "src/pages/api/listings/draft"
```
Expected: no hits in the 11 files (other files in those dirs may still hit — that is fine, they are Task 3 or out of scope).

- [ ] **Step 6: Type-check**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'`
Expected: `16`. If higher: `pnpm exec tsc --noEmit 2>&1 | grep 'error TS' | grep 'src/pages/api'` — the usual causes are a leftover `const userId` (file 11) or a route that read `userId` although the table says „no" (then destructure it too).

- [ ] **Step 7: Commit**

```bash
git add src/pages/api/announcements src/pages/api/comments src/pages/api/events src/pages/api/listings/create.ts src/pages/api/listings/draft.ts src/pages/api/listings/draft
git status --short   # must list ONLY the 11 files
git commit -m "api: use requireMemberSession() in announcements, comments, events and listing create/draft routes"
```

---

### Task 3: Swap the prelude in the remaining 11 routes (listings edit/upload, news, posts, recommendations, reports, topics)

**Files (modify only; line numbers as of main `e6880781`):**

| # | File | Prelude lines | Import lines to delete | New import (relative path) | Declares `userId`? |
|---|---|---|---|---|---|
| 12 | `src/pages/api/listings/edit/[id].ts` | 16–27 (no `const userId` in the prelude; the file declares it at line 38 after the id check) | 2, 11 | `'../../../../lib/auth'` | later |
| 13 | `src/pages/api/listings/upload.ts` | 15–29 | 2, 4 | `'../../../lib/auth'` | yes |
| 14 | `src/pages/api/news/submit.ts` | 14–27 | 2, 8 | `'../../../lib/auth'` | yes |
| 15 | `src/pages/api/news/upload.ts` | 15–28 | 2, 4 | `'../../../lib/auth'` | yes |
| 16 | `src/pages/api/posts/move/[id].ts` | 24–28 (uses a local `json()` helper for the 401 — same bytes, same header) | 7, 12 | `'../../../../lib/auth'` | no |
| 17 | `src/pages/api/posts/upload.ts` | 15–28 | 2, 4 | `'../../../lib/auth'` | yes |
| 18 | `src/pages/api/recommendations/create.ts` | 17–31 | 2, 12 | `'../../../lib/auth'` | yes |
| 19 | `src/pages/api/recommendations/edit/[id].ts` | 16–30 | 3, 12 | `'../../../../lib/auth'` | yes |
| 20 | `src/pages/api/reports/submit.ts` | 14–28 (declares `const reporterUserId = session.user.id;` — see step 3) | 2, 9 | `'../../../lib/auth'` | as `reporterUserId` |
| 21 | `src/pages/api/topics/create.ts` | 17–31 | 2, 12 | `'../../../lib/auth'` | yes |
| 22 | `src/pages/api/topics/edit/[id].ts` | 18–32 | 2, 13 | `'../../../../lib/auth'` | yes |

**Interfaces:**
- Consumes: `requireMemberSession(request): Promise<MemberGate>` from `src/lib/auth.ts` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Pre-flight grep per file**

```bash
f='src/pages/api/listings/edit/[id].ts'   # repeat per file
grep -c '^export const [A-Z]*: APIRoute' "$f"; grep -c 'getSession(' "$f"; grep -c 'rejectIfBanned(' "$f"
```
Expected `1`, `1`, `1` each. Anything else → skip that file and report.

- [ ] **Step 2: Replace the prelude (files 13, 14, 15, 17, 18, 19, 21, 22 — the standard shape)**

Today:

```ts
    const session = await getSession(request);

    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized - Please login' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Ban enforcement: banned accounts are read-only (3-strike Sperre).
    const bannedRes = await rejectIfBanned(session.user.id);
    if (bannedRes) return bannedRes;

    const userId = session.user.id;
```

Becomes:

```ts
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session, userId } = gate;
```

- [ ] **Step 3: The three variants in this batch**

File 12 `listings/edit/[id].ts`: replace lines 16–27 with the four-line block (including `const { session, userId } = gate;`) and DELETE the later `const userId = session.user.id;` (line 38 today).

File 16 `posts/move/[id].ts` — today:

```ts
    const session = await getSession(request);
    if (!session?.user) return json({ error: 'Unauthorized - Please login' }, 401);

    const bannedRes = await rejectIfBanned(session.user.id);
    if (bannedRes) return bannedRes;
```

Becomes (the file reads `session.user.id` and `session.user.role` further down, never a `userId` variable):

```ts
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session } = gate;
```

File 20 `reports/submit.ts` — the prelude ends with `const reporterUserId = session.user.id;`. Replace the whole prelude with:

```ts
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session, userId: reporterUserId } = gate;
```

- [ ] **Step 4: Fix the imports per file** — delete the `getSession` and `rejectIfBanned` import lines, add `import { requireMemberSession } from '<path from the table>';` where the banGuard import was.

- [ ] **Step 5: Verify the diff shape and that no old call survives**

```bash
git diff --stat
grep -rln "rejectIfBanned(" src/pages/api | sort
```
Expected: exactly these 8 out-of-scope files and nothing else — `likes/toggle.ts`, `listings/[id]/bump.ts`, `listings/[id]/status.ts`, `posts/drafts/index.ts`, `profile/avatar.ts`, `profile/change-password.ts`, `profile/email-change/start.ts`, `users/update.ts`. If any of the 22 in-scope files is still listed, its prelude was not replaced.

- [ ] **Step 6: Type-check**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'`
Expected: `16`.

- [ ] **Step 7: Commit**

```bash
git add src/pages/api/listings/edit src/pages/api/listings/upload.ts src/pages/api/news/submit.ts src/pages/api/news/upload.ts src/pages/api/posts src/pages/api/recommendations src/pages/api/reports src/pages/api/topics
git status --short   # must list ONLY the 11 files
git commit -m "api: use requireMemberSession() in listing edit/upload, news, posts, recommendations, reports and topics routes"
```

---

### Task 4: Docs, build, preview smoke (orchestrator task — needs the dev password file and the Vercel CLI)

**Files:**
- Modify: `CLAUDE.md` (root) — the *API Routes* pattern block (search for `All API routes in \`src/pages/api/\` follow this pattern`), the *Admin gate helper* bullet under *Authentication Flow*, and the *Dead-code sweep* comment line in *Development Commands* (search for `still open: the same session/ban/connect prelude`).
- Modify: `src/lib/auth/banGuard.ts` lines 22–27 (the usage comment).
- Create (scratch, not committed): `scratchpad/member-gate-smoke.cjs`.

**Interfaces:**
- Consumes: the helper and the 22 converted routes (Tasks 1–3).
- Produces: a green preview and the docs that tell the next agent the pattern.

- [ ] **Step 1: Rewrite the *API Routes* block in root `CLAUDE.md`**

Replace the code block under `### API Routes` (the one that shows `getSession` + a hand-written 401) with:

````markdown
### API Routes
Member write routes in `src/pages/api/` (create/edit/upload/draft/submit/report/move, 22 files since 2026-09-30) open with ONE helper:
```typescript
import type { APIRoute } from 'astro';
import { requireMemberSession } from '../../../lib/auth';
import { connectDB } from '../../../lib/mongodb';

export const POST: APIRoute = async ({ request }) => {
  // session → 401 `{ error: 'Unauthorized - Please login' }`, then LIVE ban check → 403 `account_banned`
  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;
  const { session, userId } = gate;   // session.user.role/name/email as before
  // ... handler logic
};
```
`requireMemberSession()` sits beside `requireAdminSession()` in `src/lib/auth.ts`; its decision logic is the pure, tested `gateMember()` in `src/lib/auth/memberGate.ts` (`npx tsx --test src/lib/auth/memberGate.test.ts`). Rules: the 401 text is frozen (clients may match it); a route that validates a path id BEFORE the session (`events/[id]/like`, `events/[id]/rsvp`) calls the helper after that check; a session without `user.id` is refused (before the helper it slipped through — the only behaviour change of the refactor). Routes with a different 401 body (`likes/toggle`, `listings/[id]/bump|status`, `profile/*`, `users/update`, `posts/drafts`) still hand-write their prelude — convert them only together with their clients.
````

- [ ] **Step 2: Extend the *Admin gate helper* bullet and the sweep comment**

In *Authentication Flow*, after the `requireAdminSession(request)` bullet, add:

```markdown
- **Member gate helper**: `requireMemberSession(request)` in the same file returns `{ ok: true, userId, session }` or a pre-shaped 401/403 `Response` (session, then live `rejectIfBanned`). Used by the 22 member write routes — see „API Routes" below.
```

In the *Development Commands* block, replace `still open: the same session/ban/connect prelude copied into 13 API routes (candidate \`requireMemberSession()\` next to \`requireAdminSession()\`).` with `Phase 3 (\`requireMemberSession()\` in 22 member write routes) landed 2026-09-30 — the sweep is closed; parked: ~100 unused exports, 60 unused types, 9 unread Svelte props, the \`global.css\` glass block.`

- [ ] **Step 3: Update the usage comment in `src/lib/auth/banGuard.ts`**

Replace lines 22–27:

```ts
/**
 * Write-endpoint guard. Call AFTER the session check:
 *
 *   const bannedRes = await rejectIfBanned(session.user.id);
 *   if (bannedRes) return bannedRes;
 *
```
with:
```ts
/**
 * Write-endpoint guard. Call AFTER the session check. Most routes get it
 * through requireMemberSession() (src/lib/auth.ts); the hand-written form is
 *
 *   const bannedRes = await rejectIfBanned(session.user.id);
 *   if (bannedRes) return bannedRes;
 *
```

- [ ] **Step 4: Build**

Run: `pnpm build 2>&1 | tail -3`
Expected: `[build] Complete!`, no line matching `error` above it (`grep -n -i "error" <log> | grep -v -i "errors.ts\|ErrorPanel\|500.astro"` → empty).

- [ ] **Step 5: Commit the docs**

```bash
git add CLAUDE.md src/lib/auth/banGuard.ts
git commit -m "docs: requireMemberSession() pattern for member API routes, sweep closed"
```

- [ ] **Step 6: Push the branch, wait for the preview**

```bash
git push -u origin chore/require-member-session
sleep 20; vercel ls 2>&1 | grep -m1 vercel.app      # note the URL; poll `vercel inspect <url> | grep status` every 20 s until Ready (≈ 60 s)
```

- [ ] **Step 7: Smoke the preview (six probes, exact expectations)**

Create `scratchpad/member-gate-smoke.cjs` (gitignored dir):

```js
// NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/member-gate-smoke.cjs <previewUrl>
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2];
const PW = fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim();
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} — ${detail}`); };
(async () => {
  // 1–3. logged-out on the UNGATED prefixes (the middleware would answer first on /api/topics etc.)
  let r = await fetch(BASE + '/api/posts/upload', { method: 'POST' });
  check('logged-out posts/upload is 401 with the legacy body', r.status === 401 && (await r.text()) === '{"error":"Unauthorized - Please login"}', `status ${r.status}`);
  r = await fetch(BASE + '/api/reports/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('logged-out reports/submit is 401 JSON', r.status === 401 && (r.headers.get('content-type') || '').includes('application/json') && (await r.text()) === '{"error":"Unauthorized - Please login"}', `status ${r.status} ${r.headers.get('content-type')}`);
  r = await fetch(BASE + '/api/posts/move/000000000000000000000000', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('logged-out posts/move is 401 (session before id/body)', r.status === 401 && (await r.text()) === '{"error":"Unauthorized - Please login"}', `status ${r.status}`);
  // 4–6. logged-in: the gate passes → a real write that needs no moderation (listing draft save), a validation 400 (gate passed, body refused), a bad-id 400 on an id-first route
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'ayse@mahalle-dev.test');
  await page.fill('input[type="password"]', PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
  const post = (path, body) => page.evaluate(async ([base, path, body]) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    return { status: res.status, text: (await res.text()).slice(0, 120) };
  }, [BASE, path, body]);
  const draft = await post('/api/listings/draft', JSON.stringify({ title: 'Smoke-Entwurf requireMemberSession ' + Date.now() }));
  check('logged-in listings/draft saves (gate passed)', draft.status === 200 || draft.status === 201, `status ${draft.status} ${draft.text}`);
  const bad = await post('/api/topics/create', '{}');
  check('logged-in topics/create with an empty body is 400 (gate passed, validation refused)', bad.status === 400, `status ${bad.status} ${bad.text}`);
  const badId = await post('/api/events/not-an-id/like', '{}');
  check('logged-in events/not-an-id/like is 400 Invalid event ID', badId.status === 400, `status ${badId.status} ${badId.text}`);
  await browser.close();
  const fails = results.filter((x) => !x.ok).length;
  console.log(fails ? `FAILS: ${fails}` : 'ALL OK');
  process.exit(fails ? 1 : 0);
})();
```

Run: `NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/member-gate-smoke.cjs <previewUrl>`
Expected: `ALL OK` (6 checks). Two spurious failures to recognise before blaming the gate: probe #5 answers **429** when the dev account already created 5 topics in the last 24 h (the daily limit runs before validation), and probe #4 answers **409 `draft_limit`** when the account holds its maximum of listing drafts — both mean the gate PASSED; delete old drafts on the preview's `/entwuerfe` or use `jonas@mahalle-dev.test` and re-run. The draft this creates lives in the DEV database (preview = `mahalle-dev`); delete it afterwards from `/entwuerfe` on the preview or leave it — it is a dev fixture.

- [ ] **Step 8: Report to the user** — commit SHAs, tsc 16, build green, preview URL, the six smoke lines. The USER merges (fast-forward) — never merge in this plan.
