import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../lib/mongodb';
import { checkDailyLimit } from '../../../lib/limits/dailyLimit';

export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);

    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = await connectDB();
    // The listings bucket.
    const r = await checkDailyLimit(db, { userId: session.user.id, role: session.user.role }, 'listings');
    return new Response(JSON.stringify({ count: r.count, limit: r.limit, remaining: r.remaining, canCreate: r.allowed }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Daily count error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
