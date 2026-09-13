// Change a forum post's kind: move it between topics / announcements /
// recommendations. Same gate as the edit endpoints (author, approved, no
// warning label) + admin allowed; official announcements never move (they
// belong to /admin/announcements and carry the pin lifecycle). The heavy
// lifting is src/lib/forum/movePost.ts.
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { ObjectId } from 'mongodb';
import * as Sentry from '@sentry/astro';
import { connectDB } from '../../../../lib/mongodb';
import { invalidateKiezKontext } from '../../../../lib/kiez/kontext';
import { rejectIfBanned } from '../../../../lib/auth/banGuard';
import { isOwner } from '../../../../utils/authHelpers';
import { parseRequestBody } from '../../../../schemas/validation.utils';
import { PostMoveSchema } from '../../../../schemas/forum.schema';
import { movePost } from '../../../../lib/forum/movePost';
import { hrefForPost } from '../../../../lib/forum/postKind';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const session = await getSession(request);
    if (!session?.user) return json({ error: 'Unauthorized - Please login' }, 401);

    const bannedRes = await rejectIfBanned(session.user.id);
    if (bannedRes) return bannedRes;

    const id = params.id;
    if (!id || !ObjectId.isValid(id)) return json({ error: 'Invalid post ID' }, 400);

    const validation = await parseRequestBody(request, PostMoveSchema);
    if (!validation.success) return validation.response;
    const { from, to } = validation.data;
    if (from === to) return json({ error: 'same_collection' }, 400);

    const db = await connectDB();
    const existing = await db.collection(from).findOne({ _id: new ObjectId(id) });
    if (!existing) return json({ error: 'Post not found' }, 404);

    const isAdmin = session.user.role === 'admin';
    if (!isAdmin && !isOwner(existing.author, session.user.id)) {
      return json({ error: 'You can only change your own posts' }, 403);
    }
    // Mirrors /api/{collection}/edit/[id].ts: nothing under review or
    // warning-labelled gets rewritten — and a kind change is a rewrite.
    if (existing.moderationStatus !== 'approved' || existing.hasWarningLabel) {
      return json({ error: 'edit_blocked_by_moderation' }, 403);
    }
    if (existing.isOfficial === true) return json({ error: 'official_announcement' }, 403);

    const result = await movePost(db, { id, from, to });
    if (!result.ok) return json({ error: result.reason }, result.reason === 'not_found' ? 404 : 400);

    // Anwohner-Kontext keyword-matches forum titles in `topics` — a title
    // entering or leaving that collection changes the chip payload.
    await invalidateKiezKontext();

    return json({ collection: to, href: hrefForPost(to, id) });
  } catch (error) {
    console.error('Post move error:', error);
    // Vercel freezes the function the instant the response leaves, eating
    // the SDK's async event POST — flush here, inside the request window,
    // or a crash mid-move (post stuck in both collections) goes unseen.
    Sentry.captureException(error, { extra: { id: params.id, route: 'posts/move' } });
    await Sentry.flush(2000);
    return json({ error: 'Internal server error' }, 500);
  }
};
