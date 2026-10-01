import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { connectDB } from '../../../../lib/mongodb';
import { requireAdminSession } from '../../../../lib/auth';
import { MEMBER_TYPES, MAX_DAILY_LIMIT } from '../../../../lib/members/memberType';
import { planAdminPatch } from '../../../../lib/members/memberTypeChange';

// PATCH /api/admin/users/[id] — admin writes on a member: `verified` (Kiez-
// verification v1), `memberType` (correcting the member's own choice) and
// `dailyLimit` (1–50, organisations only). This admin-gated endpoint is the
// ONLY writer of `verified` and `dailyLimit` — keep it that way.
// Tombstoned accounts (anonymized: true) are excluded from the match →
// 404, so a deleted user can't be re-verified.

const BodySchema = z.object({
  verified: z.boolean().optional(),
  memberType: z.enum(MEMBER_TYPES).optional(),
  dailyLimit: z.number().int().min(1).max(MAX_DAILY_LIMIT).nullable().optional(),
}).strict();

export const PATCH: APIRoute = async ({ request, params }) => {
  const guard = await requireAdminSession(request);
  if (!guard.ok) return guard.response;

  const id = params.id ?? '';
  if (!ObjectId.isValid(id)) {
    return new Response(JSON.stringify({ error: 'invalid_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = await connectDB();
    const users = db.collection('users');
    const _id = new ObjectId(id);
    // Read first: the limit rule depends on the member's type AFTER this call.
    const stored = await users.findOne(
      { _id, anonymized: { $ne: true } },
      { projection: { memberType: 1, dailyLimit: 1, verified: 1 } }
    );
    if (!stored) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const plan = planAdminPatch(stored, parsed.data);
    if (!plan.ok) {
      return new Response(JSON.stringify({ error: plan.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const update: Record<string, Record<string, unknown>> = {};
    if (Object.keys(plan.set).length > 0) update.$set = plan.set;
    if (plan.unset.length > 0) update.$unset = Object.fromEntries(plan.unset.map((f) => [f, '']));
    if (Object.keys(update).length > 0) {
      await users.updateOne({ _id, anonymized: { $ne: true } }, update);
    }

    return new Response(JSON.stringify({
      success: true,
      verified: plan.set.verified ?? stored.verified === true,
      memberType: plan.result.memberType,
      dailyLimit: plan.result.dailyLimit,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Admin user update error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
