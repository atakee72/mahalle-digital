// src/lib/members/memberType.ts — dependency-pure (server routes AND islands import it).
// A member is a person unless the user document says otherwise: the field is
// ABSENT for a person, so no existing account needed a migration.

export const MEMBER_TYPES = ['person', 'organisation', 'business'] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];

export const DEFAULT_DAILY_LIMIT = 5;
export const MAX_DAILY_LIMIT = 50;

/**
 * The two fields these rules read off a user document. The index signature is
 * load-bearing: without it TypeScript's weak-type check refuses a MongoDB
 * `WithId<Document>` (its `_id` shares no property with an all-optional type).
 */
export type UserFields = { memberType?: unknown; dailyLimit?: unknown; [k: string]: unknown };

/** Client input → type. Exact match only; anything else is null (caller answers 400). */
export function parseMemberType(raw: unknown): MemberType | null {
  return typeof raw === 'string' && (MEMBER_TYPES as readonly string[]).includes(raw)
    ? (raw as MemberType)
    : null;
}

/** A user document → type. Absent or unknown value reads as person. */
export function storedMemberType(doc: UserFields | null | undefined): MemberType {
  const t = doc?.memberType;
  return t === 'organisation' || t === 'business' ? t : 'person';
}

/** i18n key of the tag beside the name; a person (or junk) carries none. */
export function memberTypeTagKey(t: unknown): 'member.tag.organisation' | 'member.tag.business' | null {
  if (t === 'organisation') return 'member.tag.organisation';
  if (t === 'business') return 'member.tag.business';
  return null;
}

/** The admin's number counts only for an organisation and only when it is an integer 1–50. */
export function effectiveDailyLimit(doc: UserFields | null | undefined): number {
  if (storedMemberType(doc) !== 'organisation') return DEFAULT_DAILY_LIMIT;
  const n = doc?.dailyLimit;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_DAILY_LIMIT
    ? n
    : DEFAULT_DAILY_LIMIT;
}
