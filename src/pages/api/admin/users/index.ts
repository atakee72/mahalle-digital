import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../../lib/mongodb';
import { requireAdminSession } from '../../../../lib/auth';
import { storedMemberType } from '../../../../lib/members/memberType';
import { storedNewsletterMode } from '../../../../lib/newsletter/kiezBriefRules';
import { emailFragment, escapeRegex } from '../../../../lib/members/emailLookup';

// GET /api/admin/users — full members list for /admin/mitglieder.
// ALLOWLIST projection only (never a full doc, never a {password:0}-style
// blocklist — this payload reaches the admin's browser). Tombstoned
// accounts (anonymized: true) are excluded: their verified flag is
// $unset by the deletion pipeline and they must stay untogglable.
// Capped at 1000 — a neighborhood app; revisit with pagination if the
// community ever outgrows it.
//
// Since 2026-10-04 (evening) each row carries the member's `email` — the admin asked for a new
// member's address and no admin surface showed one. Admin-only payload, `no-store`.
//
// GET /api/admin/users?email=<part of an address> (2026-10-04) — which members have an
// address containing this? Answers `{ ids }` only (a bounce names an address; the admin needs the row).
// The island calls it while the admin types (from three characters). Literal, case-insensitive
// substring match on `email` and on the address of a pending change; at most 50 hits.

export const GET: APIRoute = async ({ request }) => {
  const guard = await requireAdminSession(request);
  if (!guard.ok) return guard.response;

  const emailParam = new URL(request.url).searchParams.get('email');
  if (emailParam !== null) {
    const fragment = emailFragment(emailParam);
    if (!fragment) {
      return new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    try {
      const db = await connectDB();
      const match = { $regex: escapeRegex(fragment), $options: 'i' };
      const hits = await db
        .collection('users')
        .find({ anonymized: { $ne: true }, $or: [{ email: match }, { pendingEmail: match }] }, { projection: { _id: 1 } })
        .limit(50)
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
        { projection: { name: 1, handle: 1, email: 1, createdAt: 1, emailVerified: 1, verified: 1, role: 1, memberType: 1, dailyLimit: 1, newsletter: 1, invitedBy: 1, invitesPaused: 1 } }
      )
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray();

    // The invite tree (2026-10-07): who issued the link each member came through, and how many
    // members each one brought in. Inviters are resolved from the loaded rows (the list is the
    // whole community) plus one lookup for inviters outside it (tombstones → „Ehemaliges Mitglied").
    const byId = new Map(docs.map((u) => [u._id.toString(), u]));
    const inviterIds = Array.from(new Set(docs.map((u) => u.invitedBy).filter((v) => v !== undefined && v !== null).map(String)));
    const missing = inviterIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const extra = await db
        .collection('users')
        .find({ _id: { $in: missing.flatMap((id) => (ObjectId.isValid(id) ? [new ObjectId(id), id] : [id])) as any[] } }, { projection: { name: 1, handle: 1 } })
        .toArray();
      for (const u of extra) byId.set(u._id.toString(), u);
    }
    const invitedCount = new Map<string, number>();
    for (const u of docs) {
      if (u.invitedBy === undefined || u.invitedBy === null) continue;
      const k = String(u.invitedBy);
      invitedCount.set(k, (invitedCount.get(k) ?? 0) + 1);
    }

    const users = docs.map((u) => ({
      id: u._id.toString(),
      name: typeof u.name === 'string' ? u.name : '',
      handle: typeof u.handle === 'string' ? u.handle : null,
      email: typeof u.email === 'string' ? u.email : null,
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
      invitedBy: (() => {
        if (u.invitedBy === undefined || u.invitedBy === null) return null;
        const inviter = byId.get(String(u.invitedBy));
        return {
          name: typeof inviter?.name === 'string' ? inviter.name : '',
          handle: typeof inviter?.handle === 'string' ? inviter.handle : null,
        };
      })(),
      invited: invitedCount.get(u._id.toString()) ?? 0,
      invitesPaused: u.invitesPaused === true,
    }));

    return new Response(JSON.stringify({ users }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('Admin users list error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
