# Export sweep inventory (2026-10-01)

Companion to `2026-10-01-unused-exports-sweep.md`. Generated from `npx -y fallow@latest dead-code --format json` on `main @ 71779106`, then classified by a name search over `src/`, `scripts/`, `scratchpad/`, `.github/` and the root config files.

**Pre-classification (a starting point, not a verdict — the plan's per-symbol rule decides):**

- `DELETE` — the name occurs once in its own file (the declaration) and nowhere else.
- `UNEXPORT` — the name is used inside its own file; only the `export` keyword goes.
- `DROP-REEXPORT` — a re-export line nobody imports through.
- `CHECK-SRC` — the same NAME occurs in another `src/` file. It may be a real use the tool missed or an unrelated symbol with the same name. Decide by reading.
- `KEEP-*` — used by `scripts/`, `scratchpad/` or a test; the tools are blind there. Do not touch.

The „Seen elsewhere" column is a raw NAME match and includes mentions in comments. The plan's audit (2026-10-01) re-ran the search for all 164 rows with code-file filters: every `DELETE` row has exactly one own-file mention, every `UNEXPORT` row more than one, and no row outside `CHECK-SRC`/`KEEP-*` has an outside user. Expected verdicts for the `CHECK-SRC` rows are in the plan, Task 1 Step 4.


## Part A — unused type exports (Task 2)

60 symbols in 17 files.


### `src/lib/calendarMutations.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 75 | `EditEventInput` | UNEXPORT | — |
| 111 | `RsvpInput` | UNEXPORT | — |


### `src/lib/forum/searchStore.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 14 | `SearchComment` | DROP-REEXPORT (nobody imports it through searchStore.ts; searchQuery.ts is the declaration) | `src/lib/forum/searchQuery.ts` (2) |
| 14 | `SearchPost` | DROP-REEXPORT (nobody imports it through searchStore.ts; searchQuery.ts is the declaration) | `src/lib/forum/searchQuery.ts` (2) |


### `src/lib/forumMutations.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 47 | `CreateTopicInput` | UNEXPORT | — |
| 153 | `EditTopicInput` | UNEXPORT | — |
| 243 | `CreateCommentInput` | UNEXPORT | — |


### `src/lib/landing.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 24 | `ForumPeek` | DROP-REEXPORT (LandingPage.svelte imports it from landing/frames, not landing.ts) | `src/components/landing/LandingPage.svelte` (2), `src/lib/landing/frames.ts` (5) |
| 24 | `ListingPeek` | DROP-REEXPORT (LandingPage.svelte imports it from landing/frames, not landing.ts) | `src/components/landing/LandingPage.svelte` (2), `src/lib/landing/frames.ts` (5) |


### `src/lib/marketplaceQueryOptions.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 48 | `ListingsQueryOptions` | DELETE | — |


### `src/lib/moderation.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 751 | `SpamClassification` | UNEXPORT | — |
| 868 | `ImageSafetyClassification` | UNEXPORT | — |


### `src/lib/savedEventsQueries.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 41 | `SaveEventInput` | UNEXPORT | — |


### `src/lib/userProfilesQueries.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 15 | `UserProfile` | UNEXPORT | — |


### `src/schemas/auth.schema.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 98 | `ResetPasswordInput` | DELETE | — |
| 101 | `LoginInput` | DELETE | — |
| 102 | `RegisterInput` | DELETE | — |
| 103 | `ProfileUpdateInput` | DELETE | — |
| 104 | `JWTPayload` | DELETE (auth.ts declares its own private interface; nothing imports this one) | `src/lib/auth.ts` (3), `src/types/index.ts` (1) |
| 105 | `PasswordResetInput` | DELETE | — |
| 106 | `ChangePasswordInput` | DELETE | — |


### `src/schemas/comment.schema.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 49 | `CommentCreate` | DELETE | — |
| 50 | `CommentUpdate` | DELETE | — |
| 51 | `CommentDelete` | DELETE | — |
| 52 | `CommentUpvote` | DELETE | — |
| 53 | `CommentQuery` | DELETE | — |


### `src/schemas/forum.schema.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 208 | `TopicCreate` | DELETE | — |
| 209 | `TopicUpdate` | DELETE | — |
| 210 | `AnnouncementCreate` | DELETE | — |
| 211 | `AnnouncementUpdate` | DELETE | — |
| 212 | `AdminAnnouncementUpdate` | DELETE | — |
| 213 | `RecommendationCreate` | DELETE | — |
| 214 | `RecommendationUpdate` | DELETE | — |
| 215 | `EventCreate` | DELETE | — |
| 216 | `EventUpdate` | DELETE | — |
| 217 | `LikeAction` | DELETE | — |
| 218 | `ViewCount` | DELETE | — |
| 219 | `SearchFilter` | DELETE | — |


### `src/schemas/listing.schema.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 314 | `ListingCreateInput` | DELETE | — |
| 315 | `ListingUpdateInput` | DELETE | — |
| 316 | `ListingFilterInput` | DELETE | — |
| 317 | `ListingStep1Input` | DELETE | — |
| 318 | `ListingStep2Input` | DELETE | — |
| 319 | `ListingStep3Input` | DELETE | — |
| 320 | `ListingDraftInput` | DELETE | — |


### `src/schemas/moderation.schema.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 143 | `FlaggedContentCreate` | DELETE | — |
| 144 | `ReviewAction` | DELETE | — |
| 145 | `BulkReviewAction` | DELETE | — |
| 146 | `FlaggedContentQuery` | DELETE | — |
| 147 | `ReportContent` | DELETE | — |


### `src/schemas/news.schema.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 27 | `NewsSubmit` | DELETE | — |
| 28 | `NewsQuery` | DELETE | — |


### `src/types/index.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 259 | `SavedItem` | DELETE | — |
| 268 | `AuthState` | DELETE | — |
| 277 | `ApiResponse` | DELETE | — |
| 285 | `JWTPayload` | DELETE (auth.ts declares its own private interface; nothing imports this one) | `src/lib/auth.ts` (3), `src/schemas/auth.schema.ts` (1) |


### `src/types/kiezStats.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 4 | `KiezDemographicsDoc` | DELETE (zdw.ts hit is a comment) | `src/lib/kiez/zdw.ts` (1) |
| 33 | `KiezSocialDoc` | DELETE | — |
| 50 | `KiezReferenceDoc` | DELETE | — |


### `src/types/listing.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 131 | `ListingFilters` | DELETE | — |


## Part B — unused value exports (Task 3)

104 symbols in 49 files.


### `src/components/kiez/plrPaths.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 14 | `PLR_CODES` | KEEP-scripts | `scripts/sync-stats.ts` (8), `scripts/simplify-plr.js` (1) |


### `src/lib/adminAlerts.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 34 | `sendAdminAlert` | UNEXPORT | — |


### `src/lib/adminModeration.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 65 | `ADM_REPORT_REASONS` | UNEXPORT | — |


### `src/lib/announcements/pin.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 8 | `MAX_PINS` | DROP-REEXPORT (every consumer imports it from pinRules.ts) | `src/components/admin/kiosk/announce/AnnCard.svelte` (1), `src/components/admin/kiosk/announce/AnnounceApp.svelte` (3), `src/components/admin/kiosk/announce/annFormat.ts` (1), `src/components/forum/kiosk/ForumIndexInner.svelte` (4), `src/pages/api/admin/announcements/create.ts` (1), `src/pages/api/admin/announcements/[id].ts` (1) |


### `src/lib/announcements/pinRules.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 13 | `isCurrentlyPinned` | UNEXPORT | — |


### `src/lib/auth.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 76 | `signToken` | DELETE | — |
| 80 | `verifyToken` | DELETE | — |
| 90 | `extractTokenFromHeader` | DELETE | — |


### `src/lib/auth/accountDeletion.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 37 | `GRACE_MS` | UNEXPORT (used in own file; schedule.ts hit is a comment) | `src/pages/api/profile/delete-account/schedule.ts` (1) |


### `src/lib/auth/emailChange.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 13 | `TOKEN_TTL_MS` | UNEXPORT (used in own file; emailVerify/passwordReset declare their own private consts) | `src/lib/auth/emailVerify.ts` (2), `src/lib/auth/passwordReset.ts` (2) |


### `src/lib/calendar/allDayRepair.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 6 | `repairedAllDayBounds` | KEEP-scripts+test | `src/lib/calendar/allDayRepair.test.ts` (6), `scripts/repair-allday-event-bounds.ts` (2) |


### `src/lib/calendarQueryOptions.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 18 | `startOfMonthUTC` | UNEXPORT | — |
| 22 | `endOfMonthUTC` | UNEXPORT | — |


### `src/lib/composeDraftStore.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 63 | `createDraftStore` | UNEXPORT | — |


### `src/lib/eventsQuery.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 28 | `EVENTS_DEFAULT_LIMIT` | UNEXPORT | — |


### `src/lib/forum/commentLimits.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 10 | `COMMENT_COUNTER_FROM` | UNEXPORT | — |


### `src/lib/forum/searchQuery.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 6 | `SEARCH_MIN_LEN` | UNEXPORT | — |
| 8 | `EXCERPT_LEN` | UNEXPORT | — |


### `src/lib/forum/searchStore.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 16 | `SEARCH_PER_KIND` | UNEXPORT | — |
| 17 | `SEARCH_POSTS_MAX` | UNEXPORT | — |
| 18 | `SEARCH_COMMENTS_MAX` | UNEXPORT | — |


### `src/lib/forumMutations.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 27 | `lastSubmittedAt` | UNEXPORT (used in own file; ComposePageInner hit is a comment) | `src/components/forum/kiosk/compose/ComposePageInner.svelte` (1) |
| 179 | `editTopicMutation` | DELETE | — |
| 215 | `deleteTopicMutation` | DELETE | — |
| 270 | `createCommentMutation` | DELETE | — |


### `src/lib/kiez/airLog.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 10 | `AIR_DAILY_COLLECTION` | KEEP-scratchpad | `scratchpad/repair-air-sentinel.mts` (4) |
| 11 | `HOURLY_RETENTION_DAYS` | UNEXPORT | — |
| 21 | `berlinDayKey` | UNEXPORT | — |
| 31 | `lastBerlinDays` | UNEXPORT | — |
| 76 | `ensureAirIndexes` | UNEXPORT | — |
| 98 | `recomputeDailyRollup` | KEEP-scratchpad | `scratchpad/repair-air-sentinel.mts` (2) |


### `src/lib/kiez/blume.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 3 | `BLUME_LQI_URL` | UNEXPORT | — |


### `src/lib/kiez/kiezViewModel.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 31 | `periodLabel` | UNEXPORT | — |


### `src/lib/kiez/kzWobble.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 3 | `kzRnd` | UNEXPORT | — |


### `src/lib/kiosk-i18n.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 4106 | `dictionaries` | UNEXPORT | — |


### `src/lib/landing.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 84 | `isoWeekStart` | UNEXPORT | — |
| 91 | `weekendRange` | UNEXPORT | — |


### `src/lib/landing/frames.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 13 | `SECTION_HREF` | UNEXPORT | — |


### `src/lib/linkify.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 60 | `DISPLAY_URL_MAX` | UNEXPORT | — |


### `src/lib/listingsQuery.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 44 | `populateSellers` | UNEXPORT (used in own file; other hits are comments) | `src/pages/api/listings/create.ts` (1), `src/lib/notifications.ts` (1), `src/lib/marketplaceQueryOptions.ts` (1) |


### `src/lib/marketplaceResolvers.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 16 | `isLegacyDelivery` | DELETE | — |


### `src/lib/mentions/broadcast.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 7 | `BROADCAST_HANDLE` | UNEXPORT | — |


### `src/lib/mentions/mentions.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 10 | `MAX_MENTIONS` | UNEXPORT | — |


### `src/lib/moderation.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 400 | `moderateContent` | UNEXPORT | — |
| 675 | `moderateImages` | DELETE | — |
| 1010 | `getCategoryDisplayName` | DELETE | — |
| 1032 | `getSeverityLevel` | DELETE | — |


### `src/lib/nav/hideOnScroll.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 20 | `TELEPORT` | UNEXPORT | — |


### `src/lib/newsboard/newsFormat.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 37 | `formatFetchDate` | DELETE | — |


### `src/lib/newsboard/newsTaxonomy.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 100 | `KIEZ_SOURCE_PATTERNS` | UNEXPORT | — |


### `src/lib/profile/nameRules.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 6 | `DISPLAY_NAME_MIN` | DELETE | — |
| 7 | `DISPLAY_NAME_MAX` | DELETE | — |


### `src/lib/queryKeys.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 71 | `forumQk` | DELETE | — |


### `src/lib/queryUtils.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 39 | `buildProjection` | UNEXPORT | — |
| 68 | `buildSort` | UNEXPORT | — |


### `src/lib/search/siteSearchStore.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 29 | `searchEvents` | UNEXPORT | — |
| 46 | `searchListings` | UNEXPORT | — |
| 66 | `searchNews` | UNEXPORT | — |


### `src/lib/sentry/clientNoise.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 25 | `isClientNoise` | KEEP (imported by sentry.client.config.ts and clientNoise.test.ts) | `src/lib/sentry/clientNoise.test.ts` (15), `sentry.client.config.ts` (2) |


### `src/lib/topicsQuery.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 14 | `FORUM_QUERY_OPTIONS` | DROP-REEXPORT (everyone imports it from forumQueryOptions.ts; topicsQuery uses the imported name itself) | `src/lib/forumQueryOptions.ts` (1) |
| 170 | `attachSavedCounts` | UNEXPORT | — |
| 276 | `attachLastCommentAt` | UNEXPORT (used in own file at line 159; ForumIndexInner hit is a comment) | `src/components/forum/kiosk/ForumIndexInner.svelte` (1) |


### `src/lib/tour/tourStore.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 15 | `CHAPTER_KEYS` | UNEXPORT | — |


### `src/lib/translation/deepl.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 4 | `ALLOWED_TARGET_LANGS` | UNEXPORT | — |


### `src/schemas/auth.schema.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 15 | `RegisterSchema` | DELETE once Task 2 removed RegisterInput (other hits are comments; only own-file reader is that type) | `src/components/auth/kiosk/AuthRegisterInner.svelte` (1), `src/pages/api/auth/register.ts` (1) |
| 32 | `ProfileUpdateSchema` | UNEXPORT | — |
| 57 | `JWTPayloadSchema` | UNEXPORT | — |


### `src/schemas/comment.schema.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 7 | `COMMENT_MAX_LEN` | KEEP-scratchpad (`scratchpad/comment-len-check.mts` imports it from this file) | `src/components/forum/kiosk/ForumComment.svelte` (2), `src/components/forum/kiosk/compose/CommentComposerMobile.svelte` (4), `src/components/forum/kiosk/compose/CommentComposer.svelte` (4), `src/lib/forum/commentLimits.ts` (2), `src/lib/forum/commentLimits.test.ts` (6), `scratchpad/comment-len-check.mts` (2) |
| 28 | `CommentDeleteSchema` | UNEXPORT | — |
| 33 | `CommentUpvoteSchema` | UNEXPORT | — |
| 39 | `CommentQuerySchema` | UNEXPORT | — |


### `src/schemas/forum.schema.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 40 | `TopicUpdateSchema` | UNEXPORT | — |
| 184 | `LikeActionSchema` | UNEXPORT | — |
| 190 | `ViewCountSchema` | UNEXPORT | — |
| 195 | `SearchFilterSchema` | UNEXPORT | — |


### `src/schemas/listing.schema.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 4 | `DeltaOpSchema` | UNEXPORT | — |
| 9 | `DeltaSchema` | UNEXPORT | — |
| 14 | `ListingTypeSchema` | UNEXPORT | — |
| 21 | `ListingCategorySchema` | DELETE | — |
| 58 | `ListingConditionSchema` | UNEXPORT | — |
| 67 | `ListingStatusSchema` | UNEXPORT | — |
| 79 | `SpecsSchema` | UNEXPORT | — |
| 226 | `ListingFilterSchema` | UNEXPORT | — |
| 240 | `ListingStep1Schema` | UNEXPORT | — |
| 256 | `ListingStep2Schema` | UNEXPORT | — |
| 263 | `ListingStep3Schema` | UNEXPORT | — |


### `src/schemas/moderation.schema.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 11 | `ModerationDecisionSchema` | UNEXPORT | — |
| 15 | `ModerationReviewStatusSchema` | UNEXPORT | — |
| 18 | `ModeratedContentTypeSchema` | UNEXPORT | — |
| 29 | `FlaggedContentSourceSchema` | UNEXPORT | — |
| 54 | `FlaggedContentSchema` | UNEXPORT | — |


### `src/schemas/translate.schema.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 8 | `TRANSLATE_REQUEST_TYPES` | UNEXPORT | — |


### `src/schemas/validation.utils.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 6 | `formatZodError` | UNEXPORT | — |
| 20 | `createValidationErrorResponse` | UNEXPORT | — |
| 41 | `safeParse` | DELETE (all other hits are Zod .safeParse() methods; no bare call of this function anywhere) | `src/components/auth/kiosk/AuthResetInner.svelte` (1), `src/components/auth/kiosk/AuthLoginInner.svelte` (1), `src/components/auth/kiosk/AuthForgotInner.svelte` (1), `src/components/profile/kiosk/PPasswordChangePanel.svelte` (1), `src/pages/api/translate.ts` (1), `src/pages/api/listings/[id]/status.ts` (1) |
| 101 | `createCustomError` | DELETE | — |


### `src/types/listing.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 14 | `isRichText` | DELETE | — |
| 19 | `deltaToPlainText` | DELETE | — |
| 155 | `LISTING_CATEGORIES` | DELETE | — |
| 168 | `LISTING_CONDITIONS` | DELETE | — |
| 176 | `CONDITION_COLORS` | DELETE | — |
| 184 | `STATUS_COLORS` | DELETE | — |


### `src/utils/authHelpers.ts`

| Line | Symbol | Pre-class | Seen elsewhere |
|---|---|---|---|
| 11 | `extractUserId` | UNEXPORT | — |
| 36 | `getUserDisplayName` | DELETE | — |


## Part C — duplicate type names (Task 4)

- `ModerationDecision`: `src/lib/moderation.ts:39`, `src/types/index.ts:296`
- `ReportReason`: `src/schemas/moderation.schema.ts:148`, `src/types/index.ts:300`

## Part D — unread Svelte props (Task 5)

| Component | Prop | Line |
|---|---|---|
| `src/components/admin/kiosk/ModerationApp.svelte` | `adminName` | 32 |
| `src/components/admin/kiosk/announce/AnnounceApp.svelte` | `adminName` | 20 |
| `src/components/calendar/kiosk/AgendaRow.svelte` | `onRsvp` | 21 |
| `src/components/calendar/kiosk/compose/EventComposePageInner.svelte` | `currentUser` | 43 |
| `src/components/forum/kiosk/BookmarksPage.svelte` | `currentUserId` | 13 |
| `src/components/forum/kiosk/compose/ModeratingModal.svelte` | `onDismiss` | 23 |
| `src/components/kiez/kiosk/KzKanalSocial.svelte` | `plr` | 20 |
| `src/components/marketplace/kiosk/detail/OwnerActions.svelte` | `currentUserId` | 8 |
| `src/components/newsboard/kiosk/primitives/ArticleImage.svelte` | `sektion` | 9 |
