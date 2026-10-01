<script lang="ts">
  // Admin · Amtliche Mitteilungen — kiosk orchestrator.
  // Design: design/handoffs/design_handoff_announce/jsx/kiosk-admin-announce.jsx
  //
  // Task 3: read side — kicker/H1/counter, board + archive AnnCard
  // lists, skeleton (state 01) + empty (state 02).
  // Task 4 (this pass): composer (create + edit), optimistic pin
  // displacement + undo, unpin/re-pin, delete confirm modal (state 05),
  // and the board↔archive View Transition (`withMove`).
  import { onMount, tick } from 'svelte';
  import { t, tStr, locale } from '../../../../lib/kiosk-i18n';
  import { showToast, showError } from '../../../../utils/toast';
  import { isPinned, fmtKickerDate, truncate, type AnnLang } from './annFormat';
  import { MAX_PINS, pickDisplaced } from '../../../../lib/announcements/pinRules';
  import AnnCard from './AnnCard.svelte';
  import AnnComposer from './AnnComposer.svelte';
  import AdmModalShell from '../AdmModalShell.svelte';
  import AdmActionBtn from '../AdmActionBtn.svelte';

  let { initialItems = [] }: { initialItems?: any[] } = $props();

  // ── State contract ──────────────────────────────────────────────────────
  // svelte-ignore state_referenced_locally
  let status = $state<'loading' | 'ready'>(initialItems.length > 0 ? 'ready' : 'loading');
  // svelte-ignore state_referenced_locally
  let items = $state<any[]>(initialItems);

  let editing = $state<any | null>(null); // item loaded into composer
  let saving = $state(false);
  let composeError = $state(false);
  let confirmDelete = $state<any | null>(null); // item pending delete modal
  let composerTitle = $state('');
  let composerBody = $state('');
  // Bumped after every successful create so the composer remounts blank
  // even though `editing` stays null across repeated creates.
  let composerResetKey = $state(0);

  // seq-guard for GET fetches (initial load + post-mutation reconcile) —
  // same pattern as NewsboardIndexInner.
  let seq = 0;

  async function loadItems(): Promise<void> {
    status = 'loading';
    const mySeq = ++seq;
    try {
      const res = await fetch('/api/admin/announcements', { credentials: 'include' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      if (mySeq !== seq) return;
      items = Array.isArray(json.items) ? json.items : [];
    } catch {
      if (mySeq !== seq) return;
      items = [];
      showError($t['admin.ann.toast.loadError']);
    } finally {
      if (mySeq === seq) status = 'ready';
    }
  }

  // Background reconciliation after a successful mutation — reconciles
  // author population / server-side displacement side-effects without
  // flipping `status` (the optimistic state already looks right).
  async function refetch(opts: { animate?: boolean } = {}): Promise<void> {
    const mySeq = ++seq;
    try {
      const res = await fetch('/api/admin/announcements', { credentials: 'include' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      if (mySeq !== seq) return;
      if (opts.animate) {
        await withMove(() => {
          items = Array.isArray(json.items) ? json.items : [];
        });
      } else {
        items = Array.isArray(json.items) ? json.items : [];
      }
    } catch {
      // silent — the optimistic state stands, next successful reconcile wins
    }
  }

  onMount(() => {
    // initialItems.length > 0 → SSR already delivered the real list, no
    // refetch needed. Empty array covers both a genuinely empty board AND
    // an SSR failure — either way a client-side fetch is the source of
    // truth before we commit to state 02.
    if (initialItems.length === 0) void loadItems();
  });

  // Up to MAX_PINS pinned officials; newest pin first (pinnedUntil desc —
  // fixed 7-day duration means a later expiry is a later pin).
  const pinnedItems = $derived(
    items
      .filter((it) => isPinned(it))
      .slice()
      .sort((a, b) => new Date(b.pinnedUntil).getTime() - new Date(a.pinnedUntil).getTime())
  );
  const archiveItems = $derived(items.filter((it) => !isPinned(it)));
  // The pin that would be displaced by a NEW pin right now (null = room).
  const nextDisplaced = $derived(pickDisplaced(pinnedItems));

  // Live clock — re-derives the kicker every minute (mirrors AdmTitleBlock).
  let now = $state(new Date());
  $effect(() => {
    const id = setInterval(() => (now = new Date()), 60_000);
    return () => clearInterval(id);
  });

  const lang = $derived(($locale === 'de' ? 'DE' : 'EN') as AnnLang);
  // `now &&` forces a read of the ticking clock so this derivation re-runs
  // every minute — fmtKickerDate itself always uses `new Date()` internally
  // (it has no date param per spec) so nothing else here depends on `now`.
  const kicker = $derived(`${$t['admin.ann.kicker']} · ${now && fmtKickerDate(lang)}`);
  const counter = $derived(tStr($t['admin.ann.counter'], { n: items.length, p: pinnedItems.length, max: MAX_PINS }));

  // Mobile card sizing — AnnCard's `compact` prop tracks the same md
  // breakpoint AdminLayout uses for its own desktop/mobile masthead split.
  let compactCards = $state(false);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => (compactCards = mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  });

  // Task 5 — mobile stack: below `md` the composer column collapses
  // behind a full-width CTA. Same `AnnComposer` instance throughout —
  // this just toggles whether its wrapper carries `hidden` on mobile.
  // Desktop ignores this entirely (composer wrapper is `md:block` always).
  let showMobileComposer = $state(false);

  function handleMobileCtaClick() {
    if (showMobileComposer) {
      showMobileComposer = false;
    } else {
      void focusComposer();
    }
  }

  // ── Board↔archive displacement motion ───────────────────────────────────
  // A CSS transition class can't animate a card crossing between the board
  // and archive DOM subtrees — same-document View Transitions API instead.
  // Every AnnCard wrapper below carries a stable view-transition-name so
  // the browser can match old/new position across the mutation.
  async function withMove(apply: () => void) {
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // @ts-ignore — startViewTransition typing may lag
    if (reduced || typeof document === 'undefined' || !document.startViewTransition) {
      apply();
      return;
    }
    // @ts-ignore — startViewTransition typing may lag
    document.startViewTransition(async () => {
      apply();
      await tick();
    });
  }

  // Scrolls the composer into view + focuses the title field. Used by the
  // empty-state CTA and by "✎ bearbeiten" (edit prefill).
  async function focusComposer() {
    showMobileComposer = true;
    await tick();
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wrap = document.getElementById('ann-composer');
    wrap?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    (document.getElementById('ann-composer-title') as HTMLInputElement | null)?.focus();
  }

  // ── Create (optimistic, state 03) ───────────────────────────────────────
  async function handleCreateSubmit(title: string, body: string) {
    composeError = false;
    const prevItems = [...items];
    const displaced = nextDisplaced;
    let createdId: string | null = null; // set after the server confirms
    const displacedUntilISO = displaced ? new Date(displaced.pinnedUntil).toISOString() : null;
    const tempId = 'tmp-' + crypto.randomUUID();

    await withMove(() => {
      if (displaced) {
        items = items.map((it) => (it._id === displaced._id ? { ...it, pinnedUntil: null } : it));
      }
      items = [
        {
          _id: tempId,
          title,
          body,
          pinnedUntil: new Date(Date.now() + 7 * 864e5).toISOString(),
          createdAt: new Date().toISOString(),
          editCount: 0,
          _pending: true,
        },
        ...items,
      ];
    });

    saving = true;

    async function undoDisplacement() {
      if (!displaced || !displacedUntilISO || !createdId) return;
      try {
        const patch = (id: string, pinnedUntil: string | null) =>
          fetch(`/api/admin/announcements/${id}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pinnedUntil }),
          });
        // 1) the new post gives its pin back, 2) the displaced one returns.
        const r1 = await patch(createdId, null);
        if (!r1.ok) throw new Error(String(r1.status));
        const r2 = await patch(displaced._id, displacedUntilISO);
        if (!r2.ok) throw new Error(String(r2.status));
        await refetch({ animate: true });
        showToast($t['admin.ann.toast.undone'], { type: 'success' });
      } catch {
        showError($t['admin.ann.toast.actionError']);
        await refetch({ animate: true });
      }
    }

    try {
      const res = await fetch('/api/admin/announcements/create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, tags: [], images: [] }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      createdId = String(json.announcement._id);

      items = items.map((it) => (it._id === tempId ? json.announcement : it));
      composerTitle = '';
      composerBody = '';
      composerResetKey += 1;
      saving = false;

      const canUndo = !!(displaced && displacedUntilISO && new Date(displacedUntilISO).getTime() > Date.now());
      showToast(
        displaced
          ? tStr($t['admin.ann.toast.posted.replaced'], { title: truncate(displaced.title, 28) })
          : $t['admin.ann.toast.posted'],
        {
          type: 'success',
          ...(canUndo
            ? { action: { label: $t['admin.ann.toast.undo'], onClick: undoDisplacement }, duration: 8000 }
            : {}),
        }
      );

      void refetch();
    } catch {
      await withMove(() => {
        items = prevItems;
      });
      saving = false;
      composeError = true;
    }
  }

  // ── Unpin ────────────────────────────────────────────────────────────────
  async function handleUnpin(item: any) {
    const prevItems = [...items];
    await withMove(() => {
      items = items.map((it) => (it._id === item._id ? { ...it, pinnedUntil: null } : it));
    });
    try {
      const res = await fetch(`/api/admin/announcements/${item._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinnedUntil: null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      showToast($t['admin.ann.toast.unpinned'], { type: 'info' });
      void refetch();
    } catch {
      await withMove(() => {
        items = prevItems;
      });
      showError($t['admin.ann.toast.actionError']);
    }
  }

  // ── Re-pin ───────────────────────────────────────────────────────────────
  async function handleRepin(item: any) {
    const prevItems = [...items];
    const other = pickDisplaced(pinnedItems, item._id);
    const thatISO = new Date(Date.now() + 7 * 864e5).toISOString();
    await withMove(() => {
      if (other) {
        items = items.map((it) => (it._id === other._id ? { ...it, pinnedUntil: null } : it));
      }
      items = items.map((it) => (it._id === item._id ? { ...it, pinnedUntil: thatISO } : it));
    });
    try {
      const res = await fetch(`/api/admin/announcements/${item._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinnedUntil: thatISO }),
      });
      if (!res.ok) throw new Error(String(res.status));
      showToast($t['admin.ann.toast.repinned'], { type: 'success' });
      void refetch();
    } catch {
      await withMove(() => {
        items = prevItems;
      });
      showError($t['admin.ann.toast.actionError']);
    }
  }

  // ── Edit ─────────────────────────────────────────────────────────────────
  function handleEditClick(item: any) {
    editing = item;
    composerTitle = item.title;
    composerBody = item.body;
    composeError = false;
    void focusComposer();
  }

  function handleCancelEdit() {
    editing = null;
    composerTitle = '';
    composerBody = '';
    composeError = false;
  }

  async function handleEditSubmit(title: string, body: string) {
    if (!editing) return;
    const targetId = editing._id;
    composeError = false;
    saving = true;
    try {
      const res = await fetch(`/api/admin/announcements/${targetId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      items = items.map((it) => (it._id === targetId ? json.announcement : it));
      editing = null;
      composerTitle = '';
      composerBody = '';
      saving = false;
      showToast($t['admin.ann.toast.saved'], { type: 'success' });
      void refetch();
    } catch {
      saving = false;
      composeError = true;
    }
  }

  function handleRetry() {
    composeError = false;
  }

  // ── Delete (state 05) ────────────────────────────────────────────────────
  function handleDeleteClick(item: any) {
    confirmDelete = item;
  }

  function handleDeleteCancel() {
    confirmDelete = null;
  }

  async function handleDeleteConfirm() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    confirmDelete = null;
    try {
      const res = await fetch(`/api/admin/announcements/${target._id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(String(res.status));
      items = items.filter((it) => it._id !== target._id);
      showToast($t['admin.ann.toast.deleted'], { type: 'success' });
      void refetch();
    } catch {
      showError($t['admin.ann.toast.actionError']);
    }
  }
</script>

<div class="mx-auto" style="max-width:1280px;">
  <section class="px-4 pt-5 md:px-9 md:pt-[22px]">
    <div class="font-dmmono text-[10px] md:text-[11px] tracking-[0.12em]" style="color: var(--k-accent);">{kicker}</div>
    <h1
      class="font-bricolage font-extrabold text-ink leading-[0.95] mt-1.5 text-[28px] md:text-[48px]"
      style="letter-spacing: -0.035em;"
    >{$t['admin.ann.title.a']}<span class="font-instrument italic font-normal" style="color: var(--k-accent);">{$t['admin.ann.title.accent']}</span>{$t['admin.ann.title.b']}</h1>
    {#if status === 'ready'}
      <div class="font-dmmono text-[10px] md:text-[11px] text-ink-mute mt-2.5 pb-3.5" style="border-bottom: 1px dashed var(--k-rule);">
        {counter}
      </div>
    {:else}
      <div class="pb-3.5" style="border-bottom: 1px dashed var(--k-rule);">
        <div class="ann-skel" style="width: 40%; height: 12px; border-radius: 4px; margin-top: 12px;"></div>
      </div>
    {/if}
  </section>

  <section class="px-4 pt-5 pb-8 md:px-9 md:pt-[22px] md:pb-8 grid grid-cols-1 md:[grid-template-columns:460px_1fr] gap-6 items-start">
    <div class="relative" id="ann-composer">
      <div class="md:hidden mb-3.5">
        <button
          type="button"
          onclick={handleMobileCtaClick}
          class="font-bricolage w-full"
          style="
            min-height: 48px; background: var(--k-ink); color: var(--k-paper);
            border: var(--k-border-ink); border-radius: var(--k-radius-pill);
            font-size: 14.5px; font-weight: 700; box-shadow: 2px 2px 0 var(--k-teal);
            cursor: pointer;
          "
        >{$t['admin.ann.mobile.cta']}</button>
        <div class="font-dmmono text-[9.5px] text-ink-mute text-center" style="margin-top: 6px;">
          {$t['admin.ann.mobile.hint']}
        </div>
      </div>
      <div class="{showMobileComposer ? '' : 'hidden'} md:block">
        {#if status === 'loading'}
          <div class="ann-skel" style="width: 100%; height: 230px; border-radius: var(--k-radius-lg);"></div>
        {:else}
          {#key (editing?._id ?? 'new') + ':' + composerResetKey}
            <AnnComposer
              mode={editing ? 'edit' : 'create'}
              initialTitle={editing ? composerTitle : ''}
              initialBody={editing ? composerBody : ''}
              currentPinTitle={nextDisplaced?.title ?? null}
              {saving}
              errorState={composeError}
              onSubmit={editing ? handleEditSubmit : handleCreateSubmit}
              onCancel={editing ? handleCancelEdit : undefined}
              onRetry={handleRetry}
            />
          {/key}
        {/if}
      </div>
    </div>

    <div class="flex flex-col gap-3.5">
      {#if status === 'loading'}
        <div class="ann-skel" style="width: 55%; height: 16px; border-radius: 4px;"></div>
        <div class="ann-skel" style="width: 100%; height: 140px; border-radius: var(--k-radius-lg);"></div>
        <div class="ann-skel" style="width: 40%; height: 14px; border-radius: 4px; margin-top: 8px;"></div>
        <div class="ann-skel" style="width: 100%; height: 90px; border-radius: var(--k-radius-lg);"></div>
        <div class="ann-skel" style="width: 100%; height: 90px; border-radius: var(--k-radius-lg);"></div>
      {:else if items.length === 0}
        <div class="text-center px-3 py-8">
          <div class="font-instrument italic text-ink-soft" style="font-size: 19px;">{$t['admin.ann.empty.title']}</div>
          <div class="text-[12.5px] text-ink-mute mt-1.5 leading-normal">{$t['admin.ann.empty.hint']}</div>
          <div class="mt-3">
            <button
              type="button"
              onclick={focusComposer}
              class="font-bricolage"
              style="background: transparent; color: var(--k-accent); border: 1.5px solid var(--k-accent); border-radius: var(--k-radius-pill); padding: 6px 13px; font-size: 12px; font-weight: 700; cursor: pointer;"
            >{$t['admin.ann.empty.cta']}</button>
          </div>
        </div>
      {:else}
        {#if pinnedItems.length > 0}
          <div class="font-dmmono text-[10px] text-ink-mute tracking-[0.12em] md:hidden">{$t['admin.ann.mobile.board']}</div>
          <div class="font-dmmono text-[10px] text-ink-mute tracking-[0.12em] hidden md:block">{$t['admin.ann.section.board']}</div>
          {#each pinnedItems as pinned (pinned._id)}
            <div style:view-transition-name={'ann-' + pinned._id}>
              <AnnCard
                item={pinned}
                compact={compactCards}
                pending={!!pinned._pending}
                onEdit={handleEditClick}
                onUnpin={handleUnpin}
                onRepin={handleRepin}
                onDelete={handleDeleteClick}
              />
            </div>
          {/each}
        {/if}
        {#if archiveItems.length > 0}
          <div class="font-dmmono text-[10px] text-ink-mute tracking-[0.12em] md:hidden" style="margin-top: {pinnedItems.length > 0 ? '10px' : '0'};">
            {$t['admin.ann.mobile.archive']}
          </div>
          <div class="font-dmmono text-[10px] text-ink-mute tracking-[0.12em] hidden md:block" style="margin-top: {pinnedItems.length > 0 ? '10px' : '0'};">
            {$t['admin.ann.section.archive']}
          </div>
          {#each archiveItems as item (item._id)}
            <div style:view-transition-name={'ann-' + item._id}>
              <AnnCard
                {item}
                compact={compactCards}
                onEdit={handleEditClick}
                onUnpin={handleUnpin}
                onRepin={handleRepin}
                onDelete={handleDeleteClick}
              />
            </div>
          {/each}
        {/if}
      {/if}
    </div>
  </section>
</div>

{#if confirmDelete}
  <AdmModalShell accent="var(--k-danger)" width={560} onClose={handleDeleteCancel}>
    <h2 class="font-bricolage" style="margin: 0 0 8px; font-size: 22px; font-weight: 800; letter-spacing: -0.02em;">
      {$t['admin.ann.modal.delete.title']}
    </h2>
    <p style="font-size: 13px; color: var(--k-ink-soft); line-height: 1.55; margin: 0 0 18px;">
      {tStr($t['admin.ann.modal.delete.body'], { title: truncate(confirmDelete.title, 40) })}
    </p>
    <div style="display: flex; gap: 10px; justify-content: flex-end;">
      <AdmActionBtn variant="outline" onclick={handleDeleteCancel}>{$t['admin.ann.cta.cancel']}</AdmActionBtn>
      <AdmActionBtn variant="danger" onclick={handleDeleteConfirm}>{$t['admin.ann.modal.delete.confirm']}</AdmActionBtn>
    </div>
  </AdmModalShell>
{/if}
