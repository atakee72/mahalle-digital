<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../../lib/kiosk-i18n';
  import { showToast } from '../../../utils/toast';
  import {
    resolveSektion, resolveQuelle, isKiezSource, type NewsVM, type SektionKey,
  } from '../../../lib/newsboard/newsTaxonomy';
  import { chronoBucket, orderBoard } from '../../../lib/newsboard/newsFormat';

  import NewsMasthead from './browse/NewsMasthead.svelte';
  import NewsTitleBlock from './browse/NewsTitleBlock.svelte';
  import NewsFilterRail from './browse/NewsFilterRail.svelte';
  import NewsCard from './browse/NewsCard.svelte';
  import DateDivider from './browse/DateDivider.svelte';
  import NewsSkeleton from './states/NewsSkeleton.svelte';
  import NewsEmptyToday from './states/NewsEmptyToday.svelte';
  import NewsEmptySaved from './states/NewsEmptySaved.svelte';
  import NewsError from './states/NewsError.svelte';
  import NewsDegradedBanner from './states/NewsDegradedBanner.svelte';

  let {
    issue,
    degraded = false,
    currentUserId = null,
    initialArticles = [],
  }: { issue: number; degraded?: boolean; currentUserId?: string | null; initialArticles?: any[] } = $props();

  const isAuth = $derived(!!currentUserId);

  // Filters
  let activeSektion = $state<SektionKey | null>(null);
  // Default to a 1-week window so the HEUTE/GESTERN/FRÜHER dividers have content
  // (RSS publishedAt often predates the fetch day). The masthead "Artikel heute"
  // still counts only today's bucket. The Zeitraum filter re-fetches the window.
  let activeZeitraum = $state<string>('week');
  let savedOnly = $state(false);

  // Data — seed first paint from the server-fetched articles (C1: SSR-prefetch).
  // toVM is a hoisted function declaration, so calling it here is fine.
  // Capturing the initial prop value is deliberate: the island prop never
  // changes after mount; later data arrives via client re-fetches.
  // svelte-ignore state_referenced_locally
  let status = $state<'loading' | 'ready' | 'error'>(initialArticles.length ? 'ready' : 'loading');
  // svelte-ignore state_referenced_locally
  let articles = $state<NewsVM[]>(initialArticles.map((it) => toVM(it, new Set<string>())));
  let savedIds = $state<Set<string>>(new Set());
  let seq = 0;

  // DB NewsItem → view-model. `ids` passed explicitly (not closed over) so the
  // function stays safe to extract and never reads a stale `savedIds`.
  function toVM(it: any, ids: Set<string>): NewsVM {
    const summary = it.aiSummary || it.description || '';
    return {
      id: String(it._id),
      title: it.title,
      titleEN: it.titleEN,
      dek: (it.description || '').slice(0, 180),
      summary: Array.isArray(summary) ? summary[0] : summary,
      quelle: resolveQuelle(it.sourceName, it.source),
      sektion: resolveSektion(it.aiCategory),
      kiez: isKiezSource(it.sourceName),
      score: Number(it.aiRelevanceScore ?? 0),
      imageUrl: it.imageUrl || '',
      sourceUrl: it.sourceUrl,
      publishedAt: it.publishedAt ?? it.fetchedAt ?? new Date().toISOString(),
      fetchDate: it.fetchDate,
      submitterName: it.submittedBy?.name,
      forumLinks: 0,        // Phase 3
      saved: ids.has(String(it._id)),
      read: false,          // Phase 3
      archived: false,      // Phase 3
      moderationStatus: it.moderationStatus ?? 'approved',
      warningText: it.warningText,
    };
  }

  // Map Zeitraum → the API's dateFrom (ISO). today=last 1d, week=7d, month=30d.
  function zeitraumDateFrom(z: string): string | undefined {
    const now = Date.now();
    const days = z === 'today' ? 1 : z === 'week' ? 7 : z === 'month' ? 30 : 0;
    if (!days) return undefined;
    return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
  }

  async function refetch() {
    const mySeq = ++seq;
    status = 'loading';
    try {
      // saved IDs first (so toVM resolves `saved` correctly).
      // GET /api/news/save → { savedIds: string[] }.
      if (isAuth) {
        try {
          const sres = await fetch('/api/news/save');
          if (sres.ok) {
            const sj = await sres.json();
            savedIds = new Set((sj.savedIds ?? []).map((x: any) => String(x)));
          }
        } catch { /* non-fatal */ }
      }
      const params = new URLSearchParams({ limit: '40', sortBy: 'approvedAt', sortOrder: 'desc' });
      const from = zeitraumDateFrom(activeZeitraum);
      if (from) params.set('dateFrom', from);
      const res = await fetch(`/api/news?${params.toString()}`);
      if (!res.ok) throw new Error(`news fetch ${res.status}`);
      const data = await res.json();
      if (mySeq !== seq) return; // stale
      const items = data.news ?? [];   // GET /api/news → { news: [...] }
      articles = items.map((it: any) => toVM(it, savedIds));
      status = 'ready';
    } catch {
      if (mySeq !== seq) return;
      status = 'error';
    }
  }

  // Initial load + re-fetch when the time-window or auth state changes. The bare
  // reads of `activeZeitraum` and `isAuth` register them as effect dependencies
  // (reads inside the called refetch() are NOT tracked, so list them here).
  // sektion + saved are client-side filters, so they don't trigger a refetch.
  // No separate onMount needed; the `seq` guard discards any overlapping fetch.
  // C1: when the server seeded articles, skip the initial client fetch (the seed
  // matches the default `week` window). A logged-in user still needs a follow-up
  // fetch to resolve `saved` state, so only skip for anonymous visitors.
  // Flash toast from the submit flow (?just_submitted=1) — the submit page
  // navigates here immediately, so its own toast never renders; we show it on
  // arrival instead and strip the param (marketplace just_posted pattern).
  onMount(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('just_submitted') === '1') {
      showToast($t['news.submit.success'], { type: 'success' });
      url.searchParams.delete('just_submitted');
      window.history.replaceState({}, '', url.toString());
    }
  });

  let firstRun = true;
  $effect(() => {
    activeZeitraum; isAuth;
    if (firstRun) {
      firstRun = false;
      if (initialArticles.length && !isAuth) return;
    }
    refetch();
  });

  // Derived view list
  const visible = $derived(
    articles
      .filter((a) => (activeSektion ? a.sektion === activeSektion : true))
      .filter((a) => (savedOnly ? a.saved : true))
  );
  // The author's own pending/rejected submissions (the API only ever returns the
  // current user's non-approved items, so any non-approved here is theirs). Float
  // them to the top of the feed where NewsCard renders the IN-PRÜFUNG/ABGELEHNT
  // strap — and keep them OUT of the bento doubles and the
  // chrono buckets (a pending item has no meaningful publish slot yet).
  const ownNonApproved = $derived(visible.filter((a) => a.moderationStatus !== 'approved'));
  const approvedItems = $derived(visible.filter((a) => a.moderationStatus === 'approved'));
  // HEUTE is ordered by aiRelevanceScore desc (publishedAt tiebreak); GESTERN/
  // ÄLTER stay publishedAt desc (see orderBoard()). No lead card any more
  // (2026-09-22 grid): today's top TWO print double-width instead (bento), only
  // on the unfiltered board — never in GESTERN/ÄLTER.
  const board = $derived(orderBoard(approvedItems, new Date(), false));
  const bento = $derived(!activeSektion && !savedOnly);
  const GRID = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 grid-flow-row-dense';

  const today = $derived(board.today);
  const yesterday = $derived(board.yesterday);
  const older = $derived(board.older);

  // "X Artikel heute" must reflect only today's APPROVED bucket, even when a wider
  // Zeitraum window is loaded (pending items don't count as published articles).
  const todayCount = $derived(
    articles.filter((a) => a.moderationStatus === 'approved' && chronoBucket(a.publishedAt) === 'today').length
  );
  const sourceCount = $derived(degraded ? 7 : 9);

  async function handleSave(id: string) {
    if (!isAuth) { showToast($t['news.save.login'], { type: 'info' }); return; }
    const wasSaved = savedIds.has(id);
    // optimistic
    const next = new Set(savedIds);
    wasSaved ? next.delete(id) : next.add(id);
    savedIds = next;
    articles = articles.map((a) => (a.id === id ? { ...a, saved: !wasSaved } : a));
    try {
      const res = await fetch('/api/news/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // POST /api/news/save requires BOTH newsId and action ('save'|'unsave').
        body: JSON.stringify({ newsId: id, action: wasSaved ? 'unsave' : 'save' }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // rollback
      const rb = new Set(savedIds);
      wasSaved ? rb.add(id) : rb.delete(id);
      savedIds = rb;
      articles = articles.map((a) => (a.id === id ? { ...a, saved: wasSaved } : a));
      showToast($t['news.save.error'], { type: 'error' });
    }
  }
</script>

<NewsTitleBlock />
<NewsMasthead {issue} articleCount={todayCount} {sourceCount} {degraded} />
{#if degraded}<NewsDegradedBanner />{/if}
<NewsFilterRail
  {activeSektion} {activeZeitraum} {savedOnly} isAuthenticated={isAuth}
  onSektionChange={(s) => (activeSektion = s)}
  onZeitraumChange={(z) => (activeZeitraum = z)}
  onSavedToggle={(v) => (savedOnly = v)}
/>

{#if status === 'loading'}
  <NewsSkeleton />
{:else if status === 'error'}
  <NewsError onRetry={refetch} />
{:else if visible.length === 0}
  {#if savedOnly}
    <NewsEmptySaved onBack={() => (savedOnly = false)} />
  {:else}
    <NewsEmptyToday />
  {/if}
{:else}
  <!-- Card grid 1/2/3 columns (2026-09-22). One grid PER date section, so
       grid-flow-dense can backfill the hole a double card leaves on desktop
       with a card of the SAME day — never pull a GESTERN card above its divider. -->
  <div class="px-4 pt-5 pb-10 md:px-9 lg:px-10 flex flex-col" style="gap:16px;">
    {#if ownNonApproved.length}
      <div class={GRID}>
        {#each ownNonApproved as a (a.id)}<NewsCard article={a} onSave={handleSave} canSave={isAuth} />{/each}
      </div>
    {/if}
    {#if today.length}
      <DateDivider label={$t['news.divider.today']} />
      <div class={GRID}>
        {#each today as a, i (a.id)}<NewsCard article={a} onSave={handleSave} canSave={isAuth} size={bento && i < 2 ? 'double' : 'single'} />{/each}
      </div>
    {/if}
    {#if yesterday.length}
      <DateDivider label={$t['news.divider.yesterday']} />
      <div class={GRID}>
        {#each yesterday as a (a.id)}<NewsCard article={a} onSave={handleSave} canSave={isAuth} />{/each}
      </div>
    {/if}
    {#if older.length}
      <DateDivider label={$t['news.divider.older']} />
      <div class={GRID}>
        {#each older as a (a.id)}<NewsCard article={a} onSave={handleSave} canSave={isAuth} />{/each}
      </div>
    {/if}
  </div>
{/if}

<!-- Floating "+ news einreichen" FAB (phones/tablets only) — the same button as
     on the calendar, the market and the forum. INK here (user, 2026-09-20: the
     button takes the page colour); an ink shadow would vanish under an ink
     disc, so it wears the wine print shadow of every primary ink button.
     Shown in every list state. -->
<a
  href="/newsboard/submit"
  aria-label={$t['news.mobile.cta.aria']}
  data-news-fab
  data-tour="kurier-submit"
  class="fixed bottom-16 right-4 z-30 w-14 h-14 rounded-full bg-ink text-paper border-2 border-ink font-bricolage font-bold text-[28px] leading-none shadow-[2px_2px_0_var(--k-wine),inset_0_-0.25px_0_1.75px_#1b1a17,inset_0_0_0_2px_#f3ead8] flex items-center justify-center lg:hidden"
><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 4v16M4 12h16" /></svg></a>
