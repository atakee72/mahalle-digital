import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { deleteDraft } from '../../../../lib/forum/postDraftsStore';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// Deliberately NOT ban-guarded: a banned member may still clean up their drafts.
export const DELETE: APIRoute = async ({ request, params }) => {
  const session = await getSession(request);
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);
  const { deleted, imagesDestroyed } = await deleteDraft(String(params.id ?? ''), session.user.id);
  // imagesDestroyed is returned so probes can assert on it — the CDN may keep
  // serving a destroyed image for a while, a 404 check would be unreliable.
  return deleted ? json({ deleted: true, imagesDestroyed }, 200) : json({ error: 'not_found' }, 404);
};
