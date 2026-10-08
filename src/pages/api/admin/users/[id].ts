import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { connectDB } from '../../../../lib/mongodb';
import { requireAdminSession } from '../../../../lib/auth';
import { MEMBER_TYPES, MAX_DAILY_LIMIT } from '../../../../lib/members/memberType';
import { planAdminPatch } from '../../../../lib/members/memberTypeChange';
import { NEWSLETTER_MODES, storedNewsletterMode } from '../../../../lib/newsletter/kiezBriefRules';

// PATCH /api/admin/users/[id] — admin writes on a member: `verified` (Kiez-
// verification v1), `memberType` (correcting the member's own choice) and
// `dailyLimit` (1–50, organisations only). This admin-gated endpoint is the
// ONLY writer of `verified` and `dailyLimit` — keep it that way.
// `newsletter` ('weekly' | 'off', 2026-10-04): the Kiez-Brief switch the member
// also has in the profile — here for test accounts and addresses that bounce.
// Tombstoned accounts (anonymized: true) are excluded from the match →
// 404, so a deleted user can't be re-verified.

const BodySchema = z.object({
  verified: z.boolean().optional(),
  memberType: z.enum(MEMBER_TYPES).optional(),
  dailyLimit: z.number().int().min(1).max(MAX_DAILY_LIMIT).nullable().optional(),
  newsletter: z.enum(NEWSLETTER_MODES).optional(),
  // Personal invitation link: pause one member's inviting (their link stops working, the card
  // tells them). Admin-only writer, like `verified`.
  invitesPaused: z.boolean().optional(),
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
      { projection: { memberType: 1, dailyLimit: 1, verified: 1, newsletter: 1, invitesPaused: 1 } }
    );
    if (!stored) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // The planner knows `verified`, `memberType` and `dailyLimit`, and refuses a body with none
    // of them — so a call with only the fields outside its knowledge (Kiez-Brief, invites) gets
    // an empty plan (nothing else changes).
    const { newsletter, invitesPaused, ...rest } = parsed.data;
    const outsideOnly = Object.keys(rest).length === 0;
    const plan = outsideOnly
      ? planAdminPatch(stored, { verified: stored.verified === true })
      : planAdminPatch(stored, rest);
    if (!plan.ok) {
      return new Response(JSON.stringify({ error: plan.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Same storage rule as the member's own switch: absent = weekly, 'off' = none.
    const set: Record<string, unknown> = { ...plan.set };
    const unset: string[] = [...plan.unset];
    // The outside-only plan above restates `verified` to satisfy the planner: do not write it.
    if (outsideOnly) delete set.verified;
    if (newsletter === 'off') set.newsletter = 'off';
    if (newsletter === 'weekly') unset.push('newsletter');
    // Absent = may invite; only `true` is stored.
    if (invitesPaused === true) set.invitesPaused = true;
    if (invitesPaused === false) unset.push('invitesPaused');

    const update: Record<string, Record<string, unknown>> = {};
    if (Object.keys(set).length > 0) update.$set = set;
    if (unset.length > 0) update.$unset = Object.fromEntries(unset.map((f) => [f, '']));
    if (Object.keys(update).length > 0) {
      await users.updateOne({ _id, anonymized: { $ne: true } }, update);
    }

    return new Response(JSON.stringify({
      success: true,
      verified: plan.set.verified ?? stored.verified === true,
      memberType: plan.result.memberType,
      dailyLimit: plan.result.dailyLimit,
      newsletter: newsletter ?? storedNewsletterMode(stored.newsletter),
      invitesPaused: invitesPaused ?? stored.invitesPaused === true,
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
