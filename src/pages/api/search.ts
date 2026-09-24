import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../lib/mongodb';
import { consumeRateLimit } from '../../lib/auth/rateLimit';
import { normalizeQuery } from '../../lib/forum/searchQuery';
import { searchForum } from '../../lib/forum/searchStore';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Forum search. Members only (middleware gates the prefix too). 300 queries
// per member and hour — the island debounces, a person cannot reach that.
export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const q = normalizeQuery(url.searchParams.get('q'));
  if (!q) return json({ error: 'query_invalid' }, 400);

  const rl = await consumeRateLimit(`search:${userId}`, 300, 60 * 60 * 1000);
  if (rl.limited) return json({ error: 'rate_limited' }, 429);

  const db = await connectDB();
  return json(await searchForum(db, q, userId));
};
