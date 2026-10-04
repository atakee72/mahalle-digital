import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../lib/mongodb';
import { MAIL_LOCALES } from '../../../lib/newsletter/kiezBriefRules';

// The member's app language as the SERVER knows it (users.locale; absent = German). The DE/EN
// toggle itself lives in the browser's localStorage — this copy exists so that things sent
// without a browser (the weekly Kiez-Brief) can speak the member's language. Written by
// src/lib/localeSync.ts; not ban-gated (a preference, not content).
const BodySchema = z.object({ locale: z.enum(MAIL_LOCALES) });

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
  if (!parsed.success) return json({ error: 'Invalid locale' }, 400);
  const { locale } = parsed.data;

  const db = await connectDB();
  await db.collection('users').updateOne(
    { _id: new ObjectId(session.user.id) },
    locale === 'de' ? { $unset: { locale: '' } } : { $set: { locale } },
  );
  return json({ locale });
};
