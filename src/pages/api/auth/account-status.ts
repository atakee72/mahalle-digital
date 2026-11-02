import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../lib/mongodb';

// Live account state for the session user: `banned` (SuspendedBanner) and `emailBounced`
// (EmailBounceBanner — Resend reported the address as permanently undeliverable). Mirrors
// verification-status: the JWT can't be trusted (bans happen mid-session), so the banners ask
// the DB. Session-gated — reveals nothing about other accounts.
export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  const id = session.user.id;
  let banned = false;
  let emailBounced = false;
  if (ObjectId.isValid(id)) {
    const db = await connectDB();
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(id) },
      { projection: { isBanned: 1, emailBounce: 1 } },
    );
    banned = user?.isBanned === true;
    emailBounced = !!user?.emailBounce;
  }
  return new Response(JSON.stringify({ banned, emailBounced }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
