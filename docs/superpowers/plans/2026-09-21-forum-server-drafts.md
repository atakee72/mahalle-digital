# Forum Server-Side Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can save several forum drafts on the server, find them again on any device under the forum's „Meine" filter (and from the account menu), continue writing, publish or delete them — and the compose page finally publishes the KIND the member chose.

**Architecture:** Drafts live in their OWN collection `postDrafts` (never inside `topics` / `announcements` / `recommendations`), so no feed, search, count, related-rail, move or notification query can ever see one. Saving runs no moderation and no daily limit (the marketplace precedent); moderation and the limit run when the draft is published through the normal create endpoint of its kind. Images are uploaded when the draft is saved; deleting a draft destroys only images no published post of the author references.

**Tech Stack:** Astro 5 API routes, MongoDB driver, Zod, Svelte 5 islands (`client:only`), TanStack Query (existing create mutation), Tailwind, `node:test` via `npx tsx --test`, standalone Playwright probes.

**Spec:** none — the design was agreed in chat on 2026-09-21 (user: „dont you think we have to save it somewhere in the user profile to give users the opportunity to come back anytime? and also to save more then merely one draft?" → my design answer → „plan it"). The design is restated in full under „Design decisions" below; that section is the binding authority for this plan.

## Found while planning — affects members TODAY

`ComposePageInner.svelte` lets a member pick Diskussion / Empfehlung / Ankündigung, but `onPublish()` calls `create.mutateAsync({ title, body, tags, images })` and `createTopicReq()` always POSTs to `/api/topics/create`. **Every post from the compose page is published as a discussion, whatever card was chosen.** No kiosk code calls `/api/announcements/create` or `/api/recommendations/create` (only the admin dashboard has its own endpoint). Workaround until fixed: publish, then open the post → „Bearbeiten" → change the kind (the 09-13 kind change works). Task 1 fixes this and can ship on its own before the rest.

## Design decisions (binding)

1. Collection `postDrafts`: `{ _id, userId: string, kind: 'discussion'|'recommendation'|'announcement', title, body, tags: string[], images: {url, publicId}[], createdAt: Date, updatedAt: Date }`. Index `{ userId: 1, updatedAt: -1 }`. No TTL — drafts stay until the member deletes them or the account is deleted.
2. At most `MAX_POST_DRAFTS = 20` per member. Saving a NEW draft beyond that → `409 draft_limit`. Updating an existing one is always allowed.
3. A draft may be incomplete (title shorter than 5, body shorter than 10) but not EMPTY (title, body, tags and images all empty → `400 draft_empty`). Upper limits are the publish limits: title ≤ 200, body ≤ 5000, tags ≤ 5 × 30 chars, images ≤ 5.
4. No AI moderation, no blocklist, no daily limit, no admin alert, no notification on save. Banned accounts cannot save (`rejectIfBanned`). 120 saves per member per hour (`consumeRateLimit('postdraft:<userId>', 120, 3600000)`).
5. Only the owner can list, read or delete a draft. Every response is `Cache-Control: no-store`. A foreign or unknown id answers `404 not_found` (never 403 — do not confirm existence).
6. Publishing a draft = the normal create endpoint of its kind (Task 1), then `DELETE /api/posts/drafts/<id>`. The delete destroys a Cloudinary image only if NO published post of this author in `topics` / `announcements` / `recommendations` references its `publicId` — so publishing keeps the images, deleting an unpublished draft removes them. No client flag controls this.
7. Compose: `/topics/create?draft=<id>` resumes (SSR owner check; unknown id → redirect to `/topics/create`). While a server draft is open the local-storage autosave is OFF (marketplace precedent: otherwise the resumed text pollutes the single local slot). Without `?draft=` the local autosave stays exactly as today (crash safety net).
8. „als Entwurf speichern": uploads pending images, saves, clears the local slot, goes to `/forum?kind=mine&draft_saved=1`; the index shows a success toast and the „Entwürfe" section. „verwerfen" with a server draft open leaves WITHOUT saving changes and keeps the draft (deleting happens in the list, with a confirm).
9. „Entwürfe" section: only under the „Meine" filter, above the member's posts, hidden when there are none. Row = kind chip · title (or „Ohne Titel") · „zuletzt geändert <relTime>" · „weiterschreiben" link · „löschen" button (`confirmAction`, `variant: 'danger'`).
10. Account menu gets one row „Meine Entwürfe" → `/forum?kind=mine`. No count (the menu has no counts by decision).
11. Account deletion: the day-7 pipeline deletes the member's drafts and destroys their images.
12. Out of scope: calendar and News drafts, a drafts filter in the profile ledger, autosave to the server, draft sharing.

## Global Constraints

- Commit messages: one line, no „Generated with Claude Code", no Co-Authored-By. `git add` named files only. Never stage `.env` or anything under `scratchpad/`.
- Work on branch `feat/forum-server-drafts`; merge and push only on the user's word.
- Never print a value from `.env`; never echo `scratchpad/devpw.txt`.
- Dev database only (`mahalle-dev`). The index script must refuse any database name without „dev" unless `--prod` is given, and default to dry-run. The PROD index run is the USER's.
- Own dev server: `SENTRY_DSN= TELEGRAM_BOT_TOKEN= pnpm astro dev --port 4655`; stop it with `fuser -k 4655/tcp`. Never port 3000.
- Gates before every commit of app code, numbers must not rise: `pnpm type-check > /tmp/tsc.log 2>&1; grep -c 'error TS' /tmp/tsc.log` ≤ 26 · `pnpm exec svelte-check --output machine 2>/dev/null | grep ' COMPLETED '` ≤ 92 errors · `pnpm build` exits 0.
- New `.svelte` components reachable only through another island carry NO `<style>` block (orphaned-CSS rule) — Tailwind classes only.
- `history.replaceState` always passes `window.history.state`.
- UI copy in this plan is an OFFER; the user words copy himself. List every new key in the final report.
- A file imported by both server and client must stay dependency-pure (no `mongodb`, no `cloudinary`).

---

### Task 1: The compose page publishes the chosen kind

**Files:**
- Modify: `src/lib/forum/postKind.ts` (append)
- Modify: `src/lib/forum/postKind.test.ts` (append)
- Modify: `src/lib/forumMutations.ts:46-78` and `:107-112`
- Modify: `src/components/forum/kiosk/compose/ComposePageInner.svelte` (`onPublish`)

**Interfaces:**
- Produces: `createEndpointForKind(kind: PostKind): string`, `createdDocKeyForKind(kind: PostKind): 'topic' | 'announcement' | 'recommendation'`; `CreateTopicInput` gains `kind?: PostKind`.

- [ ] **Step 1: Write the failing test** — append to `src/lib/forum/postKind.test.ts`:

```ts
import { createEndpointForKind, createdDocKeyForKind } from './postKind';

test('each kind has its own create endpoint and response key', () => {
  assert.equal(createEndpointForKind('discussion'), '/api/topics/create');
  assert.equal(createEndpointForKind('announcement'), '/api/announcements/create');
  assert.equal(createEndpointForKind('recommendation'), '/api/recommendations/create');
  assert.equal(createdDocKeyForKind('discussion'), 'topic');
  assert.equal(createdDocKeyForKind('announcement'), 'announcement');
  assert.equal(createdDocKeyForKind('recommendation'), 'recommendation');
});
```

(If the file already imports `test`/`assert`, do not import them twice; merge the new names into the existing `./postKind` import.)

- [ ] **Step 2: Run it, expect FAIL** — `npx tsx --test src/lib/forum/postKind.test.ts` → „createEndpointForKind is not a function".

- [ ] **Step 3: Implement** — append to `src/lib/forum/postKind.ts`:

```ts
/** Where the compose page creates a post of this kind. Until 2026-09-21 it
 *  always used /api/topics/create, so „Empfehlung" and „Ankündigung" were
 *  published as discussions. */
export function createEndpointForKind(kind: PostKind): string {
  return `/api/${collectionForKind(kind)}/create`;
}

/** The three create endpoints name the created document differently. */
export function createdDocKeyForKind(kind: PostKind): PostContentType {
  return contentTypeForCollection(collectionForKind(kind));
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Route the request** — in `src/lib/forumMutations.ts` replace the `CreateTopicInput` type and `createTopicReq`:

```ts
import { createEndpointForKind, createdDocKeyForKind, type PostKind } from './forum/postKind';

export type CreateTopicInput = {
  title: string;
  body: string;
  tags?: string[];
  images?: { url: string; publicId: string }[];
  /** Which collection the post goes to. Absent = discussion (old callers). */
  kind?: PostKind;
};

async function createTopicReq(input: CreateTopicInput) {
  const kind: PostKind = input.kind ?? 'discussion';
  const { kind: _drop, ...payload } = input; // the endpoints' Zod schemas strip unknown keys anyway
  const res = await fetch(createEndpointForKind(kind), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    if (res.status === 429) {
      throw new RateLimitError(
        error.dailyLimit ?? 5,
        error.currentCount ?? 0,
        error.message ?? 'Daily limit reached'
      );
    }
    const details = error.details ? Object.values(error.details).join(', ') : '';
    throw new Error(details || error.error || 'Failed to create post');
  }

  const json = await res.json();
  // Normalise: callers read `.topic` whatever the kind was.
  return {
    topic: { ...json[createdDocKeyForKind(kind)], kind },
    message: json.message as string,
    moderationStatus: json.moderationStatus as 'pending' | 'approved' | 'rejected' | undefined
  };
}
```

`API_URL` was only used for the topic URL here; leave the constant if other functions in the file use it. In the optimistic insert replace the hard-coded `kind: 'discussion',` (and its five-line comment) by `kind: input.kind ?? 'discussion',`.

- [ ] **Step 6: Pass the kind** — in `ComposePageInner.svelte` `onPublish()`:

```ts
      await create.mutateAsync({
        title: values.title.trim(),
        body: values.body.trim(),
        tags: values.tags,
        images: allImages,
        kind: values.kind
      });
```

- [ ] **Step 7: Prove it on dev** — write `scratchpad/compose-kind-probe.cjs`: redirect-bounce login as `admin@mahalle-dev.test` (password from `scratchpad/devpw.txt`, read straight into `page.fill`), open `/topics/create`, choose the „Empfehlung" card, title `Kind-Probe Empfehlung <timestamp>`, body `Probe: landet dieser Beitrag wirklich bei den Empfehlungen?`, publish, wait for `/forum?just_posted=1`, then `page.evaluate(() => fetch('/api/recommendations').then(r => r.json()))` and assert one item has that title; repeat for „Ankündigung" against `/api/announcements` and for „Diskussion" against `/api/topics`. Delete the three probe posts through their `delete` endpoints at the end. Expected: 3 PASS. (Admin is exempt from moderation and the daily limit, so the probe needs no OpenAI call.)

- [ ] **Step 8: Gates, then commit**

```bash
git add src/lib/forum/postKind.ts src/lib/forum/postKind.test.ts src/lib/forumMutations.ts src/components/forum/kiosk/compose/ComposePageInner.svelte
git commit -m "forum: the compose page publishes the chosen kind (was always a discussion)"
```

---

### Task 2: Pure draft rules + schema

**Files:**
- Create: `src/lib/forum/postDrafts.ts`
- Create: `src/lib/forum/postDrafts.test.ts`
- Modify: `src/schemas/forum.schema.ts` (append; export `PostImageSchema` is NOT needed — reuse the constant inside the file)

**Interfaces:**
- Produces: `MAX_POST_DRAFTS = 20`, `type PostDraftInput`, `type PostDraftDTO`, `draftIsEmpty(d): boolean`, `draftResumeHref(id): string`, `PostDraftSaveSchema` (Zod).

- [ ] **Step 1: Failing test** — `src/lib/forum/postDrafts.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_POST_DRAFTS, draftIsEmpty, draftResumeHref } from './postDrafts';
import { PostDraftSaveSchema } from '../../schemas/forum.schema';

const base = { kind: 'discussion' as const, title: '', body: '', tags: [], images: [] };

test('a draft may be incomplete but not empty', () => {
  assert.equal(draftIsEmpty(base), true);
  assert.equal(draftIsEmpty({ ...base, title: '   ' }), true);
  assert.equal(draftIsEmpty({ ...base, title: 'Hi' }), false);
  assert.equal(draftIsEmpty({ ...base, body: 'x' }), false);
  assert.equal(draftIsEmpty({ ...base, tags: ['garten'] }), false);
  assert.equal(draftIsEmpty({ ...base, images: [{ url: 'https://res.cloudinary.com/x/a.jpg', publicId: 'mahalle/posts/a' }] }), false);
});

test('limits and links', () => {
  assert.equal(MAX_POST_DRAFTS, 20);
  assert.equal(draftResumeHref('64f000000000000000000001'), '/topics/create?draft=64f000000000000000000001');
});

test('schema: short text is fine, publish limits are not exceeded', () => {
  assert.equal(PostDraftSaveSchema.safeParse({ ...base, title: 'Hi' }).success, true);
  assert.equal(PostDraftSaveSchema.safeParse({ ...base, title: 'x'.repeat(201) }).success, false);
  assert.equal(PostDraftSaveSchema.safeParse({ ...base, body: 'x'.repeat(5001) }).success, false);
  assert.equal(PostDraftSaveSchema.safeParse({ ...base, tags: ['a', 'b', 'c', 'd', 'e', 'f'] }).success, false);
  assert.equal(PostDraftSaveSchema.safeParse({ ...base, kind: 'official' }).success, false);
  assert.equal(PostDraftSaveSchema.safeParse({ ...base, id: 'not-an-id', title: 'Hi' }).success, false);
  const ok = PostDraftSaveSchema.safeParse({ ...base, id: '64f000000000000000000001', title: '  Hi  ' });
  assert.equal(ok.success && ok.data.title, 'Hi');
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx tsx --test src/lib/forum/postDrafts.test.ts`.

- [ ] **Step 3: Implement** — `src/lib/forum/postDrafts.ts`:

```ts
// Forum drafts — the rules both the server and the islands need. Dependency-pure
// (no mongodb, no zod): imported by API routes AND by client:only islands.
import type { PostKind } from './postKind';

export const MAX_POST_DRAFTS = 20;

export type PostDraftInput = {
  kind: PostKind;
  title: string;
  body: string;
  tags: string[];
  images: { url: string; publicId: string }[];
};

/** What the API returns and the islands render. Dates are ISO strings. */
export type PostDraftDTO = PostDraftInput & { id: string; createdAt: string; updatedAt: string };

/** A draft may be unfinished, but there must be SOMETHING to come back to. */
export function draftIsEmpty(d: PostDraftInput): boolean {
  return !d.title.trim() && !d.body.trim() && d.tags.length === 0 && d.images.length === 0;
}

export function draftResumeHref(id: string): string {
  return `/topics/create?draft=${id}`;
}
```

Append to `src/schemas/forum.schema.ts`:

```ts
// Forum draft (server-side, several per member — 2026-09-21). Same UPPER limits
// as publishing, no lower limits: a draft may be unfinished. Emptiness is checked
// by draftIsEmpty() in the endpoint, not here.
export const PostDraftSaveSchema = z.object({
  id: ObjectIdSchema.optional(),
  kind: z.enum(['discussion', 'recommendation', 'announcement']),
  title: z.string().max(200, 'Title must be less than 200 characters').trim().default(''),
  body: z.string().max(5000, 'Content must be less than 5000 characters').trim().default(''),
  tags: z.array(z.string().max(30)).max(5, 'Maximum 5 tags allowed').default([]),
  images: PostImageSchema
});
```

- [ ] **Step 4: Run, expect PASS (3 tests).**

- [ ] **Step 5: Commit**

```bash
git add src/lib/forum/postDrafts.ts src/lib/forum/postDrafts.test.ts src/schemas/forum.schema.ts
git commit -m "forum drafts: pure rules and the save schema"
```

---

### Task 3: Store, endpoints, indexes

**Files:**
- Create: `src/lib/forum/postDraftsStore.ts` (SERVER-ONLY)
- Create: `src/pages/api/posts/drafts/index.ts` (GET list, POST save)
- Create: `src/pages/api/posts/drafts/[id].ts` (DELETE)
- Create: `scripts/create-post-draft-indexes.ts`
- Create (scratch, not committed): `scratchpad/e2e-post-drafts.mts`

**Interfaces:**
- Consumes: `PostDraftSaveSchema`, `PostDraftInput`, `PostDraftDTO`, `MAX_POST_DRAFTS`, `draftIsEmpty`, `POST_COLLECTIONS`.
- Produces: `listDrafts(userId): Promise<PostDraftDTO[]>`, `getDraft(id, userId): Promise<PostDraftDTO | null>`, `saveDraft(userId, input & { id?: string }): Promise<{ ok: true; draft: PostDraftDTO } | { ok: false; reason: 'limit' | 'not_found' }>`, `deleteDraft(id, userId): Promise<{ deleted: boolean; imagesDestroyed: number }>`, `deleteAllDraftsOf(userId): Promise<{ drafts: number; imagesDestroyed: number }>`.
- HTTP: `GET /api/posts/drafts` → `200 { drafts: PostDraftDTO[] }`; `POST /api/posts/drafts` → `200 { draft }` | `400 draft_empty` | `409 draft_limit` | `404 not_found` | `429 throttled`; `DELETE /api/posts/drafts/<id>` → `200 { deleted: true }` | `404 not_found`. All `401` without a session, all `no-store`.

- [ ] **Step 1: The store** — `src/lib/forum/postDraftsStore.ts`:

```ts
// Forum drafts — database + Cloudinary side. SERVER-ONLY (imports mongodb +
// cloudinary): never import this from an island; islands use postDrafts.ts.
import { ObjectId } from 'mongodb';
import { v2 as cloudinary } from 'cloudinary';
import * as Sentry from '@sentry/astro';
import { connectDB } from '../mongodb';
import { POST_COLLECTIONS } from './postKind';
import { MAX_POST_DRAFTS, type PostDraftDTO, type PostDraftInput } from './postDrafts';

cloudinary.config({
  cloud_name: import.meta.env.CLOUD_NAME,
  api_key: import.meta.env.CLOUDINARY_API_KEY,
  api_secret: import.meta.env.CLOUDINARY_API_SECRET
});

type DraftDoc = PostDraftInput & { _id: ObjectId; userId: string; createdAt: Date; updatedAt: Date };

const COLLECTION = 'postDrafts';
const isId = (s: string) => /^[0-9a-fA-F]{24}$/.test(s);

function toDTO(d: DraftDoc): PostDraftDTO {
  return {
    id: d._id.toString(),
    kind: d.kind,
    title: d.title,
    body: d.body,
    tags: d.tags ?? [],
    images: d.images ?? [],
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString()
  };
}

export async function listDrafts(userId: string): Promise<PostDraftDTO[]> {
  const db = await connectDB();
  const docs = await db.collection<DraftDoc>(COLLECTION).find({ userId }).sort({ updatedAt: -1 }).limit(MAX_POST_DRAFTS).toArray();
  return docs.map(toDTO);
}

export async function getDraft(id: string, userId: string): Promise<PostDraftDTO | null> {
  if (!isId(id)) return null;
  const db = await connectDB();
  // userId is part of the filter: a foreign id behaves exactly like an unknown one.
  const doc = await db.collection<DraftDoc>(COLLECTION).findOne({ _id: new ObjectId(id), userId });
  return doc ? toDTO(doc) : null;
}

export async function saveDraft(
  userId: string,
  input: PostDraftInput & { id?: string }
): Promise<{ ok: true; draft: PostDraftDTO } | { ok: false; reason: 'limit' | 'not_found' }> {
  const db = await connectDB();
  const col = db.collection<DraftDoc>(COLLECTION);
  const now = new Date();
  const fields = { kind: input.kind, title: input.title, body: input.body, tags: input.tags, images: input.images };

  if (input.id) {
    const updated = await col.findOneAndUpdate(
      { _id: new ObjectId(input.id), userId },
      { $set: { ...fields, updatedAt: now } },
      { returnDocument: 'after' }
    );
    return updated ? { ok: true, draft: toDTO(updated as DraftDoc) } : { ok: false, reason: 'not_found' };
  }

  if ((await col.countDocuments({ userId })) >= MAX_POST_DRAFTS) return { ok: false, reason: 'limit' };
  const doc = { ...fields, userId, createdAt: now, updatedAt: now } as Omit<DraftDoc, '_id'>;
  const res = await col.insertOne(doc as DraftDoc);
  return { ok: true, draft: toDTO({ ...(doc as DraftDoc), _id: res.insertedId }) };
}

/** Destroy only images that no PUBLISHED post of this author uses — publishing a
 *  draft copies its images into the post, and those must survive the draft. */
async function destroyUnreferencedImages(userId: string, publicIds: string[]): Promise<number> {
  if (!publicIds.length) return 0;
  const db = await connectDB();
  const used = new Set<string>();
  for (const c of POST_COLLECTIONS) {
    const posts = await db.collection(c).find({ author: userId, 'images.publicId': { $in: publicIds } }, { projection: { images: 1 } }).toArray();
    for (const p of posts) for (const img of (p as any).images ?? []) used.add(img.publicId);
  }
  // Another draft of the same member may share an image after a "save as new".
  const others = await db.collection(COLLECTION).find({ userId, 'images.publicId': { $in: publicIds } }, { projection: { images: 1 } }).toArray();
  for (const d of others) for (const img of (d as any).images ?? []) used.add(img.publicId);

  let destroyed = 0;
  for (const id of publicIds) {
    // Only our own upload folder — never destroy an id a client could have typed.
    if (used.has(id) || !id.startsWith('mahalle/posts/')) continue;
    try {
      await cloudinary.uploader.destroy(id);
      destroyed++;
    } catch (err) {
      Sentry.captureException(err, { extra: { where: 'postDraftsStore.destroyUnreferencedImages' } });
    }
  }
  return destroyed;
}

export async function deleteDraft(id: string, userId: string): Promise<{ deleted: boolean; imagesDestroyed: number }> {
  if (!isId(id)) return { deleted: false, imagesDestroyed: 0 };
  const db = await connectDB();
  // Delete FIRST, so the "other drafts" lookup above no longer finds this one.
  const doc = await db.collection<DraftDoc>(COLLECTION).findOneAndDelete({ _id: new ObjectId(id), userId });
  if (!doc) return { deleted: false, imagesDestroyed: 0 };
  const imagesDestroyed = await destroyUnreferencedImages(userId, ((doc as DraftDoc).images ?? []).map((i) => i.publicId));
  return { deleted: true, imagesDestroyed };
}

/** Account deletion (day-7 pipeline). */
export async function deleteAllDraftsOf(userId: string): Promise<{ drafts: number; imagesDestroyed: number }> {
  const db = await connectDB();
  const col = db.collection<DraftDoc>(COLLECTION);
  const docs = await col.find({ userId }, { projection: { images: 1 } }).toArray();
  const ids = [...new Set(docs.flatMap((d) => (d.images ?? []).map((i) => i.publicId)))];
  const res = await col.deleteMany({ userId });
  return { drafts: res.deletedCount ?? 0, imagesDestroyed: await destroyUnreferencedImages(userId, ids) };
}
```

Audited 2026-09-21: `src/pages/api/posts/upload.ts:63` uploads to `folder: 'mahalle/posts'`, so the `startsWith('mahalle/posts/')` guard matches.

- [ ] **Step 2: List + save endpoint** — `src/pages/api/posts/drafts/index.ts`:

```ts
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { rejectIfBanned } from '../../../../lib/auth/banGuard';
import { consumeRateLimit } from '../../../../lib/auth/rateLimit';
import { parseRequestBody } from '../../../../schemas/validation.utils';
import { PostDraftSaveSchema } from '../../../../schemas/forum.schema';
import { draftIsEmpty } from '../../../../lib/forum/postDrafts';
import { listDrafts, saveDraft } from '../../../../lib/forum/postDraftsStore';

// Forum drafts: private to their owner, several per member, no moderation and no
// daily limit on save (both run when the draft is PUBLISHED through the normal
// create endpoint of its kind). Design: docs/superpowers/plans/2026-09-21-forum-server-drafts.md
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);
  return json({ drafts: await listDrafts(session.user.id) }, 200);
};

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);

  const banned = await rejectIfBanned(session.user.id);
  if (banned) return banned;

  const cap = await consumeRateLimit(`postdraft:${session.user.id}`, 120, 60 * 60 * 1000);
  if (cap.limited) return json({ error: 'throttled' }, 429);

  const validation = await parseRequestBody(request, PostDraftSaveSchema);
  if (!validation.success) return validation.response;
  if (draftIsEmpty(validation.data)) return json({ error: 'draft_empty' }, 400);

  const result = await saveDraft(session.user.id, validation.data);
  if (!result.ok) return json({ error: result.reason === 'limit' ? 'draft_limit' : 'not_found' }, result.reason === 'limit' ? 409 : 404);
  return json({ draft: result.draft }, 200);
};
```

- [ ] **Step 3: Delete endpoint** — `src/pages/api/posts/drafts/[id].ts`:

```ts
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { deleteDraft } from '../../../../lib/forum/postDraftsStore';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// Deliberately NOT ban-guarded: a banned member may still clean up their drafts.
export const DELETE: APIRoute = async ({ request, params }) => {
  const session = await getSession(request);
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);
  const { deleted } = await deleteDraft(String(params.id ?? ''), session.user.id);
  return deleted ? json({ deleted: true }, 200) : json({ error: 'not_found' }, 404);
};
```

- [ ] **Step 4: Index script** — `scripts/create-post-draft-indexes.ts`. Copy `ensureIndex()` (the 85/86 conflict guard) and the `dotenv` + raw `MongoClient` setup from `scripts/create-notification-indexes.ts` — that script has NO dry-run and NO database interlock, so add both here: read the db name from the URI path (`new URL(uri).pathname.slice(1)`), print it, exit 1 when it does not contain `dev` unless `--prod` is given, and without `--apply` only print „would create postDrafts_user_updated on <db>" and exit 0. The one index:

```ts
await db.collection('postDrafts').createIndex({ userId: 1, updatedAt: -1 }, { name: 'postDrafts_user_updated' });
```

Run it against dev: `pnpm tsx scripts/create-post-draft-indexes.ts --apply`. Expected output names the database `mahalle-dev` and the index.

- [ ] **Step 5: E2E on dev** — `scratchpad/e2e-post-drafts.mts`, modelled on `scratchpad/e2e-admin-moderation-exemption.mts` (fetch-based login, cookie jar, base `http://localhost:4655`). Two accounts: `admin@mahalle-dev.test` and a second seeded dev member (list them with `scripts/seed-dev-db.ts`'s output or the dev `users` collection — names only, never passwords on screen). Assertions, each printed as PASS/FAIL:
  1. logged out: `GET` and `POST` → 401.
  2. `POST {kind:'discussion', title:'', body:'', tags:[], images:[]}` → 400 `draft_empty`.
  3. `POST {kind:'announcement', title:'Hi'}` → 200, `draft.id` is 24 hex, `draft.kind === 'announcement'`.
  4. `POST` same `id` with `body:'mehr Text'` → 200, same id, `updatedAt` later, `GET` lists exactly one draft.
  5. second account: `GET` lists 0; `POST` with the first account's `id` → 404; `DELETE` that id → 404; first account still has it.
  6. `POST` with `title: 'x'.repeat(201)` → 400.
  7. create drafts until 20 exist → the 21st `POST` without id → 409 `draft_limit`; an update of an existing one still → 200.
  8. none of the draft titles appears in `GET /api/topics`, `/api/announcements`, `/api/recommendations` or `/search?q=…` HTML.
  9. `DELETE` each → 200; `GET` → 0.
Expected: all PASS.

- [ ] **Step 6: Gates, then commit**

```bash
git add src/lib/forum/postDraftsStore.ts src/pages/api/posts/drafts/index.ts "src/pages/api/posts/drafts/[id].ts" scripts/create-post-draft-indexes.ts
git commit -m "forum drafts: store, list/save/delete endpoints, index script"
```

---

### Task 4: Compose saves to the server and resumes a draft

**Files:**
- Modify: `src/pages/topics/create.astro`
- Modify: `src/components/forum/kiosk/compose/ComposePage.svelte`
- Modify: `src/components/forum/kiosk/compose/ComposePageInner.svelte`
- Modify: `src/lib/kiosk-i18n.ts`

**Interfaces:**
- Consumes: `getDraft`, `PostDraftDTO`, `draftIsEmpty`, `POST /api/posts/drafts`, `DELETE /api/posts/drafts/<id>`.
- Produces: prop `initialDraft?: PostDraftDTO | null` on `ComposePage` and `ComposePageInner`; flash param `draft_saved=1` on `/forum`.

- [ ] **Step 1: SSR** — in `src/pages/topics/create.astro`, after `currentUser`:

```astro
import { getDraft } from '../../lib/forum/postDraftsStore';

// Resume a server-side draft: owner-checked here, so the island never sees a foreign one.
const draftParam = Astro.url.searchParams.get('draft');
const initialDraft = draftParam ? await getDraft(draftParam, session.user.id) : null;
if (draftParam && !initialDraft) return Astro.redirect('/topics/create', 302);
```

(The `import` line goes to the other imports at the top of the frontmatter.) Pass it: `<ComposePage client:only="svelte" currentUser={currentUser} initialDraft={initialDraft} />`.

- [ ] **Step 2: Thread the prop** — `ComposePage.svelte`: add `initialDraft = null` to `$props` with type `import('../../../../lib/forum/postDrafts').PostDraftDTO | null`, pass `<ComposePageInner {currentUser} {initialDraft} />`.

- [ ] **Step 3: Resume + no local autosave** — `ComposePageInner.svelte`:

```ts
  import { draftIsEmpty, type PostDraftDTO } from '../../../../lib/forum/postDrafts';

  let { currentUser, initialDraft = null } = $props<{
    currentUser: { id: string; name?: string; image?: string | null };
    initialDraft?: PostDraftDTO | null;
  }>();

  // A server-side draft is open (resumed via ?draft=, or saved from this page).
  // svelte-ignore state_referenced_locally
  let draftId = $state<string | null>(initialDraft?.id ?? null);
```

At the top of `computeInitialValues()`:

```ts
    // A resumed server draft wins over everything — prefill params and the
    // local slot belong to a different piece of writing.
    if (initialDraft) {
      return {
        title: initialDraft.title,
        body: initialDraft.body,
        kind: initialDraft.kind,
        tags: initialDraft.tags,
        pendingFiles: [],
        existingImages: initialDraft.images
      };
    }
```

First line inside the autosave `$effect`: `if (draftId) return; // server draft open — the local slot stays someone else's (marketplace precedent)`.

- [ ] **Step 4: Save to the server** — replace `onSaveDraft`:

```ts
  let savingDraft = $state(false);

  async function onSaveDraft() {
    if (savingDraft || submitting) return;
    inlineError = null;
    const candidate = { kind: values.kind, title: values.title, body: values.body, tags: values.tags, images: values.existingImages };
    if (draftIsEmpty(candidate) && values.pendingFiles.length === 0) {
      inlineError = $t['drafts.error.empty'] as string;
      return;
    }
    if (values.existingImages.length + values.pendingFiles.length > 5) {
      inlineError = 'Zu viele Bilder (max. 5).';
      return;
    }
    savingDraft = true;
    try {
      const uploaded = values.pendingFiles.length ? await uploadPendingFiles(values.pendingFiles) : [];
      const res = await fetch('/api/posts/drafts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(draftId ? { id: draftId } : {}), ...candidate, images: [...values.existingImages, ...uploaded] })
      });
      if (res.status === 409) throw new Error($t['drafts.error.limit'] as string);
      if (!res.ok) throw new Error($t['drafts.error.save'] as string);
      draftId = (await res.json()).draft.id;
      topicDraft.clearDraft();
      window.location.href = '/forum?kind=mine&draft_saved=1';
    } catch (caught) {
      savingDraft = false;
      inlineError = caught instanceof Error ? caught.message : ($t['drafts.error.save'] as string);
    }
  }
```

Known cost, accepted: if the upload succeeds and the save then fails, the uploaded images are orphans on Cloudinary (same as a failed publish today).

- [ ] **Step 5: Publishing removes the draft** — in `onPublish()`, right after `topicDraft.clearDraft();`:

```ts
      if (draftId) {
        // Best effort: the post exists; a leftover draft is only clutter. The
        // server keeps the images because the new post references them.
        await fetch(`/api/posts/drafts/${draftId}`, { method: 'DELETE', credentials: 'include', keepalive: true }).catch(() => {});
      }
```

- [ ] **Step 6: „verwerfen" keeps a server draft** — replace `onDiscard`:

```ts
  function onDiscard() {
    if (!draftId) topicDraft.clearDraft();
    window.location.href = draftId ? '/forum?kind=mine' : '/forum';
  }
```

Disable both draft buttons while saving: add `|| savingDraft` to the `disabled` of the mobile „als Entwurf speichern" `KioskBtn`, and pass `submitting={submitting || savingDraft}` to `ComposePreview`.

- [ ] **Step 7: Copy (OFFER)** — add to BOTH dictionaries in `src/lib/kiosk-i18n.ts`, next to `'compose.cta.draft'`:

```ts
  'drafts.error.empty': 'Ein leerer Entwurf lässt sich nicht speichern.',
  'drafts.error.limit': 'Du hast schon 20 Entwürfe. Lösche einen, dann kannst du diesen speichern.',
  'drafts.error.save': 'Der Entwurf wurde nicht gespeichert. Dein Text ist noch da.',
```

```ts
  'drafts.error.empty': 'An empty draft cannot be saved.',
  'drafts.error.limit': 'You already have 20 drafts. Delete one, then you can save this one.',
  'drafts.error.save': 'The draft was not saved. Your text is still here.',
```

- [ ] **Step 8: Gates, then commit**

```bash
git add src/pages/topics/create.astro src/components/forum/kiosk/compose/ComposePage.svelte src/components/forum/kiosk/compose/ComposePageInner.svelte src/lib/kiosk-i18n.ts
git commit -m "forum drafts: compose saves to the server with images and resumes a draft"
```

---

### Task 5: „Entwürfe" under „Meine", toast, account menu

**Files:**
- Create: `src/components/forum/kiosk/ForumDraftsSection.svelte` (no `<style>` block)
- Modify: `src/components/forum/kiosk/ForumIndexInner.svelte`
- Modify: `src/components/forum/kiosk/AvatarMenu.svelte`
- Modify: `src/lib/kiosk-i18n.ts`
- Create (scratch): `scratchpad/forum-drafts-probe.cjs`

**Interfaces:**
- Consumes: `GET /api/posts/drafts`, `DELETE /api/posts/drafts/<id>`, `PostDraftDTO`, `draftResumeHref`, `relTime`, `confirmAction`, `showToast` / `showError`.

- [ ] **Step 1: The section** — `src/components/forum/kiosk/ForumDraftsSection.svelte`:

```svelte
<script lang="ts">
  // The member's own forum drafts — rendered only under the "Meine" filter.
  // Tailwind classes only: this component is reachable only through the forum
  // island, a <style> block here would be orphaned in the prod build.
  import { onMount } from 'svelte';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import { relTime } from '../../../lib/relTime';
  import { confirmAction, showError } from '../../../utils/toast';
  import { draftResumeHref, type PostDraftDTO } from '../../../lib/forum/postDrafts';

  let drafts = $state<PostDraftDTO[]>([]);
  let deleting = $state<string | null>(null);

  const chip: Record<PostDraftDTO['kind'], { key: string; cls: string }> = {
    discussion: { key: 'chip.discussion', cls: 'bg-wine' },
    announcement: { key: 'chip.announcement', cls: 'bg-teal' },
    recommendation: { key: 'chip.recommendation', cls: 'bg-moss' }
  };

  onMount(async () => {
    try {
      const res = await fetch('/api/posts/drafts', { credentials: 'include' });
      if (res.ok) drafts = (await res.json()).drafts ?? [];
    } catch { /* a missing drafts list must never break the feed */ }
  });

  async function remove(d: PostDraftDTO) {
    if (deleting) return;
    const ok = await confirmAction($t['drafts.delete.confirm'] as string, { variant: 'danger', confirmLabel: $t['drafts.delete'] as string });
    if (!ok) return;
    deleting = d.id;
    try {
      const res = await fetch(`/api/posts/drafts/${d.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok && res.status !== 404) throw new Error();
      drafts = drafts.filter((x) => x.id !== d.id);
    } catch {
      showError($t['drafts.delete.error'] as string);
    } finally {
      deleting = null;
    }
  }
</script>

{#if drafts.length}
  <section id="entwuerfe" data-forum-drafts class="mb-6 rounded-lg border-[1.5px] border-dashed border-ink/50 bg-paper-warm px-4 py-3">
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
      <h2 class="font-bricolage font-bold text-base tracking-tight">{$t['drafts.section.title']} · {drafts.length}</h2>
      <p class="font-instrument italic text-[13px] text-ink-soft">{$t['drafts.section.hint']}</p>
    </div>
    <ul class="flex flex-col divide-y divide-dashed divide-rule">
      {#each drafts as d (d.id)}
        <li data-draft-row class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <span class={`shrink-0 px-[9px] py-[3px] rounded-lg border border-ink font-dmmono text-[10px] font-medium tracking-[0.08em] text-paper ${chip[d.kind].cls}`}>{$t[chip[d.kind].key]}</span>
          <a href={draftResumeHref(d.id)} class="min-w-0 flex-1 basis-[12rem] truncate font-bricolage font-bold text-[15px] text-ink hover:underline">
            {d.title.trim() || $t['drafts.untitled']}
          </a>
          <span class="shrink-0 font-dmmono text-[10px] text-ink-mute">{$t['drafts.changed']} {relTime(d.updatedAt, $locale)}</span>
          <a href={draftResumeHref(d.id)} class="shrink-0 inline-flex items-center min-h-[36px] font-dmmono text-[11px] uppercase tracking-[0.1em] text-wine underline">{$t['drafts.resume']}</a>
          <button type="button" onclick={() => remove(d)} disabled={deleting === d.id}
            class="shrink-0 inline-flex items-center min-h-[36px] font-dmmono text-[11px] uppercase tracking-[0.1em] text-ink-mute underline disabled:opacity-50">{$t['drafts.delete']}</button>
        </li>
      {/each}
    </ul>
  </section>
{/if}
```

Audited 2026-09-21: `confirmAction` and `showError` both live in `src/utils/toast.ts`; `relTime(input: string | number | Date | null | undefined, locale)` accepts the ISO string as is; `locale` is exported from `kiosk-i18n.ts`; the `chip.*` keys and the `bg-moss` / `bg-teal` / `bg-wine` classes exist.

- [ ] **Step 2: Mount it + toast** — in `ForumIndexInner.svelte`: import `ForumDraftsSection`; directly under the filter rail `<div class="mb-5">…</div>` add:

```svelte
  {#if activeFilter === 'mine'}
    <!-- Own drafts (server-side, several per member, 2026-09-21). Above every
         state branch: a member with drafts but no posts must still see them. -->
    <ForumDraftsSection />
  {/if}
```

In `onMount`, next to the `just_posted` block:

```ts
    if (url.searchParams.get('draft_saved') === '1') {
      showToast($t['drafts.saved.toast'], { type: 'success' });
      url.searchParams.delete('draft_saved');
      window.history.replaceState(window.history.state, '', url.toString());
    }
```

(`?kind=mine` stays in the URL — it is real view state, parsed by `indexUrlState.ts`.)

- [ ] **Step 3: Account menu row** — in `AvatarMenu.svelte`, under the `nav.menu.beitraege` row:

```svelte
      <a role="menuitem" href="/forum?kind=mine" class="am-row font-bricolage">{$t['nav.menu.entwuerfe']}</a>
```

- [ ] **Step 4: Copy (OFFER)** — both dictionaries:

```ts
  'drafts.section.title': 'Entwürfe',
  'drafts.section.hint': 'Nur du siehst sie. Geprüft wird erst beim Veröffentlichen.',
  'drafts.untitled': 'Ohne Titel',
  'drafts.changed': 'zuletzt geändert',
  'drafts.resume': 'weiterschreiben',
  'drafts.delete': 'löschen',
  'drafts.delete.confirm': 'Diesen Entwurf endgültig löschen?',
  'drafts.delete.error': 'Der Entwurf ließ sich nicht löschen.',
  'drafts.saved.toast': 'Entwurf gespeichert — du findest ihn hier unter „Meine".',
  'nav.menu.entwuerfe': 'Meine Entwürfe',
```

```ts
  'drafts.section.title': 'Drafts',
  'drafts.section.hint': 'Only you can see these. They are reviewed when you publish.',
  'drafts.untitled': 'Untitled',
  'drafts.changed': 'last changed',
  'drafts.resume': 'continue writing',
  'drafts.delete': 'delete',
  'drafts.delete.confirm': 'Delete this draft for good?',
  'drafts.delete.error': 'The draft could not be deleted.',
  'drafts.saved.toast': 'Draft saved — you find it here under "Mine".',
  'nav.menu.entwuerfe': 'My drafts',
```

- [ ] **Step 5: Browser probe** — `scratchpad/forum-drafts-probe.cjs` (standalone Playwright, `NODE_PATH="$(npm root -g)/@playwright/cli/node_modules"`, dev :4655, widths 390 and 1280). Flow and checks:
  1. `/topics/create` → choose „Ankündigung", title `Entwurf-Probe <ts>`, body `Noch nicht fertig.`, attach `scratchpad/fab-forum-390.png` via the file input → „als Entwurf speichern" → URL becomes `/forum?kind=mine` (param `draft_saved` stripped), toast text contains „Entwurf gespeichert", `[data-forum-drafts]` visible with one `[data-draft-row]` showing the title and the teal chip.
  2. Under „Alle" the section is NOT in the DOM and no feed card carries the title.
  3. „weiterschreiben" → `/topics/create?draft=<id>`; title, body, kind card and ONE image thumbnail are restored; `localStorage['kiosk-draft:topic']` stays `null` after typing (autosave off).
  4. Change the title, save again → still ONE row, new title.
  5. `/topics/create?draft=000000000000000000000000` → lands on `/topics/create` (no query).
  6. Resume, publish → `/forum?just_posted=1`; the post is in `/api/announcements` WITH its image; „Meine" shows no drafts section; the image URL still answers 200.
  7. Save a second draft with an image, delete it in the list (confirm dialog → confirm) → row gone; the image URL answers 404 within 10 s (Cloudinary may cache — accept 404 OR `x-cld-error`; if neither after 10 s report it, do not fail the run silently).
  8. 390 px: no sideways scroll, every control in a row ≥ 36 px high.
  9. Account menu has „Meine Entwürfe" → `/forum?kind=mine`.
  Clean up: delete the probe post. Expected: all PASS at both widths.

- [ ] **Step 6: Gates + orphan-CSS check** — `pnpm build`, then confirm the new component produced no stylesheet of its own: `grep -rl "data-forum-drafts" .vercel/output/static/_astro/*.css | wc -l` → `0`.

- [ ] **Step 7: Commit**

```bash
git add src/components/forum/kiosk/ForumDraftsSection.svelte src/components/forum/kiosk/ForumIndexInner.svelte src/components/forum/kiosk/AvatarMenu.svelte src/lib/kiosk-i18n.ts
git commit -m "forum drafts: Entwürfe section under Meine, saved toast, account menu row"
```

---

### Task 6: Account deletion, docs, final verification

**Files:**
- Modify: `src/lib/auth/accountDeletion.ts` (step 2 block, after `savedEvents`)
- Modify: `CLAUDE.md` (Database Collections), `src/components/forum/kiosk/CLAUDE.md`, `src/components/profile/kiosk/CLAUDE.md` („Account deletion" pipeline list)

- [ ] **Step 1: Pipeline step** — in `accountDeletion.ts`, import `deleteAllDraftsOf` from `'../forum/postDraftsStore'` and add inside the step-2 `try`, after the `savedEvents` line, following the file's own `steps.<name> = …` bookkeeping:

```ts
    // Forum drafts are private working copies — they go with the account,
    // and so do their images (none of them was ever published).
    const delDrafts = await deleteAllDraftsOf(userId);
    steps.postDrafts = delDrafts.drafts;
    steps.postDraftImages = delDrafts.imagesDestroyed;
```

Audited: `steps` is `Record<string, number>` (line 166), so the two keys need no type change; a failing step is recorded through the file's own `fail('<name>', err)` helper — wrap these three lines in their own `try { … } catch (err) { fail('postDrafts', err); }` like the neighbouring steps, so a Cloudinary error cannot abort the pipeline. Check that `accountDeletion.ts` is not imported by any island (`grep -rn "accountDeletion" src/components` → no hit) — it now pulls in Cloudinary through the store (it already imports cloudinary itself, so this holds).

- [ ] **Step 2: Test the step on dev** — extend `scratchpad/e2e-post-drafts.mts`: create a throwaway dev user, two drafts, call `executeAccountDeletion`'s exported entry the way its existing test script does (`grep -rn "accountDeletion" scripts scratchpad | head`), assert `postDrafts` has 0 rows for that user.

- [ ] **Step 3: Docs**
  - Root `CLAUDE.md`, „Database Collections", after `savedPosts`: one bullet for `postDrafts` — shape, „own collection so no feed/search/count query can see a draft", 20 per member, no moderation/limit on save, images destroyed only when unreferenced, removed by account deletion, index script name, and „PROD index run: user".
  - `src/components/forum/kiosk/CLAUDE.md`: new section „Drafts (server-side, 2026-09-21)" — decisions 1–11 in short, the compose `?draft=` flow, „local autosave is OFF while a server draft is open", the two scratch probes, and the Task 1 finding („compose published every kind as a discussion until …").
  - `src/components/profile/kiosk/CLAUDE.md`: add the drafts step to the ordered deletion pipeline.

- [ ] **Step 4: Full verification** — all unit tests (`npx tsx --test src/lib/forum/*.test.ts`), `scratchpad/e2e-post-drafts.mts`, `scratchpad/forum-drafts-probe.cjs`, `scratchpad/compose-kind-probe.cjs`, plus the regression probes `forum-pin-stack-probe.cjs` (19), `forum-tags-chip-probe.cjs` (14), `fab-probe.cjs` (26). Gates. `fuser -k 4655/tcp`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/accountDeletion.ts CLAUDE.md src/components/forum/kiosk/CLAUDE.md src/components/profile/kiosk/CLAUDE.md
git commit -m "forum drafts: removed with the account, docs"
```

- [ ] **Step 6: Hand over** — report to the user: what was built, every new copy key for his wording, the PROD index command (`pnpm tsx scripts/create-post-draft-indexes.ts --prod` = dry-run, add `--apply` to write — HIS to run; without the index the feature works, only slower at scale), and that merge + push wait for his word. After deploy: paced read-only prod check with `atakee+lasttest@gmail.com` — save one draft, see it under „Meine", delete it (this writes ONE private row to prod through the app and removes it again; ask before doing it).

---

## Self-review record

- **Coverage:** several drafts (T2/T3), cross-device + „come back anytime" (T3/T5), reachable from the account menu (T5), images kept (T3/T4), no moderation/limit until publish (T3 + decision 4), clear saved message (T4/T5), local copy stays as crash net (T4 step 3), deletion pipeline (T6), never in feeds/search/counts (own collection + T3 step 5 check 8), publish-by-kind (T1).
- **Names:** `PostDraftDTO`, `PostDraftInput`, `MAX_POST_DRAFTS`, `draftIsEmpty`, `draftResumeHref`, `PostDraftSaveSchema`, `listDrafts`, `getDraft`, `saveDraft`, `deleteDraft`, `deleteAllDraftsOf`, `createEndpointForKind`, `createdDocKeyForKind` — used identically in every task.
- **Audited against the code on 2026-09-21 (fixed in place):** `confirmAction` lives in `utils/toast.ts`, not `utils/confirm.ts`; the notification index script has no dry-run/interlock to copy (the plan now spells both out); the upload folder is `mahalle/posts`; `steps` is an open record and failures go through `fail()`.
- **Still to verify while executing:** the deletion pipeline's test entry point (T6 step 2) and whether `postKind.test.ts` already imports `test`/`assert` (T1 step 1).
- **Open decisions for the user (defaults chosen above):** limit 20; „verwerfen" keeps a server draft; section only under „Meine"; menu label „Meine Entwürfe".
