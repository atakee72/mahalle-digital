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

const BodySchema = z.object({
  // Cleaned first (whitespace collapsed, invisible characters stripped), then the shared rule.
  name: z.string().transform((s) => cleanDisplayName(s)).pipe(z.string().regex(PROFILE_NAME_REGEX, 'name_invalid')).optional(),
  hobbies: z.array(z.string().trim().min(1).max(HOBBY_MAX_LEN)).max(HOBBY_MAX_COUNT).optional(),
  // '' is a valid, meaningful value here (explicit clear -> $unset below) —
  // do NOT add .min(1), that would reject the clear-motto request with a 400.
  motto: z.string().trim().max(MOTTO_MAX_LEN).optional(),
}).refine((d) => d.name !== undefined || d.hobbies !== undefined || d.motto !== undefined, { message: 'Nothing to update' });

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
    const { name, hobbies, motto } = parsed.data;

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

    const setFields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (name !== undefined) setFields.name = name;
    if (hobbies !== undefined) setFields.hobbies = hobbies;
    if (motto !== undefined && motto !== '') setFields.motto = motto;
    const unsetFields: Record<string, ''> = {};
    if (motto === '') unsetFields.motto = '';

    const result = await users.findOneAndUpdate(
      { _id: new ObjectId(session.user.id) },
      {
        $set: setFields,
        ...(Object.keys(unsetFields).length > 0 && { $unset: unsetFields }),
      },
      { returnDocument: 'after', projection: { name: 1, hobbies: 1, motto: 1 } }
    );

    if (!result) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      name: result.name,
      hobbies: Array.isArray(result.hobbies) ? result.hobbies : [],
      motto: typeof result.motto === 'string' ? result.motto : null,
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
