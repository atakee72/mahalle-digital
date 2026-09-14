# Marketplace (kiosk) notes

> **Whole surface login-gated since 2026-08-25** (`src/middleware.ts`: `/marketplace` in `GATED_PAGES`, `/api/listings` in `GATED_APIS`) — user decision: inner-community, not a public market; this closed the "keep public for SEO" question from the landing release. "Public" in the notes below means *visible to logged-in non-owners*, not anonymous visitors.

> **A5 superseded May 2026** — see "Bump — no rate limit" and "Freshness decay
> & public visibility" sections below. The original A5 (7-day cooldown +
> altpapier strap that bump didn't clear + 60d hide) was replaced by a single
> 21-day threshold that *hides* past-21d listings from public entirely + bump
> as freshness reset + no rate limit.


Loaded lazily when Claude reads/edits files in `src/components/marketplace/kiosk/` (or any subtree). The root `CLAUDE.md` keeps a pointer to this file so it can be pulled in even when working on related files outside this directory (e.g. `src/pages/api/listings/`, `src/lib/listingActions.ts`, `src/lib/listingsQuery.ts`).

> **Legacy dark-glass cluster removed (June 2026).** The pre-kiosk marketplace
> UI (`/marketplace/sell`, `/marketplace/my-listings` pages + `ListingWizard`,
> the `wizard/` step components, `MyListingsDashboard`, `dashboard/` components,
> `ProductCard`, `ProductFilters`, `SearchBar`, `ReportListingModal`,
> `ImageCropper`, `RichTextEditor`, `RichTextDisplay`) was deleted. Listing
> creation is `/marketplace/create` (kiosk compose); "my listings" is
> `/marketplace?view=mine`. **RichText was dropped entirely** — listing
> descriptions are plain `descriptionPlainText` (kiosk compose uses a plain
> textarea). The draft + `my-listings` API routes were KEPT (see drafts note below).

### Server-side drafts (kiosk)
- Drafts live in the `listings` collection as `status:'draft'` (no separate
  collection). The draft API is intact and reused by the kiosk compose:
  `POST /api/listings/draft` (save, no moderation/no daily-limit),
  `POST /api/listings/draft/[id]/publish` (publish w/ full moderation + daily
  limit), `GET /api/listings/my-listings` (returns `{ listings, drafts, stats }`).
- **Save**: `MarketComposeInner` (create mode) has an "Als Entwurf speichern"
  button → `POST /api/listings/draft`. Returned `draftId` is held in `$state`;
  subsequent saves update the same row. localStorage autosave is the per-device
  fallback; server drafts are explicit + cross-device.
- **Durable draft-saved confirmation (I3 fix, 2026-09-03, `74697b8a`).** A
  successful save fires the standard `showSuccess` toast AND sets `draftSaved`
  `$state` → renders a persistent inline "✓ Entwurf gespeichert" banner (all
  viewports, outside the `hidden lg:flex` desktop action row) with a link to
  `?view=mine`. A dedicated `$effect` subscribing to every form field clears
  `draftSaved` on the next edit; `handleSaveDraft` changes no subscribed field, so
  the banner survives the save itself. Why: unlike publish (which redirects with a
  flash param), draft-save stays on an unchanged-looking form, so the transient
  toast alone was a weak signal — the banner is the durable one.
- **Resume**: `/marketplace/create?draft=<id>` → `create.astro` owner-gates +
  loads the draft via `fetchListingForSSR`, passes it as `initialListing`
  (mode stays `create`). The compose detects `status:'draft'` → tracks `draftId`.
  **Gotcha**: the autosave `$effect` skips when `initialListing` is set (as well
  as edit mode) — otherwise a resumed draft would pollute the
  `marketplace-compose-draft-create` localStorage key. Don't remove that guard.
- **Publish routing** in `handlePublish`: `mode==='edit'` → `PUT /edit/{id}`;
  else `draftId` set → save latest then `POST /draft/{id}/publish`; else
  `POST /create`. A 400 (incomplete) keeps the user on the form with a
  missing-field hint (no redirect).

### Owner view (`?view=mine`) — stats strip + Entwürfe section
- Replaces the deleted dark-glass dashboard. `MarketplaceBrowseInner` fetches
  `/api/listings/my-listings` via a seq-guarded `fetchOwnerMeta()` (mirrors the
  grid's `refetch()`) **only** while `filters.view === 'mine'` — the paginated
  grid can't be trusted for totals or the full drafts list.
- **`OwnerStatsStrip.svelte`**: Total · Active · Sold · **Stale**. "Stale" =
  active (available/reserved) listings past the 21d freshness clock, hidden from
  public until bumped (server-computed `staleCount` on `ListingStats`, added in
  `my-listings.ts` via `isPubliclyHiddenFrom`). Earnings intentionally dropped.
- **`OwnerDraftsSection.svelte`**: dedicated "Entwürfe" block above the grid.
  Dumb component; parent owns the API calls. Bearbeiten → `?draft=` resume;
  Veröffentlichen → publish (400 → route to compose to finish); Löschen →
  `DELETE /api/listings/delete/{id}` + refetch.
- **Grid de-dupe**: `sortedItems` filters out `status:'draft'` in owner view so
  drafts appear only in the Entwürfe section, not the grid.

### Page-accent rule (dual accent)
- Marketplace uses **two** accents — not one:
  - `--k-accent: var(--k-wine)` — kickers (mono-uppercase eyebrows like `MARKTPLATZ`) and default surface accents. Wine is also the marketplace FAB color.
  - `--k-accent-italic: var(--k-ochre)` — italic verb emphasis ONLY in headlines. Per Decision A10.
- The `.kiosk-headline em` CSS rule in `global.css` auto-applies the ochre + italic to `<em>` inside `.kiosk-headline` elements. Don't manually write `text-ochre italic` — let the rule do it.
- **Don't extend `--k-accent-italic`** (ochre italic) to other pages. It's a marketplace-only design decision. Forum stays wine-italic, calendar stays teal-italic.
- **Don't touch** these semantic accents that stay constant across all kiosk surfaces: live-now indicator (ochre dot), today indicator on calendar, weekend-day labels, required-field asterisks, compose step numbers (`01`, `02`, …), CTA wine-shadows, modal wine-shadows, mobile wine FABs.

### Strap precedence in `ListingCard`
Order in the top-left strap stack (topmost = highest priority):
1. `entwurf` — draft badge (author-only, not shown in public feed)
2. `bump` — recently bumped (within 7 days of last bump)
3. `reserviert` — reserved for a buyer
4. `altpapier` — stale listing (≥ 21 days old)
5. `StatusBadge` (author-only, moderation state) — last in the stack

The stack is intentionally additive. A listing that was bumped at day 22 wears `altpapier + bump` simultaneously (A5). Each strap communicates a different signal.

**`altbestand` strap removed from rendering** (May 2026). The strap kind + CSS still exist in `MarketStrap.svelte` + `tokens.css` for any future direct-DB-edit edge case, but `ListingCard` no longer renders it — the one-time backfill (`scripts/migrate-legacy-categories.ts`) maps every pre-redesign legacy category to a kiosk key, so `resolveCategory().legacy === false` for all rows.

### Soft-migration symmetry (A2 + A3) — post-backfill
- **DB column is permissive**: `category` is a plain string (no enum constraint at the DB level). `delivery` is nullable. This allowed legacy listings to survive the redesign without an upfront migration.
- **Write path is strict**: `KioskCategorySchema` (Zod) gates all creates + edits to the **13 approved kiosk category keys** (`moebel`, `garten`, `werkzeug`, `kleidung`, `medien`, `elektronik`, `fahrrad`, `pflanze`, `kinder`, `spielzeug`, `handgemacht`, `sport`, `sonstiges`). `DeliverySchema` gates delivery to `'abholung' | 'versand' | 'abholungVersand'`.
- **One-time backfill ran May 2026** (`scripts/migrate-legacy-categories.ts`): mapped pre-redesign English legacy keys (`furniture`/`electronics`/etc.) to the new German kiosk keys, defaulted null `delivery` to `'abholung'`, and renamed the original short-lived `kind` key → `kinder` (split into `kinder` + `spielzeug` for the children/toys distinction).
- **Owner-edit still forces re-pick on legacy values**: `BackfillBanner` keeps rendering on the edit page when a listing has a legacy category or null delivery — defense in depth for any direct-DB-edit cases that bypass the schema.

### Backfill rule
`BackfillBanner` renders owner-only on the detail page (`/marketplace/[id]`) when either:
- `resolveCategory(listing.category).legacy === true`, OR
- `listing.delivery == null`

CTA routes to `/marketplace/edit/{id}?from=backfill`. Edit page pre-populates whatever valid fields exist; owner must pick a new category and/or delivery mode, then republish. Republish re-runs the full moderation pipeline (same as create path).

### Contact-form relay design (A6)
`POST /api/listings/[id]/contact` is the buyer→seller email pipeline.

**Rate limits** (per-listing-flood + per-IP + per-sender + per-sender-to-owner):
- Max 3 contact messages per listing per hour (global flood guard)
- Max 5 messages per IP per hour
- Max 2 messages per sender email per hour
- Max 1 message per sender per listing per day (prevents harassment)

**Security layers:**
- AI moderation on message body (same `checkSpamWithGPT` pipeline as all content)
- Honeypot field (`website`) drains bots silently — no error, no action, HTTP 200
- `Origin` header CSRF guard — must match `ALLOWED_ORIGINS` env var

**GDPR / privacy design:**
- No message bodies stored server-side. Metadata only: `{ listingId, sellerId, buyerEmailHash (sha256+CONTACT_IP_SALT, 32 hex), senderIpHash, sentAt }` (90d TTL index) in `listingContacts` collection.
- Message lives only in the two outbound Resend emails (seller confirmation + buyer receipt).
- `replyTo: senderEmail` on the seller email is the privacy mechanism — seller can reply directly to the buyer, but the seller's email never appears on any page the buyer sees.
- Confirmation email to buyer has an "ignore if you didn't send this" footer for impersonation victims.

**Contact-form copy is fully i18n'd (DE/EN).** Both the server error codes and
the client `validate()` messages live in kiosk-i18n under `market.contact.error.*`
and `market.contact.validate.*` (`0576253e` + `6b1b60d6`, 2026-09-06). Before that,
`ContactForm.svelte` carried a local German-only `ERROR_MESSAGES` record that
*shadowed* the existing dict keys, so EN visitors got German error text — a dead-code
bug, not missing translation. `errorCopy(code?)` resolves a known code to its key and
falls back to `market.contact.error.generic`; `validate()` returns dict strings via
`tStr` with `{n}` for the length limits. Add new codes as keys in BOTH dicts, never as
local literals.

**No synchronous 550/bounce → `seller_unreachable` mapping (parked, prod-impossible).**
The `410 seller_unreachable` fires only when the seller row has **no email at
all** (`contact.ts` ~L194). A hard SMTP 550 (recipient rejected) is thrown from
inside the owner `sendMail` (~L224) and falls to the outer catch → generic
**500**. Mapping 550→410 was considered and deliberately NOT done: prod transport
is **Resend**, which resolves the send and reports bounces **asynchronously via
webhook** — a 550 never surfaces synchronously in prod, only on the local-dev
SMTP path. So the mapping would guard a case that can't fire in production. If a
real need appears (e.g. SMTP returns as prod transport, or Resend bounce webhooks
get wired to flip a seller flag), catch the owner-send throw, sniff nodemailer's
`responseCode === 550` (distinguish from transient failures, which must stay 500
so the buyer retries), and return `jsonErr('seller_unreachable', 410)`.

**Required env vars for contact relay:**
```
SMTP_HOST=                 # SMTP relay (with SMTP_USER+SMTP_PASS: active transport; see src/lib/email/mailer.ts)
SMTP_PORT=                 # 587
SMTP_USER=                 # SMTP login
SMTP_PASS=                 # app password (secret)
RESEND_API_KEY=            # Resend.com API key — legacy/fallback transport (used only without SMTP_*)
SENDING_FROM_EMAIL=        # e.g. "Mahalle <noreply@ercan-atak.de>" — must be registered at the SMTP provider
CONTACT_IP_SALT=           # 32+ chars, fixed across deploys (for hashing IPs in rate-limit keys)
ALLOWED_ORIGINS=           # CSV of allowed origins, e.g. "https://mahalle.berlin" (defaults to this)
```

### Server-side projection — A5 `lastBumpedAt` is owner-only
`listingsQuery.ts` strips `lastBumpedAt` from the non-owner serialization branch and exposes `isBumped: boolean` instead (computed server-side: `lastBumpedAt != null && Date.now() - lastBumpedAt < 7 * 86400 * 1000`).

`ListingCard.svelte` uses `isBumped` as the canonical signal for the bump strap. **Never extend the public projection to expose `lastBumpedAt`** — bump timestamps are a privacy leak (tells competitors exactly when a seller is active/desperate).

### Seller identity is a READ-TIME join — never store it (Aug 2026)
`sellerName` / `sellerImage` are **not columns**. They are populated by `populateSellers()` in `src/lib/listingsQuery.ts`, one batched `$in` per fetcher call, and all three SSR fetchers (`fetchListingsForSSR`, `fetchListingForSSR`, `fetchListingDetailForSSR`) call it — so browse grid, editorial lead, detail `SellerCard` and the client-side `/api/listings` path are all fed from the same join.

**Do not "optimize" this into a denormalized write.** `src/lib/auth/accountDeletion.ts` step 6 tombstones a deleted user's `name` to `"Ehemaliges Mitglied"` and unsets their avatar, relying on authored content resolving identity at read time. A stored `sellerName` would freeze the pre-deletion name and defeat the GDPR anonymization — and go stale on every rename. The tombstone path is the reason the join exists, not a side effect of it.

Projection is an **allowlist**: `{ name: 1, image: 1, userPicture: 1 }`. Never `{ password: 0 }` — that returns email / `isBanned` / `pendingEmail` / strike counts into client-visible payloads. Same narrowing as `populateAuthors` in `topicsQuery.ts`. Unresolvable sellers (hard-deleted user) yield `null`, which the cards render as `—` / `?`.

Historical: before this, 0 of 11 real listings had the fields — `create.ts` computed them for the API *response* only, after `insertOne`. That echo is now deleted; the compose flow reads only `moderationStatus` off the create response.

### `GET /api/listings/[id]` is gated by `fetchListingDetailForSSR` (Aug 2026)
It used to be a bare `findOne({ _id })` — no session, no moderation filter, no status filter, no freshness filter — so anonymous callers could read **moderation-rejected listings, drafts, sold items and past-21d listings**, with `sellerEmail` attached. It now delegates to the same helper `/marketplace/[id].astro` uses, so there is exactly one place where marketplace visibility is decided.

Three things to preserve if you touch this endpoint:
- **Both non-visible kinds (`hidden_past_21d`, `not_found`) collapse to the same 404 body.** Distinguishing them would turn the endpoint into an ID-existence oracle.
- **`Cache-Control: no-cache, no-store, must-revalidate` + `Vary: Cookie` on the 200 *and* the 404.** The response became session-dependent the moment owners kept access to their own drafts; without these a shared cache can store an owner-scoped body and hand it to an anonymous requester — re-opening the exact hole the gate closes. Sibling endpoints (`index.ts`, `my-listings.ts`) already set the same Cache-Control.
- **`sellerEmail` is gone from the `Listing` type**, so reintroducing it anywhere is a compile error. Keep it that way.

Still un-gated by the same rules (pre-existing, distinguishable codes for missing vs. non-public): `POST /api/listings/[id]/contact` and `src/pages/api/listings/[id]/view.ts`.

### Bump — no rate limit (supersedes A5)
- Endpoint: `POST /api/listings/[id]/bump`.
- No cooldown. Bump is the freshness reset; sellers need to be able to use it whenever the listing slips out of the public feed (past the 21d freshness clock). Spamming it would be visible in the audit (`updatedAt` + `lastBumpedAt` timestamps) and gated by the user's own social signals — not a technical concern.
- `canMutateListing` guards the endpoint: blocks pending / rejected / reserved / sold. Bump passes `{ allowOnWarningLabel: true }` (see below).
- **Bump resets the freshness clock.** A bumped 25-day listing is back in the public feed at the top, with the 24h `FRISCH HOCHGEHOLT` strap. No more `altpapier` strap simultaneously.
- Owner-facing label: the bump button reads "frisch hochholen" normally; when the listing is past 21d it swaps to "↻ Auffrischen" — same action, clearer intent.
- **Bump button is disabled while the listing is within its 21-day freshness window** (server-computed freshness clock = `max(createdAt, lastBumpedAt)`). It re-enables the moment the listing goes stale and gets hidden from the public feed — that's the only time bumping does something user-visible. Brand-new listings have their bump button disabled for the first 21 days; this is intentional, not a bug. The disabled tooltip shows the days remaining (`market.owner.bump.disabledFresh` with `{n}` interpolation).
- **Warning-labeled AND rejected listings are editable.** Both pass `{ allowOnWarningLabel: true, allowOnRejected: true }` to `canMutateListing`; the `edit/[id].astro` page-level gate matches (blocks pending only, so warning + rejected reach the compose form). The edit endpoint writes a pre-edit snapshot to `listingAuditTrail` before the moderation re-run — event type `'edit_warning_cleared'` for warning-labeled edits, `'edit_rejection_cleared'` for rejected edits. If the fresh re-moderation passes (new content is clean), the warning OR rejection is auto-cleared on the same `$set`:
  - **Warning-cleared**: `hasWarningLabel: false`, `warningText: null`.
  - **Rejection-cleared**: `moderationStatus: 'approved'`, `rejectionReason: null`.
  - **Dirty re-mod** (re-flagged): listing flips to `'pending'`. Warning state intentionally persists (admin reviews); rejection's `rejectionReason` IS cleared to avoid stale text alongside the fresh pending record.
  - `isUserReported` is intentionally NOT cleared in any branch — user reports are independent of AI moderation; admin clears them via `/admin/moderation`.
- **Warning-labeled listings are also bumpable.** Bumping doesn't change content, just the freshness timestamp. Bump + status endpoints pass `{ allowOnWarningLabel: true }` for the same reason as edit. (Rejected listings are NOT bumpable — bumping a rejected listing makes no semantic sense; the owner needs to fix the content first via edit.)
- The "editing evades the warning/rejection" attack isn't real because moderation re-runs on every edit; the audit trail is for legal/regulatory provability of what the moderation state was + when it was cleared.
- **`PendingLockBanner` triggers on `moderationStatus === 'pending'` only** (NOT on `hasWarningLabel`). Warning-labeled listings render the full action grid; bump + status + edit all work. The lock banner's copy ("Diese Anzeige wird gerade geprüft") is only accurate for the pending state.

### `listingAuditTrail` collection
- Written by `/api/listings/edit/[id]` whenever an edit happens on a listing with `hasWarningLabel === true`. One record per warning-clearing edit. Captures pre-edit title + body + images + warningText + editing user + timestamp.
- Schema: `src/types/index.ts` → `ListingAuditTrail` interface.
- Write-once, never reviewed by admin (no UI surface yet — query via mongo shell). If/when there's a legal request, build a small dashboard then.
- Index: `{ listingId: 1, createdAt: -1 }` for "audit history for this listing" queries.
- Edge: snapshot is written BEFORE the `updateOne` that persists the new content. A failure mid-flow (DB hiccup) can leave a "phantom" audit record for an edit that never happened. Cross-check `editedAt` against the listing's `updatedAt` to disambiguate — if `updatedAt < editedAt`, the edit failed.

### Freshness decay & public visibility (supersedes A5 + Task 7.2)
- **Freshness clock = `max(createdAt, lastBumpedAt)`.** Bumping resets it; editing does not.
- **0–21 days since the clock**: visible in public feed, search, browse, direct URL. Normal card.
- **>21 days since the clock**:
  - **Hidden from public entirely.** `buildListingsFilter` in `listingsQuery.ts` uses `$expr: { $gte: [{ $ifNull: ['$lastBumpedAt', '$createdAt'] }, twentyOneDaysAgo] }` on the public branch. (Caveat: `$expr` doesn't use indexes — fine for current scale; future optimization is a precomputed `freshness` field with an index on it.)
  - **Direct URL → "Diese Anzeige ist nicht mehr verfügbar." page** (HTTP 200, not 404). `fetchListingDetailForSSR` returns `{ kind: 'hidden_past_21d' }` and `[id].astro` renders `<ListingUnavailable />` inside the same `<KioskLayout>` shell at the same URL. Keeps the URL indexable-but-empty; the moment the owner bumps, the next request flips back to the full detail page.
  - **Owner's „Meine Anzeigen" view**: the card renders grayed (`.market-stale` class — opacity 0.6 + saturate 0.45 via motion-marketplace.css) + an ochre `⚠ Nicht im public Feed · bump zum Hochholen` warning chip (i18n key `market.owner.notInPublicFeed`). Triggered when the orchestrator passes `inOwnerView={true}` AND the server-computed `listing.isPubliclyHidden === true`.
  - **Owner's direct URL**: full detail page renders normally (owner bypass via `fetchListingDetailForSSR`'s `isOwner` branch).
- **No auto-archive, no hard cutoff.** Past-21d listings live indefinitely in the author's private view until they bump or delete.
- **`altpapier` / `altbestand` straps**: kinds + CSS retained in `MarketStrap.svelte` + `tokens.css` for defense; never rendered by `ListingCard` after May 2026.
- **`verkauft` / `reserviert` straps ARE rendered (I1 fix, 2026-09-03, `74697b8a`).** The `verkauft` MarketStrap variant existed but was never wired up, so a sold listing showed no indicator. Now `ListingCard` (browse grid) renders `verkauft` when `status === 'sold'` (priority over `reserviert`), and `DetailGallery`'s hero strap stack renders `verkauft`/`reserviert` (updates live — the detail's `listing` is `$state`, reassigned on status change). Since sold listings are owner-only (table below; non-owners `not_found`), this only affects the owner's own view — there was never buyer-facing confusion, just a missing honest signal.
- **`isPubliclyHidden: boolean`** is a server-computed virtual on the `Listing` type. Always `false` for any listing a non-owner receives (server filter excludes them); variable for the owner's own. No privacy leak — boolean only, not a timestamp.

### Status visibility (A7)
| Status | Visible to | Conditions |
|---|---|---|
| `available` | All (incl. logged-out) | Always |
| `reserved` | All (incl. logged-out) | Always |
| `sold` | Owner only | Only when `?view=mine` |
| `exchanged` | Owner only | Only when `?view=mine` |
| `draft` | Owner only | Only when `?view=mine` |

Owner does **not** see their own drafts/sold listings leaking into the public feed unless they explicitly switch to the "Meine Anzeigen" (`?view=mine`) tab. `buildListingsFilter` enforces this via a `$or` arm that adds `{ sellerId: userId, status: { $in: ['draft', 'sold', 'exchanged'] } }` only when the request includes `?view=mine` + a valid session.

### Editorial lead — algorithmic, no manual override

The full-bleed `<ListingLead>` on page-1-unfiltered views is purely algorithmic: it's `data.items[0]` after the SSR query sorts by `updatedAt: -1` (from `LISTINGS_QUERY_OPTIONS.sortBy`). Freshness — created or bumped — wins the slot. Bump writes `updatedAt = now`, so a freshly-bumped listing immediately pops to the lead.

Lead-visibility guard in `MarketplaceBrowseInner.svelte`:
```ts
const showLead = $derived(
  (filters.offset ?? 0) === 0 && !hasFilters && data.items.length > 0
);
```
Hidden on pagination (`offset > 0`) and on any filtered view (kind/cat/search/view).

**No manual curation lever.** Marketplace listings are equal citizens; there's no `isOfficial` / `pinnedUntil` equivalent on `listings` (those exist only on `announcements` for the forum's pinned-official slot). If a specific listing should be featured deliberately, the only available lever is for the owner to bump it (resetting `updatedAt` → it becomes the lead until something fresher arrives).

**Future option** (no concrete trigger yet): mirror the forum's `isOfficial: boolean` + `pinnedUntil: Date | null` pattern on listings + add an admin endpoint. Don't add the schema fields preemptively — they're cheap to add later when an actual need surfaces (community team wants to highlight a specific listing during an event, etc.).

### Hybrid SSR-static + island-hydrate pattern (detail page)
`/marketplace/[id].astro` renders the listing title, body, lead image, and structured data directly in the Astro template (visible to search engines, link previews, and a11y). It then mounts `<MarketDetailInner client:load>` on top for the interactive gallery, sidebar contact form, and action buttons.

**Why not `client:only="svelte"`:** Empirical Googlebot test (2026-05-20) showed `client:only` islands return zero body content in raw HTML — bad for SEO on a search-driven marketplace. Hybrid SSR-static is the correct pattern here.

**Rule:** For any new detail-page surface on marketplace, follow the same split: static Astro template for visible content + `client:load` island for interactivity.

**GOTCHA — the description body has TWO render sites.** The DEFAULT visible description is the **SSR shell in `[id].astro`** (plain `{bodyText}`); `MarketDetailInner`'s description `<p>` is inside `{#if translation}` and renders ONLY the translated variant (deliberate dedup — see the comment there). So any change to how the body renders (linkify, `pre-line`, truncation, …) MUST be applied to the `[id].astro` shell — editing only the island silently does nothing in the normal, untranslated view. (Bit us 2026-09-05: a linkify fix went into the island first and shipped as a no-op. **Bit us again 2026-09-13, `65ff7c2a`:** the short-label change — `displayUrl()` anchor text, `title`, `↗`, `break-words` — landed in the island only; the `[id].astro` shell still shows the raw URL with `break-all`. FIXED 2026-09-14: the shell's `.map()` now renders the same `displayUrl()` label, `title`, `↗` and `overflow-wrap: break-word` — both render sites match again; the browse `ListingLead` excerpt runs through `shortenUrlsInText()` like `ForumPostCard`.)

**Translation block sits at the TOP of the island** (`0d4e6a62`, 2026-09-05): the `TranslateControl` + `{#if translation}` block render before `<DetailGallery/>`, so the page reads SSR original → translate toggle → translation, co-located. They used to render after the gallery, stranding the translation screens away from the original. Guarded `{#if !(isOwner && moderationStatus === 'rejected')}` (an owner's rejected listing shows `ListingRejectedPanel` instead — no translate control); keep that guard if you move the block again.

**Mobile sticky contact bar — keep `display` in CLASSES, never inline** (`df97454b`, 2026-09-05): the `{#if !isOwner}` sticky "↑ Nachricht senden" bar is `lg:hidden` (mobile-only; on desktop the sidebar form's "→ senden" is the CTA). It had an inline `style="display:flex"`, and **an inline `display` always beats a class**, so `lg:hidden` never hid it — the bar showed on desktop, doubling the CTA and covering the page. Fixed by moving `display/align/gap` to `flex items-center gap-2.5` classes. Do NOT put `display` back in the style attribute — it silently re-breaks the responsive hide.

### Kind-key bridge (rail vs API)
`MarketFilterRail.svelte` and the URL bar speak German keys: `verkaufen`, `tausch`, `verschenken`.
The data layer, DB, and API speak English enum values: `sell`, `exchange`, `gift`.

`MarketplaceBrowseInner.svelte` has the translation maps:
```ts
const RAIL_TO_API = { verkaufen: 'sell', tausch: 'exchange', verschenken: 'gift' };
const API_TO_RAIL = { sell: 'verkaufen', exchange: 'tausch', gift: 'verschenken' };
```

Compose flow uses the same convention: the category/kind pickers emit German keys → the submit handler translates before posting to the API. **Don't bypass these maps** by writing English kind values directly into URLs or filter state.

**`price` is optional at the schema base** (`ListingCreateSchema`, since 2026-09-02) — exchange/gift listings carry no price and `MarketComposeInner` sends `price: undefined` for them. A `superRefine` enforces that only `sell` listings must have a price (> 0.01) and that exchange/gift must NOT. **Don't make base `price` required again** — it rejected every exchange/gift publish with `price: Required` before the refine ever ran (silent 400 in the compose UI). `listings/create.ts` reads `finalPrice = (exchange|gift) ? 0 : (price ?? 0)` — the `?? 0` is a never-hit tsc narrow (sell always has a price by then).

### `canMutateListing` guard
Located at `src/lib/listingActions.ts`. Central guard called by all listing mutation endpoints (edit, delete, bump, status-change).

**Default behavior** — blocks: `pending`, `warning`, `rejected`, `reserved`, `sold`.

**Override flags** (pass as second arg object):
- `{ allowOnRejected: true }` — delete endpoint. Owners need to be able to clean up rejected listings.
- `{ allowOnReserved: true }` — status endpoint. `reserved → sold` is a one-click intended path.
- `{ allowOnSold: true }` — status endpoint (added 2026-09-02). Without it the unconditional sold-block dead-coded the `sold → available` transition in `VALID_TRANSITIONS`, so a sold listing could never be un-marked, edited, or deleted (delete defers to the status endpoint to "back out"). The status endpoint passes it; the `VALID_TRANSITIONS` matrix is then the real guard for what a sold listing may do (only → available). The un-mark UI is the "wieder verfügbar" button in `OwnerActions.svelte` (renders `{#if listing.status === 'sold'}` — the reserve/sold toggles hide on sold, so without this button a sold listing had NO status control at all).

**The bump endpoint uses default** (no overrides) — bumping a reserved/rejected listing makes no semantic sense.

**Pattern for new endpoints:** call `canMutateListing(listing, session, opts)` at the top of the handler before any writes. Return its `Response` if it returns one.

### Multi-gate alignment (edit + bump + status flows)

When a mutation is gated, the gate logic lives in **four** places that must agree:

1. **Page-frontmatter gate** in the corresponding `src/pages/marketplace/.../*.astro` (short-circuits navigation; redirects to a flash-toast URL).
2. **API endpoint gate** in `src/pages/api/listings/...` (the `canMutateListing` call with its `allowOn*` opt-ins).
3. **Compose-component gate** in `MarketComposeInner.svelte` (the `isEditBlocked` `$derived` that decides whether to render the form or the "Bearbeiten gesperrt" banner inline).
4. **Entry-button gate** in `OwnerActions.svelte` (the `canEdit` `$derived` that toggles between an active `<a>` and a disabled-with-tooltip `<button>`). Without this, the button looks clickable, takes the owner to the gated page, and the page bounces them back to `/marketplace?edit_blocked=1` — a dead-end UX.

If you lift or tighten one, **grep for the other three and update them in lockstep**. The warning-edit lift shipped in three commits because the page gate + the compose-inner gate were missed on the first attempt — clicking "bearbeiten" appeared to work (API accepted) but the form never rendered (component still blocked). Same shape for the rejected-edit lift afterward. The OwnerActions seat was discovered when reserved/sold listings dead-linked back to marketplace frontpage.

Concretely: search for `moderationStatus === 'pending'`, `hasWarningLabel`, `allowOnRejected`, `allowOnWarningLabel`, `isEditBlocked`, `canEdit` across the marketplace tree before declaring a gate change done.

### `ListingImagePlaceholder` accepts `src` (not decorative-only)

`src/components/marketplace/kiosk/primitives/ListingImagePlaceholder.svelte` looks like a riso-stripe placeholder but it accepts an optional `src` prop. When set, it overlays an `<img>` (object-cover + `optimizeCloudinary()`) on top of the stripes; stripes show through during load + at object-cover transparent edges as cat-tinted bleed. Both `ListingCard` and `ListingLead` pass `src={listing.images?.[0]}` — don't bypass the primitive thinking "it's just the placeholder." (Originally the JSX spec always showed the stripe pattern; we extended it for real listings without renaming because the fallback is still the placeholder.)

---

## Bundles (deferred to follow-up PR)

Spec: `design/handoffs/design_handoff_marketplace/jsx/kiosk-marketplace-novel.jsx:166-213` (block-commented as `// DEFERRED` per Task 1.0). Scoping: `MARKETPLACE_SCOPING.md` §03.

Schema reserves `bundleId?: ObjectId` nullable FK on the `listings` collection + partial index (`scripts/create-listing-indexes.ts`).

**Un-defer trigger conditions** — build bundles when 2-3 of the following signals appear in production:
1. Owners writing "siehe auch meine andere Anzeige" / "see also my other listing" in description bodies (search the `listings` collection for these phrases).
2. Repeat-seller patterns — one user with 5+ simultaneously-active listings (query `listings` grouped by `sellerId` where `status = 'available'`).
3. Forum / `/admin/moderation` reports asking "kann man mehrere Sachen zusammen verkaufen?" or equivalent.

Until then: `bundleId` stays null on all listings. The Bundle UI surfaces (`BundleCard`, `BundleCompose`, `BundleDetail`) and the auto-dissolve cron are out-of-scope.

---

## Watch-items (deferred by design — build only when the trigger fires)

These were deliberately NOT built for v1. They are not bugs or tech-debt to pay
down now — each is parked behind a concrete trigger. Don't pre-build; revisit
only when the named condition appears.

1. **`$expr` freshness filter isn't index-backed.** `buildListingsFilter`'s public
   branch uses `$expr: { $gte: [{ $ifNull: ['$lastBumpedAt','$createdAt'] }, 21d] }`,
   which Mongo can't serve from an index. Fine at current scale (tens of listings).
   **Trigger:** active listings cross ~500–1000, OR slow-query warnings appear in
   Mongo/Vercel logs. **Fix when triggered:** precomputed `freshness` field
   (= `max(createdAt, lastBumpedAt)`) written on create + bump, with an index on it;
   needs a one-time backfill. Adds write-path cost — not worth it before the trigger.

2. **`listingAuditTrail` has no read UI.** Write-once collection; inspected via mongo
   shell. **Trigger:** an actual legal/regulatory data request, OR audit lookups
   become routine (>2–3×). **Fix when triggered:** a small CLI dump script keyed by
   `listingId` beats a full admin page; only build UI if lookups are frequent.

3. **No admin "feature this listing" lever.** Intentional — listings are equal
   citizens; the editorial lead is purely algorithmic (freshest wins). This is a
   *product* decision, not a gap. **Trigger:** the community team asks to highlight a
   specific listing (e.g. during an event). **Fix when triggered:** mirror the forum's
   `isOfficial: boolean` + `pinnedUntil: Date | null` pattern on `listings` + an admin
   endpoint (server-controlled, never client-settable — same as announcements).

### Mobile-behavior audit 2026-09-09 (390×844 functional pass)
- `SellerCard`'s „⚑ melden" was never wired (no `onReport` passed) and rendered for the owner too. `MarketDetailInner` now passes `onReport={isOwner ? undefined : () => (reportOpen = true)}` and the card renders the button only when it has a handler.
- Compose: bottom padding raised 96→144px so a field scrolled into view isn't under the stacked mobile sticky publish bar (~64px) + bottom nav (~45px); the sticky bar's CTA follows `mode` via the new `publishLabel` prop (`market.compose.cta.publish` / new `market.compose.cta.saveChanges`) — it used to say „veröffentlichen →" while editing; the „Preis & Übergabe" section heading rendered a literal `&amp;` (it was inside a JS string, not HTML text).
- `ContactForm` is `novalidate` now: the `required`/`minlength` attributes let the browser's English bubbles pre-empt the bilingual `validate()` copy.
- Listing delete confirm is i18n'd (`market.owner.deleteConfirm*`); the shared `ConfirmDialog`'s defaults are locale-aware (root `CLAUDE.md` „Confirm dialog").
- Parked for the UI-polish peer: „bearbeiten / veröffentlichen / löschen" on the Entwürfe rows measure 27px tall (`browse/OwnerDraftsSection.svelte`).
