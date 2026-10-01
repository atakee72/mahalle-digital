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
- Re-saving the SAME type changes nothing: no unset of `dailyLimit`, no ping.
- `dailyLimit` never enters any client-visible projection (author, seller,
  public profile); it is returned only by the admin list endpoint.
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
forum routes share one message that names forum posts in general. The count
endpoints keep their field names (`count`, `limit`, `remaining`, and
`canCreate` — `canSubmit` on news); `limit` carries the real limit. The
kind-change route (`posts/move`) needs no gate: `buildMovedDoc` keeps
`createdAt`, so a move stays inside the forum bucket. Drafts and the news
„discuss in forum" link publish through the normal create routes; official
announcements are admin posts and exempt. Counts include pending and
rejected items, as today. A missing user document throws (500).

Client copy and UI that hard-code the 5 (`src/lib/kiosk-i18n.ts`, DE + EN)
change with it:

- `state.rate.kicker` („LIMIT ERREICHT · 5 BEITRÄGE / TAG") and
  `state.rate.body.short` take the number from the 429's `dailyLimit`
  (`RateLimitError` already carries it; `RateLimitPanel.svelte` gains a
  `limit` prop from both compose pages).
- `news.forumcta.exhausted` („Heute schon 5 Themen erstellt") becomes
  number-free forum-post wording.
- `blog.foot.discuss.note` („zählt zu deinen 5 Beiträgen/Tag") becomes
  number-free.
- `news.submit.quotaReachedTitle` and `QuotaIndicator.svelte` (fixed
  `max = 5`) use `limit` from `news/daily-count`; above 10 the indicator
  prints „n / limit" instead of one slot per post.
- New wording is DRAFT until the owner confirms it.

### Choosing the type

- **Signup** (`AuthRegisterInner.svelte`, `api/auth/register.ts`): a
  three-way choice under the name, person preselected. The route parses the
  value with the cheap checks, BEFORE the paid name check; missing ⇒ person;
  unknown ⇒ 400 `member_type_invalid`, which the form's hand-written error
  map must know. The field joins the `insertOne` only when not person.
- **Profile edit** (`PIdentityCard.svelte`, `api/users/update.ts`): the same
  choice. The body schema gains optional `memberType` and its „nothing to
  update" refine accepts a type-only save. The route pre-reads the stored
  `memberType`, `handle` and `name` (it has no prior document today), then
  applies the data rules; the response and the card's `onSaved` payload echo
  `memberType`. The schema stays non-strict-stripping and never lists
  `dailyLimit`, so a member cannot write it. The pre-read is not atomic with
  the write: two parallel saves may ping twice — accepted.
- Choice labels: Privatperson / Verein · Initiative / Gewerbe (EN: Private
  person / Association · initiative / Business). Keys in the kiosk i18n
  files, DE and EN.

### The tag

- `src/components/ui/MemberTypeTag.svelte` — props `type`, renders nothing
  for person. Styled with Tailwind classes only (no scoped `<style>`: it is
  reached through other islands, and nested-island styles are orphaned in
  production builds).
  The component itself treats `undefined` and unknown values as person, so
  a raw or stale value can never print a wrong tag.
- Five data paths carry the field, each normalised through
  `storedMemberType`:
  1. `PUBLIC_AUTHOR_PROJECTION` + `toPublicAuthor()` (create/edit responses,
     comment list) — `publicAuthor.test.ts` pins the key list, update it;
  2. `populateAuthors()` in `topicsQuery.ts`, which spreads the raw document
     and does NOT call `toPublicAuthor` (forum cards, the three detail
     pages and their comments, bookmarks, forum search, events);
  3. `SELLER_PROJECTION` + `populateSellers()` → new flat field
     `sellerMemberType` (`types/listing.ts`, `MarketDetailInner`,
     `SellerCard`);
  4. `lib/profile/publicProfile.ts` (own projection) → `PPublicIdentityCard`;
  5. `lib/profile/profileQuery.ts` (`ProfileMe`) → `PIdentityCard`.
- Shown beside the name in: `ForumPostCard`, `ForumPostDetail`,
  `ForumComment`, `SellerCard`, `EventDetailModal` (author slab),
  `PPublicIdentityCard`, `PIdentityCard`. `/search` (slim result rows) and
  `/bookmarks` (no author line) do not render the post card and show no tag.
- Independent of the Kiez-verified badge; both may show (post detail, event
  slab, seller card, profile cards — check the pair's layout at 390 px).

### Admin (`/admin/mitglieder`)

- `GET /api/admin/users` returns `memberType` and `dailyLimit` per row.
- `MitgliederApp.svelte`: a type selector per row; for organisations a
  number field 1–50 (empty = normal limit, placeholder 15). Optimistic
  write with rollback, like the verified toggle.
- `PATCH /api/admin/users/[id]`: the strict body accepts any of
  `verified: boolean`, `memberType: 'person' | 'organisation' | 'business'`,
  `dailyLimit: integer 1–50 | null`; at least one key is required (400
  `invalid_body` otherwise). The route reads the member first and decides
  on the type AFTER this call (`memberType` in the body, else the stored
  one): a numeric `dailyLimit` when that type is not organisation ⇒ 400
  `limit_needs_organisation`; `dailyLimit: null` always just unsets; a type
  leaving organisation unsets `dailyLimit` in the same update. The response
  echoes `verified`, `memberType` and `dailyLimit`. It stays the only writer
  of `dailyLimit`. The UI's empty number field sends `null`.

### Telegram

- `member_new` text names the type when it is not person (it stays in the
  e-mail mirror set, which is off in production).
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
- No tag in notifications, the „@" popup, the calendar attendee list, News
  submitter lines, the admin moderation queue, `/search`, `/bookmarks`, the
  landing page, or e-mails.
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

## Docs to update when it lands

Root `CLAUDE.md` („Daily posting limits", the `users` field list and its
tombstone list), `src/components/forum/kiosk/CLAUDE.md` („each kind has its
own daily limit"), the admin and profile area files, `design-system.astro`'s
limit note.
