# Member types and daily-limit buckets — design

Date: 2026-10-01. Status: approved in conversation, awaiting review of this file.

## Purpose

Neighbours should see at a glance whether a private person, an association
or a business is speaking (cases so far: Banou Bistro, STK
Schillerpromenade/Neukölln, an NGO). An association the admin trusts should
be able to post more than the normal daily amount. While reading the limit
code a gap showed: the forum limit is counted per kind, so one member can
publish 15 forum posts a day. That is closed in the same change.

## Decisions (user, 2026-10-01)

1. The member chooses the type at signup; the admin can correct it.
2. The member can change the type later in profile edit, any time.
3. Only organisations and businesses carry a tag; a person shows nothing.
4. Tag wording: „Initiative" and „Gewerbe" (EN: "Initiative", "Business").
5. The type is a label only. A raised daily limit exists only for a member
   whose type is organisation AND for whom the admin has set a number.
   Businesses stay at the normal limit.
6. Daily limits are four buckets of 5 per rolling 24 hours: forum
   (discussions + announcements + recommendations counted TOGETHER), events,
   listings, news. This applies to every member.
7. The admin's number (1–50) replaces the 5 in all four buckets.
8. The admin gets a Telegram ping whenever a member chooses organisation or
   business (signup or later change).

## Data

Two optional fields on `users`:

- `memberType?: 'organisation' | 'business'` — absent means person. No
  migration: every existing account is a person.
- `dailyLimit?: number` — integer 1–50. Written ONLY by the admin endpoint.
  Honoured only while `memberType === 'organisation'`.

Rules:

- A member's own change away from `organisation` (to person or business)
  `$unset`s `dailyLimit` in the same update, so choosing organisation again
  never brings a raised limit back without the admin.
- An admin correction away from `organisation` also unsets `dailyLimit`.
- Setting the type to person stores nothing: `$unset memberType`.
- The account-deletion tombstone adds `memberType` and `dailyLimit` to its
  `$unset` list.
- The dormant `roleBadge` field is not touched and not reused.

## Units

### `src/lib/members/memberType.ts` (pure, tested)

- `MEMBER_TYPES = ['person', 'organisation', 'business'] as const`,
  `type MemberType`.
- `parseMemberType(raw: unknown): MemberType | null` — exact match only;
  anything else is `null` (callers answer 400 `member_type_invalid`).
- `storedMemberType(doc): MemberType` — reads a user document; absent or
  unknown value ⇒ `'person'`.
- `memberTypeTagKey(t: MemberType): string | null` — i18n key of the tag,
  `null` for person.
- `DEFAULT_DAILY_LIMIT = 5`, `MAX_DAILY_LIMIT = 50`.
- `effectiveDailyLimit(doc): number` — `dailyLimit` when the stored type is
  organisation and the value is an integer 1–50, else 5.

Dependency-pure: imported by server routes and by Svelte islands.

### `src/lib/limits/dailyLimit.ts` (server)

- `type LimitBucket = 'forum' | 'events' | 'listings' | 'news'`.
- `countToday(db, userId, bucket): Promise<number>` — rolling 24 h, with the
  filters each route uses today:
  - forum: `topics` + `announcements` + `recommendations`, `author: userId`
    (three counts in parallel, summed);
  - events: `events`, `author: userId`;
  - listings: `listings`, `sellerId: userId`, `status: { $ne: 'draft' }`;
  - news: `news`, `submittedBy: userId`, `source: 'user_submitted'`.
- `checkDailyLimit(db, { userId, role }, bucket): Promise<{ count, limit,
  remaining, allowed }>` — reads `memberType` + `dailyLimit` LIVE from the
  user document (projection of those two fields; the login token is a
  snapshot and would lag an admin change). `role === 'admin'` ⇒
  `allowed: true` whatever the count (unchanged exemption).
- The decision part (`count`, user fields, role → result) is a pure function
  in the same folder so it can be unit-tested without a database.

Consumers, all replacing a hand-written count and a hard-coded 5:

- create/publish gates: `topics/create`, `announcements/create`,
  `recommendations/create` (bucket forum), `events/create`,
  `listings/create`, `listings/draft/[id]/publish`, `news/submit`;
- count endpoints: `topics/daily-count` (now the forum bucket),
  `listings/daily-count`, `news/daily-count`.

The 429 body keeps its shape (`error`, `message`, `dailyLimit`,
`currentCount`); `dailyLimit` carries the member's real limit. The three
forum routes share one message that names forum posts in general. The
kind-change route (`posts/move`) needs no gate: a move stays inside the
forum bucket.

### Choosing the type

- **Signup** (`AuthRegisterInner.svelte`, `api/auth/register.ts`): a
  three-way choice under the name, person preselected. The route parses the
  value; missing ⇒ person; unknown ⇒ 400 `member_type_invalid`.
- **Profile edit** (own-profile identity card, `api/users/update.ts`): the
  same choice. The body schema gains optional `memberType`; the update
  applies the data rules above.
- Choice labels: Privatperson / Verein · Initiative / Gewerbe (EN: Private
  person / Association · initiative / Business). Keys in the kiosk i18n
  files, DE and EN.

### The tag

- `src/components/ui/MemberTypeTag.svelte` — props `type`, renders nothing
  for person. Styled with Tailwind classes only (no scoped `<style>`: it is
  reached through other islands, and nested-island styles are orphaned in
  production builds).
- `PUBLIC_AUTHOR_PROJECTION` and `toPublicAuthor()` gain `memberType`
  (normalised through `storedMemberType`, so the browser always receives one
  of the three values). `SELLER_PROJECTION` / `populateSellers()` in
  `listingsQuery.ts` gain the same.
- Shown beside the name on: forum post cards, post detail, comments,
  marketplace seller card, event author slab, public profile
  (`/nachbarn/[handle]`), and the own profile's identity card.
- Independent of the Kiez-verified badge; both may show.

### Admin (`/admin/mitglieder`)

- `GET /api/admin/users` returns `memberType` and `dailyLimit` per row.
- `MitgliederApp.svelte`: a type selector per row; for organisations a
  number field 1–50 (empty = normal limit, placeholder 15). Optimistic
  write with rollback, like the verified toggle.
- `PATCH /api/admin/users/[id]`: the strict body accepts any of
  `verified: boolean`, `memberType: 'person' | 'organisation' | 'business'`,
  `dailyLimit: integer 1–50 | null`. A `dailyLimit` for a member who is not
  (and is not being set to) organisation ⇒ 400 `limit_needs_organisation`.
  It stays the only writer of `dailyLimit`.

### Telegram

- `member_new` text names the type when it is not person.
- New kind `member_type`: „<Name> (@handle) hat sich als Initiative/Gewerbe
  eingetragen", sent from `users/update` when the member's own change ends
  on organisation or business and differs from the stored value. Telegram
  only (not in the e-mail mirror set).
- No ping for a change to person, none for admin corrections. Same
  never-throw, awaited best-effort contract as the other alerts.

## Error handling

- Unknown type value: 400 `member_type_invalid` (signup and profile edit).
- A banned member cannot change the type (profile update already refuses).
- A failed limit lookup throws like the current count does; the route's
  existing 500 path answers. No fail-open: an unreadable user document must
  not lift the limit.

## Not included

- No confirmation step before the tag shows; no raised limit for businesses;
  no per-bucket numbers.
- No tag in notifications, the „@" popup, search results, the landing page,
  or e-mails.
- No change to moderation for any type.

## Testing

- Unit: `memberType.test.ts` (parse, stored default, tag key, effective
  limit incl. out-of-range and non-organisation values); the pure limit
  decision (admin exempt, at-limit, raised organisation, business with a
  stray number stays at 5).
- Dev database: a member with 2 discussions + 2 announcements + 1
  recommendation is refused a sixth forum post of any kind; an organisation
  with `dailyLimit: 15` passes; after the member switches to person the
  number is gone and the sixth post is refused.
- Admin: PATCH refuses a limit for a non-organisation, accepts type + limit
  in one call.
- Browser: signup choice, profile-edit change, tag on the six surfaces at
  390 and 1440 px, `/admin/mitglieder` controls; production build with the
  logged-in smoke on a preview.
- CI budgets stay at tsc ≤16 / svelte-check ≤81.
