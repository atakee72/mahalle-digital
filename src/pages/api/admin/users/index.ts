import type { APIRoute } from 'astro';
import { connectDB } from '../../../../lib/mongodb';
import { requireAdminSession } from '../../../../lib/auth';
import { storedMemberType } from '../../../../lib/members/memberType';
import { storedNewsletterMode } from '../../../../lib/newsletter/kiezBriefRules';
import { lookupEmail } from '../../../../lib/members/emailLookup';

// GET /api/admin/users — full members list for /admin/mitglieder.
// ALLOWLIST projection only (never a full doc, never a {password:0}-style
// blocklist — this payload reaches the admin's browser). Tombstoned
// accounts (anonymized: true) are excluded: their verified flag is
// $unset by the deletion pipeline and they must stay untogglable.
// Capped at 1000 — a neighborhood app; revisit with pagination if the
// community ever outgrows it.
//
// GET /api/admin/users?email=<whole address> (2026-10-04) — which member has this
// address? Answers `{ ids }` only: the list above never carries addresses, and this
// lookup echoes none either (a bounce names an address; the admin needs the row).
// Exact match, case-insensitive (collation), also the address of a pending change.

export const GET: APIRoute = async ({ request }) => {
  const guard = await requireAdminSession(request);
  if (!guard.ok) return guard.response;

  const emailParam = new URL(request.url).searchParams.get('email');
  if (emailParam !== null) {
    const email = lookupEmail(emailParam);
    if (!email) {
      return new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    try {
      const db = await connectDB();
      const hits = await db
        .collection('users')
        .find({ anonymized: { $ne: true }, $or: [{ email }, { pendingEmail: email }] }, { projection: { _id: 1 } })
        .collation({ locale: 'en', strength: 2 })
        .limit(5)
        .toArray();
      return new Response(JSON.stringify({ ids: hits.map((u) => u._id.toString()) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    } catch (error) {
      console.error('Admin users e-mail lookup error:', error);
      return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  try {
    const db = await connectDB();
    const docs = await db
      .collection('users')
      .find(
        { anonymized: { $ne: true } },
        { projection: { name: 1, handle: 1, createdAt: 1, emailVerified: 1, verified: 1, role: 1, memberType: 1, dailyLimit: 1, newsletter: 1 } }
      )
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray();

    const users = docs.map((u) => ({
      id: u._id.toString(),
      name: typeof u.name === 'string' ? u.name : '',
      handle: typeof u.handle === 'string' ? u.handle : null,
      createdAt:
        u.createdAt instanceof Date
          ? u.createdAt.toISOString()
          : typeof u.createdAt === 'string'
            ? u.createdAt
            : null,
      emailVerified: u.emailVerified === true,
      verified: u.verified === true,
      // Kiez-Brief: 'weekly' (absent) or 'off' — the admin can switch it for test accounts and bounced addresses.
      newsletter: storedNewsletterMode(u.newsletter),
      role: u.role === 'admin' ? ('admin' as const) : ('user' as const),
      memberType: storedMemberType(u),
      // The stored number, shown only for an organisation (it counts for no one else).
      dailyLimit:
        storedMemberType(u) === 'organisation' && typeof u.dailyLimit === 'number' ? u.dailyLimit : null,
    }));

    return new Response(JSON.stringify({ users }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Admin users list error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
