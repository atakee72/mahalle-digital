import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../lib/mongodb';
import { VISIT_SECTIONS, toMs } from '../../../lib/visits/visitRules';

// „New since your last visit": opening a section's index page stamps
// users.lastVisit.<section> and answers with the PREVIOUS stamp — the baseline
// for that visit's card markers. Not ban-gated (reading is allowed while banned).
const BodySchema = z.object({ section: z.enum(VISIT_SECTIONS) });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) return json({ error: 'Unauthorized' }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid section' }, 400);
  const { section } = parsed.data;

  const db = await connectDB();
  const before = await db.collection('users').findOneAndUpdate(
    { _id: new ObjectId(session.user.id) },
    { $set: { [`lastVisit.${section}`]: new Date() } },
    { returnDocument: 'before', projection: { lastVisit: 1 } },
  );
  const previousMs = toMs(before?.lastVisit?.[section]);
  return json({ previous: previousMs === null ? null : new Date(previousMs).toISOString() });
};
