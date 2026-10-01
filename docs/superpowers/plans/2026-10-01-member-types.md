# Member Types and Daily-Limit Buckets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members carry a self-chosen type (person / organisation / business) shown as a tag beside their name; the admin can correct it and give an organisation a higher daily limit; the three forum kinds share ONE daily limit.

**Architecture:** Two optional fields on `users` (`memberType`, `dailyLimit`; absent = person / 5). Pure rule modules under `src/lib/members/` and `src/lib/limits/` decide everything; one server helper `checkDailyLimit()` replaces seven hand-written counts; five existing user-data joins carry the normalised type to one shared tag component.

**Tech Stack:** Astro 5 API routes, Svelte 5 islands, MongoDB driver, Zod, `node:test` via `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-01-member-types-design.md` — read it; it is the authority.

## Global Constraints

- Branch `feat/member-types` (exists, holds the spec). Never commit on `main`, never push, never merge.
- Commit messages: plain and concise, e.g. `feat: member type rules`. NO „Generated with Claude Code" line, NO `Co-Authored-By` footer.
- Never stage or print secrets; never print any `.env` VALUE (names only). The dev test password is in `scratchpad/devpw.txt` — never print it, never put it into a snapshot or a report.
- Never start `pnpm dev` or any long-running server. Never run Knip/Fallow in `fix` mode.
- Database scripts: dev database only; every script must refuse a database name that does not contain `dev`.
- `memberType` stored values are exactly `'organisation'` and `'business'`; person is the ABSENCE of the field. `dailyLimit` is an integer 1–50, written only by `PATCH /api/admin/users/[id]`, honoured only while the stored type is `organisation`, and never part of any client-visible projection except the admin list.
- Daily limits: four buckets `forum | events | listings | news`, 5 per rolling 24 h, admin exempt.
- Tag wording: DE „Initiative" / „Gewerbe", EN „Initiative" / „Business". Choice wording: DE „Privatperson" / „Verein · Initiative" / „Gewerbe", EN „Private person" / „Association · initiative" / „Business". Other new copy is DRAFT (mark it `// DRAFT` in the i18n file).
- i18n lives in ONE file, `src/lib/kiosk-i18n.ts`: the DE dictionary `const de = {` and the EN dictionary `const en: Dict = {`. Every new key goes into BOTH.
- A Svelte component that is only imported by other islands must not use a scoped `<style>` block (it is orphaned in production builds): Tailwind classes or inline styles only.
- Tests: `node:test` + `node:assert/strict`, first line `// Run: npx tsx --test <path>`, pure (no database).
- CI budgets must not rise: `npx tsc --noEmit` ≤ 16 errors, `npx -y svelte-check@4` ≤ 81 errors. The branch starts at EXACTLY 16 and 81 — there is no headroom; one new error fails the gate. Never pass a typed-narrow object type where a MongoDB document goes: use `UserFields` (Task 1).
- Find code by the quoted anchor text, not by line number; line numbers in this plan are hints.

## Review Focus

1. A member with `memberType: 'business'` and a stray `dailyLimit: 30` in the database → still limited to 5 (Task 1 test `business with a stray number`).
2. A user document carrying a junk `memberType` (e.g. `'admin'`, `42`) → treated as person everywhere, no tag, limit 5 (Task 1 test `unknown stored value`).
3. A member re-saves the profile without changing the type → `dailyLimit` survives and no Telegram ping (Task 1 test `same type is a no-op`).
4. Admin sends `{ memberType: 'person', dailyLimit: 10 }` in one call → 400 `limit_needs_organisation`, nothing written (Task 1 test `limit together with leaving organisation`).
5. An organisation with limit 15 has posted 5 → the count endpoints report `limit: 15, remaining: 10, canCreate: true` (Task 1 test `raised organisation`).

---

### Task 1: Pure rules (member type, type changes, limit decision)

**Files:**
- Create: `src/lib/members/memberType.ts`, `src/lib/members/memberType.test.ts`
- Create: `src/lib/members/memberTypeChange.ts`, `src/lib/members/memberTypeChange.test.ts`
- Create: `src/lib/limits/limitRules.ts`, `src/lib/limits/limitRules.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `MEMBER_TYPES`, `type MemberType = 'person' | 'organisation' | 'business'`
  - `parseMemberType(raw: unknown): MemberType | null`
  - `type UserFields = { memberType?: unknown; dailyLimit?: unknown; [k: string]: unknown }` — the parameter type of every rule that reads a user document (a raw MongoDB document must be assignable to it)
  - `storedMemberType(doc: UserFields | null | undefined): MemberType`
  - `memberTypeTagKey(t: unknown): 'member.tag.organisation' | 'member.tag.business' | null`
  - `DEFAULT_DAILY_LIMIT = 5`, `MAX_DAILY_LIMIT = 50`
  - `effectiveDailyLimit(doc: UserFields | null | undefined): number`
  - `planSelfTypeChange(stored: MemberType, requested: MemberType): SelfTypePlan`
  - `planAdminPatch(stored: UserFields, body: AdminPatchBody): AdminPatchPlan`
  - `decideLimit(input: { count: number; role?: string | null; user: UserFields | null }): LimitResult` with `LimitResult = { count: number; limit: number; remaining: number; allowed: boolean }`

- [ ] **Step 1: Write the three failing test files**

`src/lib/members/memberType.test.ts`:

```ts
// Run: npx tsx --test src/lib/members/memberType.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMBER_TYPES, parseMemberType, storedMemberType, memberTypeTagKey,
  effectiveDailyLimit, DEFAULT_DAILY_LIMIT, MAX_DAILY_LIMIT,
} from './memberType';

test('the three types, person first', () => {
  assert.deepEqual([...MEMBER_TYPES], ['person', 'organisation', 'business']);
});

test('parseMemberType accepts exact values only', () => {
  assert.equal(parseMemberType('person'), 'person');
  assert.equal(parseMemberType('organisation'), 'organisation');
  assert.equal(parseMemberType('business'), 'business');
  for (const bad of ['Organisation', ' business', 'organization', '', null, undefined, 1, {}, ['person']]) {
    assert.equal(parseMemberType(bad), null);
  }
});

test('unknown stored value reads as person', () => {
  assert.equal(storedMemberType(null), 'person');
  assert.equal(storedMemberType(undefined), 'person');
  assert.equal(storedMemberType({}), 'person');
  assert.equal(storedMemberType({ memberType: 'admin' }), 'person');
  assert.equal(storedMemberType({ memberType: 42 }), 'person');
  assert.equal(storedMemberType({ memberType: 'business' }), 'business');
  assert.equal(storedMemberType({ memberType: 'organisation' }), 'organisation');
});

test('tag key: none for a person or junk', () => {
  assert.equal(memberTypeTagKey('person'), null);
  assert.equal(memberTypeTagKey(undefined), null);
  assert.equal(memberTypeTagKey('admin'), null);
  assert.equal(memberTypeTagKey('organisation'), 'member.tag.organisation');
  assert.equal(memberTypeTagKey('business'), 'member.tag.business');
});

test('effective limit: only an organisation with a valid number is raised', () => {
  assert.equal(DEFAULT_DAILY_LIMIT, 5);
  assert.equal(MAX_DAILY_LIMIT, 50);
  assert.equal(effectiveDailyLimit(null), 5);
  assert.equal(effectiveDailyLimit({}), 5);
  assert.equal(effectiveDailyLimit({ memberType: 'organisation' }), 5);
  assert.equal(effectiveDailyLimit({ memberType: 'organisation', dailyLimit: 15 }), 15);
  assert.equal(effectiveDailyLimit({ memberType: 'organisation', dailyLimit: 1 }), 1);
  assert.equal(effectiveDailyLimit({ memberType: 'organisation', dailyLimit: 50 }), 50);
});

test('business with a stray number stays at 5; out-of-range numbers are ignored', () => {
  assert.equal(effectiveDailyLimit({ memberType: 'business', dailyLimit: 30 }), 5);
  assert.equal(effectiveDailyLimit({ dailyLimit: 30 }), 5);
  for (const bad of [0, -3, 51, 500, 7.5, '15', null, NaN]) {
    assert.equal(effectiveDailyLimit({ memberType: 'organisation', dailyLimit: bad }), 5);
  }
});
```

`src/lib/members/memberTypeChange.test.ts`:

```ts
// Run: npx tsx --test src/lib/members/memberTypeChange.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSelfTypeChange, planAdminPatch } from './memberTypeChange';

test('self: same type is a no-op (limit survives, no ping)', () => {
  for (const t of ['person', 'organisation', 'business'] as const) {
    assert.deepEqual(planSelfTypeChange(t, t), { changed: false, set: {}, unset: [], ping: false });
  }
});

test('self: to organisation or business sets the field and pings', () => {
  assert.deepEqual(planSelfTypeChange('person', 'organisation'),
    { changed: true, set: { memberType: 'organisation' }, unset: [], ping: true });
  assert.deepEqual(planSelfTypeChange('person', 'business'),
    { changed: true, set: { memberType: 'business' }, unset: [], ping: true });
});

test('self: leaving organisation clears the limit', () => {
  assert.deepEqual(planSelfTypeChange('organisation', 'business'),
    { changed: true, set: { memberType: 'business' }, unset: ['dailyLimit'], ping: true });
  assert.deepEqual(planSelfTypeChange('organisation', 'person'),
    { changed: true, set: {}, unset: ['memberType', 'dailyLimit'], ping: false });
});

test('self: to person stores nothing and does not ping', () => {
  assert.deepEqual(planSelfTypeChange('business', 'person'),
    { changed: true, set: {}, unset: ['memberType', 'dailyLimit'], ping: false });
});

test('admin: empty body is refused', () => {
  assert.deepEqual(planAdminPatch({}, {}), { ok: false, error: 'invalid_body' });
});

test('admin: verified alone passes through', () => {
  assert.deepEqual(planAdminPatch({ memberType: 'business' }, { verified: true }), {
    ok: true, set: { verified: true }, unset: [],
    result: { memberType: 'business', dailyLimit: null },
  });
});

test('admin: a limit needs an organisation', () => {
  assert.deepEqual(planAdminPatch({}, { dailyLimit: 10 }), { ok: false, error: 'limit_needs_organisation' });
  assert.deepEqual(planAdminPatch({ memberType: 'business' }, { dailyLimit: 10 }),
    { ok: false, error: 'limit_needs_organisation' });
});

test('admin: limit together with leaving organisation is refused', () => {
  assert.deepEqual(planAdminPatch({ memberType: 'organisation', dailyLimit: 20 }, { memberType: 'person', dailyLimit: 10 }),
    { ok: false, error: 'limit_needs_organisation' });
});

test('admin: type and limit in one call', () => {
  assert.deepEqual(planAdminPatch({}, { memberType: 'organisation', dailyLimit: 15 }), {
    ok: true, set: { memberType: 'organisation', dailyLimit: 15 }, unset: [],
    result: { memberType: 'organisation', dailyLimit: 15 },
  });
});

test('admin: limit for a stored organisation; null removes it', () => {
  assert.deepEqual(planAdminPatch({ memberType: 'organisation' }, { dailyLimit: 30 }), {
    ok: true, set: { dailyLimit: 30 }, unset: [],
    result: { memberType: 'organisation', dailyLimit: 30 },
  });
  assert.deepEqual(planAdminPatch({ memberType: 'organisation', dailyLimit: 30 }, { dailyLimit: null }), {
    ok: true, set: {}, unset: ['dailyLimit'],
    result: { memberType: 'organisation', dailyLimit: null },
  });
  // null for a non-organisation is a harmless unset, not an error
  assert.deepEqual(planAdminPatch({}, { dailyLimit: null }), {
    ok: true, set: {}, unset: ['dailyLimit'],
    result: { memberType: 'person', dailyLimit: null },
  });
});

test('admin: correcting away from organisation clears the limit', () => {
  assert.deepEqual(planAdminPatch({ memberType: 'organisation', dailyLimit: 20 }, { memberType: 'business' }), {
    ok: true, set: { memberType: 'business' }, unset: ['dailyLimit'],
    result: { memberType: 'business', dailyLimit: null },
  });
  assert.deepEqual(planAdminPatch({ memberType: 'organisation', dailyLimit: 20 }, { memberType: 'person' }), {
    ok: true, set: {}, unset: ['memberType', 'dailyLimit'],
    result: { memberType: 'person', dailyLimit: null },
  });
});

test('admin: keeping organisation keeps a stored limit in the result', () => {
  assert.deepEqual(planAdminPatch({ memberType: 'organisation', dailyLimit: 20 }, { memberType: 'organisation' }), {
    ok: true, set: { memberType: 'organisation' }, unset: [],
    result: { memberType: 'organisation', dailyLimit: 20 },
  });
});
```

`src/lib/limits/limitRules.test.ts`:

```ts
// Run: npx tsx --test src/lib/limits/limitRules.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideLimit } from './limitRules';

test('plain member below and at the limit', () => {
  assert.deepEqual(decideLimit({ count: 4, role: 'user', user: {} }),
    { count: 4, limit: 5, remaining: 1, allowed: true });
  assert.deepEqual(decideLimit({ count: 5, role: 'user', user: {} }),
    { count: 5, limit: 5, remaining: 0, allowed: false });
  assert.deepEqual(decideLimit({ count: 9, role: 'user', user: null }),
    { count: 9, limit: 5, remaining: 0, allowed: false });
});

test('raised organisation', () => {
  assert.deepEqual(decideLimit({ count: 5, role: 'user', user: { memberType: 'organisation', dailyLimit: 15 } }),
    { count: 5, limit: 15, remaining: 10, allowed: true });
  assert.deepEqual(decideLimit({ count: 15, role: 'user', user: { memberType: 'organisation', dailyLimit: 15 } }),
    { count: 15, limit: 15, remaining: 0, allowed: false });
});

test('business with a stray number stays at 5', () => {
  assert.deepEqual(decideLimit({ count: 5, role: 'user', user: { memberType: 'business', dailyLimit: 30 } }),
    { count: 5, limit: 5, remaining: 0, allowed: false });
});

test('admin is always allowed and sees the full limit as remaining', () => {
  assert.deepEqual(decideLimit({ count: 40, role: 'admin', user: {} }),
    { count: 40, limit: 5, remaining: 5, allowed: true });
});
```

- [ ] **Step 2: Run them — they must fail**

Run: `npx tsx --test src/lib/members/memberType.test.ts src/lib/members/memberTypeChange.test.ts src/lib/limits/limitRules.test.ts`
Expected: failures with „Cannot find module".

- [ ] **Step 3: Write the three modules**

`src/lib/members/memberType.ts`:

```ts
// src/lib/members/memberType.ts — dependency-pure (server routes AND islands import it).
// A member is a person unless the user document says otherwise: the field is
// ABSENT for a person, so no existing account needed a migration.

export const MEMBER_TYPES = ['person', 'organisation', 'business'] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];

export const DEFAULT_DAILY_LIMIT = 5;
export const MAX_DAILY_LIMIT = 50;

/**
 * The two fields these rules read off a user document. The index signature is
 * load-bearing: without it TypeScript's weak-type check refuses a MongoDB
 * `WithId<Document>` (its `_id` shares no property with an all-optional type).
 */
export type UserFields = { memberType?: unknown; dailyLimit?: unknown; [k: string]: unknown };

/** Client input → type. Exact match only; anything else is null (caller answers 400). */
export function parseMemberType(raw: unknown): MemberType | null {
  return typeof raw === 'string' && (MEMBER_TYPES as readonly string[]).includes(raw)
    ? (raw as MemberType)
    : null;
}

/** A user document → type. Absent or unknown value reads as person. */
export function storedMemberType(doc: UserFields | null | undefined): MemberType {
  const t = doc?.memberType;
  return t === 'organisation' || t === 'business' ? t : 'person';
}

/** i18n key of the tag beside the name; a person (or junk) carries none. */
export function memberTypeTagKey(t: unknown): 'member.tag.organisation' | 'member.tag.business' | null {
  if (t === 'organisation') return 'member.tag.organisation';
  if (t === 'business') return 'member.tag.business';
  return null;
}

/** The admin's number counts only for an organisation and only when it is an integer 1–50. */
export function effectiveDailyLimit(doc: UserFields | null | undefined): number {
  if (storedMemberType(doc) !== 'organisation') return DEFAULT_DAILY_LIMIT;
  const n = doc?.dailyLimit;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_DAILY_LIMIT
    ? n
    : DEFAULT_DAILY_LIMIT;
}
```

`src/lib/members/memberTypeChange.ts`:

```ts
// src/lib/members/memberTypeChange.ts — dependency-pure decisions for the two
// writers of users.memberType: the member (profile edit) and the admin
// (/admin/mitglieder). `dailyLimit` belongs to an organisation: whoever moves
// a member away from that type removes the number in the same update.
import { storedMemberType, type MemberType, type UserFields } from './memberType';

type UnsetField = 'memberType' | 'dailyLimit';

export interface SelfTypePlan {
  changed: boolean;
  set: { memberType?: 'organisation' | 'business' };
  unset: UnsetField[];
  /** Telegram ping: only when the member's own change ends on organisation or business. */
  ping: boolean;
}

export function planSelfTypeChange(stored: MemberType, requested: MemberType): SelfTypePlan {
  if (stored === requested) return { changed: false, set: {}, unset: [], ping: false };
  if (requested === 'person') {
    return { changed: true, set: {}, unset: ['memberType', 'dailyLimit'], ping: false };
  }
  return {
    changed: true,
    set: { memberType: requested },
    unset: stored === 'organisation' ? ['dailyLimit'] : [],
    ping: true,
  };
}

export interface AdminPatchBody {
  verified?: boolean;
  memberType?: MemberType;
  dailyLimit?: number | null;
}

export type AdminPatchPlan =
  | { ok: false; error: 'invalid_body' | 'limit_needs_organisation' }
  | {
      ok: true;
      set: { verified?: boolean; memberType?: 'organisation' | 'business'; dailyLimit?: number };
      unset: UnsetField[];
      /** State after the write, for the response. */
      result: { memberType: MemberType; dailyLimit: number | null };
    };

export function planAdminPatch(
  stored: UserFields,
  body: AdminPatchBody,
): AdminPatchPlan {
  if (body.verified === undefined && body.memberType === undefined && body.dailyLimit === undefined) {
    return { ok: false, error: 'invalid_body' };
  }
  const before = storedMemberType(stored);
  const after = body.memberType ?? before;
  if (typeof body.dailyLimit === 'number' && after !== 'organisation') {
    return { ok: false, error: 'limit_needs_organisation' };
  }

  const set: { verified?: boolean; memberType?: 'organisation' | 'business'; dailyLimit?: number } = {};
  const unset = new Set<UnsetField>();
  if (body.verified !== undefined) set.verified = body.verified;
  if (body.memberType !== undefined) {
    if (body.memberType === 'person') unset.add('memberType');
    else set.memberType = body.memberType;
  }
  if (after !== 'organisation') unset.add('dailyLimit');
  if (body.dailyLimit === null) unset.add('dailyLimit');
  if (typeof body.dailyLimit === 'number') set.dailyLimit = body.dailyLimit;

  // An unset that only repeats „nothing stored" for an untouched person is noise:
  // drop the dailyLimit unset when the type did not change, was not organisation,
  // and the body did not ask for it.
  if (body.memberType === undefined && body.dailyLimit === undefined) unset.delete('dailyLimit');

  const storedLimit =
    typeof stored.dailyLimit === 'number' && before === 'organisation' ? stored.dailyLimit : null;
  const dailyLimit =
    after !== 'organisation' ? null
    : typeof body.dailyLimit === 'number' ? body.dailyLimit
    : body.dailyLimit === null ? null
    : storedLimit;

  return { ok: true, set, unset: [...unset], result: { memberType: after, dailyLimit } };
}
```

Note the order the tests expect in `unset`: `['memberType', 'dailyLimit']` — `memberType` is added first, `dailyLimit` second.

`src/lib/limits/limitRules.ts`:

```ts
// src/lib/limits/limitRules.ts — dependency-pure decision behind every daily limit.
// Four buckets, each per rolling 24 hours. The three forum kinds share ONE bucket
// (until 2026-10-01 each kind counted alone: 15 forum posts a day were possible).
import { effectiveDailyLimit, type UserFields } from '../members/memberType';

export type LimitBucket = 'forum' | 'events' | 'listings' | 'news';

export interface LimitResult {
  count: number;
  limit: number;
  remaining: number;
  allowed: boolean;
}

export function decideLimit(input: {
  count: number;
  role?: string | null;
  user: UserFields | null;
}): LimitResult {
  const limit = effectiveDailyLimit(input.user);
  // Admins post official content in bursts — exempt, and the count endpoints
  // report the full limit as remaining (unchanged behaviour).
  if (input.role === 'admin') return { count: input.count, limit, remaining: limit, allowed: true };
  return {
    count: input.count,
    limit,
    remaining: Math.max(0, limit - input.count),
    allowed: input.count < limit,
  };
}
```

- [ ] **Step 4: Run the tests — all pass**

Run: `npx tsx --test src/lib/members/memberType.test.ts src/lib/members/memberTypeChange.test.ts src/lib/limits/limitRules.test.ts`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/members src/lib/limits
git commit -m "feat: member type and daily-limit rules"
```

---

### Task 2: One limit helper for the seven gates and three count endpoints

**Files:**
- Create: `src/lib/limits/dailyLimit.ts`
- Modify: `src/pages/api/topics/create.ts`, `src/pages/api/announcements/create.ts`, `src/pages/api/recommendations/create.ts`, `src/pages/api/events/create.ts`, `src/pages/api/listings/create.ts`, `src/pages/api/listings/draft/[id]/publish.ts`, `src/pages/api/news/submit.ts`
- Modify: `src/pages/api/topics/daily-count.ts`, `src/pages/api/listings/daily-count.ts`, `src/pages/api/news/daily-count.ts`
- Create: `scratchpad/member-types/limit-check.mts` (gitignored helper, not committed)

**Interfaces:**
- Consumes: `decideLimit`, `LimitBucket`, `LimitResult` from `src/lib/limits/limitRules.ts`.
- Produces: `countToday(db, userId, bucket): Promise<number>`, `checkDailyLimit(db, who: { userId: string; role?: string | null }, bucket): Promise<LimitResult>`, `limitReachedResponse(bucket, r: LimitResult, extra?: string): Response`.

- [ ] **Step 1: Write the helper**

`src/lib/limits/dailyLimit.ts`:

```ts
// src/lib/limits/dailyLimit.ts — SERVER-ONLY (imports mongodb).
// The one place that counts a member's posts of the last 24 hours and decides
// whether another one is allowed. Used by the seven create/publish gates and
// the three daily-count endpoints.
import { ObjectId, type Db } from 'mongodb';
import { decideLimit, type LimitBucket, type LimitResult } from './limitRules';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Posts of the rolling 24 hours in one bucket. Pending and rejected items count, as before. */
export async function countToday(db: Db, userId: string, bucket: LimitBucket): Promise<number> {
  const since = { $gte: new Date(Date.now() - DAY_MS) };
  if (bucket === 'forum') {
    const counts = await Promise.all(
      ['topics', 'announcements', 'recommendations'].map((c) =>
        db.collection(c).countDocuments({ author: userId, createdAt: since }),
      ),
    );
    return counts.reduce((a, b) => a + b, 0);
  }
  if (bucket === 'events') {
    return db.collection('events').countDocuments({ author: userId, createdAt: since });
  }
  if (bucket === 'listings') {
    return db.collection('listings').countDocuments({ sellerId: userId, createdAt: since, status: { $ne: 'draft' } });
  }
  return db.collection('news').countDocuments({ submittedBy: userId, source: 'user_submitted', createdAt: since });
}

/**
 * Count + decision. The member's type and limit are read LIVE from the user
 * document (the login token is a snapshot and would lag an admin change).
 * A missing user document throws: an unreadable member must never lift the limit.
 */
export async function checkDailyLimit(
  db: Db,
  who: { userId: string; role?: string | null },
  bucket: LimitBucket,
): Promise<LimitResult> {
  const [count, user] = await Promise.all([
    countToday(db, who.userId, bucket),
    db.collection('users').findOne(
      { _id: new ObjectId(who.userId) },
      { projection: { memberType: 1, dailyLimit: 1 } },
    ),
  ]);
  if (!user) throw new Error('daily limit: user not found');
  return decideLimit({ count, role: who.role, user });
}

const NOUN: Record<LimitBucket, string> = {
  forum: 'forum posts',
  events: 'events',
  listings: 'listings',
  news: 'news items',
};

/** The 429 every gate answers. Shape frozen: clients read dailyLimit + currentCount. */
export function limitReachedResponse(bucket: LimitBucket, r: LimitResult, extra = ''): Response {
  return new Response(JSON.stringify({
    error: 'Daily limit reached',
    message: `You can publish up to ${r.limit} ${NOUN[bucket]} per day. Please try again tomorrow${extra}.`,
    dailyLimit: r.limit,
    currentCount: r.count,
  }), { status: 429, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 2: Replace the seven gates**

In each of the seven files the block to replace starts at the comment `// Check daily … limit` (news: `// Daily submit limit`, publish: `// Check daily limit (publishing counts toward limit)`) and ends with the closing `}` of `if (session.user.role !== 'admin' && todayCount >= 5) { … }`. Replace the whole block. Add the import (adjust the relative depth to the file).

`topics/create.ts`, `announcements/create.ts`, `recommendations/create.ts` — the block becomes:

```ts
    // Daily limit (forum bucket: discussions + announcements + recommendations
    // together, rolling 24h) before validation to save API costs.
    const db = await connectDB();
    const limit = await checkDailyLimit(db, { userId, role: session.user.role }, 'forum');
    if (!limit.allowed) return limitReachedResponse('forum', limit);
```

with `import { checkDailyLimit, limitReachedResponse } from '../../../lib/limits/dailyLimit';`.

Each of these three files declared its collection inside the removed block (`const topicsCollection = db.collection<Topic>('topics');`, `announcementsCollection`, `recommendationsCollection`) and uses it further down for the insert. Keep that declaration: put it directly under the new block, unchanged.

`events/create.ts`:

```ts
    // Daily limit (events bucket, rolling 24h) before validation to save API costs.
    const db = await connectDB();
    const eventsCollection = db.collection<any>('events');
    const limit = await checkDailyLimit(db, { userId, role: session.user.role }, 'events');
    if (!limit.allowed) return limitReachedResponse('events', limit);
```

`listings/create.ts`:

```ts
    // Daily limit (listings bucket, rolling 24h; drafts do not count).
    const db = await connectDB();
    const listingsCollection = db.collection<Listing>('listings');
    const limit = await checkDailyLimit(db, { userId, role: session.user.role }, 'listings');
    // The marketplace composer shows this server message as it comes — keep the draft hint.
    if (!limit.allowed) return limitReachedResponse('listings', limit, ' or save as a draft');
```

`listings/draft/[id]/publish.ts` (import depth `'../../../../../lib/limits/dailyLimit'`; `db`, `listingsCollection`, `session`, `userId` already exist above the block — check the names and reuse them):

```ts
    // Daily limit (publishing counts toward the listings bucket).
    const limit = await checkDailyLimit(db, { userId, role: session.user.role }, 'listings');
    if (!limit.allowed) return limitReachedResponse('listings', limit);
```

If `publish.ts` has no `db` variable in scope at that point (only `listingsCollection`), read the top of the handler and use the variable it has; do not open a second connection name that shadows another.

`news/submit.ts`:

```ts
    // Daily limit (news bucket: the member's own submissions, rolling 24h).
    const dbEarly = await connectDB();
    const limit = await checkDailyLimit(dbEarly, { userId, role: session.user.role }, 'news');
    if (!limit.allowed) return limitReachedResponse('news', limit);
```

After each edit, search the file for `todayCount` and `dayAgo`: any later use of a removed variable must be resolved (there should be none; if one exists, report it instead of guessing).

- [ ] **Step 3: Replace the three count endpoints' bodies**

`topics/daily-count.ts` — inside the `try`, replace everything from `const db = await connectDB();` to the `return new Response(...)` with:

```ts
    const db = await connectDB();
    // The forum bucket: discussions + announcements + recommendations together.
    const r = await checkDailyLimit(db, { userId: session.user.id, role: session.user.role }, 'forum');
    return new Response(JSON.stringify({ count: r.count, limit: r.limit, remaining: r.remaining, canCreate: r.allowed }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
```

`news/daily-count.ts` — same shape with bucket `'news'` and the field name `canSubmit: r.allowed` (NOT `canCreate`). Update the file's header comment: „quota = the member's daily limit (5 unless raised)".

`listings/daily-count.ts` — bucket `'listings'`, fields `count, limit, remaining, canCreate`; keep its existing response headers and add `'Cache-Control': 'no-store'`.

Import in all three: `import { checkDailyLimit } from '../../../lib/limits/dailyLimit';`. Remove imports that became unused (e.g. the `Listing` type).

- [ ] **Step 4: Type-check and count**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 16 or fewer. If the number rose, read the new errors (`npx tsc --noEmit 2>&1 | grep "src/pages/api\|src/lib/limits"`) and fix them.

Run: `grep -rn ">= 5\|limit: 5\|dailyLimit: 5" src/pages/api | grep -v "contact.ts"`
Expected: no output.

- [ ] **Step 5: Write and run the dev-database check**

`scratchpad/member-types/limit-check.mts` (the folder is gitignored; do not commit it). It inserts throwaway forum posts for a throwaway user document, checks the bucket, and removes everything it created:

```ts
// Run: npx tsx --env-file=.env scratchpad/member-types/limit-check.mts
// Dev database only. Creates a throwaway user + posts, checks the buckets, cleans up.
import { MongoClient, ObjectId } from 'mongodb';
import { checkDailyLimit } from '../../src/lib/limits/dailyLimit';

const uri = process.env.MONGODB_URI ?? '';
const client = new MongoClient(uri);
await client.connect();
const db = client.db();
if (!db.databaseName.includes('dev')) {
  console.error(`REFUSED: database "${db.databaseName}" is not a dev database`);
  process.exit(1);
}

const _id = new ObjectId();
const userId = _id.toString();
const mark = { __limitCheck: userId };
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`); if (!ok) failed++; };

try {
  await db.collection('users').insertOne({ _id, name: 'Limit Check', createdAt: new Date().toISOString() });
  const post = (c: string) => db.collection(c).insertOne({ author: userId, title: 'limit check', createdAt: new Date(), ...mark });

  await post('topics'); await post('topics'); await post('announcements'); await post('announcements');
  let r = await checkDailyLimit(db, { userId, role: 'user' }, 'forum');
  check('4 mixed forum posts → allowed, 1 remaining', r.count === 4 && r.allowed && r.remaining === 1);

  await post('recommendations');
  r = await checkDailyLimit(db, { userId, role: 'user' }, 'forum');
  check('5 mixed forum posts → refused', r.count === 5 && !r.allowed && r.limit === 5);

  r = await checkDailyLimit(db, { userId, role: 'user' }, 'events');
  check('events bucket untouched by forum posts', r.count === 0 && r.allowed);

  r = await checkDailyLimit(db, { userId, role: 'admin' }, 'forum');
  check('admin exempt', r.allowed);

  await db.collection('users').updateOne({ _id }, { $set: { memberType: 'organisation', dailyLimit: 15 } });
  r = await checkDailyLimit(db, { userId, role: 'user' }, 'forum');
  check('organisation with 15 → allowed, limit 15, 10 remaining', r.allowed && r.limit === 15 && r.remaining === 10);

  await db.collection('users').updateOne({ _id }, { $set: { memberType: 'business' } });
  r = await checkDailyLimit(db, { userId, role: 'user' }, 'forum');
  check('business with a stray number → refused at 5', !r.allowed && r.limit === 5);

  let threw = false;
  try { await checkDailyLimit(db, { userId: new ObjectId().toString(), role: 'user' }, 'forum'); } catch { threw = true; }
  check('unknown user throws', threw);
} finally {
  for (const c of ['topics', 'announcements', 'recommendations']) await db.collection(c).deleteMany(mark);
  await db.collection('users').deleteOne({ _id });
  await client.close();
}
console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

Note: `checkDailyLimit` takes the `db` as a parameter, so the script's own client is used and `src/lib/mongodb.ts` is not involved. If the import of `dailyLimit.ts` fails under `tsx` because of a path or env problem, report the exact error — do not rewrite the helper to make the script run.

Run: `npx tsx --env-file=.env scratchpad/member-types/limit-check.mts`
Expected: seven `OK` lines and `ALL OK`. The script prints no env value.

- [ ] **Step 6: Commit**

```bash
git add src/lib/limits/dailyLimit.ts src/pages/api
git commit -m "feat: one daily-limit helper; forum kinds share one bucket"
```

---

### Task 3: Limit copy and indicators follow the real number

**Files:**
- Modify: `src/lib/kiosk-i18n.ts` (DE + EN: `state.rate.kicker`, `state.rate.body`, `state.rate.body.short`, `news.forumcta.exhausted`, `news.submit.quotaReachedTitle`, `blog.foot.discuss.note`)
- Modify: `src/components/forum/kiosk/states/RateLimitPanel.svelte`
- Modify: `src/components/forum/kiosk/compose/ComposePageInner.svelte`, `src/components/calendar/kiosk/compose/EventComposePageInner.svelte`
- Modify: `src/components/newsboard/kiosk/submit/QuotaIndicator.svelte`, `src/components/newsboard/kiosk/submit/NewsSubmitInner.svelte`
- Modify: `src/pages/design-system.astro` (one sentence)

**Interfaces:**
- Consumes: the 429 body's `dailyLimit` (already carried by `RateLimitError.dailyLimit`, `src/lib/errors.ts`) and `limit` from `GET /api/news/daily-count` (Task 2).
- Produces: `RateLimitPanel` prop `limit?: number` (default 5); `QuotaIndicator` prop `max?: number` (default 5).

- [ ] **Step 1: Change the five keys in both dictionaries**

DE (find each by its current text):

```ts
  'state.rate.kicker': 'LIMIT ERREICHT · {n} BEITRÄGE / TAG',
  'state.rate.body':
    'Du hast {n} Beiträge in den letzten 24 Stunden geschrieben — das ist viel! Wir geben Mahalle und allen anderen Lesenden ein bisschen Zeit.',
  'state.rate.body.short': '{n} heute · komm morgen wieder.',
  'news.forumcta.exhausted': 'Tageslimit für Forenbeiträge erreicht — morgen geht’s weiter.', // DRAFT
  'news.submit.quotaReachedTitle': '{used} / {max} Einreichungen heute genutzt.',
```

EN:

```ts
  'state.rate.kicker': 'LIMIT REACHED · {n} POSTS / DAY',
  'state.rate.body':
    "You've made {n} posts in the last 24 hours — that's a lot! We're giving Mahalle and other readers some breathing room.",
  'state.rate.body.short': '{n} today · come back tomorrow.',
  'news.forumcta.exhausted': 'Daily limit for forum posts reached — back tomorrow.', // DRAFT
  'news.submit.quotaReachedTitle': '{used} / {max} submissions used today.',
```

Also make `blog.foot.discuss.note` number-free in both dictionaries (it says „zählt zu deinen 5 Beiträgen/Tag" / "counts toward your 5 posts/day"): replace only the number phrase — DE „zählt zu deinem Tageslimit", EN "counts toward your daily limit" — and keep the rest of each sentence as it is. Mark both `// DRAFT`.

- [ ] **Step 2: `RateLimitPanel.svelte` takes the number**

Replace the import line and the props block:

```svelte
  import { t, tStr } from '../../../../lib/kiosk-i18n';

  let { unlocksIn = '04:47:12' as string | null, limit = 5 } = $props<{
    unlocksIn?: string | null;
    /** The member's real daily limit, from the 429 (`RateLimitError.dailyLimit`). */
    limit?: number;
  }>();
```

and in the markup:

```svelte
    {tStr($t['state.rate.kicker'], { n: limit })}
```

```svelte
    {unlocksIn === null ? tStr($t['state.rate.body.short'], { n: limit }) : tStr($t['state.rate.body'], { n: limit })}
```

In the file's header comment replace the sentence about „5 per rolling 24 hours (src/pages/api/topics/create.ts:24–43)" with: „The limit is per bucket and per member (src/lib/limits/dailyLimit.ts); the panel prints the number the 429 carried."

- [ ] **Step 3: Both compose pages keep the number**

In `ComposePageInner.svelte` and `EventComposePageInner.svelte`, next to `let rateLimited = $state(false);` add:

```ts
  let rateLimit = $state(5);
```

in the `catch`, change

```ts
      if (caught instanceof RateLimitError) {
        rateLimited = true;
```

to

```ts
      if (caught instanceof RateLimitError) {
        rateLimit = caught.dailyLimit;
        rateLimited = true;
```

and the markup `<RateLimitPanel unlocksIn={null} />` to `<RateLimitPanel unlocksIn={null} limit={rateLimit} />`.

- [ ] **Step 4: `QuotaIndicator.svelte` and its parent**

Replace the whole file `QuotaIndicator.svelte`:

```svelte
<script lang="ts">
  import { t } from '../../../../lib/kiosk-i18n';
  // `max` is the member's real daily limit (GET /api/news/daily-count → limit).
  // One slot per submission up to 10; above that the row of slots would not
  // fit, so only the „used / max" line is printed.
  let { used = 0, max = 5 }: { used?: number; max?: number } = $props();
  const remaining = $derived(Math.max(0, max - used));
</script>

<div class="flex items-center" style="gap:12px; padding:10px 12px; background:var(--k-paper-soft); border:1px solid var(--k-rule); border-radius:var(--k-radius-sm);">
  {#if max <= 10}
    <div class="flex" style="gap:3px;">
      {#each Array(max) as _, i}
        <div style="width:14px; height:18px; border:1px solid var(--k-ink); border-radius:2px; background:{i < used ? 'var(--k-ink)' : 'transparent'};"></div>
      {/each}
    </div>
  {/if}
  <div>
    <div class="font-dmmono" style="font-size:10px; color:var(--k-ink); letter-spacing:0.1em;">{used} / {max} {$t['news.submit.quotaUsed']}</div>
    <div class="font-instrument italic" style="font-size:11.5px; color:var(--k-ink-soft);">
      {remaining > 0 ? `${remaining} ${$t['news.submit.quotaRemaining']}` : $t['news.submit.quotaReached']}
    </div>
  </div>
</div>
```

In `NewsSubmitInner.svelte`:
- next to `let used = $state(0);` add `let max = $state(5);`
- the fetch line becomes
  `if (res.ok) { const d = await res.json(); used = d.count; max = typeof d.limit === 'number' ? d.limit : 5; quotaReached = !d.canSubmit; }`
- `<QuotaIndicator {used} />` becomes `<QuotaIndicator {used} {max} />`
- `{$t['news.submit.quotaReachedTitle']}` becomes `{tStr($t['news.submit.quotaReachedTitle'], { used, max })}`; add `tStr` to the file's `kiosk-i18n` import if it is not imported yet.

- [ ] **Step 5: `design-system.astro` sentence**

Find the paragraph containing `dailyLimit: 5</code> enforced by`. Replace the text from „Copy adapted to" to the end of the paragraph with:

```html
        Copy adapted to <b>n/Tag</b>: the number comes from the member's real
        daily limit (<code class="font-dmmono text-[12px]">src/lib/limits/dailyLimit.ts</code>; the JSX shows
        5/Stunde, which the API never enforced).
```

Leave the sandbox mount `<RateLimitPanel unlocksIn="04:47:12" client:load />` as it is (default `limit` 5).

- [ ] **Step 6: Check and commit**

Run: `grep -n "'state.rate.kicker'\|'state.rate.body.short'\|'news.submit.quotaReachedTitle'\|'news.forumcta.exhausted'" src/lib/kiosk-i18n.ts`
Expected: eight lines, none containing a bare „5". And `grep -n "5 Beiträgen/Tag\|5 posts/day" src/lib/kiosk-i18n.ts` → no output.

Run: `npx -y svelte-check@4 --output machine 2>&1 | grep COMPLETED`
Expected: the error count (5th field) is 81 or lower.

```bash
git add src/lib/kiosk-i18n.ts src/components src/pages/design-system.astro
git commit -m "fix: limit copy and quota indicator show the member's real limit"
```

---

### Task 4: The type travels through the five member-data paths

**Files:**
- Modify: `src/lib/publicAuthor.ts`, `src/lib/publicAuthor.test.ts`
- Modify: `src/lib/topicsQuery.ts` (`populateAuthors`)
- Modify: `src/lib/listingsQuery.ts` (`SELLER_PROJECTION`, `populateSellers`), `src/types/listing.ts`
- Modify: `src/lib/profile/publicProfile.ts`, `src/lib/profile/profileQuery.ts`, `src/lib/profile/profileShared.ts`
- Modify: `src/lib/auth/accountDeletion.ts` (tombstone `$unset`)

**Interfaces:**
- Consumes: `storedMemberType`, `type MemberType` from `src/lib/members/memberType.ts`.
- Produces (Task 5 and 6 read these): `author.memberType: MemberType` on every populated author; `Listing.sellerMemberType?: MemberType`; `PublicProfile.memberType: MemberType`; `ProfileMe.memberType: MemberType`.

- [ ] **Step 1: Update the pinned test first**

In `src/lib/publicAuthor.test.ts`:
- the allowlist expectation becomes `['createdAt', 'handle', 'image', 'memberType', 'name', 'role', 'userPicture', 'verified']`
- the `toPublicAuthor drops everything` expectation becomes `['_id', 'createdAt', 'handle', 'image', 'memberType', 'name', 'role', 'verified']`
- add inside that same test: `assert.equal(out.memberType, 'person');`
- add a new test:

```ts
test('memberType is always one of the three values; the limit never leaves', () => {
  assert.equal(toPublicAuthor({ _id: '1', memberType: 'business' }).memberType, 'business');
  assert.equal(toPublicAuthor({ _id: '1', memberType: 'organisation', dailyLimit: 20 }).memberType, 'organisation');
  assert.equal(toPublicAuthor({ _id: '1', memberType: 'admin' }).memberType, 'person');
  assert.equal('dailyLimit' in toPublicAuthor({ _id: '1', memberType: 'organisation', dailyLimit: 20 }), false);
  assert.equal('dailyLimit' in PUBLIC_AUTHOR_PROJECTION, false);
});
```

Run: `npx tsx --test src/lib/publicAuthor.test.ts` — Expected: FAIL.

- [ ] **Step 2: `publicAuthor.ts`**

```ts
import { storedMemberType, type MemberType } from './members/memberType';

export const PUBLIC_AUTHOR_PROJECTION = {
  name: 1, image: 1, userPicture: 1, createdAt: 1, verified: 1, role: 1, handle: 1,
  // 2026-10-01: the self-chosen member type (tag beside the name). NEVER add
  // `dailyLimit` here — it is the admin's number and stays server-side.
  memberType: 1,
} as const;
```

add `memberType: MemberType;` to `PublicAuthor`, and `memberType: storedMemberType(u),` to the object `toPublicAuthor` returns. Keep the file's header comment.

Run: `npx tsx --test src/lib/publicAuthor.test.ts` — Expected: `ℹ fail 0`.

- [ ] **Step 3: `populateAuthors` normalises too**

In `src/lib/topicsQuery.ts` add `import { storedMemberType } from './members/memberType';` and change the map line

```ts
  for (const u of users) userMap.set(u._id.toString(), { ...u, image: u.image || u.userPicture || null });
```

to

```ts
  // memberType is normalised here as well: this join spreads the raw document
  // (it does not go through toPublicAuthor), and a browser must only ever
  // receive one of the three values.
  for (const u of users) userMap.set(u._id.toString(), {
    ...u,
    image: u.image || u.userPicture || null,
    memberType: storedMemberType(u),
  });
```

- [ ] **Step 4: Seller join**

`src/lib/listingsQuery.ts`: add `memberType: 1` to `SELLER_PROJECTION` with the comment line
`// `memberType` (2026-10-01): the tag beside the seller's name. Never `dailyLimit`.`
and in `populateSellers`' returned object add

```ts
      sellerMemberType: storedMemberType(u),
```

(import `storedMemberType` from `'./members/memberType'`; `u` may be `undefined` — the function accepts that).

`src/types/listing.ts`: under `sellerVerified?: boolean;` add

```ts
  sellerMemberType?: MemberType;
```

and import the type: `import type { MemberType } from '../lib/members/memberType';` (check the file's existing import style; if it has no imports from `lib`, this relative path is still correct from `src/types/`).

- [ ] **Step 5: The two profile paths**

`src/lib/profile/profileShared.ts`: add `import type { MemberType } from '../members/memberType';` at the top, and to BOTH `ProfileMe` and `PublicProfile`:

```ts
  memberType: MemberType; // self-chosen; 'person' when the user doc has no field (2026-10-01)
```

`src/lib/profile/publicProfile.ts` (`getPublicProfile`): add `memberType: 1,` to the projection and `memberType: storedMemberType(user),` to the returned object (import from `'../members/memberType'`).

`src/lib/profile/profileQuery.ts` (`getProfileMe`): add `memberType: 1` to the projection object and `memberType: storedMemberType(user),` to the returned object (same import).

- [ ] **Step 6: Tombstone**

`src/lib/auth/accountDeletion.ts`: in the tombstone update's `$unset` object (the one that lists `roleBadge: ''`, `motto: ''`, `tours: ''` …) add

```ts
          memberType: '',
          dailyLimit: '',
```

- [ ] **Step 7: Check and commit**

Run: `grep -rn "PublicProfile\b\|ProfileMe\b" src --include=*.ts --include=*.svelte --include=*.astro -l`
For every file that BUILDS one of these objects by hand (an object literal with `stats:` and `memberSince:`), add `memberType`. Files that only read them need nothing.

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — Expected: ≤ 16.
Run: `npx tsx --test src/lib/publicAuthor.test.ts` — Expected: `ℹ fail 0`.

```bash
git add src/lib src/types
git commit -m "feat: member type travels with author, seller and profile data"
```

---

### Task 5: The tag component on seven surfaces

**Files:**
- Create: `src/components/forum/kiosk/MemberTypeTag.svelte` (beside `KioskAvatar.svelte`, which the same surfaces already share)
- Modify: `src/lib/kiosk-i18n.ts` (two keys, DE + EN)
- Modify: `src/components/forum/kiosk/ForumPostCard.svelte`, `ForumPostDetail.svelte`, `ForumComment.svelte`
- Modify: `src/components/marketplace/kiosk/detail/SellerCard.svelte`, `MarketDetailInner.svelte`
- Modify: `src/components/calendar/kiosk/EventDetailModal.svelte`
- Modify: `src/components/profile/kiosk/PPublicIdentityCard.svelte`, `PIdentityCard.svelte` (read state only; the edit control is Task 6)

**Interfaces:**
- Consumes: `memberTypeTagKey` from `src/lib/members/memberType.ts`; the data fields of Task 4.
- Produces: `<MemberTypeTag type={…} tone="paper" | "ink" />` — renders NOTHING for a person, `undefined` or an unknown value; root element carries `data-member-tag={type}`.

- [ ] **Step 1: i18n keys**

DE, next to `'role.team'`:

```ts
  'member.tag.organisation': 'Initiative',
  'member.tag.business': 'Gewerbe',
```

EN, next to its `'role.team'`:

```ts
  'member.tag.organisation': 'Initiative',
  'member.tag.business': 'Business',
```

- [ ] **Step 2: The component**

`src/components/forum/kiosk/MemberTypeTag.svelte`:

```svelte
<script lang="ts">
  // The small tag beside a member's name: „Initiative" or „Gewerbe".
  // A private person carries none, and so does any missing or unknown value —
  // the tag can never print for data it does not recognise.
  // Tailwind classes only: this component is reached through other islands,
  // and a scoped <style> block would be orphaned in production builds.
  import { t } from '../../../lib/kiosk-i18n';
  import { memberTypeTagKey } from '../../../lib/members/memberType';

  let { type, tone = 'paper' }: {
    type?: string | null;
    /** `ink` for dark (ink) cards, `paper` everywhere else. */
    tone?: 'paper' | 'ink';
  } = $props();

  const key = $derived(memberTypeTagKey(type));
</script>

{#if key}
  <span
    data-member-tag={type}
    class={`shrink-0 inline-flex items-center font-dmmono text-[8.5px] font-semibold uppercase tracking-[0.08em] px-1.5 py-px rounded-sm border align-middle ${
      tone === 'ink' ? 'border-paper text-paper' : 'border-ink text-ink'
    }`}
  >{$t[key]}</span>
{/if}
```

- [ ] **Step 3: Forum post card**

`ForumPostCard.svelte`: import `MemberTypeTag from './MemberTypeTag.svelte'`. In the `topic` prop type, extend `author` with `memberType?: string`. Directly after the closing `{/if}` of the `{#if team} … {/if}` block (the „Mahalle-Team" tag) add:

```svelte
            <MemberTypeTag type={topic.author?.memberType} tone={isInkCard ? 'ink' : 'paper'} />
```

- [ ] **Step 4: Post detail**

`ForumPostDetail.svelte`: import the component. The name is an `<a>` or a `<span>` inside `<div class="flex flex-col leading-tight">`. Wrap the name element and the tag in one row so the tag sits beside the name, not under it — replace the `{#if authorId} <a …>{authorName}</a> {:else} <span …>{authorName}</span> {/if}` block with:

```svelte
          <span class="flex items-center gap-1.5">
            {#if authorId}
              <a
                href={`/nachbarn/id/${authorId}`}
                class="font-bricolage font-bold text-[13px] text-ink hover:underline underline-offset-2"
                aria-label={viewProfileLabel}
              >
                {authorName}
              </a>
            {:else}
              <span class="font-bricolage font-bold text-[13px] text-ink">
                {authorName}
              </span>
            {/if}
            <MemberTypeTag type={topic.author?.memberType} />
          </span>
```

- [ ] **Step 5: Comment**

`ForumComment.svelte`: import the component; extend the `author` object type in the props with `memberType?: string`. Add a derived next to `commentAuthorHandle`:

```ts
  const commentAuthorType = $derived(
    typeof comment.author === 'object' ? (comment.author?.memberType ?? null) : null
  );
```

and directly after the `{#if commentAuthorHandle} … {/if}` block in the `<header>`:

```svelte
      <MemberTypeTag type={commentAuthorType} />
```

- [ ] **Step 6: Seller card**

`SellerCard.svelte`: import `MemberTypeTag from '../../../forum/kiosk/MemberTypeTag.svelte'`; add the prop `sellerMemberType = null` typed `sellerMemberType?: string | null;`. In the „Badges row", before `{#if isVerified}`:

```svelte
    <MemberTypeTag type={sellerMemberType} />
```

That row is `display: flex; gap: 6px; flex-wrap: wrap;` — it renders empty-and-invisible for a person with no badges, as today.

`MarketDetailInner.svelte`: on the `<SellerCard …>` mount add `sellerMemberType={listing.sellerMemberType}`.

- [ ] **Step 7: Event author slab**

`EventDetailModal.svelte`: import `MemberTypeTag from '../../forum/kiosk/MemberTypeTag.svelte'`. Add next to `authorHandle`:

```ts
  const authorType = $derived(
    typeof event?.author === 'object' && event?.author !== null
      ? (((event.author as any).memberType as string | undefined) ?? null)
      : null
  );
```

The tag goes BESIDE the name. Replace the `{#if showAuthorLink} <a …>{authorName}</a> {:else} <div …>{authorName}</div> {/if}` block with the same two elements wrapped in one row:

```svelte
                <div class="flex items-center gap-1.5 flex-wrap">
                  {#if showAuthorLink}
                    <a
                      href={`/nachbarn/id/${authorId}`}
                      class="font-bricolage font-semibold text-[13px] hover:underline underline-offset-2"
                      aria-label={viewProfileLabel}
                    >{authorName}</a>
                  {:else}
                    <div class="font-bricolage font-semibold text-[13px]">{authorName}</div>
                  {/if}
                  <MemberTypeTag type={authorType} />
                </div>
```

- [ ] **Step 8: The two profile cards (read state)**

The tag goes BESIDE the name on both cards.

`PPublicIdentityCard.svelte`: import `MemberTypeTag from '../../forum/kiosk/MemberTypeTag.svelte'`. Wrap the `<h2 …>{profile.name}</h2>` in a row and put the tag after it (the `<h2>` itself stays unchanged):

```svelte
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <h2
          class="font-bricolage"
          style="font-size: 26px; font-weight: 800; letter-spacing: -0.03em; margin: 0; line-height: 1.05;"
        >{profile.name}</h2>
        <MemberTypeTag type={profile.memberType} />
      </div>
```

`PIdentityCard.svelte`: same import. The READ state already has that row (`<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">` holding the `<h2>` and the save chip). Add directly after the `</h2>`, before the `{#if saveState === 'saving' …}` chip:

```svelte
          <MemberTypeTag type={profile.memberType} />
```

(Task 6 changes `profile.memberType` here to the optimistic value.)

- [ ] **Step 9: Check and commit**

Run: `npx -y svelte-check@4 --output machine 2>&1 | grep COMPLETED` — Expected: errors ≤ 81.
Run: `grep -rn "MemberTypeTag" src --include=*.svelte -l | wc -l` — Expected: 8 (the component + 7 surfaces).

```bash
git add src/components src/lib/kiosk-i18n.ts
git commit -m "feat: Initiative / Gewerbe tag beside member names"
```

---

### Task 6: Choosing the type — signup and profile edit, with the Telegram ping

**Files:**
- Create: `src/components/profile/kiosk/atoms/MemberTypeChoice.svelte`
- Modify: `src/lib/kiosk-i18n.ts` (choice keys, DE + EN)
- Modify: `src/pages/api/auth/register.ts`, `src/components/auth/kiosk/AuthRegisterInner.svelte`
- Modify: `src/pages/api/users/update.ts`, `src/components/profile/kiosk/PIdentityCard.svelte`, `src/components/profile/kiosk/ProfileInner.svelte`
- Modify: `src/lib/adminAlerts.ts`

**Interfaces:**
- Consumes: `parseMemberType`, `storedMemberType`, `MEMBER_TYPES`, `type MemberType` (Task 1); `planSelfTypeChange` (Task 1); `ProfileMe.memberType` (Task 4); `MemberTypeTag` (Task 5).
- Produces: `POST /api/auth/register` accepts optional `memberType`, 400 `member_type_invalid`; `POST /api/users/update` accepts optional `memberType` and echoes `memberType` in its response; `alertNewMember({ name, handle, memberType? })`, `alertMemberType({ name, handle, memberType })`.

- [ ] **Step 1: i18n keys (both dictionaries)**

DE, next to `'auth.register.handleHint'`:

```ts
  'member.type.label': 'ICH BIN HIER ALS', // DRAFT
  'member.type.person': 'Privatperson',
  'member.type.organisation': 'Verein · Initiative',
  'member.type.business': 'Gewerbe',
  'member.type.hint': 'Initiativen und Gewerbe tragen ein kleines Schild am Namen. Im Profil jederzeit änderbar.', // DRAFT
  'auth.err.memberType': 'Bitte wähle eine der drei Angaben.', // DRAFT
```

EN:

```ts
  'member.type.label': 'I AM HERE AS', // DRAFT
  'member.type.person': 'Private person',
  'member.type.organisation': 'Association · initiative',
  'member.type.business': 'Business',
  'member.type.hint': 'Initiatives and businesses carry a small tag beside their name. Changeable any time in your profile.', // DRAFT
  'auth.err.memberType': 'Please pick one of the three.', // DRAFT
```

- [ ] **Step 2: The shared choice control**

`src/components/profile/kiosk/atoms/MemberTypeChoice.svelte` (inline styles only — it is reached through other islands):

```svelte
<script lang="ts">
  // Three-way choice: Privatperson / Verein · Initiative / Gewerbe.
  // Used by the signup form and the profile edit state. A radio group, so
  // arrow keys and screen readers work without extra code.
  import { t } from '../../../../lib/kiosk-i18n';
  import { MEMBER_TYPES, type MemberType } from '../../../../lib/members/memberType';

  let { value, onchange, disabled = false, name = 'memberType' }: {
    value: MemberType;
    onchange: (v: MemberType) => void;
    disabled?: boolean;
    name?: string;
  } = $props();
</script>

<fieldset style="border: 0; margin: 0; padding: 0; min-width: 0;" {disabled}>
  <legend class="font-dmmono" style="font-size: 9.5px; letter-spacing: 0.14em; color: var(--k-ink-mute); margin-bottom: 6px; padding: 0;">
    {$t['member.type.label']}
  </legend>
  <div style="display: flex; flex-wrap: wrap; gap: 6px;">
    {#each MEMBER_TYPES as opt (opt)}
      <label
        class="font-bricolage"
        data-member-choice={opt}
        style="
          position: relative; display: inline-flex; align-items: center; min-height: 36px; padding: 6px 12px;
          border: 1.5px solid var(--k-ink); border-radius: 999px; cursor: pointer;
          font-size: 13px; font-weight: 600;
          background: {value === opt ? 'var(--k-ink)' : 'var(--k-paper-soft)'};
          color: {value === opt ? 'var(--k-paper)' : 'var(--k-ink)'};
        "
      >
        <input
          type="radio"
          {name}
          value={opt}
          checked={value === opt}
          onchange={() => onchange(opt)}
          style="position: absolute; opacity: 0; width: 1px; height: 1px;"
        />
        {$t[`member.type.${opt}`]}
      </label>
    {/each}
  </div>
  <div class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute); margin-top: 6px;">
    {$t['member.type.hint']}
  </div>
</fieldset>
```

If `$t[\`member.type.${opt}\`]` fails the type-check because the dictionary is keyed by literal strings, index with a small map instead:
`const LABEL = { person: 'member.type.person', organisation: 'member.type.organisation', business: 'member.type.business' } as const;` and `{$t[LABEL[opt]]}`.

The hidden radio input needs a visible focus mark: add to the `<label>` the Tailwind class `focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--k-ink)]` (class attribute already has `font-bricolage`).

- [ ] **Step 3: Alerts**

`src/lib/adminAlerts.ts`:
- add `| 'member_type'` to the `AdminAlertKind` union (do NOT add it to `EMAIL_KINDS` — Telegram only);
- replace `alertNewMember` and add the new builder:

```ts
// Tag wording for the alert text — same words the member sees beside a name.
const MEMBER_TYPE_WORD: Record<'organisation' | 'business', string> = {
  organisation: 'Initiative',
  business: 'Gewerbe',
};

export function alertNewMember(p: { name: string; handle: string; memberType?: 'person' | 'organisation' | 'business' }): Promise<void> {
  const typ = p.memberType === 'organisation' || p.memberType === 'business'
    ? ` — als ${MEMBER_TYPE_WORD[p.memberType]}`
    : '';
  return sendAdminAlert({
    kind: 'member_new',
    text: `🆕 Neues Mitglied: ${trunc(p.name)} (@${p.handle})${typ}`,
  });
}

/** A member chose Initiative or Gewerbe in profile edit. Never sent for a change to person. */
export function alertMemberType(p: { name: string; handle: string | null; memberType: 'organisation' | 'business' }): Promise<void> {
  const at = p.handle ? ` (@${p.handle})` : '';
  return sendAdminAlert({
    kind: 'member_type',
    text: `🏷️ ${trunc(p.name)}${at} hat sich als ${MEMBER_TYPE_WORD[p.memberType]} eingetragen\n→ ${ALERT_BASE_URL}/admin/mitglieder`,
  });
}
```

- [ ] **Step 4: Signup route**

`src/pages/api/auth/register.ts`:
- import: `import { parseMemberType } from "../../../lib/members/memberType";`
- destructure the new field: `const { name: rawName, email, password, handle: rawHandle, memberType: rawMemberType } = await request.json();`
- directly AFTER the `password.length < 6` check and BEFORE the per-IP throttle (it is a free check and must run before the paid name check):

```ts
        // Member type (2026-10-01): missing → person; anything unknown is refused.
        const memberType = rawMemberType === undefined || rawMemberType === null
            ? 'person'
            : parseMemberType(rawMemberType);
        if (!memberType) {
            return new Response(
                JSON.stringify({ error: 'member_type_invalid' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
```

- in the `insertOne` document, after the `handleChosen` spread line:

```ts
                    // person stores nothing — the absent field IS „person".
                    ...(memberType !== 'person' ? { memberType } : {}),
```

- the alert call becomes `await alertNewMember({ name, handle: finalHandle, memberType });`

- [ ] **Step 5: Signup form**

`AuthRegisterInner.svelte`:
- imports: `import MemberTypeChoice from '../../profile/kiosk/atoms/MemberTypeChoice.svelte';` and `import type { MemberType } from '../../../lib/members/memberType';`
- state: `let memberType = $state<MemberType>('person');` and `let memberTypeErr = $state<string | null>(null);`
- in the reset line at the start of `submit` add `memberTypeErr = null;`
- request body: `body: JSON.stringify({ name: cleanName, email: email.trim(), password, ...(chosen ? { handle: chosen } : {}), memberType }),`
- in the error-code chain, directly after the `name_protected` line:

```ts
        if (code === 'member_type_invalid') { memberTypeErr = $t['auth.err.memberType']; status = 'idle'; return; }
```

- markup: directly after the handle `<AuthField … />` and before the e-mail field:

```svelte
    <div>
      <MemberTypeChoice value={memberType} onchange={(v) => { memberType = v; memberTypeErr = null; }} />
      {#if memberTypeErr}
        <div class="font-dmmono" role="alert" style="font-size: 10px; color: var(--k-danger); margin-top: 4px;">{memberTypeErr}</div>
      {/if}
    </div>
```

- [ ] **Step 6: Profile update route**

`src/pages/api/users/update.ts`:
- imports:

```ts
import { MEMBER_TYPES, storedMemberType } from '../../../lib/members/memberType';
import { planSelfTypeChange } from '../../../lib/members/memberTypeChange';
import { alertMemberType } from '../../../lib/adminAlerts';
```

- schema: add the field and extend the refine. NEVER add `dailyLimit` here — Zod strips unknown keys, which is what keeps a member from writing it.

```ts
  // Self-chosen member type (label only). `dailyLimit` is deliberately NOT in
  // this schema: unknown keys are stripped, so a member can never write it.
  memberType: z.enum(MEMBER_TYPES, { message: 'member_type_invalid' }).optional(),
}).refine((d) => d.name !== undefined || d.hobbies !== undefined || d.motto !== undefined || d.memberType !== undefined, { message: 'Nothing to update' });
```

  (Verified against the installed Zod 3.25: `{ message }` is accepted and an unknown value yields exactly `member_type_invalid`.) The route already answers 400 with `issues[0].message`, so the client receives `member_type_invalid`.

- destructure: `const { name, hobbies, motto, memberType } = parsed.data;`
- after `const users = db.collection('users');` and before `setFields` is built, pre-read and plan:

```ts
    // The type change needs the stored value (re-saving the same type must
    // neither clear the admin's limit nor ping). Read-then-write is not
    // atomic: two parallel saves can ping twice — accepted.
    let typePlan: ReturnType<typeof planSelfTypeChange> | null = null;
    if (memberType !== undefined) {
      const before = await users.findOne(
        { _id: new ObjectId(session.user.id) },
        { projection: { memberType: 1 } }
      );
      if (!before) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      typePlan = planSelfTypeChange(storedMemberType(before), memberType);
    }
```

- after the existing `if (motto === '') unsetFields.motto = '';` line:

```ts
    if (typePlan?.changed) {
      if (typePlan.set.memberType) setFields.memberType = typePlan.set.memberType;
      for (const f of typePlan.unset) unsetFields[f] = '';
    }
```

- the `findOneAndUpdate` projection becomes `{ name: 1, hobbies: 1, motto: 1, memberType: 1, handle: 1 }`.
- after the `if (!result) { … 404 … }` block and before the success response:

```ts
    // Operational ping (never-throw, no-op without env): only when the member's
    // own change ended on Initiative or Gewerbe. Admins never alert themselves.
    if (typePlan?.ping && typePlan.set.memberType && session.user.role !== 'admin') {
      await alertMemberType({
        name: String(result.name ?? ''),
        handle: typeof result.handle === 'string' ? result.handle : null,
        memberType: typePlan.set.memberType,
      });
    }
```

- add to the success JSON: `memberType: storedMemberType(result),`

- [ ] **Step 7: Profile card edit state**

`PIdentityCard.svelte`:
- imports: `import MemberTypeChoice from './atoms/MemberTypeChoice.svelte';` and `import type { MemberType } from '../../../lib/members/memberType';`
- the `onSaved` prop type and `Editable` gain the field:

```ts
    onSaved: (p: { name: string; hobbies: string[]; motto: string | null; memberType: MemberType }) => void;
```

```ts
  type Editable = { name: string; hobbies: string[]; motto: string | null; memberType: MemberType };
```

- derived display value next to `displayMotto`:

```ts
  const displayMemberType = $derived(optimisticOverride?.memberType ?? profile.memberType);
```

- edit state: `let editMemberType = $state<MemberType>('person');` and in `startEdit()`: `editMemberType = displayMemberType;`
- `handleSave()`: the payload line becomes

```ts
    const payload: Editable = { name: trimmed, hobbies: [...editHobbies], motto: trimmedMotto || '', memberType: editMemberType };
```

  (the optimistic line `optimisticOverride = { ...payload, motto: trimmedMotto || null };` needs no change — it spreads the payload.)
- `submit()`: the error mapping gains one line before the final `: msg`:

```ts
          : msg === 'member_type_invalid' ? $t['auth.err.memberType']
```

  and the echo object gains

```ts
        memberType: json.memberType === 'organisation' || json.memberType === 'business' ? json.memberType : 'person',
```

- read state: the tag added in Task 5 reads `displayMemberType` instead of `profile.memberType`.
- edit state markup: directly after the motto hint `<div … >{$t['profile.edit.motto.hint']}</div>`:

```svelte
        <div style="margin-top: 12px;">
          <MemberTypeChoice value={editMemberType} onchange={(v) => (editMemberType = v)} name="profileMemberType" />
        </div>
```

`ProfileInner.svelte`: the `onSaved` handler becomes

```svelte
            profile = { ...profile, name: p.name, hobbies: p.hobbies, motto: p.motto, memberType: p.memberType };
```

- [ ] **Step 8: Check and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — Expected: ≤ 16.
Run: `npx -y svelte-check@4 --output machine 2>&1 | grep COMPLETED` — Expected: errors ≤ 81.
Run: `grep -n "dailyLimit" src/pages/api/users/update.ts src/pages/api/auth/register.ts`
Expected: only the comment line in `update.ts`; no code reads or writes it.

```bash
git add src/components src/lib src/pages/api/auth/register.ts src/pages/api/users/update.ts
git commit -m "feat: members choose their type at signup and in profile edit"
```

---

### Task 7: Admin — type column, limit field, PATCH

**Files:**
- Modify: `src/pages/api/admin/users/index.ts`, `src/pages/api/admin/users/[id].ts`
- Modify: `src/components/admin/kiosk/MitgliederApp.svelte`
- Modify: `src/lib/kiosk-i18n.ts` (admin keys, DE + EN)

**Interfaces:**
- Consumes: `storedMemberType`, `effectiveDailyLimit`, `MEMBER_TYPES`, `MAX_DAILY_LIMIT`, `type MemberType` (Task 1); `planAdminPatch` (Task 1); i18n keys `member.type.*` (Task 6).
- Produces: `GET /api/admin/users` rows carry `memberType: MemberType` and `dailyLimit: number | null`; `PATCH /api/admin/users/[id]` accepts `{ verified?, memberType?, dailyLimit? }` and answers `{ success, verified, memberType, dailyLimit }`.

- [ ] **Step 1: i18n keys**

DE, after `'admin.users.toast.fail'`:

```ts
  'admin.users.type.label': 'TYP',
  'admin.users.limit.label': 'LIMIT / TAG',
  'admin.users.limit.hint': 'leer = 5', // DRAFT
  'admin.users.toast.limit': 'Limit: ganze Zahl von 1 bis 50.', // DRAFT
```

EN:

```ts
  'admin.users.type.label': 'TYPE',
  'admin.users.limit.label': 'LIMIT / DAY',
  'admin.users.limit.hint': 'empty = 5', // DRAFT
  'admin.users.toast.limit': 'Limit: a whole number from 1 to 50.', // DRAFT
```

- [ ] **Step 2: List endpoint**

`src/pages/api/admin/users/index.ts`: import `storedMemberType` from `'../../../../lib/members/memberType'`; add `memberType: 1, dailyLimit: 1` to the projection; add to each mapped row:

```ts
      memberType: storedMemberType(u),
      // The stored number, shown only for an organisation (it counts for no one else).
      dailyLimit:
        storedMemberType(u) === 'organisation' && typeof u.dailyLimit === 'number' ? u.dailyLimit : null,
```

- [ ] **Step 3: PATCH endpoint**

`src/pages/api/admin/users/[id].ts` — replace the header comment's first sentence, the schema and the `try` block's body.

Header comment (keep the rest):

```ts
// PATCH /api/admin/users/[id] — admin writes on a member: `verified` (Kiez-
// verification v1), `memberType` (correcting the member's own choice) and
// `dailyLimit` (1–50, organisations only). This admin-gated endpoint is the
// ONLY writer of `verified` and `dailyLimit` — keep it that way.
```

Imports and schema:

```ts
import { MEMBER_TYPES, MAX_DAILY_LIMIT } from '../../../../lib/members/memberType';
import { planAdminPatch } from '../../../../lib/members/memberTypeChange';

const BodySchema = z.object({
  verified: z.boolean().optional(),
  memberType: z.enum(MEMBER_TYPES).optional(),
  dailyLimit: z.number().int().min(1).max(MAX_DAILY_LIMIT).nullable().optional(),
}).strict();
```

`try` body:

```ts
    const db = await connectDB();
    const users = db.collection('users');
    const _id = new ObjectId(id);
    // Read first: the limit rule depends on the member's type AFTER this call.
    const stored = await users.findOne(
      { _id, anonymized: { $ne: true } },
      { projection: { memberType: 1, dailyLimit: 1, verified: 1 } }
    );
    if (!stored) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const plan = planAdminPatch(stored, parsed.data);
    if (!plan.ok) {
      return new Response(JSON.stringify({ error: plan.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const update: Record<string, Record<string, unknown>> = {};
    if (Object.keys(plan.set).length > 0) update.$set = plan.set;
    if (plan.unset.length > 0) update.$unset = Object.fromEntries(plan.unset.map((f) => [f, '']));
    if (Object.keys(update).length > 0) {
      await users.updateOne({ _id, anonymized: { $ne: true } }, update);
    }

    return new Response(JSON.stringify({
      success: true,
      verified: plan.set.verified ?? stored.verified === true,
      memberType: plan.result.memberType,
      dailyLimit: plan.result.dailyLimit,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
```

Rename the `console.error` text in the `catch` to `'Admin user update error:'`.

- [ ] **Step 4: The island**

`MitgliederApp.svelte`:

- imports:

```ts
  import { MEMBER_TYPES, MAX_DAILY_LIMIT, type MemberType } from '../../../lib/members/memberType';
```

- `AdminUserRow` gains `memberType: MemberType;` and `dailyLimit: number | null;`
- generalise the write. Replace `toggleVerified` with a shared patch function and three callers:

```ts
  type RowPatch = { verified?: boolean; memberType?: MemberType; dailyLimit?: number | null };

  // Optimistic write with rollback. The server's echo is the truth afterwards
  // (e.g. leaving „organisation" clears the limit server-side).
  async function patchRow(row: AdminUserRow, patch: RowPatch, optimistic: Partial<AdminUserRow>) {
    if (busy.has(row.id)) return;
    busy = new Set(busy).add(row.id);
    const prev = { ...row };
    users = users.map((u) => (u.id === row.id ? { ...u, ...optimistic } : u));
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!res.ok) throw new Error(`patch failed (${res.status})`);
      const j = await res.json();
      users = users.map((u) => (u.id === row.id
        ? { ...u, verified: j.verified === true, memberType: j.memberType, dailyLimit: j.dailyLimit ?? null }
        : u));
    } catch {
      users = users.map((u) => (u.id === row.id ? prev : u));
      showError($t['admin.users.toast.fail']);
    } finally {
      const s = new Set(busy);
      s.delete(row.id);
      busy = s;
    }
  }

  function toggleVerified(row: AdminUserRow) {
    const next = !row.verified;
    return patchRow(row, { verified: next }, { verified: next });
  }

  function setType(row: AdminUserRow, next: MemberType) {
    if (next === row.memberType) return;
    return patchRow(row, { memberType: next }, {
      memberType: next,
      dailyLimit: next === 'organisation' ? row.dailyLimit : null,
    });
  }

  function setLimit(row: AdminUserRow, el: HTMLInputElement) {
    const text = el.value.trim();
    if (text === '') {
      if (row.dailyLimit === null) return;
      return patchRow(row, { dailyLimit: null }, { dailyLimit: null });
    }
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > MAX_DAILY_LIMIT) {
      showError($t['admin.users.toast.limit']);
      // Put the stored value back by hand: Svelte skips the DOM write when the
      // bound value did not change, so a re-render would leave the bad text.
      el.value = String(row.dailyLimit ?? '');
      return;
    }
    if (n === row.dailyLimit) return;
    return patchRow(row, { dailyLimit: n }, { dailyLimit: n });
  }
```

- markup: inside each row's right-hand cluster (`<div style="display: flex; align-items: center; gap: 10px;">`), BEFORE the `{#if row.verified}` chip, add the two controls; also add `flex-wrap: wrap;` to that cluster's style so a phone row wraps:

```svelte
              <label class="font-dmmono" style="display: flex; align-items: center; gap: 6px; font-size: 9.5px; letter-spacing: 0.1em; color: var(--k-ink-mute);">
                {$t['admin.users.type.label']}
                <select
                  class="font-bricolage"
                  data-admin-type
                  style="border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-sm); background: var(--k-paper); color: var(--k-ink); font-size: 12px; padding: 5px 6px; min-height: 32px;"
                  disabled={busy.has(row.id)}
                  value={row.memberType}
                  onchange={(e) => setType(row, (e.currentTarget as HTMLSelectElement).value as MemberType)}
                >
                  {#each MEMBER_TYPES as opt (opt)}
                    <option value={opt}>{$t[`member.type.${opt}`]}</option>
                  {/each}
                </select>
              </label>
              {#if row.memberType === 'organisation'}
                <label class="font-dmmono" style="display: flex; align-items: center; gap: 6px; font-size: 9.5px; letter-spacing: 0.1em; color: var(--k-ink-mute);">
                  {$t['admin.users.limit.label']}
                  <input
                    type="number"
                    inputmode="numeric"
                    min="1"
                    max={MAX_DAILY_LIMIT}
                    step="1"
                    data-admin-limit
                    class="font-dmmono"
                    style="width: 64px; border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-sm); background: var(--k-paper); color: var(--k-ink); font-size: 12px; padding: 5px 6px; min-height: 32px;"
                    placeholder="5"
                    title={$t['admin.users.limit.hint']}
                    disabled={busy.has(row.id)}
                    value={row.dailyLimit ?? ''}
                    onchange={(e) => setLimit(row, e.currentTarget as HTMLInputElement)}
                  />
                </label>
              {/if}
```

  If `$t[\`member.type.${opt}\`]` fails the type-check, use the same `LABEL` map as described in Task 6 Step 2.

- update the component's header comment: add „per-row type selector and, for organisations, a daily-limit field — both through the same PATCH".

- [ ] **Step 5: Check and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — Expected: ≤ 16.
Run: `npx -y svelte-check@4 --output machine 2>&1 | grep COMPLETED` — Expected: errors ≤ 81.
Run: `npx tsx --test src/lib/members/memberTypeChange.test.ts` — Expected: `ℹ fail 0`.

```bash
git add src/pages/api/admin src/components/admin src/lib/kiosk-i18n.ts
git commit -m "feat: admin corrects member type and sets an organisation's daily limit"
```

---

### Task 8: Whole-feature verification and docs

**Files:**
- Create: `scratchpad/member-types/e2e.mts` (gitignored, not committed)
- Modify: `CLAUDE.md`, `src/components/forum/kiosk/CLAUDE.md`, `src/components/admin/CLAUDE.md`, `src/components/profile/kiosk/CLAUDE.md`, `docs/superpowers/specs/2026-10-01-member-types-design.md` (two corrections)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Gates**

Run: `SKIP_BUILD=0 bash scratchpad/sweep/gates.sh`
Expected: every `GATE` line passes (tsc ≤ 16, svelte-check ≤ 81, all `*.test.ts` files `fail 0`, build succeeds). The unused-locals gate compares against `scratchpad/sweep/baseline-unused-locals.txt`; a NEW unused local introduced by this branch must be removed, not baselined.

If `scratchpad/sweep/gates.sh` is missing, run its parts by hand: `npx tsc --noEmit`, `npx -y svelte-check@4 --output machine`, `for f in $(git ls-files 'src/**/*.test.ts'); do npx tsx --test "$f" | grep "ℹ fail"; done`, `pnpm build`.

- [ ] **Step 2: Production-bundle check for the nested components**

After the build: `grep -rn "data-member-tag\|data-member-choice" .vercel/output/static/_astro/*.js | wc -l`
Expected: greater than 0 (both components are in the client bundle). Neither component has a `<style>` block, so there is no stylesheet to orphan: `grep -c "<style" src/components/forum/kiosk/MemberTypeTag.svelte src/components/profile/kiosk/atoms/MemberTypeChoice.svelte` → both `0`.

- [ ] **Step 3: Route-level check on the dev database**

`scratchpad/member-types/e2e.mts` exercises the pure-plus-database path without a server: for a throwaway user document it applies `planSelfTypeChange` and `planAdminPatch` results with real `updateOne` calls and reads the document back. Refuses a database without „dev"; cleans up in `finally`.

```ts
// Run: npx tsx --env-file=.env scratchpad/member-types/e2e.mts
import { MongoClient, ObjectId } from 'mongodb';
import { storedMemberType, effectiveDailyLimit } from '../../src/lib/members/memberType';
import { planSelfTypeChange, planAdminPatch } from '../../src/lib/members/memberTypeChange';
import { toPublicAuthor, PUBLIC_AUTHOR_PROJECTION } from '../../src/lib/publicAuthor';

const client = new MongoClient(process.env.MONGODB_URI ?? '');
await client.connect();
const db = client.db();
if (!db.databaseName.includes('dev')) { console.error(`REFUSED: "${db.databaseName}"`); process.exit(1); }

const users = db.collection('users');
const _id = new ObjectId();
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`); if (!ok) failed++; };
const apply = async (set: Record<string, unknown>, unset: string[]) => {
  const u: Record<string, unknown> = {};
  if (Object.keys(set).length) u.$set = set;
  if (unset.length) u.$unset = Object.fromEntries(unset.map((f) => [f, '']));
  if (Object.keys(u).length) await users.updateOne({ _id }, u);
};
const read = async () => (await users.findOne({ _id }))!;

try {
  await users.insertOne({ _id, name: 'Type Check', createdAt: new Date().toISOString() });
  check('new member is a person, limit 5', storedMemberType(await read()) === 'person' && effectiveDailyLimit(await read()) === 5);

  let p = planSelfTypeChange('person', 'organisation'); await apply(p.set, p.unset);
  check('self → organisation stored', (await read()).memberType === 'organisation');

  let a = planAdminPatch(await read(), { dailyLimit: 15 });
  if (a.ok) await apply(a.set, a.unset);
  check('admin limit 15 stored and effective', a.ok && effectiveDailyLimit(await read()) === 15);

  p = planSelfTypeChange('organisation', 'organisation'); await apply(p.set, p.unset);
  check('re-save same type keeps the limit', (await read()).dailyLimit === 15);

  const pub = await users.findOne({ _id }, { projection: PUBLIC_AUTHOR_PROJECTION });
  const out = toPublicAuthor(pub!);
  check('public author carries the type, never the limit', out.memberType === 'organisation' && !('dailyLimit' in out) && !('dailyLimit' in pub!));

  p = planSelfTypeChange('organisation', 'person'); await apply(p.set, p.unset);
  const after = await read();
  check('self → person removes type and limit', !('memberType' in after) && !('dailyLimit' in after));

  a = planAdminPatch(await read(), { dailyLimit: 10 });
  check('admin limit for a person is refused', !a.ok && a.error === 'limit_needs_organisation');

  a = planAdminPatch(await read(), { memberType: 'organisation', dailyLimit: 20 });
  if (a.ok) await apply(a.set, a.unset);
  a = planAdminPatch(await read(), { memberType: 'business' });
  if (a.ok) await apply(a.set, a.unset);
  const biz = await read();
  check('admin → business clears the limit', biz.memberType === 'business' && !('dailyLimit' in biz));
} finally {
  await users.deleteOne({ _id });
  await client.close();
}
console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

Run: `npx tsx --env-file=.env scratchpad/member-types/e2e.mts` — Expected: eight `OK`, `ALL OK`.
Run again: `npx tsx --env-file=.env scratchpad/member-types/limit-check.mts` — Expected: `ALL OK`.

- [ ] **Step 4: Spec corrections**

In `docs/superpowers/specs/2026-10-01-member-types-design.md`:
- replace `` `src/components/ui/MemberTypeTag.svelte` `` with `` `src/components/forum/kiosk/MemberTypeTag.svelte` `` (the `ui` folder no longer exists; the tag lives beside `KioskAvatar`);
- replace „(empty = normal limit, placeholder 15)" with „(empty = normal limit, placeholder 5 — the value that applies while the field is empty)".

- [ ] **Step 5: Docs**

Root `CLAUDE.md`:
- „Content Moderation" → the bullet **Daily posting limits**: rewrite its first sentence to: „four buckets of 5 per rolling 24h — forum (discussions + announcements + recommendations counted TOGETHER since 2026-10-01; before, each kind counted alone and 15 forum posts a day were possible), events, listings, news. One helper: `checkDailyLimit()` in `src/lib/limits/dailyLimit.ts` (pure decision `decideLimit()` in `limitRules.ts`, tested), used by the seven create/publish gates and the three `daily-count` endpoints. An organisation may carry an admin-set `dailyLimit` (1–50) that replaces the 5 in all four buckets." Keep the rest of the bullet (comments excluded, admin exemption …).
- „Database Collections" → `users`: append „plus `memberType?: 'organisation' | 'business'` — self-chosen at signup or in profile edit (absent = person, no migration), shown as the tag „Initiative" / „Gewerbe" beside the name via `MemberTypeTag.svelte`, correctable by the admin on `/admin/mitglieder`, normalised by `storedMemberType()` in every member-data join; plus `dailyLimit?: number` — admin-only (the PATCH on `/api/admin/users/[id]` is its ONLY writer), honoured only while the type is organisation, cleared whenever the member or the admin moves the type away from organisation, never in a client-visible projection except the admin list". Add `memberType/dailyLimit` to the tombstone's unset list in that same paragraph.
- „Admin alerts": add `member_type` (Telegram only) to the list of kinds; `member_new` names the type when it is not person.
- Add a pointer line to the spec and this plan.

`src/components/forum/kiosk/CLAUDE.md`: find the sentence stating that each kind has its own daily limit of 5 (grep `OWN daily limit`) and replace it with the forum-bucket rule; add a short „Member type tag" note naming `MemberTypeTag.svelte`, its `tone` prop, and that it is NOT on `/search` (slim result rows) or `/bookmarks` (no author line).

`src/components/admin/CLAUDE.md`: in the Mitglieder section add the type selector, the organisation-only limit field (empty = 5), `planAdminPatch()` and the error `limit_needs_organisation`.

`src/components/profile/kiosk/CLAUDE.md`: in the identity-card section add `MemberTypeChoice.svelte`, the `memberType` field of `/api/users/update`, the pre-read + `planSelfTypeChange()`, and the Telegram ping rule.

- [ ] **Step 6: Commit**

```bash
git status --short   # only docs; scratchpad/ is ignored
git add CLAUDE.md src/components docs/superpowers
git commit -m "docs: member types and the four daily-limit buckets"
```

- [ ] **Step 7: Report**

Report: the gate lines, both script outputs (`OK` lines only), the commit list `git log --oneline main..HEAD`, and anything that deviated from this plan. Do NOT push and do NOT merge.

The browser checks (signup choice, profile edit, the tag on the seven surfaces at 390 and 1440 px, `/admin/mitglieder` controls) run on a Vercel preview by the orchestrator after the final review — they need the logged-in smoke and are not part of this task.
