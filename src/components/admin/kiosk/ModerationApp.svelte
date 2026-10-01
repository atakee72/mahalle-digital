<script lang="ts">
  /**
   * Admin moderation orchestrator — queue view. Owns fetch state,
   * filter/pagination state, the optimistic single-item approve/warn/reject
   * flow (Tasks 4–6), and the bulk-selection + bulk approve/reject flow
   * (Task 7). `onWarn`/`onReject`/bulk-reject all open their respective
   * modal; `runSingleAction` and the bulk handlers both share the same
   * `actioning`/`settling` overlay contract with `AdmQueueCard`.
   *
   * State contract (consumed by Tasks 5–9 — keep names/shapes stable):
   *   view, filterType, items, counts, total, page, pageSize, loading,
   *   loadError, actioning, settling, selected, fetchQueue(),
   *   runSingleAction().
   */
  import { onMount } from 'svelte';
  import { t, tStr } from '../../../lib/kiosk-i18n';
  import { ADM_TYPES, type FlaggedItem } from '../../../lib/adminModeration';
  import { showToast, showError } from '../../../utils/toast';
  import AdmStatRow from './AdmStatRow.svelte';
  import AdmErrorsCard from './AdmErrorsCard.svelte';
  import AdmTitleBlock from './AdmTitleBlock.svelte';
  import AdmFilterRail from './AdmFilterRail.svelte';
  import AdmBulkBar from './AdmBulkBar.svelte';
  import AdmQueueCard from './AdmQueueCard.svelte';
  import AdmRejectModal from './AdmRejectModal.svelte';
  import AdmWarningModal from './AdmWarningModal.svelte';
  import AdmBulkRejectModal from './AdmBulkRejectModal.svelte';
  import AdmHistoryTable from './AdmHistoryTable.svelte';
  import AdmColumnMenu from './AdmColumnMenu.svelte';
  import AdmTriageCard from './AdmTriageCard.svelte';

  // ── State contract ──────────────────────────────────────────────────────
  let view = $state<'queue' | 'history'>('queue');
  let filterType = $state<'all' | (typeof ADM_TYPES)[number] | 'reported'>('all');
  let items = $state<FlaggedItem[]>([]);
  let counts = $state<{ pending: number; approved: number; approvedWithWarning: number; rejected: number; urgent: number } | null>(null);
  let total = $state(0);
  let page = $state(0); // 0-indexed
  let pageSize = $state(10); // 10 | 25 | 50
  let loading = $state(true);
  let loadError = $state(false);
  let actioning = $state<Map<string, string>>(new Map()); // id → pending pill label
  let settling = $state<Set<string>>(new Set()); // id → settle-out animation

  // ── Bulk selection (Task 7) ─────────────────────────────────────────────
  let selected = $state<Set<string>>(new Set());
  function toggleSelect(id?: string) {
    if (!id) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }
  function clearSelection() {
    selected = new Set();
  }

  // Selected items in the same order the queue renders them (== the order
  // `fetchQueue` got back from the server) — `computeBulkDeltas` does
  // sequential per-author summation that mirrors the API's own sequential
  // processing, so this order must match what gets POSTed as
  // `flaggedContentIds`. The API caps at 50; pageSize is capped at 50 too
  // so `selected.size` can't exceed it through normal use, but the slice
  // is defensive in case that invariant ever breaks.
  function getSelectedItems(): FlaggedItem[] {
    let sel = items.filter((it) => it._id && selected.has(it._id));
    if (sel.length > 50) {
      sel = sel.slice(0, 50);
      showToast($t['admin.bulk.capNotice'], { type: 'info' });
    }
    return sel;
  }

  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

  // ── Fetch (seq-guarded — marketplace `refetch()` pattern) ──────────────
  let fetchSeq = 0;

  async function fetchQueue(): Promise<void> {
    const seq = ++fetchSeq;
    loading = true;
    loadError = false;
    try {
      const params = new URLSearchParams();
      params.set('reviewStatus', 'pending');
      params.set('urgentFirst', 'true');
      params.set('sortBy', 'createdAt');
      params.set('sortOrder', 'desc');
      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));
      if (filterType === 'reported') {
        params.set('source', 'user_report');
      } else if (filterType !== 'all') {
        params.set('contentType', filterType);
      }

      const res = await fetch(`/api/admin/moderation?${params.toString()}`, { credentials: 'include' });
      if (seq !== fetchSeq) return; // stale — newer fetch in flight
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      if (seq !== fetchSeq) return;

      items = Array.isArray(json.items) ? json.items : [];
      counts = json.counts ?? null;
      total = json.pagination?.total ?? 0;
    } catch {
      if (seq !== fetchSeq) return;
      loadError = true;
    } finally {
      if (seq === fetchSeq) loading = false;
    }
  }

  function handleFilterChange(f: 'all' | (typeof ADM_TYPES)[number] | 'reported') {
    filterType = f;
    page = 0;
    clearSelection();
    void fetchQueue();
  }

  function handleViewChange(v: 'queue' | 'history') {
    view = v;
    // Queue state (filterType/page/items/selected/…) is left completely
    // untouched here — it isn't refetched, so toggling back to 'queue'
    // shows exactly what was there before. History refetches on every
    // entry so it's never stale.
    if (v === 'history') void fetchHistory();
  }

  function handlePageChange(p: number) {
    if (p < 0 || p >= totalPages) return;
    page = p;
    clearSelection();
    void fetchQueue();
  }

  function handlePageSizeChange(size: number) {
    pageSize = size;
    page = 0;
    clearSelection();
    void fetchQueue();
  }

  onMount(() => {
    void fetchQueue();
  });

  // ── History (Protokoll) state (Task 8) ──────────────────────────────────
  // Separate from the queue's own page/pageSize/items/loading/loadError —
  // switching views never touches queue state, so toggling back always
  // shows the queue exactly as it was left.
  let histFilter = $state<'all' | 'approved' | 'rejected'>('all');
  let sortBy = $state<'createdAt' | 'maxScore' | 'reviewStatus'>('createdAt');
  let sortOrder = $state<'asc' | 'desc'>('desc');
  let hiddenCols = $state<Set<string>>(new Set(['reason']));
  let histItems = $state<FlaggedItem[]>([]);
  let histTotal = $state(0);
  let histPage = $state(0);
  let histPageSize = $state(10);
  let histLoading = $state(true);
  let histLoadError = $state(false);

  const histTotalPages = $derived(Math.max(1, Math.ceil(histTotal / histPageSize)));

  let histFetchSeq = 0;

  async function fetchHistory(): Promise<void> {
    const seq = ++histFetchSeq;
    histLoading = true;
    histLoadError = false;
    try {
      const params = new URLSearchParams();
      // "Alle" = reviewed (approved + rejected) — NEVER pending. Non-negotiable:
      // the queue and history views must stay disjoint.
      params.set('reviewStatus', histFilter === 'all' ? 'reviewed' : histFilter);
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);
      params.set('limit', String(histPageSize));
      params.set('offset', String(histPage * histPageSize));
      // No urgentFirst — history has no urgency concept, it's a settled ledger.

      const res = await fetch(`/api/admin/moderation?${params.toString()}`, { credentials: 'include' });
      if (seq !== histFetchSeq) return;
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      if (seq !== histFetchSeq) return;

      histItems = Array.isArray(json.items) ? json.items : [];
      histTotal = json.pagination?.total ?? 0;
    } catch {
      if (seq !== histFetchSeq) return;
      histLoadError = true;
    } finally {
      if (seq === histFetchSeq) histLoading = false;
    }
  }

  function handleHistFilterChange(f: 'all' | 'approved' | 'rejected') {
    histFilter = f;
    histPage = 0;
    void fetchHistory();
  }

  function handleHistSort(col: 'createdAt' | 'maxScore' | 'reviewStatus') {
    if (sortBy === col) {
      sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = col;
      sortOrder = 'desc';
    }
    histPage = 0;
    void fetchHistory();
  }

  function handleHistColToggle(id: string) {
    const next = new Set(hiddenCols);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    hiddenCols = next;
  }

  function handleHistPageChange(p: number) {
    if (p < 0 || p >= histTotalPages) return;
    histPage = p;
    void fetchHistory();
  }

  function handleHistPageSizeChange(size: number) {
    histPageSize = size;
    histPage = 0;
    void fetchHistory();
  }

  const HIST_FILTERS = ['all', 'approved', 'rejected'] as const;
  const HIST_FILTER_LABEL_KEY = {
    all: 'admin.filter.all',
    approved: 'admin.hist.filter.approved',
    rejected: 'admin.hist.filter.rejected',
  } as const;

  // ── Review action (optimistic §04 flow) ─────────────────────────────────
  async function runSingleAction(
    id: string,
    action: 'approve' | 'reject' | 'approve_with_warning',
    opts?: { rejectionReason?: string; warningText?: string; notes?: string }
  ): Promise<{ ok: boolean; userBanned?: boolean; strikeCount?: number }> {
    const label =
      action === 'reject'
        ? $t['admin.act.pendingReject']
        : action === 'approve_with_warning'
          ? $t['admin.act.pendingWarn']
          : $t['admin.act.pendingApprove'];

    const startActioning = new Map(actioning);
    startActioning.set(id, label);
    actioning = startActioning;

    try {
      const res = await fetch('/api/admin/moderation/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ flaggedContentId: id, action, ...opts }),
      });

      let json: any = null;
      try {
        json = await res.json();
      } catch {
        /* non-JSON error body — fall through to generic message below */
      }

      if (!res.ok || !json?.success) {
        throw new Error(json?.error || json?.message || `Request failed (${res.status})`);
      }

      // Settle-out animation, then remove locally + resync from server.
      const startSettling = new Set(settling);
      startSettling.add(id);
      settling = startSettling;

      await new Promise((resolve) => setTimeout(resolve, 220));

      items = items.filter((it) => it._id !== id);

      const endSettling = new Set(settling);
      endSettling.delete(id);
      settling = endSettling;

      const endActioning = new Map(actioning);
      endActioning.delete(id);
      actioning = endActioning;

      void fetchQueue(); // refresh counts + backfill this page from the server

      return { ok: true, userBanned: json.userBanned, strikeCount: json.strikeCount };
    } catch (err) {
      const endActioning = new Map(actioning);
      endActioning.delete(id);
      actioning = endActioning;
      showError(err instanceof Error ? err.message : String(err));
      return { ok: false };
    }
  }

  // Approve is fully wired (also used for report-dismiss — same 'approve'
  // action per the API). Warn opens AdmWarningModal, reject opens
  // AdmRejectModal (below) — both wired since Tasks 5/6.
  function handleApprove(item: FlaggedItem) {
    if (!item._id) return;
    void runSingleAction(item._id, 'approve');
  }
  // ── Warning modal ────────────────────────────────────────────────────────
  let warnTarget = $state<FlaggedItem | null>(null);

  function handleWarn(item: FlaggedItem) {
    warnTarget = item;
  }

  function handleWarnCancel() {
    warnTarget = null;
  }

  async function handleWarnConfirm(warningText: string) {
    const item = warnTarget;
    if (!item?._id) return;
    warnTarget = null; // close immediately — the card's own optimistic
    // dim/settle (runSingleAction) carries the rest of the feedback.

    const author = item.authorName ?? item.authorId;
    const result = await runSingleAction(item._id, 'approve_with_warning', { warningText });
    if (!result.ok) return; // runSingleAction already surfaced the error toast

    showToast(tStr($t['admin.toast.warn.success'], { author }), { type: 'success' });
  }

  // ── Reject modal (incl. Ban-Bremse) ─────────────────────────────────────
  let rejectTarget = $state<FlaggedItem | null>(null);

  function handleReject(item: FlaggedItem) {
    rejectTarget = item;
  }

  function handleRejectCancel() {
    rejectTarget = null;
  }

  async function handleRejectConfirm(reason: string, notes: string) {
    const item = rejectTarget;
    if (!item?._id) return;
    rejectTarget = null; // close immediately — the card's own optimistic
    // dim/settle (runSingleAction) carries the rest of the feedback.

    const author = item.authorName ?? item.authorId;
    const result = await runSingleAction(item._id, 'reject', { rejectionReason: reason, notes });
    if (!result.ok) return; // runSingleAction already surfaced the error toast

    if (result.userBanned) {
      // §08 — ban toast. Only ever reachable via the confirmed Ban-Bremse
      // checkbox (AdmRejectModal.canSubmit gates the CTA) — never casual.
      showToast(tStr($t['admin.toast.ban.title'], { author }), {
        type: 'error',
        description: $t['admin.toast.ban.sub'],
        duration: 6000,
      });
    } else {
      showToast(tStr($t['admin.toast.reject.success'], { author, n: result.strikeCount ?? 0 }), {
        type: 'success',
      });
    }
  }

  // ── Bulk actions (Task 7) ────────────────────────────────────────────────
  let bulkBusy = $state(false);
  let bulkRejectItems = $state<FlaggedItem[] | null>(null);

  // §05 result toast — built from `results[]` + `bansTriggered`. Shared by
  // both bulk approve and bulk reject; only non-zero parts are appended.
  function showBulkResultToast(action: 'approve' | 'reject', results: Array<{ status: string }>, bansTriggered: number) {
    const succeeded = results.filter((r) => r.status === 'approved' || r.status === 'rejected').length;
    const alreadyProcessed = results.filter((r) => r.status === 'already_processed').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    let msg = tStr(action === 'reject' ? $t['admin.toast.bulk.rejected'] : $t['admin.toast.bulk.approved'], { n: succeeded });
    if (alreadyProcessed > 0) msg += ` · ${tStr($t['admin.toast.bulk.alreadyProcessed'], { n: alreadyProcessed })}`;
    if (failed > 0) msg += ` · ${tStr($t['admin.toast.bulk.failed'], { n: failed })}`;
    if (bansTriggered > 0) msg += ` — ${tStr($t['admin.toast.bulk.banned'], { n: bansTriggered })}`;

    showToast(msg, { type: bansTriggered > 0 ? 'error' : 'success', duration: 6000 });
  }

  // Failed/already-processed items are left alone here on purpose — they
  // stay 'pending' server-side, so the `fetchQueue()` refetch in `finally`
  // naturally keeps them in the list (or drops them if they did succeed).
  async function runBulkAction(
    selItems: FlaggedItem[],
    action: 'approve' | 'reject',
    rejectionReason?: string
  ): Promise<void> {
    if (selItems.length === 0) return;
    bulkBusy = true;

    const label = action === 'reject' ? $t['admin.act.pendingReject'] : $t['admin.act.pendingApprove'];
    const startActioning = new Map(actioning);
    for (const it of selItems) if (it._id) startActioning.set(it._id, label);
    actioning = startActioning;

    try {
      const res = await fetch('/api/admin/moderation/bulk-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          flaggedContentIds: selItems.map((it) => it._id),
          action,
          ...(action === 'reject' ? { rejectionReason } : {}),
        }),
      });

      let json: any = null;
      try {
        json = await res.json();
      } catch {
        /* non-JSON error body — fall through to generic message below */
      }

      if (!res.ok || !json?.success) {
        throw new Error(json?.error || json?.message || `Request failed (${res.status})`);
      }

      showBulkResultToast(action, json.results ?? [], json.bansTriggered ?? 0);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      const endActioning = new Map(actioning);
      for (const it of selItems) if (it._id) endActioning.delete(it._id);
      actioning = endActioning;
      clearSelection();
      bulkBusy = false;
      void fetchQueue();
    }
  }

  function handleBulkApproveAll() {
    void runBulkAction(getSelectedItems(), 'approve');
  }

  function handleBulkRejectOpen() {
    const selItems = getSelectedItems();
    if (selItems.length === 0) return;
    bulkRejectItems = selItems;
  }

  function handleBulkRejectCancel() {
    bulkRejectItems = null;
  }

  function handleBulkRejectConfirm(reason: string) {
    const selItems = bulkRejectItems;
    bulkRejectItems = null; // close immediately — actioning pills on the
    // cards below carry the rest of the feedback, same division of labor
    // as the single-item reject flow.
    if (!selItems || selItems.length === 0) return;
    void runBulkAction(selItems, 'reject', reason);
  }
</script>

<!-- ═══ Desktop (≥ md) — Tasks 4–8, unchanged: view toggle, stat row, ═══
     filter rail, bulk bar, history. ═══════════════════════════════════ -->
<div class="hidden md:block">
<AdmStatRow {counts} />
<AdmErrorsCard />
<AdmTitleBlock {view} onViewChange={handleViewChange} />

{#if view === 'queue'}
  <AdmFilterRail active={filterType} onFilterChange={handleFilterChange} />

  {#if selected.size > 0}
    <AdmBulkBar
      count={selected.size}
      busy={bulkBusy}
      onApproveAll={handleBulkApproveAll}
      onRejectAll={handleBulkRejectOpen}
      onClear={clearSelection}
    />
  {/if}

  <div style="padding: 0 36px 28px; display: flex; flex-direction: column; gap: 16px; position: relative;">
    {#if loading && items.length === 0}
      <!-- §01 loading — skeleton sweep -->
      {#each [0, 1, 2] as i (i)}
        <div style="border: 1px solid var(--k-rule); border-radius: var(--k-radius-md); padding: 12px 14px; background: var(--k-paper);">
          <div class="adm-skeleton-bar" style="height: 10px; width: 38%; border-radius: 5px;"></div>
          <div class="adm-skeleton-bar" style="height: 10px; width: 82%; border-radius: 5px; margin-top: 8px;"></div>
          <div class="adm-skeleton-bar" style="height: 10px; width: 64%; border-radius: 5px; margin-top: 8px;"></div>
        </div>
      {/each}

    {:else if loadError}
      <!-- §06 error -->
      <div style="border: 1.5px solid var(--k-danger); border-radius: var(--k-radius-md); background: var(--k-paper-warm); padding: 14px 16px;">
        <div class="font-bricolage" style="font-size: 13.5px; font-weight: 800;">{$t['admin.state.error.title']}</div>
        <div style="font-size: 12px; color: var(--k-ink-soft); margin-top: 4px; line-height: 1.5;">{$t['admin.state.error.body']}</div>
        <button
          type="button"
          onclick={() => fetchQueue()}
          class="font-bricolage"
          style="margin-top: 10px; display: inline-block; background: var(--k-ink); color: var(--k-paper); border-radius: var(--k-radius-pill); padding: 6px 14px; font-size: 12px; font-weight: 700; box-shadow: 2px 2px 0 var(--k-danger); border: none; cursor: pointer;"
        >{$t['admin.state.error.retry']}</button>
      </div>

    {:else if !items.length && counts}
      <!-- §02 empty — the good state -->
      <div style="text-align: center; padding: 26px 12px;">
        <div style="width: 44px; height: 44px; margin: 0 auto 12px; border-radius: 50%; border: 1.5px solid var(--k-success); display: flex; align-items: center; justify-content: center; color: var(--k-success); font-size: 19px; font-weight: 700;">✓</div>
        <div class="font-bricolage" style="font-size: 17px; font-weight: 800; letter-spacing: -0.02em;">{$t['admin.state.empty.title']}</div>
        <div class="font-instrument" style="font-style: italic; font-size: 13.5px; color: var(--k-ink-soft); margin-top: 4px;">{$t['admin.state.empty.sub']}</div>
      </div>

    {:else}
      {#each items as item (item._id)}
        <AdmQueueCard
          {item}
          selected={selected.has(item._id ?? '')}
          onToggleSelect={() => toggleSelect(item._id)}
          onApprove={handleApprove}
          onWarn={handleWarn}
          onReject={handleReject}
          actioningLabel={item._id ? (actioning.get(item._id) ?? null) : null}
          settling={item._id ? settling.has(item._id) : false}
        />
      {/each}

      <!-- pagination footer -->
      <div style="display: flex; justify-content: center; gap: 14px; align-items: center; font-family: var(--k-font-mono); font-size: 11px; color: var(--k-ink-mute); padding-top: 6px; flex-wrap: wrap;">
        <button
          type="button"
          disabled={page === 0}
          onclick={() => handlePageChange(page - 1)}
          style="border: var(--k-border-ink); border-radius: var(--k-radius-pill); padding: 5px 14px; color: var(--k-ink); font-weight: 600; background: transparent; opacity: {page === 0 ? 0.5 : 1}; cursor: {page === 0 ? 'not-allowed' : 'pointer'};"
        >{$t['admin.page.prev']}</button>

        <span>
          {tStr($t['admin.page.of'], { p: page + 1, t: totalPages, n: total, what: $t['admin.page.pending'] })}
          <select
            value={pageSize}
            onchange={(e) => handlePageSizeChange(Number((e.target as HTMLSelectElement).value))}
            class="font-dmmono"
            style="margin-left: 4px; border: 1px solid var(--k-rule); border-radius: var(--k-radius-sm); background: var(--k-paper); color: var(--k-ink); font-size: 11px; padding: 2px 4px;"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </span>

        <button
          type="button"
          disabled={page >= totalPages - 1}
          onclick={() => handlePageChange(page + 1)}
          style="border: var(--k-border-ink); border-radius: var(--k-radius-pill); padding: 5px 14px; color: var(--k-ink); font-weight: 600; background: transparent; opacity: {page >= totalPages - 1 ? 0.5 : 1}; cursor: {page >= totalPages - 1 ? 'not-allowed' : 'pointer'};"
        >{$t['admin.page.next']}</button>
      </div>
    {/if}
  </div>

{:else}
  <!-- History (Protokoll) — no checkboxes, no bulk bar; disjoint from the
       queue (reviewStatus is always 'reviewed'/'approved'/'rejected', never
       'pending'). -->
  <div style="padding: 14px 36px 4px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
    {#each HIST_FILTERS as f (f)}
      <button
        type="button"
        onclick={() => handleHistFilterChange(f)}
        class="font-bricolage"
        style="
          padding: 5px 12px; font-size: 12.5px; font-weight: 600;
          background: {histFilter === f ? 'var(--k-ink)' : 'transparent'};
          color: {histFilter === f ? 'var(--k-paper)' : 'var(--k-ink)'};
          border: var(--k-border-ink); border-radius: var(--k-radius-pill); cursor: pointer;
        "
      >{$t[HIST_FILTER_LABEL_KEY[f]]}</button>
    {/each}
    <span class="font-dmmono" style="font-size: 10.5px; color: var(--k-ink-mute); margin-left: 6px;">{$t['admin.hist.allNote']}</span>
    <div style="margin-left: auto;">
      <AdmColumnMenu hidden={hiddenCols} onToggle={handleHistColToggle} />
    </div>
  </div>

  <div style="padding: 0 36px 28px;">
    {#if histLoading && histItems.length === 0}
      <!-- loading — same skeleton sweep as the queue -->
      {#each [0, 1, 2] as i (i)}
        <div style="border: 1px solid var(--k-rule); border-radius: var(--k-radius-md); padding: 12px 14px; background: var(--k-paper); margin-top: 12px;">
          <div class="adm-skeleton-bar" style="height: 10px; width: 38%; border-radius: 5px;"></div>
          <div class="adm-skeleton-bar" style="height: 10px; width: 82%; border-radius: 5px; margin-top: 8px;"></div>
        </div>
      {/each}

    {:else if histLoadError}
      <!-- §06 error, same treatment as the queue -->
      <div style="border: 1.5px solid var(--k-danger); border-radius: var(--k-radius-md); background: var(--k-paper-warm); padding: 14px 16px;">
        <div class="font-bricolage" style="font-size: 13.5px; font-weight: 800;">{$t['admin.state.error.title']}</div>
        <div style="font-size: 12px; color: var(--k-ink-soft); margin-top: 4px; line-height: 1.5;">{$t['admin.state.error.body']}</div>
        <button
          type="button"
          onclick={() => fetchHistory()}
          class="font-bricolage"
          style="margin-top: 10px; display: inline-block; background: var(--k-ink); color: var(--k-paper); border-radius: var(--k-radius-pill); padding: 6px 14px; font-size: 12px; font-weight: 700; box-shadow: 2px 2px 0 var(--k-danger); border: none; cursor: pointer;"
        >{$t['admin.state.error.retry']}</button>
      </div>

    {:else if !histItems.length}
      <!-- §03 empty — no decisions made yet -->
      <div style="text-align: center; padding: 26px 12px;">
        <div class="font-bricolage" style="font-size: 17px; font-weight: 800; letter-spacing: -0.02em;">{$t['admin.state.histEmpty.title']}</div>
        <div class="font-instrument" style="font-style: italic; font-size: 13.5px; color: var(--k-ink-soft); margin-top: 4px;">{$t['admin.state.histEmpty.body']}</div>
        <button
          type="button"
          onclick={() => handleViewChange('queue')}
          class="font-bricolage"
          style="margin-top: 12px; background: transparent; color: var(--k-accent); border: none; font-size: 13px; font-weight: 700; cursor: pointer;"
        >{$t['admin.state.histEmpty.cta']}</button>
      </div>

    {:else}
      <AdmHistoryTable items={histItems} {hiddenCols} {sortBy} {sortOrder} onSort={handleHistSort} />

      <!-- pagination footer (Task 4 pattern, admin.page.decisions label) -->
      <div style="display: flex; justify-content: center; gap: 14px; align-items: center; font-family: var(--k-font-mono); font-size: 11px; color: var(--k-ink-mute); padding-top: 16px; flex-wrap: wrap;">
        <button
          type="button"
          disabled={histPage === 0}
          onclick={() => handleHistPageChange(histPage - 1)}
          style="border: var(--k-border-ink); border-radius: var(--k-radius-pill); padding: 5px 14px; color: var(--k-ink); font-weight: 600; background: transparent; opacity: {histPage === 0 ? 0.5 : 1}; cursor: {histPage === 0 ? 'not-allowed' : 'pointer'};"
        >{$t['admin.page.prev']}</button>

        <span>
          {tStr($t['admin.page.of'], { p: histPage + 1, t: histTotalPages, n: histTotal, what: $t['admin.page.decisions'] })}
          <select
            value={histPageSize}
            onchange={(e) => handleHistPageSizeChange(Number((e.target as HTMLSelectElement).value))}
            class="font-dmmono"
            style="margin-left: 4px; border: 1px solid var(--k-rule); border-radius: var(--k-radius-sm); background: var(--k-paper); color: var(--k-ink); font-size: 11px; padding: 2px 4px;"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </span>

        <button
          type="button"
          disabled={histPage >= histTotalPages - 1}
          onclick={() => handleHistPageChange(histPage + 1)}
          style="border: var(--k-border-ink); border-radius: var(--k-radius-pill); padding: 5px 14px; color: var(--k-ink); font-weight: 600; background: transparent; opacity: {histPage >= histTotalPages - 1 ? 0.5 : 1}; cursor: {histPage >= histTotalPages - 1 ? 'not-allowed' : 'pointer'};"
        >{$t['admin.page.next']}</button>
      </div>
    {/if}
  </div>
{/if}
</div>

<!-- ═══ Mobile (< md) — triage only, per the handoff rule "mobil wird ═══
     triagiert, nicht verwaltet": count line, TRIAGE label, the triage
     stack (queue items only — no view toggle, so history is simply
     unreachable here), footer note, pager. No checkboxes, no bulk bar,
     no column menu. Shares `items`/`counts`/`actioning`/`settling` with
     the desktop block above — `fetchQueue()` runs unconditionally on
     mount, so this list is populated regardless of the desktop `view`
     toggle's current position. ═══════════════════════════════════════ -->
<div class="md:hidden">
  <div class="font-dmmono" style="padding: 10px 18px 0; font-size: 10.5px; font-weight: 600; color: var(--k-danger); text-align: right;">
    {counts?.urgent ?? 0} {$t['admin.mobile.urgent']} · {counts?.pending ?? 0} {$t['admin.mobile.open']}
  </div>

  <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;">
    <div class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute); letter-spacing: 0.1em;">{$t['admin.mobile.triage']}</div>

    {#if loading && items.length === 0}
      <!-- §01 loading — skeleton sweep -->
      {#each [0, 1, 2] as i (i)}
        <div style="border: 1px solid var(--k-rule); border-radius: var(--k-radius-md); padding: 12px 14px; background: var(--k-paper);">
          <div class="adm-skeleton-bar" style="height: 10px; width: 38%; border-radius: 5px;"></div>
          <div class="adm-skeleton-bar" style="height: 10px; width: 82%; border-radius: 5px; margin-top: 8px;"></div>
          <div class="adm-skeleton-bar" style="height: 10px; width: 64%; border-radius: 5px; margin-top: 8px;"></div>
        </div>
      {/each}

    {:else if loadError}
      <!-- §06 error -->
      <div style="border: 1.5px solid var(--k-danger); border-radius: var(--k-radius-md); background: var(--k-paper-warm); padding: 14px 16px;">
        <div class="font-bricolage" style="font-size: 13.5px; font-weight: 800;">{$t['admin.state.error.title']}</div>
        <div style="font-size: 12px; color: var(--k-ink-soft); margin-top: 4px; line-height: 1.5;">{$t['admin.state.error.body']}</div>
        <button
          type="button"
          onclick={() => fetchQueue()}
          class="font-bricolage"
          style="margin-top: 10px; display: inline-block; background: var(--k-ink); color: var(--k-paper); border-radius: var(--k-radius-pill); padding: 6px 14px; font-size: 12px; font-weight: 700; box-shadow: 2px 2px 0 var(--k-danger); border: none; cursor: pointer;"
        >{$t['admin.state.error.retry']}</button>
      </div>

    {:else if !items.length && counts}
      <!-- §02 empty — the good state -->
      <div style="text-align: center; padding: 26px 12px;">
        <div style="width: 44px; height: 44px; margin: 0 auto 12px; border-radius: 50%; border: 1.5px solid var(--k-success); display: flex; align-items: center; justify-content: center; color: var(--k-success); font-size: 19px; font-weight: 700;">✓</div>
        <div class="font-bricolage" style="font-size: 17px; font-weight: 800; letter-spacing: -0.02em;">{$t['admin.state.empty.title']}</div>
        <div class="font-instrument" style="font-style: italic; font-size: 13.5px; color: var(--k-ink-soft); margin-top: 4px;">{$t['admin.state.empty.sub']}</div>
      </div>

    {:else}
      {#each items as item (item._id)}
        <AdmTriageCard
          {item}
          onApprove={handleApprove}
          onWarn={handleWarn}
          onReject={handleReject}
          actioningLabel={item._id ? (actioning.get(item._id) ?? null) : null}
          settling={item._id ? settling.has(item._id) : false}
        />
      {/each}
    {/if}

    <div class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute); text-align: center; padding-top: 4px;">
      {$t['admin.mobile.note']}
    </div>

    {#if items.length > 0 && !loading && !loadError}
      <!-- pagination footer — same pager as desktop, mobile padding -->
      <div style="display: flex; justify-content: center; gap: 10px; align-items: center; font-family: var(--k-font-mono); font-size: 11px; color: var(--k-ink-mute); flex-wrap: wrap;">
        <button
          type="button"
          disabled={page === 0}
          onclick={() => handlePageChange(page - 1)}
          style="border: var(--k-border-ink); border-radius: var(--k-radius-pill); padding: 5px 14px; color: var(--k-ink); font-weight: 600; background: transparent; opacity: {page === 0 ? 0.5 : 1}; cursor: {page === 0 ? 'not-allowed' : 'pointer'};"
        >{$t['admin.page.prev']}</button>

        <span>
          {tStr($t['admin.page.of'], { p: page + 1, t: totalPages, n: total, what: $t['admin.page.pending'] })}
          <select
            value={pageSize}
            onchange={(e) => handlePageSizeChange(Number((e.target as HTMLSelectElement).value))}
            class="font-dmmono"
            style="margin-left: 4px; border: 1px solid var(--k-rule); border-radius: var(--k-radius-sm); background: var(--k-paper); color: var(--k-ink); font-size: 11px; padding: 2px 4px;"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </span>

        <button
          type="button"
          disabled={page >= totalPages - 1}
          onclick={() => handlePageChange(page + 1)}
          style="border: var(--k-border-ink); border-radius: var(--k-radius-pill); padding: 5px 14px; color: var(--k-ink); font-weight: 600; background: transparent; opacity: {page >= totalPages - 1 ? 0.5 : 1}; cursor: {page >= totalPages - 1 ? 'not-allowed' : 'pointer'};"
        >{$t['admin.page.next']}</button>
      </div>
    {/if}
  </div>
</div>

<!-- ═══ Shared: modals + toasts (outside both responsive blocks) ═══ -->
{#if rejectTarget}
  <AdmRejectModal item={rejectTarget} onCancel={handleRejectCancel} onConfirm={handleRejectConfirm} />
{/if}

{#if warnTarget}
  <AdmWarningModal item={warnTarget} onCancel={handleWarnCancel} onConfirm={handleWarnConfirm} />
{/if}

{#if bulkRejectItems}
  <AdmBulkRejectModal items={bulkRejectItems} onCancel={handleBulkRejectCancel} onConfirm={handleBulkRejectConfirm} />
{/if}
