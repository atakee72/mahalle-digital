<script lang="ts">
  // Forum post card — Editorial Kiosk three-treatment design.
  //
  // Each post-kind owns a distinct visual identity (per kiosk-forum.jsx):
  //
  //   topic         → paper-warm bg, 1.5px ink border, no strap, no shadow.
  //                   PostTypeChip floats in the top-right corner.
  //   announcement  → INK bg, paper text. Teal strap reads
  //                   "OFFIZIELLE ANKÜNDIGUNG · KIEZRAT" with optional
  //                   "📌 ANGEHEFTET" on the right when pinned. 2px ink
  //                   border, teal print-offset shadow.
  //   recommendation → paper-warm bg with moss strap "✦ EMPFEHLUNG AUS
  //                   DEM KIEZ", 1.5px moss border, moss print shadow,
  //                   body text rendered in Instrument Serif italic for
  //                   editorial warmth.
  //
  // Common skeleton (top → bottom):
  //   1. Strap (announcement + recommendation only).
  //   2. Top row: author byline (avatar + name + optional MAHALLE-TEAM
  //      badge + relative time below) on the left; PostTypeChip (only
  //      when no strap) + optional StatusBadge on the right.
  //   3. Image (when present) — real Cloudinary URL, riso scanline overlay.
  //   4. Title (Bricolage extrabold, balanced wrap).
  //   5. Body excerpt (font-per-kind, ink/paper tone-per-kind).
  //   6. Tags — plain mono `#tagname`, NOT pills.
  //   7. Meta footer — dashed top border, `♥ likes 💬 replies 🔖` on
  //      the left, `→ lesen` on the right.

  import KioskAvatar from './KioskAvatar.svelte';
  import StatusBadge from './StatusBadge.svelte';
  import PostTypeChip from './PostTypeChip.svelte';
  import { t, tStr, locale } from '../../../lib/kiosk-i18n';
  import { relTime as relTimeFor } from '../../../lib/relTime';
  import { optimizeCloudinary } from '../../../utils/cloudinary';
  import { shortenUrlsInText } from '../../../lib/linkify';

  let {
    topic,
    kind = 'discussion',
    featured = false,
    optimistic = false,
    ghosted = false,
    statusBadgeOverride = null,
    team = false,
    pinned = false,
    bookmarked = false,
    isOfficial = false,
    slotFill = false,
    readHref = null,
    attached = false
  } = $props<{
    topic: {
      _id: string;
      title: string;
      body?: string;
      description?: string;
      author?: { _id?: string; name?: string; image?: string | null; createdAt?: string } | null;
      tags?: string[];
      images?: { url: string }[];
      comments?: any[];
      date?: string;
      likes?: number;
      savedCount?: number;
      moderationStatus?: string;
      isUserReported?: boolean;
      hasWarningLabel?: boolean;
    };
    kind?: 'discussion' | 'recommendation' | 'announcement';
    featured?: boolean;
    optimistic?: boolean;
    ghosted?: boolean;
    statusBadgeOverride?:
      | 'pending' | 'approved' | 'rejected' | 'flagged' | 'reported' | 'warning' | null;
    team?: boolean;
    pinned?: boolean;
    bookmarked?: boolean;
    /** Set when the card is stacked under a status banner inside a
     *  single grid cell (the author-only pending/reported/rejected
     *  wrappers). Drops the 340px convergence floor so banner + card
     *  together fit one normal grid slot instead of ~1.5x it — the
     *  card still fills the slot via `h-full` on the flex parent. */
    slotFill?: boolean;
    /** When the card is NOT wrapped in an outer <a> (the pinned-official
     *  accordion), pass the detail URL here and the "→ read" CTA renders
     *  as the one real link on the card. Null (default) keeps the CTA a
     *  plain span because the outer anchor already navigates. */
    readHref?: string | null;
    /** The card hangs directly under a pin bar that already carries the
     *  official/pinned label (forum pin accordion): drop the strap, the
     *  top corners, the top border and the hover lift so bar + card fuse
     *  into one box. */
    attached?: boolean;
    /** Set true when the announcement was posted by an admin via the
     *  /admin/announcements composer (which sets isOfficial=true on
     *  the doc). Switches the strap copy from the softer community
     *  "ANKÜNDIGUNG · NACHBARSCHAFT" to the official "OFFIZIELLE
     *  ANKÜNDIGUNG · MAHALLE-TEAM". Recommendations + discussions
     *  ignore this prop. */
    isOfficial?: boolean;
  }>();

  // Same tiny helper as ForumPostDetail.svelte / ForumComment.svelte —
  // author may be a populated object, a bare id string, or null.
  function authorIdOf(v: any): string | null {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v._id) return String(v._id);
    return null;
  }
  const authorId = $derived(authorIdOf(topic.author));
  const authorName = $derived(topic.author?.name ?? 'anonym');
  const viewProfileLabel = $derived(tStr($t['profile.public.viewprofile'], { name: authorName }));

  // The whole card is wrapped in an outer <a href={detailHref}> by
  // ForumIndexInner (see CLAUDE.md forum notes) — nesting another <a>
  // here would be invalid HTML and the browser would mangle/hoist it.
  // Use a keyboard-accessible click target instead: stop the click from
  // bubbling to the outer anchor (which would navigate to the post) and
  // navigate to the profile ourselves.
  function goToProfile(e: MouseEvent | KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (authorId) window.location.href = `/nachbarn/id/${authorId}`;
  }
  function onNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      goToProfile(e);
    }
  }

  const isAnnouncement = $derived(kind === 'announcement');
  const isRecommendation = $derived(kind === 'recommendation');
  // The "ink card" treatment (dark bg + paper text + teal print shadow)
  // is reserved for OFFICIAL admin announcements. Community
  // announcements share the regular paper-warm look — only the teal
  // strap above the card differentiates them from discussions.
  const isInkCard = $derived(isAnnouncement && isOfficial);

  const cardBgClass = $derived(isInkCard ? 'bg-ink' : 'bg-paper-warm');
  // Border colour matches the kind-accent — teal for announcements
  // (official + community), moss for recommendations, wine for
  // discussions (matches PostTypeChip's discussion accent). Uniform
  // 1.5px thickness; discussions skip the print shadow so they stay
  // visually quieter than the louder kinds (the "calm baseline").
  const cardBorderClass = $derived(
    isAnnouncement ? 'border-[1.5px] border-teal'
    : isRecommendation ? 'border-[1.5px] border-moss'
    : 'border border-wine'
  );
  // Print shadow per kind: announcements (official + community) carry
  // the teal riso stamp — that's the kind identity, not the official-
  // vs-community distinction. Recommendations get moss. Topics stay
  // flat (the quiet kind). Same 2px offset across kinds for consistent
  // visual weight; the colour signals the kind, not the thickness.
  const cardShadowClass = $derived(
    isAnnouncement
      ? 'shadow-[2px_2px_0_var(--k-teal)]'
    : isRecommendation
      ? 'shadow-[2px_2px_0_var(--k-moss)]'
    : ''
  );

  const strapBgClass = $derived(
    isAnnouncement ? 'bg-teal' : isRecommendation ? 'bg-moss' : ''
  );
  const strapLabel = $derived(
    isAnnouncement && isOfficial ? $t['pinned.banner.label']
    : isAnnouncement ? $t['card.strap.announcement']
    : isRecommendation ? $t['card.strap.recommendation']
    : ''
  );

  // Tone helpers — only the ink (official) card flips text to paper.
  // Community announcements + recommendations keep ink text on paper.
  const titleColor = $derived(isInkCard ? 'text-paper' : 'text-ink');
  const authorColor = $derived(isInkCard ? 'text-paper' : 'text-ink');
  const bodyToneClass = $derived(
    isInkCard ? 'text-paper/80'
    : isRecommendation ? 'text-ink-soft italic'
    : 'text-ink-soft'
  );
  const bodyFontClass = $derived(
    isRecommendation ? 'font-instrument' : 'font-bricolage'
  );
  const metaColor = $derived(isInkCard ? 'text-paper/55' : 'text-ink-mute');
  const metaBorderColor = $derived(isInkCard ? 'border-paper/25' : 'border-rule');
  const tagColor = $derived(isInkCard ? 'text-paper/70' : 'text-ink-mute');

  // German short relative-time. EN strings come in Phase 4b/5b once
  // the design source's English variants are locked in.
  const relTime = (iso?: string) => relTimeFor(iso, $locale);

  const body = $derived(shortenUrlsInText((topic.body ?? topic.description ?? '').trim()));
  const commentCount = $derived(topic.comments?.length ?? 0);
  const likeCount = $derived(topic.likes ?? 0);
  const savedCount = $derived(topic.savedCount ?? 0);
  const tags = $derived(topic.tags ?? []);
  const heroImage = $derived(
    topic.images?.[0]?.url ? optimizeCloudinary(topic.images[0].url) : null
  );

  // StatusBadge: explicit override wins, else infer from moderation flags.
  // Precedence: rejected > (pending && reported) > pending > warning.
  // The reported case takes priority over generic pending so non-authors
  // viewing a community-reported post see "⚑ GEMELDET" — the small mark
  // says what kind of review is happening, more informative than the
  // generic "in prüfung". A formerly-reported but now-approved post
  // intentionally drops the chip (the report is resolved).
  const inferredBadge = $derived(
    topic.moderationStatus === 'rejected' ? 'rejected'
    : topic.isUserReported && topic.moderationStatus === 'pending' ? 'reported'
    : topic.moderationStatus === 'pending' ? 'pending'
    : topic.hasWarningLabel ? 'warning'
    : null
  );
  const badgeState = $derived(statusBadgeOverride ?? inferredBadge);

  const opacityClass = $derived(
    ghosted ? 'opacity-45' : optimistic ? 'opacity-[0.78]' : 'opacity-100'
  );

  const padding = $derived(featured ? 'px-6 py-5' : 'px-5 py-4');
  const titleSize = $derived(
    featured ? 'text-2xl md:text-[28px]' : 'text-[16.5px] md:text-[17px]'
  );
  const bodySize = $derived(featured ? 'text-[14px]' : 'text-[12.5px]');
  const imageHeight = $derived(
    featured ? 'h-[180px] md:h-[220px]' : 'h-[100px] md:h-[140px]'
  );
</script>

<article
  class={`${cardBgClass} ${cardBorderClass} ${cardShadowClass} ${opacityClass} h-full flex flex-col overflow-hidden transition-all duration-[180ms] ease-out ${
    attached ? 'rounded-b-lg border-t-0' : 'rounded-lg hover:-translate-x-px hover:-translate-y-px'
  } ${featured || slotFill ? '' : 'min-h-[340px]'}`}
>
  {#if strapLabel && !attached}
    <!-- Editorial strap (announcement + recommendation) -->
    <div
      class={`${strapBgClass} text-paper border-b border-ink flex items-center justify-between gap-3 px-3.5 py-1`}
    >
      <span class="font-dmmono text-[9.5px] uppercase font-semibold tracking-[0.12em]">
        {strapLabel}
      </span>
      {#if pinned && isAnnouncement}
        <span
          class="font-dmmono text-[9.5px] uppercase font-semibold tracking-[0.12em] flex items-center gap-1"
        >
          <span aria-hidden="true">📌</span> {$t['pinned.banner.tag']}
        </span>
      {/if}
    </div>
  {/if}

  <div class={padding}>
    <!-- Top row: author byline (left) · type chip / status badge (right) -->
    <div class="flex items-start justify-between gap-3 mb-2.5">
      <div class="flex items-center gap-2 min-w-0">
        <KioskAvatar
          name={topic.author?.name ?? '·'}
          image={topic.author?.image ?? null}
          size="sm"
        />
        <div class="min-w-0 leading-tight">
          <div class={`flex items-center gap-1.5 text-[12.5px] font-bold ${authorColor}`}>
            {#if authorId}
              <span
                class="truncate hover:underline underline-offset-2 cursor-pointer"
                role="link"
                tabindex="0"
                aria-label={viewProfileLabel}
                onclick={goToProfile}
                onkeydown={onNameKeydown}
              >{authorName}</span>
            {:else}
              <span class="truncate">{authorName}</span>
            {/if}
            {#if team}
              <span
                class={`shrink-0 font-dmmono text-[8.5px] font-semibold uppercase tracking-[0.08em] px-1.5 py-px rounded-sm border ${
                  isInkCard
                    ? 'bg-ochre text-ink border-ochre'
                    : 'bg-ink text-paper border-ink'
                }`}
              >
                {$t['role.team']}
              </span>
            {/if}
          </div>
          <div class={`font-dmmono text-[9.5px] tracking-[0.05em] ${metaColor}`}>
            {relTime(topic.date)}
          </div>
        </div>
      </div>

      <!-- Right cluster: stacks vertically (kind chip on top, status badge
           below) so a 1/3-width slot can carry both without crowding the
           author byline. When only one is present, the column collapses
           to a single item and reads identically to the older single-row
           layout. Order matches the visual hierarchy: kind first, state
           below as a modifier. -->
      <div class="flex flex-col items-end gap-1.5 shrink-0">
        {#if !strapLabel}
          <!-- Card kind-chip — direct port of the design HTML
               (Mahalle Redesign.html). Filled with the kind color
               (wine for discussion, teal for announcement, moss for
               recommendation) + paper text + small DM Mono caps.
               Distinct from PostTypeChip — that component is the
               outlined PILL used in the filter rail and does double
               duty there. -->
          {@const chipBg = kind === 'announcement'
            ? 'bg-teal'
            : kind === 'recommendation'
            ? 'bg-moss'
            : 'bg-wine'}
          {@const chipLabel = ($t[`chip.${kind}` as const] as string).toUpperCase()}
          <span
            class={`inline-flex items-center font-dmmono font-medium text-[10px] tracking-[0.08em] text-paper border border-ink rounded-lg px-[9px] py-[3px] ${chipBg}`}
          >
            {chipLabel}
          </span>
        {/if}
        {#if badgeState}
          <StatusBadge state={badgeState} size="sm" />
        {/if}
      </div>
    </div>

    {#if heroImage}
      <div class={`relative mb-3 rounded-md border-[1.5px] border-ink overflow-hidden ${imageHeight}`}>
        <img
          src={heroImage}
          alt={topic.title}
          class="w-full h-full object-cover"
          loading="lazy"
        />
        <!-- riso scanlines on top of the photo, very subtle -->
        <div
          class="pointer-events-none absolute inset-0"
          style="background: repeating-linear-gradient(0deg, transparent 0 4px, rgba(0,0,0,0.04) 4px 5px);"
          aria-hidden="true"
        ></div>
      </div>
    {/if}

    <h3
      class={`font-bricolage font-extrabold tracking-tight leading-[1.18] mb-2 text-balance ${titleColor} ${titleSize}`}
    >
      {topic.title}
    </h3>

    {#if body}
      <p class={`${bodyFontClass} ${bodyToneClass} leading-[1.5] mb-3.5 line-clamp-3 ${bodySize}`}>
        {body}
      </p>
    {/if}

    {#if tags.length}
      <div class={`flex gap-2 flex-wrap font-dmmono text-[10px] mb-2.5 ${tagColor}`}>
        {#each tags as tg (tg)}
          <span>#{tg}</span>
        {/each}
      </div>
    {/if}

    <div
      class={`flex items-center justify-between font-dmmono text-[11px] pt-2.5 border-t border-dashed ${metaBorderColor} ${metaColor}`}
    >
      <span class="flex items-center gap-3">
        <span class="flex items-center gap-1" aria-label="Likes">
          <span aria-hidden="true">♥</span> {likeCount}
        </span>
        <span class="flex items-center gap-1" aria-label="Antworten">
          <span aria-hidden="true">💬</span> {commentCount}
        </span>
        <span
          class={`flex items-center gap-1 ${bookmarked ? 'text-ochre' : ''}`}
          aria-label={$t['card.saved']}
        >
          <span aria-hidden="true">🔖</span> {savedCount}
        </span>
      </span>
      {#if readHref}
        <a
          href={readHref}
          class="flex items-center gap-1 min-h-[44px] -my-3 px-2 -mr-2 rounded focus:outline-none focus:ring-2 focus:ring-paper hover:underline underline-offset-2"
        >→ {$t['card.cta.read']}</a>
      {:else}
        <span class="flex items-center gap-1">→ {$t['card.cta.read']}</span>
      {/if}
    </div>
  </div>
</article>
