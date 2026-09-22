<script lang="ts">
  // Top navigation chrome — Editorial Kiosk canvas:
  //   left   — wine "m" disc + "mahalle" wordmark + "SCHILLERKIEZ · NEUKÖLLN"
  //   center — outlined pill nav (Forum/Kalender/News/Markt/Kiez/Blog), desktop only
  //   right  — segmented DE/EN pill toggle + ochre user disc (initials)
  //
  // Mobile shows the top bar (brand + locale toggle) plus a fixed bottom nav
  // bar (5 short labels). The avatar opens the account menu on all viewports
  // (bottom sheet on mobile); Profil is the menu's first row.

  import { locale, t, toggleLocale } from '../../../lib/kiosk-i18n';
  import { initialsOf } from '../../../lib/initials';
  import AvatarMenu from './AvatarMenu.svelte';
  import NotificationBell from './NotificationBell.svelte';
  import { untrack } from 'svelte';
  import { initialMastState, nextMastState, MAST_HIDE_QUERY } from '../../../lib/nav/hideOnScroll';

  let { currentPath = '/', user = null } = $props<{
    currentPath?: string;
    user?: { name?: string; image?: string | null; role?: string } | null;
  }>();

  let menuOpen = $state(false);
  let bellOpen = $state(false);
  let avatarEl = $state<HTMLElement | null>(null);

  // ─── Hide-on-scroll (phones/tablets, 2026-09-19) ─────────────────────
  // The bar slides away on a deliberate scroll down and returns on the first
  // scroll up (rules + thresholds: lib/nav/hideOnScroll.ts). It moves by
  // animating the sticky header's `top` — NEVER transform: AvatarMenu's
  // bottom sheet and the notification panel are position:fixed CHILDREN of
  // this header, and a transformed ancestor becomes their containing block
  // (root CLAUDE.md, „backdrop-filter creates a containing block").
  let headerEl = $state<HTMLElement | null>(null);
  let mastHidden = $state(false);
  let mastH = $state(0);

  $effect(() => {
    const el = headerEl;
    if (!el) return;
    const root = document.documentElement;
    const mq = window.matchMedia(MAST_HIDE_QUERY);
    let st = initialMastState(window.scrollY);
    let raf = 0;

    // Write-only on purpose: reading `mastH` back here would make this effect
    // depend on its own write — it re-ran, and its cleanup deleted the
    // --k-mast-offset the effect below had just published (found 2026-09-19).
    const measure = () => {
      const h = el.offsetHeight;
      mastH = h;
      root.style.setProperty('--k-mast-h', `${h}px`);
    };
    const apply = () => {
      raf = 0;
      // untrack: these reads must not turn this effect into a dependent of the
      // menu flags (it would tear down and re-subscribe on every menu toggle).
      const locked = untrack(
        () =>
          !mq.matches ||
          menuOpen ||
          bellOpen ||
          el.querySelector(':focus-visible') !== null ||
          document.querySelector('.tour-card') !== null
      );
      st = nextMastState(st, window.scrollY, root.scrollHeight - window.innerHeight, locked);
      mastHidden = st.hidden;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onResize = () => {
      measure();
      onScroll();
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    mq.addEventListener('change', onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      mq.removeEventListener('change', onScroll);
      root.style.removeProperty('--k-mast-h');
      root.style.removeProperty('--k-mast-offset');
    };
  });

  // Opening a menu, or keyboard focus entering the bar, brings it back at once
  // (the scroll handler only runs on scroll).
  $effect(() => {
    if (menuOpen || bellOpen) mastHidden = false;
  });

  // Published for whatever docks under the bar (BlogReadBar, calendar reveal).
  $effect(() => {
    if (!mastH) return; // not measured yet — consumers keep their own fallback instead of docking at 0 for a frame
    document.documentElement.style.setProperty('--k-mast-offset', mastHidden ? '0px' : `${mastH}px`);
  });

  // Avatar click toggles the account menu on ALL viewports (desktop:
  // anchored dropdown; mobile: bottom sheet — presentation switches in
  // CSS, .am-* block in global.css). /profile stays reachable as the
  // menu's first row; the href remains for no-JS/middle-click semantics.
  function handleAvatarClick(e: MouseEvent) {
    e.preventDefault();
    menuOpen = !menuOpen;
  }
  function closeMenu(restoreFocus: boolean) {
    menuOpen = false;
    // Focus returns to the avatar only when the close originated from Escape
    // or focus was still inside the menu (keyboard nav) — NOT on an
    // outside-click that landed on another interactive element (e.g. a text
    // field), which would otherwise yank focus back 140ms later.
    // preventScroll: the avatar sits in the sticky masthead, so it never needs
    // scrolling into view — and a plain focus() here yanked the page back to the
    // top right after the menu's „Führung" row had scrolled the tour's first
    // anchor into place (Kiez-Daten mobile audit, 2026-09-09).
    if (restoreFocus) avatarEl?.focus({ preventScroll: true });
  }

  // `/` is the public landing now — the Forum pill points at /forum and no
  // longer claims the root path. (Members hitting `/` get SSR-redirected.)
  const FORUM_MATCH = ['/forum', '/topics', '/announcements', '/recommendations'];

  // Calendar covers `/calendar` plus the per-event create/detail routes
  // (e.g. `/events/create`, eventually `/events/{id}`).
  const CALENDAR_MATCH = ['/calendar', '/events'];

  const topNav = $derived([
    { href: '/forum',        label: $t['nav.forum'],       match: FORUM_MATCH },
    { href: '/calendar',     label: $t['nav.calendar'],    match: CALENDAR_MATCH },
    { href: '/newsboard',    label: $t['nav.news'],        match: ['/newsboard'] },
    { href: '/marketplace',  label: $t['nav.marketplace'], match: ['/marketplace'] },
    { href: '/schillerkiez', label: $t['nav.kiez'],        match: ['/schillerkiez'] },
    { href: '/blog',         label: $t['nav.blog'],        match: ['/blog'] }
  ]);

  const bottomNav = $derived([
    { href: '/forum',        label: $t['nav.short.forum'],       match: FORUM_MATCH },
    { href: '/calendar',     label: $t['nav.short.calendar'],    match: CALENDAR_MATCH },
    { href: '/newsboard',    label: $t['nav.short.news'],        match: ['/newsboard'] },
    { href: '/marketplace',  label: $t['nav.short.marketplace'], match: ['/marketplace'] },
    { href: '/schillerkiez', label: $t['nav.short.kiez'],        match: ['/schillerkiez'] }
  ]);

  function isActive(matches: string[]): boolean {
    return matches.some((m) => currentPath === m || (m !== '/' && currentPath.startsWith(m + '/')));
  }

  // Profile isn't a nav tab — while it's the active route, the avatar disc
  // itself carries an ochre ring instead (`.prof-nav-avatar-active` in
  // src/styles/profile.css, which only loads on /profile — harmless no-op
  // class reference on other pages since profileActive is false there).
  const profileActive = $derived(currentPath === '/profile' || currentPath.startsWith('/profile/'));

  // Live avatar update — the nav's `user` prop is a session snapshot (only
  // refreshed on next login/SSR). The profile page's avatar-upload flow
  // (PIdentityCard) dispatches this event on a successful save so the nav
  // reflects the new photo immediately, without a reload. Residual: other
  // tabs/windows stay stale until they revisit a page that re-derives
  // `user` — acceptable, documented in the Task 7 brief (Decision 7).
  let liveImage = $state<string | null>(null);
  $effect(() => {
    function handleAvatarUpdate(e: Event) {
      const url = (e as CustomEvent<{ url: string }>).detail?.url;
      if (url) liveImage = url;
    }
    window.addEventListener('profile:avatar-updated', handleAvatarUpdate);
    return () => window.removeEventListener('profile:avatar-updated', handleAvatarUpdate);
  });
</script>

<!-- ─── Top bar (sticky, all viewports) ───────────────────────────────── -->
<header
  bind:this={headerEl}
  data-mast-hidden={mastHidden ? 'true' : undefined}
  onfocusin={() => (mastHidden = false)}
  class="sticky {menuOpen || bellOpen ? 'z-50' : 'z-40'} border-b-2 border-ink transition-[top] duration-200 ease-out motion-reduce:transition-none"
  style="background: var(--k-bar); top: {mastHidden ? -(mastH + 2) : 0}px;"
>
  <!-- py-2 below lg: a lower bar on phones (user, 2026-09-10); the 44px tap
       boxes inside the 25px locale pill overflow it invisibly, so they don't
       push the row height. -->
  <div class="max-w-7xl mx-auto px-4 md:px-8 py-2 lg:py-3 flex items-center justify-between gap-4">
    <!-- Brand: wine disc + wordmark + place tagline below -->
    <a href="/" class="flex items-center gap-3 group shrink-0 kiosk-tap">
      <span
        class="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-wine text-paper flex items-center justify-center font-bricolage font-bold text-xl leading-none group-hover:scale-105 transition-transform duration-[180ms] ease-out"
        style="box-shadow: var(--k-bar-disc-ring), inset -1px 0 1.5px rgb(27 26 23 / 0.55), inset 1px 0 1.5px rgb(245 239 224 / 0.8);"
      >m</span>
      <span class="hidden sm:flex flex-col leading-tight">
        <span class="font-bricolage font-bold text-xl tracking-tight" style="color: var(--k-bar-fg);">
          {$t['brand.name']}
        </span>
        <span class="font-dmmono text-[10px] uppercase tracking-[0.18em] opacity-80" style="color: var(--k-bar-fg);">
          {$t['brand.location']}
        </span>
      </span>
    </a>

    <!-- Pill nav (desktop only) -->
    <nav class="hidden lg:flex items-center gap-2">
      {#each topNav as item (item.href)}
        <a
          href={item.href}
          class="px-4 py-1.5 rounded-full border-2 font-bricolage font-medium text-sm transition-colors duration-150 {
            isActive(item.match)
              ? 'bg-ink text-paper border-[color:var(--k-paper)] shadow-[inset_-1px_0_3px_rgba(245,239,224,0.75),inset_-1px_0_1.5px_rgba(27,26,23,0.55)]'
              : 'border-ink bg-transparent text-[color:var(--k-bar-fg)] hover:bg-[var(--k-bar-hover)]'
          }"
          aria-current={isActive(item.match) ? 'page' : undefined}
        >
          {item.label}
        </a>
      {/each}
    </nav>

    <!-- Right: segmented locale toggle + avatar disc -->
    <div class="flex items-center gap-3 shrink-0">
      <!-- DE/EN segmented pill. The pill itself is a fixed 25px tall; the two
           buttons wear `.kiosk-tap-box` (44px on touch viewports) and overflow
           it invisibly, with the paint on inner spans — so the hit area grows
           without the pill (user: "too big on mobile", 2026-09-10). -->
      <div
        class="relative inline-flex items-center h-[25px] rounded-full border-2 border-[color:var(--k-bar-pill-border)] font-dmmono text-[11px] uppercase tracking-[0.12em] bg-ink"
        role="group"
        aria-label="Language"
      >
        <button
          type="button"
          onclick={() => $locale === 'en' && toggleLocale()}
          class="kiosk-tap-box inline-flex items-center justify-center"
          aria-pressed={$locale === 'de'}
        >
          <span class="inline-flex items-center justify-center w-full h-[21px] px-2.5 leading-none rounded-l-full transition-colors {
            $locale === 'de' ? 'bg-paper text-ink' : 'bg-ink text-paper hover:text-paper-warm'
          }">DE</span>
        </button>
        <button
          type="button"
          onclick={() => $locale === 'de' && toggleLocale()}
          class="kiosk-tap-box inline-flex items-center justify-center"
          aria-pressed={$locale === 'en'}
        >
          <span class="inline-flex items-center justify-center w-full h-[21px] px-2.5 leading-none rounded-r-full transition-colors {
            $locale === 'en' ? 'bg-paper text-ink' : 'bg-ink text-paper hover:text-paper-warm'
          }">EN</span>
        </button>
        <!-- Same bevel layer as the avatar and the bell disc (user,
             2026-09-22): dark hairline on the right, pale on the left. It
             sits above both halves, because an inset shadow on this box
             would be painted under them. -->
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 rounded-full shadow-[inset_-1px_0_1.5px_rgba(27,26,23,0.55),inset_1px_0_1.5px_rgba(245,239,224,0.8)]"
        ></span>
      </div>

      <!-- User disc (ochre + initials, or photo) -->
      {#if user?.name}
        <NotificationBell onOpenChange={(o: boolean) => (bellOpen = o)} />
        <div class="relative">
          <a
            bind:this={avatarEl}
            href="/profile"
            onclick={handleAvatarClick}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={user.name}
            aria-current={profileActive ? 'page' : undefined}
            class:prof-nav-avatar-active={profileActive}
            class="relative w-9 h-9 rounded-full border-2 border-[color:var(--k-bar-pill-border)] flex items-center justify-center font-dmmono font-bold text-[11px] uppercase tracking-wider bg-paper text-ink hover:scale-105 transition-transform duration-[180ms] ease-out kiosk-tap"
          >
            {#if liveImage ?? user.image}
              <img src={liveImage ?? user.image} alt="" class="w-full h-full object-cover rounded-full" />
            {:else}
              {initialsOf(user.name)}
            {/if}
            <!-- Same bevel the DE/EN pill gets for free from its stacked
                 layers (user, 2026-09-22): a hairline that is dark on the
                 right and light on the left, so the ring reads
                 as raised and the face as set back. Own layer, because an
                 inset shadow on the <a> would sit UNDER the photo. -->
            <span
              aria-hidden="true"
              class="pointer-events-none absolute inset-0 rounded-full shadow-[inset_-1px_0_1.5px_rgba(27,26,23,0.55),inset_1px_0_1.5px_rgba(245,239,224,0.8)]"
            ></span>
          </a>
          {#if menuOpen}
            <AvatarMenu {user} onClose={closeMenu} />
          {/if}
        </div>
      {:else}
        <a
          href="/login"
          aria-label="Sign in"
          class="w-9 h-9 rounded-full border-2 border-ink flex items-center justify-center bg-paper text-ink hover:scale-105 transition-transform duration-[180ms] ease-out kiosk-tap"
        >
          <svg viewBox="0 0 24 24" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="8.5" r="3.5" />
            <path d="M5 19.5c1.4-3 4-4.5 7-4.5s5.6 1.5 7 4.5" />
          </svg>
        </a>
      {/if}
    </div>
  </div>
</header>

<!-- ─── Bottom mobile nav (fixed, hidden on lg+) ──────────────────────── -->
<!-- Both bars paint the section colour (--k-bar, tokens.css, 2026-09-22). -->
<nav
  class="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t-2 border-ink"
  style="background: var(--k-bar);"
  aria-label="Primary"
>
  <div class="flex items-stretch justify-around max-w-md mx-auto">
    {#each bottomNav as item (item.href)}
      <a
        href={item.href}
        class="flex-1 min-h-[44px] flex items-center justify-center py-3.5 font-dmmono text-[10px] uppercase tracking-[0.12em] text-center transition-colors {
          isActive(item.match)
            ? 'font-bold bg-paper-warm text-ink shadow-[inset_-1px_0_1.5px_rgba(27,26,23,0.55),inset_1px_0_1.5px_rgba(245,239,224,0.8)]'
            : 'opacity-[var(--k-bar-dim)] hover:opacity-100 text-[color:var(--k-bar-fg)]'
        }"
        aria-current={isActive(item.match) ? 'page' : undefined}
      >
        {item.label}
      </a>
    {/each}
  </div>
</nav>
