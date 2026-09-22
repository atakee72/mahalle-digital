import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { z } from 'zod';
import { connectDB } from '../../../lib/mongodb';
import { ObjectId } from 'mongodb';

// Tour progress — additive users fields (tours.<chapter>: Date, tourHelloDismissedAt: Date).
// Deliberately NOT ban-gated: reading a UI tour is not content-writing; banned
// accounts keep read access to the app and may see the tour.
const CHAPTERS = ['forum', 'kalender', 'markt', 'kurier', 'kiezdaten', 'blog', 'profil'] as const;

const BodySchema = z.object({
  chapter: z.enum(CHAPTERS).optional(),
  hello: z.literal(true).optional(),
}).refine((d) => d.chapter !== undefined || d.hello === true, { message: 'Nothing to mark' });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);
  const db = await connectDB();
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(session.user.id) },
    { projection: { tours: 1, tourHelloDismissedAt: 1 } }
  );
  return json({
    tours: user?.tours ?? {},
    tourHelloDismissedAt: user?.tourHelloDismissedAt ?? null,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400);

  const $set: Record<string, Date> = {};
  const now = new Date();
  // $set only when absent (first write wins — restarts/aborts never move the date).
  const db = await connectDB();
  const users = db.collection('users');
  const _id = new ObjectId(session.user.id);
  const existing = await users.findOne({ _id }, { projection: { tours: 1, tourHelloDismissedAt: 1 } });
  if (parsed.data.chapter && !existing?.tours?.[parsed.data.chapter]) $set[`tours.${parsed.data.chapter}`] = now;
  if (parsed.data.hello && !existing?.tourHelloDismissedAt) $set.tourHelloDismissedAt = now;
  if (Object.keys($set).length) await users.updateOne({ _id }, { $set });
  return json({ ok: true });
};
