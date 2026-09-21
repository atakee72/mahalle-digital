<script lang="ts">
  // Paper dropdown (desktop) / bottom sheet (mobile <1024px) anchored to the nav
  // avatar. Design source: design/handoffs/design_handoff_avatarmenu/
  // jsx/kiosk-avatar-menu.jsx (AvatarMenu) + motion-avatarmenu.css.
  // Foot slot: „Abmelden" as WORD, wine + mono, behind a SOLID ink rule —
  // links to /logout (which runs the real signOut flow → /login?abgemeldet=1).
  // Who-am-i cache lives in avatarMenuCache.ts, NOT a `<script module>`
  // block — see that file's comment (Astro prod CSS-extraction bug).
  import { t } from '../../../lib/kiosk-i18n';
  import { whoamiCache, setWhoamiCache } from './avatarMenuCache';

  // `context`: 'app' (default — KioskNav on the member surfaces) or 'admin'
  // (AdmAvatar in the admin masthead). Admin context adds a „Bereiche" group
  // so the admin can jump to any member surface from the back-office, and
  // drops the „Admin-Bereich" row (you're already there).
  let { user, onClose, context = 'app' } = $props<{
    user: { name?: string | null; role?: string };
    onClose: (restoreFocus: boolean) => void;
    context?: 'app' | 'admin';
  }>();

  const isAdmin = $derived(user?.role === 'admin');

  // Same six surfaces as KioskNav's topNav, same i18n keys.
  const AREAS = [
    { href: '/forum',        key: 'nav.forum' },
    { href: '/calendar',     key: 'nav.calendar' },
    { href: '/newsboard',    key: 'nav.news' },
    { href: '/marketplace',  key: 'nav.marketplace' },
    { href: '/schillerkiez', key: 'nav.kiez' },
    { href: '/blog',         key: 'nav.blog' },
  ] as const;

  // Who-am-i extras — one lazy fetch across the session (module cache above),
  // name renders regardless.
  let handle = $state<string | null>(null);
  let sinceYear = $state<number | null>(null);
  $effect(() => {
    if (whoamiCache) {
      handle = whoamiCache.handle;
      sinceYear = whoamiCache.sinceYear;
      return;
    }
    let alive = true;
    fetch('/api/profile/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.profile) return;
        const next = { handle: d.profile.handle ?? null, sinceYear: d.profile.memberSince ?? null };
        setWhoamiCache(next);
        if (!alive) return;
        handle = next.handle;
        sinceYear = next.sinceYear;
      })
      .catch(() => {});
    return () => { alive = false; };
  });

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let closing = $state(false);
  function close(fromEscape = false) {
    if (closing) return;
    const restoreFocus = fromEscape || (menuEl?.contains(document.activeElement) ?? false);
    if (reduced) { onClose(restoreFocus); return; }
    closing = true;
    setTimeout(() => onClose(restoreFocus), 140);
  }

  let menuEl = $state<HTMLElement | null>(null);

  function onDocPointerDown(e: PointerEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) close();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = menuEl ? Array.from(menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]')) : [];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    // Nothing focused yet (mouse-open): ArrowDown enters at the first row,
    // ArrowUp at the last. (A naive `(i-1+len)%len` with i=-1 lands on the
    // second-to-last — off-by-one, caught in plan audit.)
    const next =
      i === -1
        ? (e.key === 'ArrowDown' ? 0 : items.length - 1)
        : (e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length);
    items[next].focus();
  }
  $effect(() => {
    // Delay the outside-click listener a tick so the opening click doesn't
    // instantly close the menu. No auto-focus on open — a mouse-open would
    // paint an unexpected focus ring; ↑↓ starts keyboard navigation instead.
    const id = setTimeout(() => document.addEventListener('pointerdown', onDocPointerDown), 0);
    document.addEventListener('keydown', onKeydown);
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKeydown);
    };
  });

  // Mobile bottom-sheet: lock scroll while open — on <html> ONLY. global.css
  // sets `html { overflow-x: clip }` (sticky fix), so body overflow never
  // reaches the viewport: a body lock prevents nothing, and it un-sticks the
  // masthead this menu hangs from (it made <body> a scroll container; the bar
  // scrolled away under the scrim — fixed 2026-09-19, see lib/scrollLock.ts).
  // Desktop dropdown deliberately doesn't lock (unchanged behavior).
  $effect(() => {
    if (!window.matchMedia('(max-width: 1023px)').matches) return;
    const prevHtml = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prevHtml;
    };
  });
</script>

<div class="am-scrim" class:am-closing={closing} aria-hidden="true"></div>
<div bind:this={menuEl} class="am-menu" class:am-closing={closing} role="menu" aria-label={user?.name ?? 'Konto'}>
  <div class="am-caret"></div>
  <div class="am-card">
    <div class="am-head">
      <div class="am-name font-bricolage">{user?.name ?? ''}</div>
      {#if handle}
        <div class="am-sub font-dmmono">@{handle}{#if sinceYear}&nbsp;· {$t['nav.menu.seit']} {sinceYear}{/if}</div>
      {/if}
    </div>
    {#if context === 'admin'}
      <div class="am-group am-areas">
        <div class="am-kicker font-dmmono">{$t['nav.menu.areas']}</div>
        {#each AREAS as area (area.href)}
          <a role="menuitem" href={area.href} class="am-row font-bricolage">{$t[area.key]}</a>
        {/each}
      </div>
    {/if}
    <div class="am-group">
      <a role="menuitem" href="/profile" class="am-row font-bricolage">{$t['nav.menu.profil']}<span class="am-icon font-dmmono">→</span></a>
      <a role="menuitem" href="/profile?filter=forum" class="am-row font-bricolage">{$t['nav.menu.beitraege']}</a>
      <a role="menuitem" href="/entwuerfe" class="am-row font-bricolage">{$t['nav.menu.entwuerfe']}</a>
      <a role="menuitem" href="/profile?filter=gespeichert" class="am-row font-bricolage">{$t['nav.menu.gespeichert']}<span class="am-icon font-dmmono">◈</span></a>
      <button role="menuitem" class="am-row font-bricolage" onclick={() => { close(); (window as any).__mahalleTourStart?.(); }}>{$t['nav.menu.tour']}<span class="am-icon font-dmmono">◎</span></button>
      <a role="menuitem" href="/blog" class="am-row font-bricolage">{$t['nav.menu.beilage']}<span class="am-icon font-dmmono">❡</span></a>
    </div>
    {#if isAdmin && context !== 'admin'}
      <div class="am-group am-admin">
        <a role="menuitem" href="/admin/moderation" class="am-row am-plum font-bricolage">{$t['nav.menu.adminArea']}</a>
      </div>
    {/if}
    <div class="am-foot">
      <a role="menuitem" href="/logout" class="am-row am-wine font-dmmono">{$t['nav.menu.abmelden']}<span class="am-icon font-dmmono">⏻</span></a>
    </div>
  </div>
</div>

<!-- Styles live in src/styles/global.css (`.am-*` block), NOT a component
     <style>: Astro's production build extracts scoped CSS of a Svelte
     component imported ONLY through another Svelte island (this one is
     reached solely via KioskNav.svelte) into a chunk that no route links —
     dev renders fine (JS-injected), prod arrives unstyled. Same pattern as
     the .kiosk-toast* global styles. Verified 2026-08-04. -->
