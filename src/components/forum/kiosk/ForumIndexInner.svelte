<script module lang="ts">
  // Identifies THIS document. `<script module>` runs exactly once per
  // module load (shared by every instance), unlike the instance `<script>`
  // below which re-runs on each mount — so this survives client-routed
  // (ViewTransitions) swaps that unmount/remount the island, and the token
  // matches on a browser-back within the same document while differing
  // after any hard load — a reload or a `location.href` navigation loads a
  // fresh module and must not inherit the previous document's scroll
  // position. (Was mistakenly placed in the instance script first — that
  // re-executes on every mount, which defeated the whole point; caught via
  // the probe's scrollAfterBack regressing to 0.)
  const DOC_TOKEN = Math.random().toString(36).slice(2);
</script>

<script lang="ts">
  // Forum index inner — Phase 4a, loaded state.
  //
  // Layout (per kiosk-forum.jsx KioskForumDesktop):
  //   1. Header section (paper bg, dashed bottom rule)
  //      datetime crumb · h1 with italic serif accent · CTA top-right
  //      stats row underneath
  //   2. Filter rail (paper bg) — TagBar
  //   3. Card grid — featured pinned post first (col-span-3), then regular
  //      cards in 1/2/3-column grid.
  //
  // The synthetic Mahalle-Team welcome post is hardcoded as a featured
  // announcement card with `pinned: true` so the design's `📌 ANGEHEFTET`
  // marker shows in the strap. Phase 5 reads a real `pinned` boolean +
  // admin role from the database.

  import { tick, onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { showToast } from '../../../utils/toast';
  import { createQuery } from '@tanstack/svelte-query';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import { relTime } from '../../../lib/relTime';
  import { parseIndexState, serializeIndexState } from '../../../lib/forum/indexUrlState';
  import { shortDayMonth } from '../../../lib/forum/dateline';
  import { online } from '../../../lib/onlineStore';
  import { MAX_PINS } from '../../../lib/announcements/pinRules';
  import ForumPostCard from './ForumPostCard.svelte';
  import TagBar, { type Filter } from './TagBar.svelte';
  import { pinStackMode } from '../../../lib/forum/mobileChrome';
  import ForumIndexSkeleton from './states/ForumIndexSkeleton.svelte';
  import EmptyFilterPanel from './states/EmptyFilterPanel.svelte';
  import EmptyZeroPanel from './states/EmptyZeroPanel.svelte';
  import ErrorPanel from './states/ErrorPanel.svelte';
  import OfflineBanner from './states/OfflineBanner.svelte';
  import OwnStatusBanner from './states/OwnStatusBanner.svelte';
  import FeedStatusFooter from './states/FeedStatusFooter.svelte';

  let { initialItems = [], currentUserId = null } = $props<{
    initialItems?: any[];
    currentUserId?: string | null;
  }>();

  // Flash toast from the compose flow (?just_posted=1) — the compose page
  // navigates here immediately, so its own toast never renders; we show it on
  // arrival and strip the param (newsboard just_submitted / marketplace pattern).
  // Saved-post ids for the card's 🔖 mark — the feed items don't carry
  // per-viewer state, so fetch the viewer's list once (same GET the detail
  // page uses). Without this every card read as unsaved (user, 2026-09-10).
  let savedIds = $state<Set<string>>(new Set());

  onMount(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('just_posted') === '1') {
      showToast($t['forum.compose.success'], { type: 'success' });
      url.searchParams.delete('just_posted');
      // Keep Astro's ClientRouter state ({ index, scrollX, scrollY }) intact.
      window.history.replaceState(window.history.state, '', url.toString());
    }

    // Scroll restore across browser back. Astro's router scrolls to the
    // saved position right after the swap — while this client:only island
    // is still empty, so the page is too short and the attempt clamps to
    // ~0 (and its scrollend bookkeeping then overwrites history.state with
    // that 0). So we keep our own snapshot: written when the page is left,
    // honoured only when we come back to the SAME history entry and URL —
    // AND the same document (DOC_TOKEN, see its module-scope declaration
    // above). Without the token, a hard load (e.g. compose's
    // `location.href = '/forum?just_posted=1'` after publish/cancel) is a
    // fresh document whose `history.state.index` is ALSO 0, which would
    // otherwise false-positive match a stale snapshot from the page the
    // member scrolled on before navigating away — restoring scroll onto a
    // different list. A hard reload/nav therefore never restores scroll
    // (accepted: only a same-document browser-back does).
    //
    // window.top !== window.self guard (dev-only bug, found live 2026-09-12):
    // Astro's dev server preloads a `client:only` destination page in a
    // HIDDEN IFRAME before swapping (`prepareForClientOnlyComponents`,
    // astro/dist/transitions/router.js — DEV ONLY, absent from prod
    // builds). That iframe is same-origin, so it shares sessionStorage; it
    // mounts a SECOND ForumIndexInner whose historyIndex() also reads 0 (a
    // fresh top-level load), which spuriously matches our stored index and
    // lets the iframe consume + immediately overwrite (with its own y:0)
    // the real snapshot before the real page ever mounts. Skipping the
    // whole snapshot/restore dance inside any iframe sidesteps it — this
    // island never legitimately runs framed in production.
    let cleanupScroll: (() => void) | undefined;
    if (window.top === window.self) {
      const SCROLL_KEY = 'forum-index-scroll';
      const historyIndex = (): number | null =>
        (window.history.state as { index?: number } | null)?.index ?? null;
      const snapshot = () => {
        try {
          sessionStorage.setItem(
            SCROLL_KEY,
            JSON.stringify({
              token: DOC_TOKEN,
              index: historyIndex(),
              href: window.location.href,
              y: window.scrollY
            })
          );
        } catch { /* storage unavailable — no restore, nothing else breaks */ }
      };
      try {
        const raw = sessionStorage.getItem(SCROLL_KEY);
        sessionStorage.removeItem(SCROLL_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as {
            token?: string;
            index: number | null;
            href: string;
            y: number;
          };
          const samePath = new URL(saved.href, window.location.href).pathname === window.location.pathname;
          if (saved.token === DOC_TOKEN && saved.index === historyIndex() && samePath && saved.y > 0) {
            tick().then(() => window.scrollTo({ top: saved.y, behavior: 'instant' as ScrollBehavior }));
          }
        }
      } catch { /* malformed or unavailable — ignore */ }
      // astro:before-preparation fires at the start of every client-routed
      // navigation (ViewTransitions); pagehide covers hard navigations,
      // reloads and tab discards.
      document.addEventListener('astro:before-preparation', snapshot);
      window.addEventListener('pagehide', snapshot);
      cleanupScroll = () => {
        document.removeEventListener('astro:before-preparation', snapshot);
        window.removeEventListener('pagehide', snapshot);
      };
    }
    if (currentUserId) {
      fetch('/api/posts/save')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (Array.isArray(data?.savedIds)) savedIds = new Set(data.savedIds.map(String));
        })
        .catch(() => {});
    }
    return cleanupScroll;
  });

  const query = createQuery(() => ({
    queryKey: ['forum', 'all'],
    queryFn: async () => {
      const fields =
        '_id,title,body,description,author,tags,images,comments,date,likes,likedBy,views,moderationStatus,isUserReported,hasWarningLabel';
      const url = (type: string) =>
        `/api/${type}?fields=${fields}&sortBy=date&sortOrder=desc`;
      // allSettled mirrors the SSR resilience: a failed collection
      // shouldn't blank the whole feed. Each handler catches
      // network/parse errors so partial responses still render. We
      // track per-fetch success and throw if NONE succeed — that's the
      // "all-three-broken" failure mode that should trigger the
      // ErrorPanel (offline state is handled separately by the
      // navigator.onLine store + OfflineBanner).
      let okCount = 0;
      const safe = (p: Promise<Response>) =>
        p
          .then((res) => {
            if (res.ok) {
              okCount++;
              return res.json();
            }
            return { items: [] };
          })
          .catch(() => ({ items: [] }));
      const [tRes, aRes, rRes] = await Promise.allSettled([
        safe(fetch(url('topics'))),
        safe(fetch(url('announcements'))),
        safe(fetch(url('recommendations'))),
      ]);
      if (okCount === 0) {
        // All three endpoints failed — backend deploy gone wrong, DB
        // outage, etc. Throw so query.isError flips and ErrorPanel
        // renders with its functional "↻ neu laden" button.
        throw new Error('forum-fetch-failed');
      }
      const t = tRes.status === 'fulfilled' ? tRes.value : { items: [] };
      const a = aRes.status === 'fulfilled' ? aRes.value : { items: [] };
      const r = rRes.status === 'fulfilled' ? rRes.value : { items: [] };
      const decorate = (arr: any[], kind: string) =>
        (arr ?? []).map((it: any) => ({ ...it, kind }));
      const merged = [
        ...decorate(t.items ?? t, 'discussion'),
        ...decorate(a.items ?? a, 'announcement'),
        ...decorate(r.items ?? r, 'recommendation'),
      ];
      merged.sort(
        (x: any, y: any) =>
          +new Date(y.date ?? 0) - +new Date(x.date ?? 0)
      );
      return merged;
    },
    initialData: initialItems,
    initialDataUpdatedAt: Date.now()
  }));

  const items = $derived((query.data ?? []) as any[]);

  // Pinned official announcements — up to MAX_PINS, newest pin first
  // (server enforces the cap; see src/lib/announcements/pin.ts). After a
  // pin's 7-day pinnedUntil expires the card slips into the regular feed.
  const pinnedOfficials = $derived(
    items
      .filter(
        (it: any) =>
          it.kind === 'announcement' &&
          it.isOfficial === true &&
          it.pinnedUntil &&
          new Date(it.pinnedUntil).getTime() > Date.now()
      )
      .sort((a: any, b: any) => new Date(b.pinnedUntil).getTime() - new Date(a.pinnedUntil).getTime())
      .slice(0, MAX_PINS)
  );
  const pinnedIds = $derived(new Set(pinnedOfficials.map((it: any) => it._id)));

  // Pin accordion (v3, 2026-09-12 — supersedes the 08-25 "newest pin
  // expanded" v2): pins keep their newest-first positions and ALL start
  // collapsed as slim bars. Clicking a bar opens its card beneath the
  // bar (slide) and collapses any other open one; clicking the open bar
  // again collapses it. The card itself is not a link — only its
  // "→ read" CTA navigates. Pure per-visit VIEW state: never persisted,
  // never reordered.
  let expandedPinId = $state<string | null>(null);

  // Slide duration for the row swap — 0 under prefers-reduced-motion
  // (instant, no animation). Island is client:only, but guard anyway.
  const pinSlideMs =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : 180;

  function togglePin(id: string) {
    expandedPinId = expandedPinId === id ? null : id;
  }

  // Phones (< md), 2026-09-20: two or three pins start as ONE summary bar
  // ("newest title +2 ▾"); a tap unfolds the usual bars, "einklappen" folds
  // them again. From md up the bars always show (CSS) and this state has no
  // effect. Per-visit view state, like expandedPinId — never persisted.
  let pinsUnfolded = $state(false);
  const pinMode = $derived(pinStackMode(pinnedOfficials.length, pinsUnfolded));
  // The tapped button leaves the DOM on both switches — hand the focus on,
  // or keyboard and screen-reader users are dropped back to <body>.
  async function unfoldPins() {
    pinsUnfolded = true;
    await tick();
    document.querySelector<HTMLElement>('#forum-pin-stack button')?.focus();
  }
  async function foldPins() {
    pinsUnfolded = false;
    expandedPinId = null; // a card must not stay open inside a hidden stack
    await tick();
    document.querySelector<HTMLElement>('[data-pin-summary]')?.focus();
  }

  // Relative time for the slim pin bars — shared helper (src/lib/relTime.ts).
  const pinBarTime = (d?: string | number) => relTime(d, $locale);

  // Filter state — Phase 4a applies tag filters locally only; type/saved/mine
  // filters toggle the active pill but don't reshape the data yet.
  // View state lives in the URL (?kind=&tag=&more=) so browser back from a
  // post restores the same feed (parked since the 09-09 mobile audit).
  // client:only island → window exists at init; the guard keeps the
  // SSR-compile path harmless.
  const initialUrlState = parseIndexState(
    typeof window !== 'undefined' ? window.location.search : ''
  );
  let activeFilter = $state<Filter>(initialUrlState.kind);
  let activeTag = $state<string | null>(initialUrlState.tag);

  // Filter ladder:
  //   1. kind filter (discussion / announcement / recommendation) when
  //      activeFilter is one of those — direct match against `it.kind`
  //      (the SSR fetch + client query both decorate items with kind).
  //   2. 'mine' filter → author-owned posts only (uses currentUserId).
  //   3. 'saved' is route-handled by handleFilterChange (navigates to
  //      /bookmarks) — never reaches this filter.
  //   4. tag filter (if any tag pill is active).
  const filteredRest = $derived(
    items
      // Pinned officials render separately at the top; exclude from
      // the regular feed so they don't appear twice.
      .filter((it: any) => !pinnedIds.has(it._id))
      .filter((it: any) => {
        if (activeFilter === 'all') return true;
        if (activeFilter === 'mine')
          return authorIdOf(it.author) === currentUserId;
        return it.kind === activeFilter;
      })
      .filter((it: any) =>
        !activeTag ? true : (it.tags ?? []).includes(activeTag)
      )
      // Promote the author's own rejected posts to the top of the
      // feed (just under the pinned official slot). They're the
      // highest-priority "you need to act" signal — author should see
      // them immediately without scrolling. Stable sort: items at the
      // same priority preserve their date-desc order.
      .slice()
      .sort((a: any, b: any) => {
        const aRej = ownStatusFor(a) === 'rejected' ? 0 : 1;
        const bRej = ownStatusFor(b) === 'rejected' ? 0 : 1;
        return aRej - bRej;
      })
  );

  // Client-side pagination — the feed query returns everything; the footer's
  // "MEHR LADEN ↓" reveals a page at a time (wired 2026-09-05, replacing the
  // inert span). Pins/featured render separately, so only filteredRest pages.
  const PAGE_SIZE = 12;
  let visibleCount = $state(PAGE_SIZE * initialUrlState.pages);
  const visibleRest = $derived(filteredRest.slice(0, visibleCount));
  const feedHasMore = $derived(filteredRest.length > visibleCount);
  const pageCount = $derived(Math.max(1, Math.ceil(filteredRest.length / PAGE_SIZE)));
  const currentPage = $derived(
    Math.min(pageCount, Math.max(1, Math.ceil(visibleCount / PAGE_SIZE)))
  );
  function loadMore() {
    visibleCount += PAGE_SIZE;
  }
  // Reset to the first page whenever the active filter or tag CHANGES —
  // compared against the last seen pair, so the first run (which may
  // carry ?more=N from the URL) doesn't reset anything.
  let lastFilterKey = `${activeFilter}|${activeTag ?? ''}`;
  $effect(() => {
    const key = `${activeFilter}|${activeTag ?? ''}`;
    if (key === lastFilterKey) return;
    lastFilterKey = key;
    visibleCount = PAGE_SIZE;
  });

  // Mirror the view state into the URL. replaceState, not pushState: the
  // back button leaves the forum, it doesn't step through filter clicks.
  // history.state is passed through unchanged — Astro's ClientRouter keeps
  // { index, scrollX, scrollY } there and loses its place if it's wiped.
  $effect(() => {
    if (typeof window === 'undefined') return;
    const kind = activeFilter === 'saved' ? 'all' : activeFilter;
    const next = serializeIndexState(
      { kind, tag: activeTag, pages: Math.max(1, Math.ceil(visibleCount / PAGE_SIZE)) },
      window.location.href
    );
    if (next !== window.location.href) window.history.replaceState(window.history.state, '', next);
  });

  function topTags(input: any[], n = 6): string[] {
    const counts = new Map<string, number>();
    for (const it of input) {
      for (const tag of it.tags ?? []) {
        if (!tag) continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([tag]) => tag);
  }
  // A URL-restored activeTag outside the top 6 by-count still needs a
  // pressed pill to render (so it's visible AND toggleable) — append it
  // when it isn't already in the top-6 list.
  const tags = $derived.by(() => {
    const base = topTags(items);
    return activeTag && !base.includes(activeTag) ? [...base, activeTag] : base;
  });

  // Stats: total / new since yesterday / discussed today (a visible reply in
  // the last 24h — `lastCommentAt` is stamped server-side by
  // attachLastCommentAt(); the feed's `comments` field is only ids). Was an
  // always-0 "active now" stub until 2026-09-11.
  const stats = $derived.by(() => {
    const now = Date.now();
    const yesterday = now - 24 * 60 * 60 * 1000;
    const total = items.length;
    let newSinceYesterday = 0;
    let discussedToday = 0;
    for (const it of items) {
      const d = it.date ? new Date(it.date).getTime() : 0;
      if (d > yesterday) newSinceYesterday++;
      if (typeof it.lastCommentAt === 'number' && it.lastCommentAt > yesterday) discussedToday++;
    }
    return { total, newSinceYesterday, discussedToday };
  });

  let now = $state(new Date());
  $effect(() => {
    const id = setInterval(() => (now = new Date()), 60_000);
    return () => clearInterval(id);
  });

  const dayOfWeek = $derived(
    now.toLocaleDateString($locale === 'de' ? 'de-DE' : 'en-GB', { weekday: 'long' })
  );
  const dayMonth = $derived(
    now.toLocaleDateString($locale === 'de' ? 'de-DE' : 'en-GB', { day: '2-digit', month: 'long' })
  );
  const hhmm = $derived(
    now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  );
  // Below 410 px the kicker uses the short month — the full dateline wrapped to
  // two lines on 360–390 px phones and pushed the heading down (2026-09-19).
  const dayMonthShort = $derived(shortDayMonth(now, $locale === 'de' ? 'de' : 'en'));

  function handleFilterChange(f: Filter) {
    // 'saved' routes to the dedicated /bookmarks page rather than
    // duplicating savedPosts join logic in-page.
    if (f === 'saved') {
      if (typeof window !== 'undefined') window.location.href = '/bookmarks';
      return;
    }
    activeFilter = f;
  }
  function handleTagChange(tag: string | null) {
    activeTag = tag;
  }
  function clearFilters() {
    activeFilter = 'all';
    activeTag = null;
  }

  // ─── Phase 4b · state-matrix helpers ────────────────────────────────
  // Per-kind detail route. Each forum sub-collection has its own
  // [id].astro page so edits/deletes/comments hit the right
  // /api/{collection}/* endpoints. Falls back to /topics for any
  // legacy item without a kind decoration.
  function detailHref(item: any): string {
    if (item.kind === 'announcement') return `/announcements/${item._id}`;
    if (item.kind === 'recommendation') return `/recommendations/${item._id}`;
    return `/topics/${item._id}`;
  }

  // Author-id extractor — schema returns either a string (raw _id) or a
  // populated `{ _id }` object depending on the SSR path.
  function authorIdOf(v: any): string | null {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v._id) return String(v._id);
    return null;
  }

  type OwnStatus = 'pending' | 'rejected' | 'reported' | null;

  // Author-facing moderation state. Mirrors the i18n `state.own.*`
  // namespace + the OwnStatusBanner component, both of which are
  // explicitly author-only in intent. Non-authors never enter the
  // dashed-warn / dashed-plum special branches; their "this post is
  // under review" awareness comes from the small StatusBadge chip on
  // the card itself (see ForumPostCard's inferredBadge derive).
  function ownStatusFor(topic: any): OwnStatus {
    const isAuthor =
      currentUserId && authorIdOf(topic.author) === currentUserId;
    if (!isAuthor) return null;
    if (topic.moderationStatus === 'rejected') return 'rejected';
    if (topic.moderationStatus === 'pending' && topic.isUserReported) {
      return 'reported';
    }
    if (topic.moderationStatus === 'pending') return 'pending';
    return null;
  }

  // Localised label for the active filter (kind tab OR tag pill).
  // Keys here mirror the `filter.*` namespace in kiosk-i18n.ts.
  const KIND_LABELS_KEY = {
    discussion: 'filter.discussion',
    announcement: 'filter.announcement',
    recommendation: 'filter.recommendation',
    saved: 'filter.saved',
    mine: 'filter.mine'
  } as const;
  const filterLabel = $derived(
    activeTag
      ? `#${activeTag}`
      : activeFilter !== 'all'
      ? ($t as any)[KIND_LABELS_KEY[activeFilter as Exclude<Filter, 'all'>]]
      : ''
  );
  const FALLBACK_RELATED = ['familie', 'spielplatz', 'schule', 'betreuung'];
  const relatedTags = $derived(
    items.length > 0
      ? topTags(items, 5)
          .filter((tag) => tag !== activeTag)
          .slice(0, 4)
      : FALLBACK_RELATED
  );

  // Branching predicates (state precedence: error > loading > empty > grid).
  const showError = $derived(query.isError);
  const showSkeleton = $derived(!showError && query.isPending && !items.length);
  const showEmptyFilter = $derived(
    !showError &&
      !showSkeleton &&
      filteredRest.length === 0 &&
      (activeTag !== null || activeFilter !== 'all')
  );
  const showEmptyZero = $derived(
    !showError &&
      !showSkeleton &&
      !showEmptyFilter &&
      items.length === 0
  );
  const showGrid = $derived(!showError && !showSkeleton && !showEmptyFilter && !showEmptyZero);

  // Footer "letzter Post vor …": newest item date across the whole feed
  // (unfiltered). Was a hardcoded 28-minute prototype default until
  // 2026-09-11 — the user spotted "28 min ago" never changing.
  const lastPostAgo = $derived.by(() => {
    let newest = 0;
    for (const it of items) {
      const ts = new Date(it.date).getTime();
      if (!Number.isNaN(ts) && ts > newest) newest = ts;
    }
    return newest ? relTime(newest, $locale) : '';
  });

  // Cached-minutes for OfflineBanner — null when no data has loaded yet.
  const cachedMinutes = $derived(
    query.dataUpdatedAt
      ? Math.max(0, Math.floor((Date.now() - query.dataUpdatedAt) / 60_000))
      : null
  );

  // ─── Just-posted detection ──────────────────────────────────────────
  // When a user just submitted a new topic from /topics/create and got
  // navigated back to /, the SSR fetch returns their post at the top.
  // We detect that by date (within last ~6 s) + author, and surface it
  // with a slide-in animation + live footer mode for a brief window.
  // No URL param needed — the 6 s wall-clock window naturally covers
  // the full-page-reload navigation.
  const LIVE_MS = 6000;
  let pageMountedAt = $state(Date.now());
  let liveTick = $state(0);
  $effect(() => {
    // Re-evaluate the live window every second so the badge clears.
    const id = setInterval(() => (liveTick = Date.now()), 1000);
    return () => clearInterval(id);
  });
  function isJustPosted(topic: any): boolean {
    if (!currentUserId) return false;
    if (authorIdOf(topic.author) !== currentUserId) return false;
    if (!topic.date) return false;
    const age = liveTick - new Date(topic.date).getTime();
    return age >= 0 && age < LIVE_MS;
  }
  const hasJustPosted = $derived(filteredRest.some((tt: any) => isJustPosted(tt)));

  // Footer mode follows the same precedence as the grid branches.
  // 'live' wins over 'fresh' when a just-posted card is in the feed.
  const footerMode = $derived(
    !$online
      ? 'offline'
      : query.isFetching || query.isPending
      ? 'loading'
      : hasJustPosted
      ? 'live'
      : 'fresh'
  );
</script>

<!-- pt-5 md:pt-6 matches the kicker rhythm of calendar/news/market (20/24px under the masthead rule; user, 2026-09-10) — was py-8 md:py-10. -->
<main class="max-w-7xl mx-auto px-4 md:px-9 lg:px-10 pt-5 md:pt-6 pb-8 md:pb-10">
  <!-- ── Header section ─────────────────────────────────────────── -->
  <section class="mb-5 pb-4 border-b border-dashed border-rule">
    <p class="font-dmmono text-[11px] uppercase tracking-[0.18em] text-wine mb-2">
      FORUM · {dayOfWeek.toUpperCase()} <span class="min-[410px]:hidden">{dayMonthShort.toUpperCase()}</span><span class="hidden min-[410px]:inline">{dayMonth.toUpperCase()}</span> · {hhmm}
    </p>
    <div class="grid grid-cols-1 md:grid-cols-[1fr_auto] md:items-end gap-4">
      <!-- 34px below 380px: at 36px „Was reden wir heute?" is 4px wider than a 360px phone allows and wrapped
           to a second line (2026-09-19). The calendar's mobile hero uses the same two sizes — keep them in step. -->
      <h1
        class="font-bricolage font-extrabold text-[34px] min-[380px]:text-4xl md:text-5xl lg:text-6xl tracking-tight leading-[0.95] text-ink"
      >
        {$t['forum.title.prefix']}
        <em class="font-instrument italic font-normal text-wine">{$t['forum.title.accent']}</em>
        {$t['forum.title.suffix']}
      </h1>
      <a
        href="/topics/create"
        data-tour="forum-new-topic"
        class="self-start md:self-auto inline-flex items-center gap-2 px-5 py-2 rounded-full bg-ink text-paper font-bricolage font-medium text-sm border-2 border-ink shadow-[2px_2px_0_var(--k-wine)] hover:shadow-[3px_3px_0_var(--k-wine)] hover:-translate-x-px hover:-translate-y-px active:translate-x-px active:translate-y-px transition-all duration-[180ms] ease-out shrink-0"
      >
        {$t['forum.cta.newTopic']}
      </a>
    </div>
    <div
      class="flex flex-wrap items-baseline gap-x-2.5 md:gap-x-5 gap-y-1 mt-3 font-dmmono text-[10px] md:text-[11px] text-ink-mute [&>span]:whitespace-nowrap"
    >
      <span><span class="font-bold text-ink">{stats.total}</span> {$t['forum.stats.topics']}</span>
      <span
        ><span class="font-bold text-ink">{stats.newSinceYesterday}</span>
        {$t['forum.stats.new']}</span
      >
      <span
        ><span class="font-bold text-ink">{stats.discussedToday}</span> {$t['forum.stats.discussed']}</span
      >
    </div>
  </section>

  <!-- ── Filter rail (paper bg) ─────────────────────────────────── -->
  <div class="mb-5">
    <TagBar
      tone="paper"
      {activeFilter}
      {activeTag}
      {tags}
      onFilterChange={handleFilterChange}
      onTagChange={handleTagChange}
    />
  </div>

  <!-- ── State branch ladder ────────────────────────────────────────
       Precedence: error > skeleton > empty-filter > empty-zero > grid.
       Header + filter rail above stay visible on every branch so the
       user can still clear a bad filter or reach for a retry.        -->

  {#if showError}
    <ErrorPanel onReload={() => query.refetch()} />
  {:else if showSkeleton}
    <ForumIndexSkeleton />
  {:else if showEmptyFilter}
    <EmptyFilterPanel
      filterLabel={filterLabel}
      relatedTags={relatedTags}
      onClear={clearFilters}
    />
  {:else if showEmptyZero}
    <EmptyZeroPanel />
  {:else}
    <!-- ── Happy path · pinned + regular grid ──────────────────────── -->
    {#if !$online}
      <OfflineBanner cachedMinutes={cachedMinutes} />
    {/if}

    <div
      class={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 ${
        !$online ? 'k-grayscale-cached' : ''
      }`}
    >
      <!-- Pinned official announcements (real DB docs, up to MAX_PINS).
           Accordion v3 (2026-09-12): pins keep their newest-first order
           and all start as slim one-line bars, stacked tight (8px) in one
           full-width grid cell. Clicking a bar opens its card FUSED under
           it (bar loses bottom corners + shadow, card is `attached`: no
           strap, no top corners/border — one box) with transition:slide,
           collapsing any other open one; clicking the open bar again
           closes it. The card is NOT a link — only its "→ read" CTA
           (readHref) navigates. Hidden when the kind filter wouldn't
           include announcements. Phones (< md), 2026-09-20: with 2–3 pins
           the stack starts as ONE summary bar (data-pin-summary, "+n"); a
           tap unfolds these bars, "einklappen" folds them (pinMode /
           pinsUnfolded). -->
      {#if (activeFilter === 'all' || activeFilter === 'announcement') && pinnedOfficials.length}
        <div class="md:col-span-2 lg:col-span-3">
          {#if pinMode === 'folded'}
            <!-- Phones only: one bar for all pins. Same chrome and height as
                 a pin bar; the relative time gives way to the "+n" badge. -->
            <button
              type="button"
              data-pin-summary
              aria-expanded="false"
              aria-controls="forum-pin-stack"
              onclick={unfoldPins}
              class="md:hidden w-full text-left flex items-center gap-3 min-h-[36px] px-4 py-[5px] bg-ink text-paper border-[1.5px] border-teal rounded-lg shadow-[2px_2px_0_var(--k-teal)] focus:outline-none focus:ring-2 focus:ring-ink"
            >
              <span aria-hidden="true" class="text-[12px]">📌</span>
              <span class="shrink-0 font-dmmono text-[9px] uppercase tracking-[0.12em] text-[#7fc2ce]">{$t['pinned.bar.label']}</span>
              <span class="min-w-0 truncate font-bricolage text-[14px] font-bold tracking-[-0.01em]">{pinnedOfficials[0].title}</span>
              <span aria-hidden="true" class="ml-auto shrink-0 px-1.5 rounded-full border border-[#7fc2ce] font-dmmono text-[10px] leading-[16px] text-[#7fc2ce]">+{pinnedOfficials.length - 1}</span>
              <span class="sr-only">{($t['pinned.stack.more'] as string).replace('{n}', String(pinnedOfficials.length - 1))}</span>
              <span aria-hidden="true" class="shrink-0 text-[#7fc2ce] font-bold">▾</span>
            </button>
          {/if}
          <!-- 'hidden md:flex' must stay a literal string (Tailwind scan). -->
          <div id="forum-pin-stack" class={`flex-col gap-2 ${pinMode === 'folded' ? 'hidden md:flex' : 'flex'}`}>
          {#each pinnedOfficials as pin, i (pin._id)}
            {@const open = expandedPinId === pin._id}
            <!-- Phones, after a tap on the summary bar: bars 2 and 3 slide out
                 from under the first one (.pin-unfold-in in global.css — this
                 island is nested, a <style> block here would be orphaned). -->
            <div
              class={pinMode === 'unfolded' ? (i === 0 ? 'relative z-[1]' : 'pin-unfold-in') : ''}
              style={`--pin-i:${i}`}
            >
              <!-- #7fc2ce is deliberate: teal legible on ink (no on-ink teal
                   token exists — same reason the blog has --k-rust-on-ink).
                   Don't "fix" it to text-teal, which vanishes on the ink bg. -->
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`pin-card-${pin._id}`}
                onclick={() => togglePin(pin._id)}
                class={`w-full text-left flex items-center gap-3 min-h-[36px] md:min-h-[34px] px-4 py-[5px] md:py-[4px] bg-ink text-paper border-[1.5px] border-teal focus:outline-none focus:ring-2 focus:ring-ink transition-all duration-[180ms] ease-out ${
                  open ? 'rounded-t-lg' : 'rounded-lg shadow-[2px_2px_0_var(--k-teal)] hover:-translate-x-px hover:-translate-y-px'
                }`}
              >
                <span aria-hidden="true" class="text-[12px]">📌</span>
                <span class="shrink-0 font-dmmono text-[9px] uppercase tracking-[0.12em] text-[#7fc2ce]">{$t['pinned.bar.label']}</span>
                <span class="min-w-0 truncate font-bricolage text-[14px] font-bold tracking-[-0.01em]">{pin.title}</span>
                <span class="ml-auto shrink-0 font-dmmono text-[9.5px] text-paper/55">{pinBarTime(pin.date)}</span>
                <span aria-hidden="true" class="shrink-0 text-[#7fc2ce] font-bold">{open ? '▴' : '▾'}</span>
              </button>
              {#if open}
                <div id={`pin-card-${pin._id}`} transition:slide={{ duration: pinSlideMs }}>
                  <div>
                    <ForumPostCard
                      topic={pin}
                      kind="announcement"
                      featured
                      pinned
                      isOfficial
                      team={pin.author?.role === 'admin'}
                      bookmarked={savedIds.has(String(pin._id))}
                      readHref={detailHref(pin)}
                      attached
                    />
                  </div>
                </div>
              {/if}
            </div>
          {/each}
          </div>
          {#if pinMode === 'unfolded'}
            <button
              type="button"
              data-pin-fold
              aria-controls="forum-pin-stack"
              style={`--pin-i:${pinnedOfficials.length}`}
              onclick={foldPins}
              class="pin-unfold-in md:hidden mt-1 ml-auto flex items-center gap-1 min-h-[36px] px-2 font-dmmono text-[10px] uppercase tracking-[0.12em] text-ink-mute focus:outline-none focus:ring-2 focus:ring-ink rounded"
            ><span aria-hidden="true">▴</span> {$t['pinned.stack.collapse']}</button>
          {/if}
        </div>
      {/if}

      <!-- Regular feed. Per-topic moderation status drives placement:
             pending   → dashed-warn wrapper around banner + own card (one grid slot, AUTHOR ONLY)
             reported  → dashed-plum wrapper around banner + own card (one grid slot, AUTHOR ONLY)
             rejected  → dashed-danger wrapper around banner + ghosted card (one slot, AUTHOR ONLY)
             else      → normal grid card. Non-authors viewing
                         community-reported pending posts hit this branch
                         and see the post normally with a small ⚑ GEMELDET
                         chip via the card's inferredBadge derive — that's
                         the "subtle mark" treatment, no stigma.
           The three status wrappers are `h-full flex flex-col`: the compact
           banner takes its natural height and the card (slotFill → no 340px
           floor) flexes into the rest, so the cell fills one normal grid slot
           instead of stacking two full-height cards and inflating the row. -->
      {#each visibleRest as topic (topic._id)}
        {@const status = ownStatusFor(topic)}
        {@const justPosted = isJustPosted(topic)}
        {#if justPosted}
          <!-- ✓ DEIN POST celebration — full-width slide-in + green pill.
               Wins over the moderation status banner for the 6 s window
               after submit; falls through to the normal status branch
               once the celebration tick clears. -->
          <div
            class="md:col-span-2 lg:col-span-3 relative k-slide-in"
          >
            <span
              class="absolute -top-2 left-3 z-[2] px-2.5 py-0.5 rounded-full bg-success text-paper font-dmmono text-[9.5px] tracking-[0.1em] uppercase border border-ink"
            >
              {$t['feed.footer.live']}
            </span>
            <a
              href={detailHref(topic)}
              class="block focus:outline-none focus:ring-2 focus:ring-ink rounded-lg"
            >
              <ForumPostCard
                {topic}
                kind={topic.kind ?? 'discussion'}
                optimistic
                isOfficial={topic.isOfficial === true}
                team={topic.author?.role === 'admin'}
                bookmarked={savedIds.has(String(topic._id))}
                statusBadgeOverride={status === 'rejected' ? 'rejected' : 'pending'}
              />
            </a>
          </div>
        {:else if status === 'pending'}
          <div
            class="h-full flex flex-col p-1 rounded-lg border-2 border-dashed border-warn"
          >
            <div class="shrink-0 px-2 pt-1.5 pb-2">
              <OwnStatusBanner state="pending" compact />
            </div>
            <a
              href={detailHref(topic)}
              class="flex-1 block focus:outline-none focus:ring-2 focus:ring-ink rounded-lg"
            >
              <ForumPostCard
                {topic}
                kind={topic.kind ?? 'discussion'}
                optimistic
                isOfficial={topic.isOfficial === true}
                team={topic.author?.role === 'admin'}
                bookmarked={savedIds.has(String(topic._id))}
                statusBadgeOverride="pending"
                slotFill
              />
            </a>
          </div>
        {:else if status === 'rejected'}
          <div
            class="h-full flex flex-col p-1 rounded-lg border-2 border-dashed border-danger"
          >
            <div class="shrink-0 px-2 pt-1.5 pb-2">
              <OwnStatusBanner state="rejected" reason={topic.rejectionReason} compact />
            </div>
            <a
              href={detailHref(topic)}
              class="flex-1 block focus:outline-none focus:ring-2 focus:ring-ink rounded-lg"
            >
              <ForumPostCard
                {topic}
                kind={topic.kind ?? 'discussion'}
                ghosted
                isOfficial={topic.isOfficial === true}
                team={topic.author?.role === 'admin'}
                bookmarked={savedIds.has(String(topic._id))}
                statusBadgeOverride="rejected"
                slotFill
              />
            </a>
          </div>
        {:else if status === 'reported'}
          <div
            class="h-full flex flex-col p-1 rounded-lg border-2 border-dashed border-plum"
          >
            <div class="shrink-0 px-2 pt-1.5 pb-2">
              <OwnStatusBanner state="reported" compact />
            </div>
            <a
              href={detailHref(topic)}
              class="flex-1 block focus:outline-none focus:ring-2 focus:ring-ink rounded-lg"
            >
              <ForumPostCard
                {topic}
                kind={topic.kind ?? 'discussion'}
                optimistic
                isOfficial={topic.isOfficial === true}
                team={topic.author?.role === 'admin'}
                bookmarked={savedIds.has(String(topic._id))}
                statusBadgeOverride="reported"
                slotFill
              />
            </a>
          </div>
        {:else}
          <a
            href={detailHref(topic)}
            class="block focus:outline-none focus:ring-2 focus:ring-ink rounded-lg"
          >
            <ForumPostCard
              {topic}
              kind={topic.kind ?? 'discussion'}
              isOfficial={topic.isOfficial === true}
              team={topic.author?.role === 'admin'}
              bookmarked={savedIds.has(String(topic._id))}
            />
          </a>
        {/if}
      {/each}
    </div>
  {/if}

  <FeedStatusFooter
    mode={footerMode}
    lastPostAgo={lastPostAgo}
    pageCount={pageCount}
    currentPage={currentPage}
    hasMore={feedHasMore}
    onLoadMore={loadMore}
  />
</main>
