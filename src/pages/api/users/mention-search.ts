import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../lib/mongodb';
import { consumeRateLimit } from '../../../lib/auth/rateLimit';

// Autocomplete for „@" in forum posts and comments (2026-09-21). Members only
// (the middleware gates /api/users too; the session is needed here for the rate
// limit and to leave the caller out). Every member with a handle is findable —
// user decision 09-21, including members who never posted. ALLOWLIST projection
// (name, handle, avatar); tombstoned accounts never appear. The query is
// validated AND escaped before it becomes a regex.

const LIMIT_PER_HOUR = 600; // one request per typing pause
const MAX_HITS = 6;
const Q_RE = /^[\p{L}\p{N}_ .'-]{1,20}$/u;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);

    const q = (url.searchParams.get('q') ?? '').trim();
    if (!Q_RE.test(q)) return json({ error: 'bad_query' }, 400);

    const cap = await consumeRateLimit(`mentionsearch:${session.user.id}`, LIMIT_PER_HOUR, 60 * 60 * 1000);
    if (cap.limited) return json({ error: 'throttled' }, 429);

    const self = ObjectId.isValid(session.user.id) ? new ObjectId(session.user.id) : null;
    const db = await connectDB();
    const docs = await db
      .collection('users')
      .find(
        {
          anonymized: { $ne: true },
          handle: { $type: 'string' },
          ...(self ? { _id: { $ne: self } } : {}),
          $or: [
            { handle: { $regex: `^${escapeRe(q.toLowerCase())}` } },
            { name: { $regex: `(^|\\s)${escapeRe(q)}`, $options: 'i' } }
          ]
        },
        { projection: { name: 1, handle: 1, image: 1, userPicture: 1 } }
      )
      .sort({ handle: 1 })
      .limit(MAX_HITS)
      .toArray();

    // „@alle" Admin-Hinweis (2026-09-22): admins see a synthetic „alle" row
    // when the query could still be typing that handle. Non-admins never do.
    const broadcast = session.user.role === 'admin' && 'alle'.startsWith(q.toLowerCase());

    return json(
      {
        users: docs.map((u) => ({
          id: String(u._id),
          name: typeof u.name === 'string' ? u.name : '',
          handle: String(u.handle),
          image: u.image || u.userPicture || null
        })),
        broadcast
      },
      200
    );
  } catch (error) {
    console.error('mention-search error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
