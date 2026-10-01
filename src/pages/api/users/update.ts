import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { z } from 'zod';
import { connectDB } from '../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import { rejectIfBanned } from '../../../lib/auth/banGuard';
import { checkNameProfanity, checkMottoProfanity } from '../../../lib/moderation';
import { PROFILE_NAME_REGEX, HOBBY_MAX_COUNT, HOBBY_MAX_LEN, MOTTO_MAX_LEN } from '../../../lib/profile/profileShared';
import { cleanDisplayName, isProtectedName } from '../../../lib/profile/nameRules';
import { isAdminLookalike } from '../../../lib/profile/protectedNamesStore';
import { MEMBER_TYPES, storedMemberType } from '../../../lib/members/memberType';
import { planSelfTypeChange } from '../../../lib/members/memberTypeChange';
import { alertMemberType } from '../../../lib/adminAlerts';
import { consumeRateLimit } from '../../../lib/auth/rateLimit';

const BodySchema = z.object({
  // Cleaned first (whitespace collapsed, invisible characters stripped), then the shared rule.
  name: z.string().transform((s) => cleanDisplayName(s)).pipe(z.string().regex(PROFILE_NAME_REGEX, 'name_invalid')).optional(),
  hobbies: z.array(z.string().trim().min(1).max(HOBBY_MAX_LEN)).max(HOBBY_MAX_COUNT).optional(),
  // '' is a valid, meaningful value here (explicit clear -> $unset below) —
  // do NOT add .min(1), that would reject the clear-motto request with a 400.
  motto: z.string().trim().max(MOTTO_MAX_LEN).optional(),
  // Self-chosen member type (label only). `dailyLimit` is deliberately NOT in
  // this schema: unknown keys are stripped, so a member can never write it.
  memberType: z.enum(MEMBER_TYPES, { message: 'member_type_invalid' }).optional(),
}).refine((d) => d.name !== undefined || d.hobbies !== undefined || d.motto !== undefined || d.memberType !== undefined, { message: 'Nothing to update' });

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Ban enforcement: banned accounts are read-only (3-strike Sperre).
    const bannedRes = await rejectIfBanned(session.user.id);
    if (bannedRes) return bannedRes;

    const body = await request.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.issues[0]?.message || 'Invalid request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { name, hobbies, motto, memberType } = parsed.data;

    const db = await connectDB();

    if (name !== undefined) {
      // Nobody poses as the team. Admins are exempt: an admin's real display
      // name may legitimately be „Mahalle Team".
      if (session.user.role !== 'admin' && (isProtectedName(name) || await isAdminLookalike(db, name, session.user.id))) {
        return new Response(JSON.stringify({ error: 'name_protected' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const nameCheck = await checkNameProfanity(name);
      if (!nameCheck.clean) {
        return new Response(JSON.stringify({ error: nameCheck.reason || 'Invalid display name' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Motto is printed on the Steckbrief + is public data — same profanity
    // gate as name. Empty string means "clear it" (checked below via $unset),
    // so only run the check when there's actual text to vet.
    if (motto !== undefined && motto !== '') {
      const mottoCheck = await checkMottoProfanity(motto);
      if (!mottoCheck.clean) {
        return new Response(JSON.stringify({ error: mottoCheck.reason || 'Invalid motto' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const users = db.collection('users');

    // The type change needs the stored value (re-saving the same type must
    // neither clear the admin's limit nor ping). Read-then-write is not
    // atomic: two parallel saves can ping twice — accepted.
    let typePlan: ReturnType<typeof planSelfTypeChange> | null = null;
    if (memberType !== undefined) {
      const before = await users.findOne(
        { _id: new ObjectId(session.user.id) },
        { projection: { memberType: 1 } }
      );
      if (!before) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      typePlan = planSelfTypeChange(storedMemberType(before), memberType);
    }

    const setFields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (name !== undefined) setFields.name = name;
    if (hobbies !== undefined) setFields.hobbies = hobbies;
    if (motto !== undefined && motto !== '') setFields.motto = motto;
    const unsetFields: Record<string, ''> = {};
    if (motto === '') unsetFields.motto = '';
    if (typePlan?.changed) {
      if (typePlan.set.memberType) setFields.memberType = typePlan.set.memberType;
      for (const f of typePlan.unset) unsetFields[f] = '';
    }

    const result = await users.findOneAndUpdate(
      { _id: new ObjectId(session.user.id) },
      {
        $set: setFields,
        ...(Object.keys(unsetFields).length > 0 && { $unset: unsetFields }),
      },
      { returnDocument: 'after', projection: { name: 1, hobbies: 1, motto: 1, memberType: 1, handle: 1 } }
    );

    if (!result) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Operational ping (never-throw, no-op without env): only when the member's
    // own change ended on Initiative or Gewerbe. Admins never alert themselves.
    if (typePlan?.ping && typePlan.set.memberType && session.user.role !== 'admin') {
      // At most 5 pings an hour per member: the type itself can be changed
      // freely, the admin's Telegram must not be floodable by toggling it.
      // (A bucket failure only skips the ping — the save is already written.)
      const ping = await consumeRateLimit(`membertype:${session.user.id}`, 5, 60 * 60 * 1000)
        .catch(() => ({ limited: true }));
      if (!ping.limited) {
        await alertMemberType({
          name: String(result.name ?? ''),
          handle: typeof result.handle === 'string' ? result.handle : null,
          memberType: typePlan.set.memberType,
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      name: result.name,
      hobbies: Array.isArray(result.hobbies) ? result.hobbies : [],
      motto: typeof result.motto === 'string' ? result.motto : null,
      memberType: storedMemberType(result),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Profile update error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
