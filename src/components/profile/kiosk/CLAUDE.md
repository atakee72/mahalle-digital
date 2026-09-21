# Profile (kiosk) notes

Loaded lazily when Claude reads/edits files in `src/components/profile/kiosk/`
(or any subtree). The root `CLAUDE.md` keeps a pointer to this file. Also
relevant when working on `src/lib/profile/*` and `src/pages/api/profile/*` /
`src/pages/api/users/{update,profiles}.ts` — read this file directly when
touching those server-side pieces from outside this directory.

**Scope**: Plan A = own profile (`/profile`, logged-in user viewing/editing
their own Meldebogen). Plan B = public profile (`/nachbarn/[handle]`),
konto-change flows (e-mail, password), Steckbrief/motto, and account
deletion (7-day grace + day-7 anonymization pipeline). Both plans are
**complete** (Tasks 1–11) — see the dedicated sections below: "Public
profile", "Kiez-Chronik strip" (resolver + cache), "Steckbrief + motto",
"E-mail change", "Password change", "Account deletion".

## Architecture

`src/pages/profile.astro` — thin shell: SSR session + `getProfileMe()` +
`getChronik()` (both fast paths, avoid a client round-trip on first paint),
passes `initialProfile` + `initialChronik` + `loggedIn` into
`ProfileInner.svelte` (`client:load` — SSR renders the shell, then hydrates;
no SEO stakes on this private, logged-in-only page).

`ProfileInner.svelte` is the **single orchestrator** — it owns every piece of
fetch/mutation state (`profile`, `standing`, `standingError`, `banned`) and
passes it down as props. Child cards are either genuinely stateful (mounted
exactly once, reflow via CSS) or presentational (mounted twice, once per
breakpoint — see "Mobile fold layout" below).

```
ProfileTitleBlock        — §-eyebrow + h1 ("Dein Meldebogen")
PIdentityCard            — avatar + name/handle/since + verified + stats +
                            hobbies + in-card edit (STATEFUL, single mount)
PModerationCard          — §02 standing display (stateless, `bare` prop)
PKontoCard                — §03 email/password rows + logout + "ändern" action
                            + §08 pending banner (stateless, `bare` prop)
PEmailChangePanel         — e-mail change stages 01/02 (STATEFUL, single
                            mount; see "E-mail change" below)
PChronikStrip             — Kiez-Chronik tenure strip (stateless, SSR-only
                            data, single mount; see "Kiez-Chronik strip" below)
PActivityLedger           — §01 Archiv cross-surface feed (STATEFUL, own
                            fetch, single mount)
PMobileFold (atoms/)       — accordion wrapper, mobile-only
```

## API contracts

All under `src/pages/api/profile/*` (session-gated, `getSession(request)`,
401 if absent) except `update` which lives at `/api/users/update.ts`
(pre-existing route, reused rather than duplicated under `/profile/`).

- **`GET /api/profile/me`** → `{ profile: ProfileMe }` (404 if the session's
  user record vanished). `ProfileMe` = `{ id, name, handle, email, image,
  hobbies, verified, memberSince (year), isBanned, stats: { posts, listings,
  events, danke } }`. `getProfileMe()` (`src/lib/profile/profileQuery.ts`)
  computes `stats` via parallel `countDocuments` + a `$group` danke-sum
  aggregate across topics/announcements/recommendations/events (listings
  excludes drafts: `status: { $ne: 'draft' }`).
- **`GET /api/profile/standing`** → `ProfileStanding` = `{ strikes, isBanned,
  bannedAt (ISO|null), rejected: StandingRejectedItem[] }` (max 20, newest
  first, sourced from `flaggedContent` where `reviewStatus: 'rejected'`).
  Drives both `PModerationCard` and the `banned` gate.
- **`GET /api/profile/activity`** → `ActivityPage` = `{ items:
  ActivityItem[], nextBefore }`, query params `filter` (alle/forum/markt/
  kalender/kurier/gespeichert) + `limit` + `before` (cursor). See Task 9's
  notes inline in `PActivityLedger.svelte` / `src/lib/profile/profileShared.ts`
  for the full per-kind field mapping — not duplicated here.
- **`POST /api/users/update`** → body `{ name, hobbies }`, returns the
  echoed `{ name, hobbies }` on success. Validates `PROFILE_NAME_REGEX`
  server-side too (client validates first to save the round-trip).
- **`POST /api/profile/avatar`** → `multipart/form-data` with an `image`
  field. Returns `{ url }` on success or `{ error: 'no_file' | 'bad_type' |
  'file_too_large' | 'upload_failed' | 'server_error' }`. Ban-gated via
  `rejectIfBanned()` (`src/lib/auth/banGuard.ts`) — banned accounts get a
  403 before the upload even starts. Uploads to Cloudinary folder
  `mahalle/profile`, `300x300 crop:fill gravity:face`, writes
  `users.userPicture`.
- **`POST /api/profile/email-change/{start,resend,cancel}`** + **`POST
  /api/profile/email-change/confirm`** (sessionless, no `getSession()` gate —
  see "E-mail change" below for the full flow). `start`/`resend`/`cancel` are
  session-gated like every other route in this list; `confirm` deliberately
  is not.

All shared types/constants (`ProfileMe`, `ProfileStanding`, `ActivityItem`,
`ActivityFilter`, `PROFILE_NAME_REGEX`, `HOBBY_MAX_COUNT`, `AVATAR_MAX_BYTES`,
...) live in `src/lib/profile/profileShared.ts` — a dependency-free module
(no `mongodb`, no `fs`) so it's safe to import from both server routes and
`client:*` Svelte islands. `src/lib/profile/profileQuery.ts` and
`src/lib/profile/handle.ts` are the two server/pure siblings: `profileQuery.ts`
imports `connectDB` (server-only), `handle.ts` is pure (imported by both
server code and the standalone backfill script).

## Handle system

- **Format**: `HANDLE_REGEX = /^[a-z0-9_]{3,20}$/`, generated by
  `slugifyHandle()` (`src/lib/profile/handle.ts`) — lowercases, NFD-strips
  diacritics (ö/ü/ä → o/u/a; a small `MANUAL_MAP` covers chars NFD can't
  decompose: ß→ss, ı→i, ø→o, æ→ae, œ→oe, đ→d, ł→l, þ→th — deliberately NOT
  ö→oe/ü→ue so one rule serves both German and Turkish names), collapses
  whitespace to `_`, strips anything outside `[a-z0-9_]`, clamps to 20 chars,
  falls back to `HANDLE_FALLBACK = 'nachbar'` if the result is under 3 chars.
- **Uniqueness**: `users_handle_unique` — a **partial** unique index
  (`{ handle: 1 }`, `partialFilterExpression: { handle: { $type: 'string' } }`,
  created by `scripts/backfill-user-handles.ts`). Partial, not a plain unique
  index, because a plain unique index on `handle` would make EVERY user
  missing a handle (i.e. `handle: undefined`) collide on the same implicit
  `null` key — the second registration without a handle would throw E11000
  and break prod registration outright. The partial filter only enforces
  uniqueness among documents where `handle` is actually a string.
- **Assignment paths**: (1) set at registration for new users going forward;
  (2) `scripts/backfill-user-handles.ts` — one-time batch backfill for
  pre-existing accounts; (3) **lazy self-heal** — `ensureHandle(userId)` in
  `profileQuery.ts`, called from `getProfileMe()` whenever a fetched user
  doc has no `handle` field. Generates a candidate via `slugifyHandle`, then
  loops appending `2`, `3`, ... on `E11000` (index collision with another
  user), using a `updateOne({ _id, handle: { $exists: false } })` guard so
  a concurrent request that already assigned a handle doesn't get
  clobbered — on `matchedCount === 0` it re-reads and returns the ACTUAL
  handle rather than the one it generated but never wrote.

## Optimistic-save pattern (PIdentityCard)

Same shape as the rest of the kiosk system (forum/marketplace mutations):
`handleSave()` validates client-side, immediately flips to read state with
an `optimisticOverride` value + a "speichert …" chip, then POSTs. Success
clears the override and calls `onSaved()` (parent updates the real
`profile`, which then matches what was already showing). Failure clears the
override too (falls back to the real `profile` values, not the rejected
edit) and returns to edit state with a danger banner + retry — `editName`/
`editHobbies` are left untouched so retry resends the identical payload.

**Task 8 lesson, load-bearing**: every guard variable an `$effect` reads to
decide whether to re-run (`saveSeq`-adjacent booleans, `standingRequested`
in `ProfileInner`, etc.) **must be declared with `$state`, not a plain
`let`**. A plain `let` mutated inside the effect's own body doesn't trigger
Svelte's dependency tracking, so resetting it (e.g. `retryStanding()`
setting `standingRequested = false`) silently fails to re-arm the effect —
the retry button does nothing. `saveSeq`/`standingSeq` themselves are
intentionally plain (non-reactive) counters used only for stale-response
guarding, not for effect re-arming — don't confuse the two categories.

## Avatar XHR flow

`PIdentityCard` runs its own 5-state machine (`idle → picking → uploading →
error → saved`), independent of the name/hobbies edit flow — the upload
panel renders under whichever header (read or edit state) is active, so the
rest of the card stays usable mid-upload. Uses raw `XMLHttpRequest` (not
`fetch`) specifically for `xhr.upload.onprogress` — real progress %, not a
fake bar. Re-opening the picker while an upload is in flight `abort()`s the
old XHR first (guards `avatarXhr !== xhr` in every callback so a
superseded/cancelled request can't clobber newer state).

On success: dispatches `window.dispatchEvent(new CustomEvent(
'profile:avatar-updated', { detail: { url } }))`. `KioskNav.svelte` listens
globally and stores it in a local `liveImage` `$state`, rendered in
preference to the `user.image` prop — this is how the nav avatar picture
updates immediately without a page reload.

**Accepted residual (documented, not a bug)**: the nav's `user` prop is a
**session snapshot** — it only re-derives on next login/SSR (JWT strategy,
see root CLAUDE.md's auth section). Other open tabs/windows, and this same
tab after a future full navigation that re-hydrates the island fresh, stay
on the old picture until the user logs in again or the session otherwise
refreshes. The `profile:avatar-updated` event only patches the *current*
nav island's in-memory state.

## Banned §09 binding

`ProfileInner` computes `banned = (standing?.isBanned ?? false) ||
(profile?.isBanned ?? false)` — the OR is intentional. `profile.isBanned`
comes from the SSR-fast `getProfileMe()` snapshot and is available
immediately (flips `banned` true before `standing` has even started
fetching), so `PIdentityCard`'s edit button disables right away rather than
having a window where a banned user can still click "bearbeiten". The §09
danger banner text prefers `standing.bannedAt` (exact date) but falls back
to an em-dash (`—`) if the standing fetch is still pending or failed — a
banned user is never left with a disabled edit button and zero explanation.
If the standing fetch itself fails, `standingError` swaps the §02 slot (both
the desktop card position AND the mobile fold) for a fallback line with a
retry link, rather than silently showing nothing.

## Mobile fold layout (Task 10)

Design source: `design/handoffs/design_handoff_profile/jsx/
kiosk-profile-public.jsx` (`ProfileOwnMobile` + `PMobileFold`).

Single `<div class="grid gap-[26px] items-start lg:grid-cols-[384px_1fr]">`
serves both breakpoints:

- **Desktop (`lg+`)**: explicit line placement — col 1 = identity →
  moderation → konto (`lg:row-start-{1,2,3}`), col 2 = archiv
  (`lg:row-start-1 lg:row-span-3`). Moderation/Konto desktop cards are
  `hidden lg:block`.
- **Mobile (`<lg`)**: the grid collapses to a single implicit column;
  `order-{1,2,3,4}` re-sequences it to identity → archiv → moderation fold
  → konto fold (matching `ProfileOwnMobile`, NOT the desktop DOM order).
  Moderation/Konto mobile folds are plain elements with `lg:hidden`
  (`PMobileFold` itself also carries `lg:hidden` internally, belt-and-braces).

**Why `PIdentityCard`/`PActivityLedger` are single-mounted but
`PModerationCard`/`PKontoCard` are double-mounted**: the former hold real
internal state (edit mode, avatar XHR, their own `fetch` for the ledger) —
mounting twice would split that state across two independent islands and
desync them (e.g. editing on the visible mobile fold wouldn't reflect on a
hidden desktop copy, or worse, both would independently fire the ledger's
mount-time fetch). They're mounted once and simply move around via CSS. The
latter two are pure props-in/markup-out — `standing` and `profile.email`
live in `ProfileInner`, both instances render off the *same* upstream state,
so duplicate mounts never disagree. Both accept a `bare` prop: `bare=false`
(default, desktop) renders the full `<PCard><PCardHead n="0X" .../>...`
shell; `bare=true` (mobile) skips the outer `PCard`/`PCardHead` — the
enclosing `PMobileFold` already supplies the card chrome + a title — reusing
a `{#snippet body()}` block internally so the actual content markup isn't
forked.

**Moderation fold accent tracks the same clean/warn logic as the desktop
card** — `ProfileInner`'s `modAccent` derived (`success` when
`strikes === 0 && rejected.length === 0`, else `warn`) is threaded into both
the desktop `PModerationCard`'s own internal accent AND the mobile fold's
`accent` prop. The design mock hardcodes `kiosk.color.warn` on `PMobileFold`
because its demo data always shows the rejected-content anatomy — a real
clean account must still show green on mobile, matching desktop.

**`PMobileFold`** (`atoms/PMobileFold.svelte`) is a thin presentational
accordion: `{ title, accent?, open?, badge?: Snippet, children?: Snippet }`.
`open` seeds a local `$state` (intentionally captures only the initial
value — Svelte's `state_referenced_locally` compiler warning on this line
is expected/benign, not a bug). Toggling is a local click handler, no
external wiring. Header is a real `<button>` (native `aria-expanded`
semantics, ≥44px tall via `min-height: 44px` + `padding: 13px 16px`).

**`PKontoCard` Gefahrenzone mobile disclosure (Task 4)**: the mobile `bare`
mount collapses the Gefahrenzone (account deletion zone) behind a ≥44px
disclosure button (`GEFAHRENZONE ▸/▾`) — clicking reveals a slide transition
(220ms, zero on `prefers-reduced-motion: reduce`) showing the deletion row +
danger button. The desktop `bare=false` branch renders the open dashed box
unchanged. The `deletionScheduledAt` pending-deletion banner stays ALWAYS
visible on both breakpoints, never behind the fold — active deletion
countdown is status the user must see, not an action to tuck away. Design
source: `design_handoff_avatarmenu`.

**Grid item overflow gotcha (real bug hit + fixed during Task 10)**: every
direct child of the grid carries `min-w-0`. Without it, CSS Grid's default
"automatic minimum size" on a grid item is its content's min-content width
— below `lg` there's no explicit `grid-template-columns`, so the single
implicit column's width is the MAX of every item's min-content contribution.
One non-wrapping row deep inside any card (e.g. the identity card's 4-column
stat grid, or a fold's flex header) can force the *entire column* — and
therefore every card in it, including ones with no wide content of their
own — to blow out past the viewport width. Because `html`/`body` use
`overflow-x: clip` (see root CLAUDE.md's sticky-positioning note), this
doesn't show up as a horizontal scrollbar — it's silently, invisibly
clipped, cropping real content (e.g. the 4th "danke" stat column, or the
tail end of filter chip labels) with no visual error signal short of
measuring `getBoundingClientRect()` or diffing `scrollWidth`. `min-w-0`
resets the automatic minimum to 0 so grid items respect the container's
actual available width. If this profile page (or any other kiosk page that
adopts an `order-*`-reordered single-column-below-`lg` grid) starts clipping
content on mobile with no visible cause, check for missing `min-w-0` first.

## E-mail change (Plan B, Task 8)

Design source: `kiosk-profile-flows.jsx` §03 `EmailChangeFlow` (stages 01
NEUE ADRESSE / 02 BESTÄTIGEN — stage 03 GEWECHSELT lives on the confirm
PAGE, not in-card) + `kiosk-profile-states.jsx` §08 (pending banner).

**Layout decision (load-bearing)**: `PEmailChangePanel` is mounted **ONCE**
by `ProfileInner`, gated by a local `emailPanelOpen` boolean — it is
deliberately NOT mounted inside `PKontoCard` even though the "ändern" action
that opens it lives there. Reasoning: `PKontoCard` is double-mounted
(desktop card + mobile fold, see "Mobile fold layout" above) because it's
pure props-in/markup-out — both instances safely render off the same
upstream `standing`/`profile` state. `PEmailChangePanel` is different: it
holds real local state (the new-email/password input values, per-field
focus/error state). Mounting a stateful form twice would let the two
instances diverge (e.g. typing on the mobile fold's copy while the desktop
copy — hidden via `hidden lg:block`, but still MOUNTED and holding its own
independent Svelte state — sits with empty fields; whichever one becomes
visible on a breakpoint change shows stale/wrong content). Single-mounting
sidesteps this entirely, matching the same reasoning that already governs
`PIdentityCard`/`PActivityLedger` vs `PModerationCard`/`PKontoCard`.

The single mount is placed in its **own grid slot**, directly below the
Konto card/fold on both breakpoints — `lg:col-start-1 lg:row-start-4` on
desktop (row 4, under Konto's row 3; the right column's `lg:row-span-3` only
reserves rows 1–3 so this never forces Archiv taller) and `order-5` on
mobile (after Konto's `order-4` fold). This mirrors how the flows-JSX
presents 01/02 as their own stage cards rather than content living inside
the Konto card's body.

**State flow**: `ProfileInner` owns `emailPanelOpen` (mount gate) plus three
handlers passed down to BOTH `PKontoCard` (for the §08 banner's
"erneut senden"/"abbrechen" links) and `PEmailChangePanel` (for stage 02's
identical links) — `resendEmailChange()` and `cancelEmailChange()` are the
literal same function references in both places, so the two surfaces can
never drift in behavior. `cancelEmailChange()` also closes the panel
(`emailPanelOpen = false`) since there's nothing left to show once
`pendingEmail` is cleared. `handleEmailStarted(newEmail)` (start-success
callback, panel-only) sets `profile.pendingEmail` immediately — no refetch
needed, mirrors `PIdentityCard`'s `onSaved()` optimistic-echo pattern.
`PEmailChangePanel`'s own stage (`'form' | 'sent'`) is seeded ONCE from the
`pendingEmail` prop at mount time (`pendingEmail ? 'sent' : 'form'`) —
opening the panel while a change is already pending jumps straight to stage
02, per the brief.

**Confirm page** (`src/pages/confirm-email-change.astro` +
`ConfirmEmailChangeInner.svelte`) is sessionless, mirroring
`verify-email.astro`/`AuthVerifyInner.svelte` exactly: reads `?token=`,
POSTs to `/api/profile/email-change/confirm` on mount, shows a
success/failure card. Two differences from the verify-email precedent: (1)
no "sent" stage here — the panel already covers that, so the page only ever
shows confirming → confirmed | invalid; (2) `confirmEmailChange()`
(`src/lib/auth/emailChange.ts`) now returns `{ status: 'ok'; email: string
}` instead of a bare `'ok'` string — the sessionless page has no other way
to know which address just went live, and the design requires showing it
("Login now uses {addr}."). Not a new information-disclosure surface: the
caller already had to possess the correct 256-bit token (delivered only to
the new address's inbox) to reach that branch. `confirm.ts`'s response body
gained an `email` field on success accordingly (`{ ok: true, email }`).

**Reconciliation fallback**: `ProfileInner` listens for `visibilitychange`
and, if `profile.pendingEmail` is set when the tab regains focus,
re-fetches `/api/profile/me` and merges `email`/`pendingEmail` back in
(seq-guarded like every other fetch in this file). Covers the case where the
confirm link was opened in a DIFFERENT tab/browser (e.g. a phone's mail app)
while this tab still shows the pending banner — without it the banner would
linger until the next full page load.

## Password change (Plan B, Task 9)

`POST /api/profile/change-password` (`src/pages/api/profile/change-password.ts`)
— session-gated, ban-gated (`rejectIfBanned`), rate-limited
(`pwch:${userId}`, 5/h). Generic `invalid_password` for both "no password on
file" and an actual mismatch (no signal leaked). Rejects a same-as-current
new password (compared against the pre-overwrite hash). On success: hashes
+ persists the new password AND stamps `users.passwordChangedAt = new
Date()` — this stamp is the load-bearing bit, see below.

**Other-device sign-out mechanism (root `CLAUDE.md` pointer, full story
here)**: `auth.config.ts`'s `jwt` callback compares two DIFFERENT
timestamps, and confusing them is the exact bug shape to watch for:

- **`token.loginAt`** — stamped ONCE, only in the `user` branch (i.e. only
  at actual login), and NEVER touched again for that token's lifetime. This
  is deliberately NOT jose/`@auth/core`'s auto `iat` claim — `iat` gets
  re-stamped on every JWT re-encode, including the session-cookie refresh
  that happens on every `GET /api/auth/session` call, so it does NOT mean
  "when did this device log in" by the time you'd want to compare it against
  anything. `loginAt` is the one field this codebase controls end-to-end for
  that purpose.
- **`token.pwdCheckedAt`** — a throttle, not a security boundary: caps the
  DB read that checks `passwordChangedAt` to once per 5 minutes per token
  (`PWD_RECHECK_MS`), so a change on Device B takes up to 5 minutes to log
  Device A out rather than being instant. Accepted lag, not a bug.
- **The actual check**: on every non-login `jwt` callback invocation, once
  the 5-min throttle allows a recheck, fetch `users.passwordChangedAt` and
  compare it to `token.loginAt` (NOT to `pwdCheckedAt`, NOT to `iat`). If
  `loginAt < passwordChangedAt`, this token predates the password change —
  return `null` from the callback, which `@auth/core` treats as "no valid
  session", forcing that device to re-authenticate. A token minted before
  `loginAt` existed as a field (pre-this-feature) has no way to prove it
  postdates a `passwordChangedAt` that could only ever have been written by
  this same feature — so it's invalidated unconditionally (`else` branch,
  legacy-token handling).
- **Silent re-login on the ORIGINATING device**: the endpoint's response
  echoes the session's own `email` so `PPasswordChangePanel.svelte` can
  immediately call `signIn('credentials', { email, password: newPassword,
  redirect: false })` — this mints a FRESH token with a fresh `loginAt`
  (necessarily `>= passwordChangedAt`), so the device that just changed the
  password keeps working without an explicit logout/login round-trip. If
  that silent re-login unexpectedly fails (`auth-astro`'s `signIn()` never
  exposes a `.error` field to distinguish causes), the panel hard-redirects
  to `/login` rather than leave the user on a page that silently stops
  working once the 5-min throttle next fires.
- **Password reset also stamps `passwordChangedAt`**
  (`resetPasswordWithToken()`, `src/lib/auth/passwordReset.ts`) — same
  other-device invalidation applies to the forgot-password flow, not just
  the in-profile change. There's no "silent re-login" step there (the
  sessionless reset page has no session to preserve).

## Account deletion (Plan B, Tasks 10–11)

Two-phase: **scheduling** (Task 10, session-gated, reversible for 7 days)
and the **day-7 anonymization pipeline** (Task 11, cron-driven,
irreversible). Login is allowed during the entire grace period — deletion
restricts nothing about the account until the pipeline actually runs.

### Scheduling + undo (`src/lib/auth/accountDeletion.ts`)

- `scheduleDeletion(userId)` — `$set users.deletionScheduledAt` to `now +
  GRACE_MS` (7 days) + issues a fresh single-use undo token
  (`accountDeletionTokens`, sha256-hashed, latest-wins `deleteMany` before
  inserting — identical shape to `emailChange.ts`'s token lib).
- `POST /api/profile/delete-account/schedule` — password + typed-handle
  confirmation (`confirmHandle === user.handle`, server re-check; the modal's
  client-side gate is UX only), rate-limited (`del:${userId}`, 3/h).
  Deliberately NOT ban-gated — banning restricts posting, not account
  ownership; a banned user must still be able to delete their own account.
  Best-effort undo mail (fails closed on missing `NEXTAUTH_URL` in prod —
  the schedule still stands, only the mail is skipped).
- **In-app "Widerrufen"**: `POST /api/profile/delete-account/cancel`
  (session-gated) → `cancelDeletion()` → `$unset deletionScheduledAt` +
  drops every undo token. Idempotent.
- **Mail undo link**: `/widerrufen?token=...` (sessionless, mirrors
  `confirm-email-change.astro`) → `POST /api/auth/cancel-deletion` →
  `cancelDeletionWithToken()` — atomic single-use claim
  (`findOneAndUpdate`), then `cancelDeletion()`.

### Day-7 pipeline (`runDeletionPipeline()`, Task 11)

`GET /api/cron/process-deletions` (Vercel cron, `vercel.json`, `30 5 * * *`
— **fail-closed** auth, unlike `fetch-daily.ts`'s skip-if-unset: a missing
`CRON_SECRET` returns 503 `cron_disabled` rather than opening this
destructive endpoint to any caller; otherwise `Authorization: Bearer
${CRON_SECRET}` required, else 401) finds every user with
`deletionScheduledAt <= now` and `anonymized !== true`, and runs
`runDeletionPipeline(userId)` for each. **Naturally idempotent**: the
tombstone step (6) `$unset`s `deletionScheduledAt` and sets `anonymized:
true`, so a re-run's query no longer matches a user it already finished —
no separate "already processed" guard needed.

**Atomic claim (TOCTOU fix, fix round 1)**: the cron's `find()` snapshot
and the sequential per-user loop leave a window where a Widerrufen can
land after a user is captured as due but before their turn arrives.
`runDeletionPipeline()`'s first operation is an atomic `findOneAndUpdate`
re-verifying `deletionScheduledAt <= now` and `anonymized !== true` at
claim time, stamping `deletionClaimedAt`; a non-match returns `{ ok: true,
skipped: true, steps: {} }` before any destructive step runs.
`deletionClaimedAt` is `$unset` by `cancelDeletion()` on the cancel path
and — since the 2026-08-30 hardening batch — also by the tombstone itself,
so neither outcome leaves a stale claim marker. The claim's projection also
captures `email` (normalized) alongside `userPicture`: the email-keyed
sweeps below need it, and step 6 `$unset`s it.

Ordered steps (each counted into `steps: Record<string, number>`;
per-step try/catch — a failing step is recorded as `-1` and flips the
overall `ok` to `false`, but does NOT stop the remaining steps):

1. **Listings**: collect the user's listing ids, `deleteMany({ sellerId:
   userId })`, delete their `listingAuditTrail` rows
   (`{ listingId: { $in: ids } }`), and `$unset { authorName, authorEmail }`
   on their `flaggedContent` rows (`{ contentType: 'marketplace', contentId:
   { $in: ids } }`) — rows are KEPT, never deleted (Nachweispflicht: the
   moderation record must survive the author).
2. **Saved footprints**: `savedPosts`/`savedNews`/`savedEvents.deleteMany({
   userId })` (this user's own bookmarks) + `listings.updateMany({ savedBy:
   userId }, { $pull: { savedBy: userId } })` (this user removed from
   OTHER people's saved-listing arrays).
   **2b. Forum drafts (2026-09-21)**: `deleteAllDraftsOf(userId)`
   (`src/lib/forum/postDraftsStore.ts`) removes every row of the member in
   `postDrafts` and destroys their Cloudinary images — except an image some
   published post still references (global lookup, see the forum notes). Own
   `try/catch` → `fail('postDrafts')`; reports `steps.postDrafts` +
   `steps.postDraftImages`. Test: `scratchpad/e2e-drafts-account-deletion.mts`
   (drives the real cron route on dev; aborts if any dev account is already due).
3. **RSVPs — „Zusagen entfernt" interpretation (load-bearing)**:
   `events.updateMany({ $or: [{'rsvps.going': userId}, {'rsvps.maybe':
   userId}] }, { $pull: { 'rsvps.going': userId, 'rsvps.maybe': userId } })`
   pulls ONLY the deleted user's OWN RSVPs, from every event (including
   events other people authored). It does **NOT** touch other users' RSVPs
   on events THIS user authored — those events stay (step 4), and other
   attendees' going/maybe entries are their own data, unrelated to this
   user's deletion. Verified E2E: user B's RSVP on user A's event survived
   A's deletion untouched; A's RSVP on B's event was pulled.
4. **Authored content stays**: topics/comments/announcements/
   recommendations/events/news are NEVER deleted or altered — they render
   as „Ehemaliges Mitglied" because `populateAuthors()`
   (`src/lib/topicsQuery.ts`) does a live `users` lookup by author id on
   every render, and the tombstoned doc's `name` field IS "Ehemaliges
   Mitglied" (step 6) — no special-casing needed anywhere in the render
   path. The byline link still resolves (`/nachbarn/id/<id>` → the
   id-redirect route → `getHandleForPublic()` → `anonymized: true` → `null`
   → not-found card). `flaggedContent` by `authorId: userId` (covering
   every OTHER content type, not just marketplace):
   `$unset { authorName, authorEmail }`, rows kept.
5. **Tokens + rate limits + Chronik cache**: `emailVerifyTokens`/
   `passwordResetTokens`/`emailChangeTokens`/`accountDeletionTokens`
   `.deleteMany({ userId: ObjectId })`; `rateLimits.deleteMany({ baseKey: {
   $regex: userId } })` (best-effort — `baseKey` values like `del:<uid>`/
   `pwch:<uid>` contain the raw id string); `chronikCache.deleteOne({
   userId: ObjectId })`.
6. **Tombstone** (`users` doc, Decision 6 verbatim): `$set { name:
   'Ehemaliges Mitglied', anonymized: true, deletedAt: new Date(), updatedAt
   }` + `$unset { email, password, image, userPicture, hobbies, handle,
   verified, emailVerified, roleBadge, role, motto, pendingEmail,
   dankeCrossedAt, deletionScheduledAt }`. KEEPS `moderationStrikes`/
   `strikeHistory`/`isBanned`/`bannedAt`/`bannedReason`/`createdAt`/
   `passwordChangedAt` (the last one is harmless to leave — `password` is
   gone, so login is impossible regardless; not worth a special-case
   `$unset`). `password` being unset means `login-status`/`authorize()`
   naturally fail the tombstoned account (no explicit "is this user
   anonymized" login check needed — it falls out of the missing password).
   `userPicture` is captured BEFORE this step runs (read once at the top of
   `runDeletionPipeline`), since step 7 needs it after this `$unset`s it.
7. **Cloudinary avatar destroy** (best-effort, try/catch): derives the
   `public_id` from the captured `userPicture` URL via a regex anchored to
   `mahalle/profile/` — only ever destroys an asset under that exact folder,
   never anything a URL string could otherwise point at. No-op (not an
   error) if there was no avatar or the URL doesn't match the expected
   shape.

**Hardening batch additions (2026-08-30)** — four gaps closed, all before
the tombstone in the step order: (a) **likedBy prune** (after the RSVP
step): `$pull likedBy + $inc likes: -1` across
topics/announcements/recommendations/events — the like endpoints keep the
counter in lockstep, so a bare `$pull` would have drifted it; (b)
**listingContacts sweeps** — seller side inside step 1 (`$or` on collected
listingIds + `sellerId`), buyer side as its own step keyed on the
claim-captured email (rows store buyerEmailHash since Option C 2026-08-31 — the sweep matches hash-first with a plaintext-fallback arm); the manual
`listings/delete/[id]` endpoint now cascades its listing's contact rows
too; (c) **email-keyed rateLimits**: the `$regex userId` delete gained an
exact-`$in` arm for `login:`/`banflag:`/`fp:email:` built from the captured
email (exact match, never regex — emails contain metacharacters); (d)
**tombstone `$unset` extended** with `tours`, `tourHelloDismissedAt`,
`deletionClaimedAt`. Users tombstoned BEFORE this batch keep `tours`/
`deletionClaimedAt` residue (non-PII; no backfill run — acceptable).
Integration-tested end-to-end via `scripts/verify-deletion-pipeline.ts`
(dev-only, 3 modes: `--seed` → cron curl → `--assert`, then `--cleanup`).
Known residue: contact rows a user sent under a DIFFERENT email than their
account's survive deletion (the form field is free-form) — unattributable
by design.

**E2E-verified** (Task 11, tmp fixture users, cron called directly with the
real `CRON_SECRET`): listing gone + its `flaggedContent` row kept with
name/email unset; `savedPosts` row gone; the deleted user's RSVP pulled from
another user's event while that other user's RSVP on the deleted user's OWN
event survived; topic + comment remained and rendered "Ehemaliges Mitglied"
in the forum UI; `/nachbarn/id/<id>` → not-found card; login with the old
credentials failed (`CredentialsSignin`); tokens/rate-limit/Chronik-cache
rows gone; a second cron call returned `processed: 0` (idempotent).

## Archiv feed (pointer)

Full field-by-field notes (per-kind hrefs, `zusage` dated by event
`startDate` not creation date, `savedBy`-view's no-exact-timestamp
approximation, `gespeichert` filter excluded from `alle`) live inline in
`PActivityLedger.svelte` and `src/lib/profile/profileShared.ts` — not
duplicated here to avoid drift between two copies.

## Kiez-Chronik strip (Plan B, Task 2)

`PChronikStrip.svelte` — compact derived tenure timeline. Pure
props-in/markup-out (`{ chronik: ChronikData }`), no fetch of its own — data
comes from `getChronik(userId)` (`src/lib/profile/chronik.ts`, Task 1,
SERVER-ONLY — cached 24h in `chronikCache`) via `profile.astro`'s
`initialChronik` prop. Same component/contract is meant to be reused
unmodified by the public-profile route once that ships (Task 4) — the
Chronik carries no private data (see `chronik.ts`'s own comments).

- **Mount gate**: `ProfileInner`'s `showChronik = initialChronik.stops.length
  > 0` — belt-and-braces; `chronik.ts`'s contract always returns at least
  `dabei` + `heute`, but the strip renders nothing rather than an empty
  shell if that ever changes.
- **Layout**: nested inside the SAME single-mount right-column div as
  `PActivityLedger` (`display: flex; flex-direction: column`), not given its
  own grid row-line placement. Placing it in its own `lg:row-start-1` cell
  next to the left column's identity-card row would make that shared grid
  row as tall as the (much taller) identity card, leaving a dead gap between
  the short Chronik strip and Archiv below it — the nested-flex wrapper
  sidesteps that entirely and lets the two cards sit flush, matching
  `kiosk-profile.jsx`'s `ProfileOwnDesktop` (which nests both cards in the
  same right-hand flex column in the design mock). On mobile the single
  `order-2` slot this wrapper occupies already lands directly after the
  identity card (`order-1`) and before the moderation/konto folds
  (`order-3`/`order-4`) — Chronik-then-Archiv inside it satisfies "Chronik
  before Archiv" for free, no extra `order-*` needed.
- **Dot color rule** (`kiosk-profile-novel.jsx`'s `ChronikMilestone`, NOT the
  simplified strip-level JSX which predates it): stop index 0 (always
  `dabei` per `chronik.ts`'s ordering) = wine; `kind === 'heute'` = ochre;
  every stop in between = ink.
  `.prof-chronik-now` (→ `profPulse` keyframe, `src/styles/profile.css`) is
  applied ONLY when the `heute` stop's `active` flag is true (real content in
  the last 7 days) — an inactive `heute` dot is still ochre, just static.
  Reduced motion (`@media (prefers-reduced-motion: reduce)`) drops the
  animation globally regardless of `active`.
- **Date rendering**: the `dabei` stop shows the YEAR ONLY
  (`new Date(iso).getFullYear()`); middle stops (`erstesThema`,
  `ersteAnzeige`, `ersterTermin`, `danke100`) show `MMM yyyy` via
  `Intl.DateTimeFormat($locale === 'de' ? 'de-DE' : 'en-GB', { month:
  'short', year: 'numeric' })`; the `heute` stop's year-slot shows the
  literal i18n string (`profile.chronik.heute`: DE „heute" / EN "today"),
  not a date. Labels underneath each dot are resolved from
  `profile.chronik.stop.<kind>` — kept as i18n keys rather than resolver
  output so the derived-data layer (`chronik.ts`) stays copy-free.

### Chronik resolver + cache (backend, Plan B Task 1)

`getChronik(userId)` (`src/lib/profile/chronik.ts`, SERVER-ONLY) is the sole
producer of `ChronikData`. Consumed by BOTH `profile.astro` (own view) and
`nachbarn/[handle].astro` (public view, same shape, no DATA gating needed — the
route itself is login-gated by middleware, but the Chronik carries no private data by construction: only dates + an `active`
boolean, never counts/content).

- **Cache**: `chronikCache` collection, one row per user
  (`{ userId: ObjectId, payload: ChronikData, computedAt, expiresAt }`).
  24h TTL checked in-code (`Date.now() - computedAt < CACHE_TTL_MS`), not a
  Mongo TTL index — `expiresAt` is written for potential future TTL-index
  hygiene but isn't relied on for the freshness check itself.
- **Milestone gate**: `firstTopic`/`firstListing`/`firstEvent` exclude only
  `moderationStatus: 'rejected'` (`$ne`, deliberately includes `pending` —
  a milestone is just "when did this exist", not a moderation verdict).
- **`dankeCrossedAt`** (Decision 2, stamp-on-first-observation): once a
  user's summed `likes` across topics/announcements/recommendations/events
  crosses 100, `chronik.ts` stamps `users.dankeCrossedAt` ONCE via a guarded
  `updateOne({ _id, dankeCrossedAt: { $exists: false } })` — a concurrent
  computation can't double-stamp. The stamp date is "first time this was
  *observed* crossing 100" (i.e. whenever some request happened to compute
  a fresh Chronik after the threshold was crossed), not the literal moment
  the 100th danke landed — acceptable per Decision 2, a milestone dot on a
  derived timeline doesn't need to-the-second precision.
- **`active` (the `heute` stop's pulse)**: latest of
  `topics`/`listings`/`events`/`news` `createdAt` across ALL those
  collections (author-authored, any moderation status) within the last 7
  days (`ACTIVE_WINDOW_MS`). Drives `.prof-chronik-now`'s pulse animation
  (see the dot-color-rule note above) — purely cosmetic, never gates access.
- **Deletion-pipeline interaction (Task 11)**: `runDeletionPipeline()`
  deletes the user's `chronikCache` row outright (no tombstone-shaped
  Chronik is ever computed for an anonymized user — `/nachbarn/<handle>`
  and `/nachbarn/id/<id>` both 404 before `getChronik()` would even run,
  see "Account deletion" below).

## Public profile (`/nachbarn/[handle]`, Plan B Task 3/4)

Trimmed neighbor-facing view of a user's Meldebogen. **Login-gated** like
every member surface (`/nachbarn` is in `src/middleware.ts` `GATED_PAGES`;
re-confirmed by the user 2026-09-09 after the profile audit flagged the
contradiction: resident names/avatars/activity stay off the open web). Entry
point is clicking an author name/byline anywhere content is attributed
(Forum/Market/Calendar) — all of which are gated too, so the gate is never
felt in-app; the printed Steckbrief QR bounces non-members to
`/login?redirect=/nachbarn/<handle>` (the Steckbrief page says so). A logged-in visitor viewing their OWN
handle here still sees the trimmed public view (honest "this is what
neighbors see" preview, not a bug).

- **Route + gate**: `src/pages/nachbarn/[handle].astro`. Strips one leading
  `@` (and its encoded form `%40`) before validating against `HANDLE_REGEX`;
  an invalid handle shape short-circuits to the not-found card without a DB
  round-trip. `getPublicProfile(handle)` (`src/lib/profile/publicProfile.ts`,
  SERVER-ONLY) returns `null` for both "no such handle" AND
  `anonymized: true` (tombstoned accounts) — the page can't distinguish
  the two cases and doesn't need to (`PublicNotFound.astro`, static DE-only
  copy, same precedent as `ListingUnavailable.astro`).
  `Cache-Control: no-store` — stats/activity are per-visitor-irrelevant but
  per-author-live, never cached.
- **Id-redirect**: `src/pages/nachbarn/id/[userId].astro` canonicalizes any
  `/nachbarn/id/<userId>`-shaped link (legacy `/profile/<id>` references,
  and the tombstone's own byline link — see "Account deletion" below) to
  `/nachbarn/<handle>`. Uses `getHandleForPublic(userId)`
  (`publicProfile.ts`) — NOT a raw `ensureHandle()` — because it already
  covers invalid-ObjectId-shape, missing-user, AND anonymized-tombstone in
  one gate (all → `null` → not-found card), while a legit user missing a
  handle still self-heals one via the same lazy-assignment path as
  `getProfileMe()`.
- **`PublicProfile` type contract** (`profileShared.ts`) — NEVER
  select/return `email`, `isBanned`, `pendingEmail`, `strikes`, or `motto`
  from `publicProfile.ts`. `stats` mirrors `/me`'s shape (`posts, listings,
  events, danke`) but listings are visibility-filtered (same public `$or`
  as `listingsQuery.ts`'s public branch: `status in [available, reserved]`
  AND freshness clock within 21 days) while events are an all-time count
  (Decision 11 — a stat is a count, not a listing).
- **UI**: `PublicProfileInner.svelte` + `PPublicIdentityCard.svelte` reuse
  `PChronikStrip` (identical component, no modification) and
  `PActivityLedger` (`publicView={true}`, gated to approved-only content, no
  "gespeichert" filter — a stranger's bookmarks are never public). No
  moderation card, no Konto card, no settings.
- **Public activity feed**: `GET /api/profile/public-activity` +
  `src/lib/profile/activityFeed.ts`'s `PUBLIC_MODERATION_OR` gate (approved-
  or-moderation-absent) — same gate duplicated (not imported, no shared
  export needed) in `publicProfile.ts`'s `publicModerationOr()` helper; keep
  both in sync if Decision 11 ever changes.

## Steckbrief + motto (Plan B Task 6)

`src/pages/steckbrief.astro` — printable A6-landscape (148×105mm) neighbor
card, own-view only (session-gated, redirects to `/login` if absent, to
`/profile` if the session's user record vanished). Prints straight out of
the browser (`window.print()`, no PDF backend/canvas) via a `@media print`
block that hides everything except the card
(`body * { visibility: hidden }` + `.steckbrief-card, .steckbrief-card* {
visibility: visible }`, `position: fixed` pulled to the page origin,
`!important` needed throughout to out-rank Astro's scoped-style attribute
selectors — see the file's own inline comments for the full specificity
story). Encodes `{base}/nachbarn/{handle}` into a server-generated QR (the
target is login-gated — members land on the profile, non-members on login
with redirect; fallback base is `https://mahalle.digital` when
`NEXTAUTH_URL` is unset, fixed 2026-09-09 from a stale `mahalle.berlin`) (the
`qrcode` package, SVG, injected via `set:html` — safe because the input
string is built entirely from OUR trusted base + the session's own handle,
never from request/body input). v1 is DE-only for the card content itself
(deliberate — a German print artifact), same precedent as
`PublicNotFound.astro`.

**Motto**: a free-text Steckbrief line (`users.motto`, optional,
`MOTTO_MAX_LEN`), edited through the SAME endpoint as name/hobbies
(`POST /api/users/update` — not a dedicated `/profile/motto` route). Empty
string `''` is a deliberate "clear the motto" signal (`$unset`), distinct
from `undefined` ("field not present in this request, leave alone") — the
Zod schema intentionally has no `.min(1)` on the field so a clear-request
still validates. `motto` is own-view/Steckbrief-only: `ProfileMe` carries it,
`PublicProfile` never does (not shown on `/nachbarn/[handle]`, only printed
on the Steckbrief card and the private `/profile` page). Checked for
profanity via `checkMottoProfanity()` before persisting, same moderation
posture as the display-name check at registration.

## E-mail change (Plan B, Task 8)
