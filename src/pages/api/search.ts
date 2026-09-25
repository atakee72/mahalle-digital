import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../lib/mongodb';
import { consumeRateLimit } from '../../lib/auth/rateLimit';
import { normalizeQuery } from '../../lib/forum/searchQuery';
import { searchSite } from '../../lib/search/siteSearchStore';
import { loadBlogSearchEntries } from '../../lib/search/blogEntries';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Cookie' },
  });

// Site search over Forum, Kalender, Markt, News and Blog (2026-09-25 — until
// then forum only). Members only (middleware gates the prefix too). 300
// queries per member and hour — the islands debounce, a person cannot reach
// that. Every section answers or the request fails: no partial results.
export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const q = normalizeQuery(url.searchParams.get('q'));
  if (!q) return json({ error: 'query_invalid' }, 400);

  const rl = await consumeRateLimit(`search:${userId}`, 300, 60 * 60 * 1000);
  if (rl.limited) return json({ error: 'rate_limited' }, 429);

  const [db, blog] = await Promise.all([connectDB(), loadBlogSearchEntries()]);
  return json(await searchSite(db, q, userId, blog));
};
