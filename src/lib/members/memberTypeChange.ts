// src/lib/members/memberTypeChange.ts — dependency-pure decisions for the two
// writers of users.memberType: the member (profile edit) and the admin
// (/admin/mitglieder). `dailyLimit` belongs to an organisation: whoever moves
// a member away from that type removes the number in the same update.
import { storedMemberType, type MemberType, type UserFields } from './memberType';

type UnsetField = 'memberType' | 'dailyLimit';

export interface SelfTypePlan {
  changed: boolean;
  set: { memberType?: 'organisation' | 'business' };
  unset: UnsetField[];
  /** Telegram ping: only when the member's own change ends on organisation or business. */
  ping: boolean;
}

export function planSelfTypeChange(stored: MemberType, requested: MemberType): SelfTypePlan {
  if (stored === requested) return { changed: false, set: {}, unset: [], ping: false };
  if (requested === 'person') {
    return { changed: true, set: {}, unset: ['memberType', 'dailyLimit'], ping: false };
  }
  return {
    changed: true,
    set: { memberType: requested },
    unset: stored === 'organisation' ? ['dailyLimit'] : [],
    ping: true,
  };
}

export interface AdminPatchBody {
  verified?: boolean;
  memberType?: MemberType;
  dailyLimit?: number | null;
}

export type AdminPatchPlan =
  | { ok: false; error: 'invalid_body' | 'limit_needs_organisation' }
  | {
      ok: true;
      set: { verified?: boolean; memberType?: 'organisation' | 'business'; dailyLimit?: number };
      unset: UnsetField[];
      /** State after the write, for the response. */
      result: { memberType: MemberType; dailyLimit: number | null };
    };

export function planAdminPatch(
  stored: UserFields,
  body: AdminPatchBody,
): AdminPatchPlan {
  if (body.verified === undefined && body.memberType === undefined && body.dailyLimit === undefined) {
    return { ok: false, error: 'invalid_body' };
  }
  const before = storedMemberType(stored);
  const after = body.memberType ?? before;
  if (typeof body.dailyLimit === 'number' && after !== 'organisation') {
    return { ok: false, error: 'limit_needs_organisation' };
  }

  const set: { verified?: boolean; memberType?: 'organisation' | 'business'; dailyLimit?: number } = {};
  const unset = new Set<UnsetField>();
  if (body.verified !== undefined) set.verified = body.verified;
  if (body.memberType !== undefined) {
    if (body.memberType === 'person') unset.add('memberType');
    else set.memberType = body.memberType;
  }
  if (after !== 'organisation') unset.add('dailyLimit');
  if (body.dailyLimit === null) unset.add('dailyLimit');
  if (typeof body.dailyLimit === 'number') set.dailyLimit = body.dailyLimit;

  // An unset that only repeats „nothing stored" for an untouched person is noise:
  // drop the dailyLimit unset when the type did not change, was not organisation,
  // and the body did not ask for it.
  if (body.memberType === undefined && body.dailyLimit === undefined) unset.delete('dailyLimit');

  const storedLimit =
    typeof stored.dailyLimit === 'number' && before === 'organisation' ? stored.dailyLimit : null;
  const dailyLimit =
    after !== 'organisation' ? null
    : typeof body.dailyLimit === 'number' ? body.dailyLimit
    : body.dailyLimit === null ? null
    : storedLimit;

  return { ok: true, set, unset: [...unset], result: { memberType: after, dailyLimit } };
}
