import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../lib/mongodb';
import { NEWSLETTER_MODES, storedNewsletterMode } from '../../../lib/newsletter/kiezBriefRules';
import { setOwnNewsletterMode } from '../../../lib/newsletter/preference';

// The member's Kiez-Brief preference (users.newsletter; absent = 'weekly').
// Not ban-gated: turning a mail off must always be possible.
const BodySchema = z.object({ mode: z.enum(NEWSLETTER_MODES) });

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
    { projection: { newsletter: 1, emailVerified: 1 } },
  );
  return json({ mode: storedNewsletterMode(user?.newsletter), emailVerified: user?.emailVerified === true });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) return json({ error: 'Unauthorized' }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid mode' }, 400);
  const { mode } = parsed.data;

  await setOwnNewsletterMode(session.user.id, mode, 'profile');
  return json({ mode });
};
