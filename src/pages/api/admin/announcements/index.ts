import type { APIRoute } from 'astro';
import { connectDB } from '../../../../lib/mongodb';
import { requireAdminSession } from '../../../../lib/auth';
import { shapePostForViewer } from '../../../../lib/forum/commentLike';
import { populateAuthors } from '../../../../lib/topicsQuery';

// GET /api/admin/announcements — list of official announcements for
// the admin panel. Sorted by createdAt desc, capped at 50 (low admin
// volume; pagination can be added later if needed). Author is populated
// for display.

export const GET: APIRoute = async ({ request }) => {
  const guard = await requireAdminSession(request);
  if (!guard.ok) return guard.response;

  try {
    const db = await connectDB();
    const docs = await db
      .collection('announcements')
      .find({ isOfficial: true })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    const items = (await populateAuthors(docs as any[])).map((d) => shapePostForViewer(d as any, guard.userId));
    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Admin announcements list error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
