import type { APIRoute } from 'astro';
import type { z } from 'zod';
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
  // parseRequestBody's generic resolves to the schema's INPUT shape (defaults
  // still optional); at runtime safeParse has applied them.
  const data = validation.data as z.output<typeof PostDraftSaveSchema>;
  if (draftIsEmpty(data)) return json({ error: 'draft_empty' }, 400);

  const result = await saveDraft(session.user.id, data);
  if (!result.ok) return json({ error: result.reason === 'limit' ? 'draft_limit' : 'not_found' }, result.reason === 'limit' ? 409 : 404);
  return json({ draft: result.draft }, 200);
};
