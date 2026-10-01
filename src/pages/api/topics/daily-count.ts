import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../lib/mongodb';
import { checkDailyLimit } from '../../../lib/limits/dailyLimit';

// User's topic-create count in the rolling 24h window (forum quota = 5/day).
// Used to proactively show the "exhausted" state on the newsboard "discuss in
// forum" CTA. Counts the `topics` collection by `author` (NOT news submissions).
export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const db = await connectDB();
    // The forum bucket.
    const r = await checkDailyLimit(db, { userId: session.user.id, role: session.user.role }, 'forum');
    return new Response(JSON.stringify({ count: r.count, limit: r.limit, remaining: r.remaining, canCreate: r.allowed }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
