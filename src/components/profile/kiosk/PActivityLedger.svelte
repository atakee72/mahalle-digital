<script lang="ts">
  // Archiv card — cross-surface activity ledger (§01). Filter chips
  // (Alle/Forum/Markt/Kalender/Kurier + own-view-only Gespeichert), rows,
  // "ältere laden" pagination, and the §02 empty state. Owns its own fetch
  // state (straight fetch, no TanStack) — mounted read-only into
  // ProfileInner's right column.
  // Design source: kiosk-profile.jsx (PActivityLedger, PFilterChip) +
  // kiosk-profile-states.jsx (§02 empty).
  //
  // Public reuse (Plan B, Task 4): `publicHandle` (set by PublicProfileInner)
  // swaps the fetch target to GET /api/profile/public-activity?handle=...
  // instead of /api/profile/activity, implies `publicView` (no need to pass
  // both — the caller only ever sets one), and hides the empty-state's
  // own-authoring CTAs (they'd deep-link the VISITOR into "post a first
  // topic" flows, which makes no sense on someone else's card). `headingKey`
  // lets the mobile public layout swap the §01 title to
  // `profile.public.ledger` ("Im Kiez unterwegs") without a second card
  // fork — desktop public reuses the default `profile.archiv.title`.

  import { t } from '../../../lib/kiosk-i18n';
  import { scrollFade } from '../../../lib/scrollFade';
  import { halfRowCutHeight } from '../../../lib/profile/halfRowCut';
  import { ACTIVITY_PAGE_SIZE } from '../../../lib/profile/profileShared';
  import type { ActivityFilter, ActivityItem, ActivityPage } from '../../../lib/profile/profileShared';
  import PCard from './atoms/PCard.svelte';
  import PCardHead from './atoms/PCardHead.svelte';
  import PBtn from './atoms/PBtn.svelte';
  import PFilterChip from './atoms/PFilterChip.svelte';
  import PActivityRow from './PActivityRow.svelte';

  let {
    publicView = false,
    publicHandle = null,
    headingKey = null,
  }: {
    publicView?: boolean;
    publicHandle?: string | null;
    headingKey?: string | null;
  } = $props();

  const isPublic = $derived(publicView || !!publicHandle);

  // URL-param preselect (/profile?filter=forum etc.) — used by the nav avatar
  // menu's „Meine Beiträge"/„Gespeichert" rows. Own-view only: on the public
  // profile a stranger's `gespeichert` must never preselect (that filter
  // doesn't exist there), and public links don't carry the param anyway.
  const VALID_FILTERS: ActivityFilter[] = ['alle', 'forum', 'markt', 'kalender', 'kurier', 'gespeichert'];
  function initialFilter(): ActivityFilter {
    if (typeof window === 'undefined' || publicView || publicHandle) return 'alle';
    const p = new URLSearchParams(window.location.search).get('filter') as ActivityFilter | null;
    return p && VALID_FILTERS.includes(p) ? p : 'alle';
  }
  let filter = $state<ActivityFilter>(initialFilter());
  let items = $state<ActivityItem[]>([]);
  let nextBefore = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let loadingMore = $state(false);

  // Plain (non-reactive) counter — invalidates stale in-flight responses.
  // Mirrors ProfileInner's `seq`/`standingSeq` pattern.
  let seq = 0;

  async function fetchPage(before: string | null, append: boolean) {
    const mySeq = ++seq;
    if (append) loadingMore = true;
    else status = 'loading';
    try {
      const params = new URLSearchParams({ filter, limit: String(ACTIVITY_PAGE_SIZE) });
      if (before) params.set('before', before);
      const endpoint = publicHandle ? '/api/profile/public-activity' : '/api/profile/activity';
      if (publicHandle) params.set('handle', publicHandle);
      const res = await fetch(`${endpoint}?${params.toString()}`);
      if (!res.ok) throw new Error('activity fetch failed');
      const data: ActivityPage = await res.json();
      if (mySeq !== seq) return; // stale response
      if (append) {
        const existingIds = new Set(items.map((i) => i.id));
        items = [...items, ...data.items.filter((i) => !existingIds.has(i.id))];
      } else {
        items = data.items;
      }
      nextBefore = data.nextBefore;
      status = 'ready';
    } catch {
      if (mySeq !== seq) return;
      status = 'error';
    } finally {
      if (mySeq === seq) loadingMore = false;
    }
  }

  // Filter change → reset list + fetch fresh page. Also fires once on mount.
  $effect(() => {
    void filter;
    items = [];
    nextBefore = null;
    fetchPage(null, false);
  });

  let cardEl = $state<HTMLElement | null>(null);
  function collapseLedger() {
    ledgerOpen = false;
    // Scroll the card's top edge under the masthead (its published height,
    // 0 while hidden on scroll) — never `scrollIntoView`, the ClientRouter
    // keeps its own scroll bookkeeping and this is a plain in-page move.
    const mast = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k-mast-offset')) || 0;
    const top = (cardEl?.getBoundingClientRect().top ?? 0) + window.scrollY - mast - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  }

  function selectFilter(f: ActivityFilter) {
    if (f === filter) return;
    filter = f;
    ledgerOpen = false; // a new list starts clipped again
  }

  function loadOlder() {
    if (!nextBefore || loadingMore) return;
    fetchPage(nextBefore, true);
  }

  function retry() {
    fetchPage(null, false);
  }

  const FILTERS: { key: ActivityFilter; labelKey: string }[] = [
    { key: 'alle', labelKey: 'profile.filter.alle' },
    { key: 'forum', labelKey: 'profile.filter.forum' },
    { key: 'markt', labelKey: 'profile.filter.markt' },
    { key: 'kalender', labelKey: 'profile.filter.kalender' },
    { key: 'kurier', labelKey: 'profile.filter.kurier' },
  ];

  const showSaved = $derived(filter === 'gespeichert');
  const isEmpty = $derived(status === 'ready' && items.length === 0);
  const showEmptyCtas = $derived(isEmpty && filter === 'alle' && !isPublic);
  // Desktop always keeps the default "Archiv" title (matches
  // kiosk-profile-public.jsx's PublicProfileDesktop, which doesn't override
  // it) — only the mobile heading swaps to `headingKey` when set. Both CSS
  // variants render the same text when `headingKey` is null (own profile),
  // so this is a no-op there.
  const headingDesktop = $derived($t['profile.archiv.title']);
  const headingMobile = $derived($t[(headingKey ?? 'profile.archiv.title') as keyof typeof $t]);

  // Svelte action for the bounded list: when the rows overflow the CSS cap
  // (`.prof-ledger-scroll` max-height, 520 px), trim the visible height so
  // the edge cuts a row in half — the cut row is the „there is more" hint
  // (user, 2026-09-28 02:01). Idempotent (same value → no resize churn);
  // re-measured on child changes (filter switch, „older") and on resize.
  // Phones get NO inner scroller (a 520 px scroll box under the thumb trapped
  // the page, user 02:12): the box is clipped and „alle anzeigen" opens it to
  // full height; desktop keeps the inner scroll (`profile.css`). `onOverflow`
  // tells the component whether the button is needed at all.
  const LEDGER_CAP = 520;
  let ledgerOpen = $state(false);
  let ledgerOverflows = $state(false);
  type CutOpts = { open: boolean; onOverflow: (v: boolean) => void };
  function halfRowCut(node: HTMLElement, opts: CutOpts) {
    let cur = opts;
    const apply = () => {
      const boxTop = node.getBoundingClientRect().top - node.scrollTop;
      const rows = Array.from(node.children)
        .filter((c): c is HTMLElement => c instanceof HTMLElement && c.offsetHeight > 0 && !c.hasAttribute('data-ledger-tail'))
        .map((c) => { const r = c.getBoundingClientRect(); return { top: r.top - boxTop, height: r.height }; });
      const h = halfRowCutHeight(rows, LEDGER_CAP);
      cur.onOverflow(h !== null);
      // Open: the full content height as an explicit px value, so the CSS
      // transition has two numbers to run between (a `none` cannot animate);
      // re-applied on child changes, so „older" keeps the box growing.
      node.style.maxHeight = h === null ? '' : cur.open ? `${node.scrollHeight}px` : `${h}px`;
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(node, { childList: true, subtree: true });
    const ro = new ResizeObserver(apply);
    ro.observe(node);
    return {
      update(next: CutOpts) { cur = next; apply(); },
      destroy() { mo.disconnect(); ro.disconnect(); },
    };
  }
</script>

<PCard pad={24}>
  <div bind:this={cardEl} style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; gap: 10px; flex-wrap: wrap;">
    <div class="hidden lg:block">
      <PCardHead n="01" title={headingDesktop} />
    </div>
    <div class="lg:hidden">
      <PCardHead n="01" title={headingMobile} />
    </div>
    <span style="font-family: var(--k-font-mono); font-size: 9.5px; color: var(--k-ink-mute); letter-spacing: 0.1em;">{$t['profile.archiv.note']}</span>
  </div>

  <div use:scrollFade data-tour="profil-archiv" class="kiosk-scroll-fade no-scrollbar flex items-center overflow-x-auto" style="gap: 6px; margin-bottom: 8px; padding-bottom: 2px;">
    {#each FILTERS as f (f.key)}
      <PFilterChip
        label={$t[f.labelKey as keyof typeof $t]}
        active={filter === f.key}
        count={f.key === 'alle' && filter === 'alle' && status !== 'loading' ? items.length : null}
        onclick={() => selectFilter(f.key)}
      />
    {/each}
    {#if !isPublic}
      <span style="width: 1px; height: 20px; background: var(--k-rule); margin: 0 4px; flex-shrink: 0;"></span>
      <PFilterChip
        label={`◈ ${$t['profile.filter.gespeichert']}`}
        active={showSaved}
        onclick={() => selectFilter('gespeichert')}
      />
      <!-- Not a filter: drafts are not activity. A plain link to the one drafts
           page (forum + market), styled like the neighbouring chips. -->
      <a href="/entwuerfe" data-profile-drafts-link class="shrink-0 kiosk-tap-box" style="display: inline-flex; align-items: center; text-decoration: none;">
        <span style="padding: 5px 13px; font-family: var(--k-font-display); font-size: 12.5px; font-weight: 600; background: transparent; color: var(--k-ink); border: 1.5px dashed var(--k-ink); border-radius: var(--k-radius-pill); display: inline-flex; align-items: center; white-space: nowrap;">{$t['profile.filter.entwuerfe']}</span>
      </a>
    {/if}
  </div>

  {#if status === 'error'}
    <div style="padding: 12px 0; font-family: var(--k-font-mono); font-size: 10.5px; color: var(--k-danger); display: flex; align-items: center; gap: 6px;">
      <span>{$t['profile.archiv.loadfailed']}</span>
      <button
        type="button"
        onclick={retry}
        style="font-family: var(--k-font-mono); font-size: 10.5px; font-weight: 700; color: var(--k-danger); background: none; border: none; border-bottom: 1.5px solid var(--k-danger); padding: 0; cursor: pointer;"
      >{$t['profile.save.retry']}</button>
    </div>
  {:else if isEmpty}
    <div style="padding: 20px 0; text-align: center;">
      <div style="font-family: var(--k-font-serif); font-style: italic; font-size: 15px; color: var(--k-ink-soft);">
        {$t['profile.empty.line']}
      </div>
      {#if showEmptyCtas}
        <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; margin-top: 12px;">
          <PBtn small href="/topics/create">{$t['profile.empty.cta.topic']}</PBtn>
          <PBtn small href="/marketplace/create">{$t['profile.empty.cta.listing']}</PBtn>
          <PBtn small href="/calendar">{$t['profile.empty.cta.events']}</PBtn>
        </div>
      {/if}
    </div>
  {:else}
    <!-- Bounded list: the card stopped growing with the member's history
         (user, 2026-09-28 01:51) — rows scroll inside the box, the „older"
         button sits at the end of the scroll. -->
    <div class="prof-ledger-scroll" use:halfRowCut={{ open: ledgerOpen, onOverflow: (v) => { ledgerOverflows = v; } }}>
      {#each items as item (item.id)}
        <PActivityRow {item} saved={showSaved} />
      {/each}
      {#if nextBefore}
        <div data-ledger-tail style="margin-top: 14px; text-align: center;">
          <PBtn small disabled={loadingMore} onclick={loadOlder}>{$t['profile.archiv.older']}</PBtn>
        </div>
      {/if}
    </div>
    {#if ledgerOverflows && !ledgerOpen}
      <div class="lg:hidden" style="margin-top: 10px; text-align: center;">
        <PBtn small onclick={() => { ledgerOpen = true; }}>{$t['profile.archiv.expand']}</PBtn>
      </div>
    {:else if ledgerOpen}
      <!-- Closer at the end of the opened list (user, 02:21): clips the list
           again and brings the card head back under the masthead, so the
           reader lands where the opener was instead of far below. -->
      <div class="lg:hidden" style="margin-top: 10px; text-align: center;">
        <PBtn small onclick={collapseLedger}>{$t['profile.archiv.collapse']}</PBtn>
      </div>
    {/if}
  {/if}
</PCard>
