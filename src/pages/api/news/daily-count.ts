import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../lib/mongodb';
import { checkDailyLimit } from '../../../lib/limits/dailyLimit';

// User's news-submission count in the rolling 24h window (quota = the member’s daily limit, 5 unless raised).
// Counts only user submissions (source: 'user_submitted'), not AI-fetched.
export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const db = await connectDB();
    // The news bucket.
    const r = await checkDailyLimit(db, { userId: session.user.id, role: session.user.role }, 'news');
    return new Response(JSON.stringify({ count: r.count, limit: r.limit, remaining: r.remaining, canSubmit: r.allowed }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
