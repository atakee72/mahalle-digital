import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../lib/mongodb';
import { FORUM_NOTIFY_MODES, storedForumNotify } from '../../../lib/forum/forumNotifyRules';

// The member's forum-notification preference (users.forumNotify; absent = 'each').
// Not ban-gated: turning notifications down must always be possible.
const BodySchema = z.object({ mode: z.enum(FORUM_NOTIFY_MODES) });

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
    { projection: { forumNotify: 1 } },
  );
  return json({ mode: storedForumNotify(user?.forumNotify) });
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
    mode === 'each' ? { $unset: { forumNotify: '' } } : { $set: { forumNotify: mode } },
  );
  return json({ mode });
};
