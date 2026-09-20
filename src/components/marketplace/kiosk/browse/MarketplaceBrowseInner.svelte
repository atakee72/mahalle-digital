<script lang="ts">
  // Marketplace browse orchestrator (Svelte 5).
  //
  // Wires URL params → filter state → fetchListingsClient → MarketTitleBlock +
  // MarketFilterRail + optional ListingLead + ListingCard grid + pagination.
  //
  // URL shape:
  //   ?kind=verkaufen|tausch|verschenken   (DE display keys from the filter rail)
  //   ?cat=moebel|kleidung|…
  //   ?q=search+text
  //   ?view=mine|saved
  //   ?page=0             (0-indexed page number)
  //
  // Internal state uses ListingsQueryFilters which speaks the API/query layer
  // keys ('sell' | 'exchange' | 'gift'). The two maps below translate.

  import { onMount } from 'svelte';
  import { t } from '../../../../lib/kiosk-i18n';
  import { fetchListingsClient, type ListingsQueryFilters } from '../../../../hooks/api/useListingsQuery';
  import type { Listing, ListingStats } from '../../../../types/listing';
  import { showToast, showSuccess, showError, confirmAction } from '../../../../utils/toast';

  import MarketTitleBlock from './MarketTitleBlock.svelte';
  import MarketFilterRail from './MarketFilterRail.svelte';
  import OwnerStatsStrip from './OwnerStatsStrip.svelte';
  import OwnerDraftsSection from './OwnerDraftsSection.svelte';
  import ListingLead from './ListingLead.svelte';
  import ListingCard from './ListingCard.svelte';
  import MarketSkeletonGrid from '../states/MarketSkeletonGrid.svelte';
  import MarketEmpty from '../states/MarketEmpty.svelte';
  import MarketSearchEmpty from '../states/MarketSearchEmpty.svelte';
  import MarketError from '../states/MarketError.svelte';

  // ── Props ────────────────────────────────────────────────────────────
  let { initialData, currentUserId }: {
    initialData: { items: Listing[]; total: number };
    currentUserId: string | null;
  } = $props();

  // ── Kind key translation ─────────────────────────────────────────────
  // The filter rail speaks German display keys; the data layer speaks API keys.
  type RailKind = 'all' | 'verkaufen' | 'tausch' | 'verschenken';
  type ApiKind = 'all' | 'sell' | 'exchange' | 'gift';

  const RAIL_TO_API: Record<RailKind, ApiKind> = {
    all: 'all',
    verkaufen: 'sell',
    tausch: 'exchange',
    verschenken: 'gift',
  };
  const API_TO_RAIL: Record<ApiKind, RailKind> = {
    all: 'all',
    sell: 'verkaufen',
    exchange: 'tausch',
    gift: 'verschenken',
  };

  // ── State ────────────────────────────────────────────────────────────
  let filters = $state<ListingsQueryFilters>({
    kind: 'all',
    category: undefined,
    search: '',
    view: null,
    limit: 24,
    offset: 0,
  });

  // Initial-value capture is deliberate: initialData is the SSR-prefetch
  // seed for first paint; later data arrives via client re-fetches.
  // svelte-ignore state_referenced_locally
  let data = $state<{ items: Listing[]; total: number }>(initialData);
  let loading = $state(false);
  let error = $state<Error | null>(null);

  // ── Owner-view meta (stats strip + Entwürfe section) ─────────────────
  // The grid is paginated (24/page), so it can't be trusted for totals or the
  // full drafts list. /api/listings/my-listings returns accurate aggregate
  // stats + ALL drafts; fetched only while in `?view=mine`. Seq-guarded like
  // the grid's refetch().
  let ownerStats = $state<ListingStats | null>(null);
  let ownerDrafts = $state<Listing[]>([]);
  let ownerMetaSeq = 0;

  async function fetchOwnerMeta() {
    const seq = ++ownerMetaSeq;
    try {
      const res = await fetch('/api/listings/my-listings', {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) return;
      const json = await res.json();
      if (seq !== ownerMetaSeq) return; // stale
      ownerStats = json.stats ?? null;
      ownerDrafts = Array.isArray(json.drafts) ? json.drafts : [];
    } catch {
      // non-fatal — the strip/section simply won't render
    }
  }

  // Load owner meta on entering owner view; clear it on leaving.
  $effect(() => {
    if (filters.view === 'mine' && currentUserId) {
      void fetchOwnerMeta();
    } else {
      ownerStats = null;
      ownerDrafts = [];
    }
  });

  // ── Draft actions (Entwürfe section) ──────────────────────────────────
  async function handlePublishDraft(id: string) {
    try {
      const res = await fetch(`/api/listings/draft/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      // Incomplete draft → send the owner to the compose to finish it.
      if (res.status === 400) {
        window.location.href = `/marketplace/create?draft=${id}`;
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || d.message || 'unknown_error');
      }
      const d = await res.json();
      showSuccess(
        d.moderationStatus === 'pending'
          ? $t['market.owner.draft.publishedPending']
          : $t['market.owner.draft.published'],
      );
      await Promise.all([fetchOwnerMeta(), refetch()]);
    } catch (e: any) {
      showError(e.message || $t['market.owner.draft.publishError']);
    }
  }

  async function handleDeleteDraft(id: string) {
    const ok = await confirmAction($t['market.owner.draft.deleteConfirm'], {
      title: $t['market.owner.draft.delete'],
      confirmLabel: $t['market.owner.draft.delete'],
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/listings/delete/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('delete_failed');
      showSuccess($t['market.owner.draft.deleted']);
      await Promise.all([fetchOwnerMeta(), refetch()]);
    } catch {
      showError($t['market.owner.draft.deleteError']);
    }
  }

  // ── Derived stats for MarketTitleBlock ───────────────────────────────
  const listingStats = $derived.by(() => {
    const now = Date.now();
    const yesterday = now - 24 * 60 * 60 * 1000;
    const threeHours = now - 3 * 60 * 60 * 1000;
    let newSinceYesterday = 0;
    let freshCount = 0;
    for (const it of data.items) {
      const d = it.createdAt ? new Date(it.createdAt as string).getTime() : 0;
      if (d > yesterday) newSinceYesterday++;
      if (d > threeHours) freshCount++;
    }
    return { newSinceYesterday, freshCount };
  });

  // ── Pagination derived ───────────────────────────────────────────────
  const PAGE_SIZE = 24;
  const currentPage = $derived(Math.floor((filters.offset ?? 0) / PAGE_SIZE));
  const totalPages = $derived(Math.max(1, Math.ceil(data.total / PAGE_SIZE)));

  // ── Lead visibility rule (A8) ────────────────────────────────────────
  // Show ListingLead only on page 1 + no filters + at least one listing.
  const hasFilters = $derived(
    filters.kind !== 'all' ||
    (!!filters.category && filters.category !== 'all') ||
    (!!filters.search && filters.search !== '') ||
    !!filters.view
  );
  const showLead = $derived(
    (filters.offset ?? 0) === 0 && !hasFilters && data.items.length > 0
  );

  // Owner view: drop drafts (they live in the dedicated Entwürfe section) and
  // sort rejected listings to top (most urgent "you must act" signal).
  const sortedItems = $derived.by(() => {
    if (filters.view !== 'mine') return data.items;
    return [...data.items]
      .filter((it) => it.status !== 'draft')
      .sort((a, b) => {
        const aRej = a.moderationStatus === 'rejected' ? 0 : 1;
        const bRej = b.moderationStatus === 'rejected' ? 0 : 1;
        return aRej - bRej; // rejected first
      });
  });

  // Grid items: skip the lead item when showLead is true.
  const gridItems = $derived(showLead ? sortedItems.slice(1) : sortedItems);

  // ── URL sync helpers ─────────────────────────────────────────────────
  function readFiltersFromUrl(): ListingsQueryFilters {
    if (typeof window === 'undefined') return filters;
    const params = new URL(window.location.href).searchParams;
    const railKind = (params.get('kind') as RailKind) ?? 'all';
    return {
      kind: RAIL_TO_API[railKind] ?? 'all',
      category: params.get('cat') ?? undefined,
      search: params.get('q') ?? '',
      view: (params.get('view') as 'mine' | 'saved' | null) ?? null,
      limit: PAGE_SIZE,
      offset: Number(params.get('page') ?? 0) * PAGE_SIZE,
    };
  }

  function writeFiltersToUrl(f: ListingsQueryFilters) {
    const url = new URL(window.location.href);
    const railKind = API_TO_RAIL[f.kind ?? 'all'] ?? 'all';

    if (railKind && railKind !== 'all') url.searchParams.set('kind', railKind);
    else url.searchParams.delete('kind');

    if (f.category && f.category !== 'all') url.searchParams.set('cat', f.category);
    else url.searchParams.delete('cat');

    if (f.search) url.searchParams.set('q', f.search);
    else url.searchParams.delete('q');

    if (f.view) url.searchParams.set('view', f.view);
    else url.searchParams.delete('view');

    const page = f.offset && f.limit ? Math.floor(f.offset / f.limit) : 0;
    if (page > 0) url.searchParams.set('page', String(page));
    else url.searchParams.delete('page');

    history.pushState({}, '', url.toString());
  }

  // ── Fetch ────────────────────────────────────────────────────────────
  // Monotonic sequencing guard: rapid filter changes (e.g. fast typing in
  // the search input) can produce out-of-order responses. We only accept a
  // settled response if its sequence number matches the latest issued one.
  let fetchSeq = 0;

  async function refetch() {
    const seq = ++fetchSeq;
    loading = true;
    error = null;
    try {
      const result = await fetchListingsClient(filters);
      if (seq !== fetchSeq) return; // stale response — newer fetch in flight
      data = result;
    } catch (e: any) {
      if (seq !== fetchSeq) return;
      error = e instanceof Error ? e : new Error(String(e));
    } finally {
      if (seq === fetchSeq) loading = false;
    }
  }

  function updateFilters(patch: Partial<ListingsQueryFilters>) {
    filters = { ...filters, ...patch, offset: 0 }; // reset to page 1 on filter change
    writeFiltersToUrl(filters);
    void refetch();
  }

  function goToPage(page: number) {
    filters = { ...filters, offset: page * PAGE_SIZE };
    writeFiltersToUrl(filters);
    void refetch();
    // Scroll to top on page change
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Mount: hydrate from URL if not default + consume flash params ───
  onMount(() => {
    // ── Flash toasts from compose / edit redirects ─────────────────────
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const flashes: Array<[string, string, () => void]> = [
      ['just_posted', '1',       () => showSuccess('Anzeige veröffentlicht!')],
      ['just_posted', 'pending', () => showToast('Deine Anzeige wird gerade geprüft. Sie erscheint, sobald sie freigegeben ist.', { type: 'info', duration: 6000 })],
      ['just_edited', '1',       () => showSuccess('Anzeige aktualisiert')],
      ['just_edited', 'pending', () => showToast('Änderungen werden geprüft.', { type: 'info', duration: 6000 })],
      ['edit_blocked', '1',      () => showToast('Bearbeiten gesperrt — die Anzeige wird gerade geprüft.', { type: 'warning', duration: 6000 })],
      ['not_owner', '1',         () => showError('Du kannst nur eigene Anzeigen bearbeiten.')],
      ['not_found', '1',         () => showError('Anzeige nicht gefunden.')],
    ];
    let consumed = false;
    for (const [key, val, fire] of flashes) {
      if (params.get(key) === val) {
        fire();
        params.delete(key);
        consumed = true;
      }
    }
    if (consumed) {
      window.history.replaceState({}, '', url.toString());
      void refetch(); // cache-bust so the new/updated listing appears
    }

    // ── Filter hydration from URL ──────────────────────────────────────
    const urlFilters = readFiltersFromUrl();
    const isDefault =
      urlFilters.kind === 'all' &&
      !urlFilters.category &&
      !urlFilters.search &&
      !urlFilters.view &&
      !urlFilters.offset;

    if (!isDefault) {
      filters = urlFilters;
      void refetch();
    }

    // popstate listener for browser back/forward
    function onPopState() {
      filters = readFiltersFromUrl();
      void refetch();
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  // ── Filter clear (for filtered-empty state) ──────────────────────────
  function clearFilters() {
    filters = { kind: 'all', category: undefined, search: '', view: null, limit: PAGE_SIZE, offset: 0 };
    writeFiltersToUrl(filters);
    void refetch();
  }

  // ── Active filter chips for MarketSearchEmpty ─────────────────────────
  const activeFilterChips = $derived.by(() => {
    const chips: Array<{ key: string; label: string }> = [];
    if (filters.kind && filters.kind !== 'all') {
      chips.push({ key: 'kind', label: $t[`market.filter.kind.${API_TO_RAIL[filters.kind] ?? 'all'}` as const] as string });
    }
    if (filters.category && filters.category !== 'all') {
      chips.push({ key: 'category', label: ($t[`market.cat.${filters.category}` as const] as string) ?? filters.category });
    }
    if (filters.search) {
      chips.push({ key: 'search', label: `"${filters.search}"` });
    }
    if (filters.view) {
      chips.push({ key: 'view', label: ($t[`market.filter.${filters.view}` as const] as string) ?? filters.view });
    }
    return chips;
  });

  function removeFilter(key: string) {
    if (key === 'kind') updateFilters({ kind: 'all' });
    else if (key === 'category') updateFilters({ category: undefined });
    else if (key === 'search') updateFilters({ search: '' });
    else if (key === 'view') updateFilters({ view: null });
  }

</script>

<!-- ─── Title block ────────────────────────────────────────────────────── -->
<MarketTitleBlock
  listingsCount={data.total}
  newSinceYesterday={listingStats.newSinceYesterday}
  freshCount={listingStats.freshCount}
/>

<!-- ─── Filter rail ───────────────────────────────────────────────────── -->
<MarketFilterRail
  activeKind={API_TO_RAIL[filters.kind ?? 'all'] ?? 'all'}
  activeCat={filters.category ?? null}
  searchQuery={filters.search ?? ''}
  activeView={filters.view ?? null}
  isAuthenticated={currentUserId !== null}
  onKindChange={(k) => updateFilters({ kind: RAIL_TO_API[k as RailKind] ?? 'all' })}
  onCatChange={(c) => updateFilters({ category: c ?? undefined })}
  onSearchChange={(q) => updateFilters({ search: q })}
  onViewChange={(v) => updateFilters({ view: v as 'mine' | 'saved' | null })}
/>

<!-- ─── Owner view: stats strip + Entwürfe section ─────────────────────── -->
{#if filters.view === 'mine' && currentUserId}
  {#if ownerStats}
    <OwnerStatsStrip stats={ownerStats} />
  {/if}
  {#if ownerDrafts.length > 0}
    <OwnerDraftsSection
      drafts={ownerDrafts}
      onEdit={(id) => { window.location.href = `/marketplace/create?draft=${id}`; }}
      onPublish={handlePublishDraft}
      onDelete={handleDeleteDraft}
    />
  {/if}
{/if}

<!-- ─── Loading — first paint (no cached items yet) ──────────────────── -->
{#if loading && data.items.length === 0}
  <MarketSkeletonGrid />

<!-- ─── Error state (no items to fall back on) ────────────────────────── -->
{:else if error && !data.items.length}
  <MarketError {error} onRetry={refetch} />

<!-- ─── Main content ──────────────────────────────────────────────────── -->
{:else}
  <!-- Truly-empty: no listings at all, no filters active -->
  {#if data.total === 0 && !hasFilters && !loading}
    <MarketEmpty />

  <!-- Filtered-empty: filters active, nothing matches -->
  {:else if data.total === 0 && hasFilters && !loading}
    <MarketSearchEmpty
      activeFilters={activeFilterChips}
      onClearAll={clearFilters}
      onRemoveFilter={removeFilter}
    />

  {:else if !loading}
    <!-- ─── Lead listing (page 1, no filters, has items) ─────────────── -->
    {#if showLead}
      <a
        href="/marketplace/{sortedItems[0]?._id}"
        style="display: block; text-decoration: none; color: inherit;"
      >
        <ListingLead listing={sortedItems[0] ?? null} />
      </a>

      <!-- Section divider between lead and grid -->
      <div
        style="
          margin: 0 36px;
          padding: 10px 0;
          border-top: 1px dashed var(--k-rule);
          display: flex; align-items: center; gap: 10px;
        "
      >
        <span
          class="font-dmmono uppercase tracking-widest"
          style="font-size: 10px; color: var(--k-ink-mute);"
        >
          {$t['market.divider.sortedBy'] ?? 'SORTIERT NACH FRISCHE'}
        </span>
        <div style="flex: 1; height: 1px; background: var(--k-rule);"></div>
        <span
          class="font-dmmono"
          style="font-size: 10px; color: var(--k-ink-mute);"
        >
          {data.total} {data.total === 1 ? 'Anzeige' : 'Anzeigen'}
        </span>
      </div>
    {/if}

    <!-- ─── Listing grid ───────────────────────────────────────────── -->
    {#if gridItems.length > 0}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 px-4 md:px-9 py-5 lg:px-10 lg:py-6" data-tour="markt-grid">
        {#each gridItems as item (item._id)}
          <a
            href="/marketplace/{item._id}"
            style="display: block; text-decoration: none; color: inherit;"
          >
            <ListingCard listing={item} {currentUserId} inOwnerView={filters.view === 'mine'} />
          </a>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- ─── Pagination ────────────────────────────────────────────────── -->
  {#if totalPages > 1 && !loading}
    <div
      style="
        display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
        gap: 8px;
        padding: 20px 36px 32px;
        border-top: 1px dashed var(--k-rule);
        margin-top: 8px;
      "
    >
      <button
        type="button"
        onclick={() => goToPage(0)}
        disabled={currentPage === 0}
        class="font-dmmono text-[12px]"
        style="
          padding: 6px 14px;
          border: 1.5px solid var(--k-rule);
          border-radius: var(--k-radius-md, 8px);
          background: var(--k-paper);
          color: var(--k-ink);
          cursor: pointer;
          opacity: {currentPage === 0 ? '0.35' : '1'};
        "
        aria-label="Erste Seite"
      >⟪</button>

      <button
        type="button"
        onclick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 0}
        class="font-dmmono text-[12px]"
        style="
          padding: 6px 14px;
          border: 1.5px solid var(--k-rule);
          border-radius: var(--k-radius-md, 8px);
          background: var(--k-paper);
          color: var(--k-ink);
          cursor: pointer;
          opacity: {currentPage === 0 ? '0.35' : '1'};
        "
        aria-label="Vorherige Seite"
      >← Zurück</button>

      <span
        class="font-dmmono text-[12px] text-ink-mute"
        style="padding: 6px 8px;"
      >
        Seite {currentPage + 1} von {totalPages} · {data.total} Anzeigen
      </span>

      <button
        type="button"
        onclick={() => goToPage(currentPage + 1)}
        disabled={currentPage >= totalPages - 1}
        class="font-dmmono text-[12px]"
        style="
          padding: 6px 14px;
          border: 2px solid var(--k-teal, #3f8f9f);
          border-radius: var(--k-radius-md, 8px);
          background: transparent;
          color: var(--k-teal, #3f8f9f);
          cursor: pointer;
          font-weight: 600;
          opacity: {currentPage >= totalPages - 1 ? '0.35' : '1'};
        "
        aria-label="Nächste Seite"
      >Weiter →</button>

      <button
        type="button"
        onclick={() => goToPage(totalPages - 1)}
        disabled={currentPage >= totalPages - 1}
        class="font-dmmono text-[12px]"
        style="
          padding: 6px 14px;
          border: 1.5px solid var(--k-rule);
          border-radius: var(--k-radius-md, 8px);
          background: var(--k-paper);
          color: var(--k-ink);
          cursor: pointer;
          opacity: {currentPage >= totalPages - 1 ? '0.35' : '1'};
        "
        aria-label="Letzte Seite"
      >⟫</button>
    </div>
  {/if}
{/if}

<!-- Floating "+ neue anzeige" FAB (mobile-only). Parked above the bottom
     mobile nav with 16 px clearance; wine fill + ink print-shadow matches
     the kiosk vocabulary and the calendar FAB pattern. The desktop CTA
     lives inside MarketTitleBlock (hidden < lg). -->
<a
  href="/marketplace/create"
  aria-label="Neue Anzeige erstellen"
  data-tour="markt-create"
  class="fixed bottom-16 right-4 z-30 w-14 h-14 rounded-full bg-wine text-paper border-2 border-ink font-bricolage font-bold text-[28px] leading-none shadow-[3px_3px_0_var(--k-ink,#0e1033)] flex items-center justify-center lg:hidden"
><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 4v16M4 12h16" /></svg></a>
