<script lang="ts">
  // Notification list panel — desktop dropdown / mobile bottom sheet.
  // Structural sibling of AvatarMenu.svelte (outside-click a tick late,
  // Escape, dual html+body scroll-lock on mobile) with ONE deliberate
  // deviation per CD's motion spec: close is INSTANT — no 140ms exit fade.
  import { t, tStr } from '../../../lib/kiosk-i18n';
  import type { NotificationItem } from '../../../types/notification';
  import { detectPushState, subscribeToPush, unsubscribeFromPush, type PushUiState } from '../../../lib/pushClient';
  import { showError } from '../../../utils/toast';

  let { onClose } = $props<{ onClose: (restoreFocus: boolean) => void }>();

  let pushState = $state<PushUiState>('hidden');
  let pushBusy = $state(false);

  $effect(() => {
    detectPushState().then((s) => (pushState = s));
  });

  async function enablePush() {
    if (pushBusy) return;
    pushBusy = true;
    const ok = await subscribeToPush();
    pushBusy = false;
    if (ok) {
      pushState = 'subscribed';
    } else {
      // Denied-during-prompt lands here too — re-detect to show the right state.
      pushState = await detectPushState();
      if (pushState !== 'denied') showError($t['nc.push.error']);
    }
  }

  async function disablePush() {
    if (pushBusy) return;
    pushBusy = true;
    await unsubscribeFromPush();
    pushBusy = false;
    pushState = 'ready';
  }

  let items = $state<NotificationItem[] | null>(null);
  let failed = $state(false);
  // Ids that were unread at fetch time — POST /read marks them server-side,
  // but this session still renders them as fresh so nothing feels swallowed.
  // Also feeds the head's „n NEU" counter; capped at the 30-item list by
  // design (the bell badge shows the TRUE unread count — beyond 30 unread
  // the two can differ; deliberate, don't "sync" them).
  let freshIds = $state<Set<string>>(new Set());

  $effect(() => {
    let alive = true;
    fetch('/api/notifications')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!alive) return;
        const list: NotificationItem[] = d.items ?? [];
        items = list;
        freshIds = new Set(list.filter((i) => !i.readAt).map((i) => i.id));
        if ((d.unreadCount ?? 0) > 0) {
          fetch('/api/notifications/read', { method: 'POST' }).catch(() => {});
        }
      })
      .catch(() => {
        if (alive) failed = true;
      });
    return () => {
      alive = false;
    };
  });

  let menuEl = $state<HTMLElement | null>(null);

  // CD motion spec: „Schließen: kein Exit-Theater — sofort weg."
  function close(fromEscape = false) {
    const restoreFocus = fromEscape || (menuEl?.contains(document.activeElement) ?? false);
    onClose(restoreFocus);
  }

  function onDocPointerDown(e: PointerEvent) {
    const t = e.target as Element | null;
    // Clicks on the bell itself must NOT close here — the bell's own click
    // handler toggles; closing on its pointerdown would instantly reopen
    // (close-then-toggle race; AvatarMenu only escapes it via its 140ms
    // deferred close, which CD's instant-close ruling removed here).
    if (t?.closest('.nc-bell')) return;
    if (menuEl && !menuEl.contains(e.target as Node)) close();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const rows = menuEl ? Array.from(menuEl.querySelectorAll<HTMLElement>('a.nc-row')) : [];
    if (!rows.length) return;
    const i = rows.indexOf(document.activeElement as HTMLElement);
    // Nothing focused yet (mouse-open): ArrowDown enters at the first row,
    // ArrowUp at the last (same off-by-one guard as AvatarMenu).
    const next =
      i === -1
        ? (e.key === 'ArrowDown' ? 0 : rows.length - 1)
        : (e.key === 'ArrowDown' ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length);
    rows[next].focus();
  }
  $effect(() => {
    // Listener a tick late so the opening click doesn't instantly close.
    const id = setTimeout(() => document.addEventListener('pointerdown', onDocPointerDown), 0);
    document.addEventListener('keydown', onKeydown);
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKeydown);
    };
  });

  // Mobile bottom-sheet scroll-lock: must lock <html> too — global.css sets
  // `html { overflow-x: clip }` (sticky fix), which stops body overflow from
  // propagating to the viewport, so a body-only lock does nothing.
  //
  // ROOT CAUSE of the mobile-scroll bug this replaces: a one-time
  // `matchMedia(...).matches` read at effect-mount only locks if the panel
  // happens to be OPENED while already narrower than 1024px. If it's opened
  // at desktop width and the viewport later crosses the breakpoint (browser
  // resize, or — same effect — a devtools/responsive-mode toggle) while the
  // panel stays open, the mount-time snapshot was `false` and nothing ever
  // re-evaluates it: the lock silently never engages even though the sheet
  // has already switched to its mobile layout via CSS. Confirmed live via
  // console instrumentation: opening fresh at 390px logged
  // `matches: true` + applied the lock; opening at 1280px then resizing to
  // 390px logged only the initial `matches: false` — no second log line
  // after the resize, and `getComputedStyle().overflow` stayed
  // `"clip visible"` (unlocked) the whole time; a real scroll attempt then
  // moved `window.scrollY` from 0 to 300. Fix: track the query live via
  // `MediaQueryList.addEventListener('change', ...)` instead of a single
  // imperative check, so crossing the breakpoint mid-session (still open)
  // locks/unlocks immediately.
  $effect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    // <html> only — a body `overflow: hidden` locks nothing on this site and
    // un-sticks the masthead (2026-09-19, see lib/scrollLock.ts).
    const prevHtml = document.documentElement.style.overflow;
    let locked = false;
    function sync() {
      if (mq.matches && !locked) {
        document.documentElement.style.overflow = 'hidden';
        locked = true;
      } else if (!mq.matches && locked) {
        document.documentElement.style.overflow = prevHtml;
        locked = false;
      }
    }
    sync();
    mq.addEventListener('change', sync);
    return () => {
      mq.removeEventListener('change', sync);
      if (locked) {
        document.documentElement.style.overflow = prevHtml;
      }
    };
  });

  // CD hybrid rule: accents ONLY on the glyph, only where the SYSTEM speaks.
  // ⇄ for market — NOT ◈, which means „Gespeichert" in the avatar menu.
  const GLYPH: Record<string, { g: string; c: string }> = {
    comment: { g: '✎', c: 'var(--k-ink)' },
    mention: { g: '@', c: 'var(--k-ink)' },
    market_contact: { g: '⇄', c: 'var(--k-ink)' },
    moderation: { g: '§', c: 'var(--k-plum, #6f2f59)' },
    official: { g: '◉', c: 'var(--k-teal, #3f8f9f)' },
  };

  function rowText(it: NotificationItem): string {
    const title = it.target?.title || '…';
    switch (it.type) {
      case 'comment': {
        const actor = it.actorName ?? $t['nc.tombstone'];
        // Per-contentType variants (CD: „DE-Artikel je contentType als Key-Varianten").
        const key = `nc.comment.${it.target?.contentType}`;
        return tStr($t[key] ?? $t['nc.comment.topic'], { actor, title });
      }
      case 'mention': {
        const actor = it.actorName ?? $t['nc.tombstone'];
        return tStr(it.meta?.contentKind === 'comment' ? $t['nc.mention.comment'] : $t['nc.mention.post'], { actor, title });
      }
      case 'official':
        return tStr($t['nc.official'], { title });
      case 'market_contact':
        return tStr($t['nc.market'], { title });
      case 'moderation': {
        const isComment = it.meta?.contentKind === 'comment';
        const o = it.meta?.outcome;
        if (o === 'rejected') {
          const n = String(it.meta?.strikeCount ?? 1);
          return tStr($t[isComment ? 'nc.mod.rejectedComment' : 'nc.mod.rejected'], { n });
        }
        if (o === 'warned') {
          return isComment ? $t['nc.mod.warnedComment'] : tStr($t['nc.mod.warned'], { title });
        }
        return isComment ? $t['nc.mod.approvedComment'] : tStr($t['nc.mod.approved'], { title });
      }
      default:
        return title;
    }
  }

  function relTime(iso: string): string {
    const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (mins < 1) return $t['nc.time.now'];
    if (mins < 60) return tStr($t['nc.time.m'], { n: String(mins) });
    const h = Math.round(mins / 60);
    if (h < 24) return tStr($t['nc.time.h'], { n: String(h) });
    return tStr($t['nc.time.d'], { n: String(Math.round(h / 24)) });
  }
</script>

<div class="nc-scrim" aria-hidden="true"></div>
<div bind:this={menuEl} class="nc-menu" role="dialog" aria-label={$t['nc.title']}>
  <div class="nc-caret"></div>
  <div class="nc-card">
    <div class="nc-grabber" aria-hidden="true"></div>
    <div class="nc-head">
      <span class="nc-head-title font-dmmono">{$t['nc.title']}</span>
      {#if freshIds.size > 0}
        <span class="nc-head-neu font-dmmono">{freshIds.size} {$t['nc.neu']}</span>
      {/if}
    </div>
    {#if failed}
      <div class="nc-empty font-instrument">{$t['nc.error']}</div>
    {:else if items === null}
      <div class="nc-empty font-instrument">…</div>
    {:else if items.length === 0}
      <div class="nc-empty font-instrument">{$t['nc.empty']}</div>
    {:else}
      <div class="nc-list">
        {#each items as it (it.id)}
          <a href={it.target?.href || '/forum'} class="nc-row" class:nc-fresh={freshIds.has(it.id)}>
            <span class="nc-glyph font-dmmono" style="color: {GLYPH[it.type]?.c ?? 'var(--k-ink)'}" aria-hidden="true">{GLYPH[it.type]?.g ?? '•'}</span>
            <span class="nc-text font-bricolage">{rowText(it)}</span>
            <span class="nc-time font-dmmono">{relTime(it.createdAt)}</span>
          </a>
        {/each}
      </div>
    {/if}
    <!-- Foot slot: part of the anatomy from R1, renders NOTHING (CD §6) —
         R2's push opt-in moves in here without head/rows shifting. -->
    {#if pushState === 'hidden'}
      <div class="nc-foot" aria-hidden="true"></div>
    {:else}
      <div class="nc-foot nc-foot--live">
        {#if pushState === 'ready'}
          <button type="button" class="nc-push-btn font-dmmono" disabled={pushBusy} onclick={enablePush}>
            {$t['nc.push.enable']}
          </button>
        {:else if pushState === 'subscribed'}
          <span class="nc-push-note font-instrument">{$t['nc.push.active']}</span>
          <button type="button" class="nc-push-link font-dmmono" disabled={pushBusy} onclick={disablePush}>
            {$t['nc.push.disable']}
          </button>
        {:else if pushState === 'denied'}
          <span class="nc-push-note font-instrument">{$t['nc.push.denied']}</span>
        {:else if pushState === 'ios-install'}
          <span class="nc-push-note font-instrument">{$t['nc.push.ios']}</span>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- Styles live in src/styles/global.css (`.nc-*` block) — nested-island
     CSS orphan rule, same as AvatarMenu. -->
