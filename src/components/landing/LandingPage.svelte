<script lang="ts">
  // Das Schaufenster — public landing (design/handoffs/design_handoff_landing).
  // Data is SSR-provided via props (lib-direct, 1h cache); the ONLY runtime
  // JS behaviors are the locale toggle and the date line. Pulse is pure CSS.
  import { onMount } from 'svelte';
  import { advance, activeIndex } from '../../lib/landing/loop';
  import { t, tStr, locale, setLocale } from '../../lib/kiosk-i18n';
  import type { LandingData, HeartbeatRow } from '../../lib/landing';
  import { buildFrames, type Frame, type SectionKey, type BlogPeek } from '../../lib/landing/frames';
  import { cloudinaryFit, optimizeCloudinary } from '../../utils/cloudinary';
  import { relTime } from '../../lib/relTime';

  let { data, blog } = $props<{
    data: LandingData;
    blog: BlogPeek[];
  }>();

  const GITHUB_URL = 'https://github.com/atakee72/mahalle-digital';
  const year = new Date().getFullYear();

  const dateLine = $derived(
    new Intl.DateTimeFormat($locale === 'de' ? 'de-DE' : 'en-GB', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin',
    })
      .format(new Date())
      .toUpperCase()
      .replace(', ', ' · '),
  );

  function rowLabel(r: HeartbeatRow): string {
    switch (r.kind) {
      case 'air':
        return r.mute
          ? $t['lnd.strip.airMute']
          : tStr($t['lnd.strip.air'], { grade: $t[`lnd.air.grade.${r.value}`] ?? '' });
      case 'forum':
        return r.value === 1 ? $t['lnd.strip.forum1'] : tStr($t['lnd.strip.forum'], { n: String(r.value) });
      case 'events':
        return r.value === 1 ? $t['lnd.strip.events1'] : tStr($t['lnd.strip.events'], { n: String(r.value) });
      case 'kurier':
        return $t['lnd.strip.kurier'];
      default:
        return '';
    }
  }

  const DOT: Record<string, string> = {
    air: '#9db97c', forum: '#d16a87', events: '#6fb5c4', kurier: 'var(--k-paper)',
  };

  // Sparkline points from lqiMean values (nulls = gaps, simply skipped —
  // never interpolated). Y inverted: grade 1 (best) at top.
  function sparkPoints(vals: (number | null)[], w: number, h: number): string {
    const pts: string[] = [];
    const n = vals.length;
    vals.forEach((v, i) => {
      if (v == null) return;
      const x = n === 1 ? w / 2 : (i / (n - 1)) * (w - 2) + 1;
      const y = 1 + ((v - 1) / 4) * (h - 2);
      pts.push(`${x.toFixed(1)},${Math.min(h - 1, Math.max(1, y)).toFixed(1)}`);
    });
    return pts.join(' ');
  }

  function fmtBlogDate(iso: string): string {
    return new Intl.DateTimeFormat($locale === 'de' ? 'de-DE' : 'en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
    }).format(new Date(iso)).toUpperCase();
  }

  // ── Das Schaufenster (2026-09-28): six live frames, per-frame zero rule ──
  const FALLBACKS: Record<SectionKey, string> = {
    forum: '/assets/schaufenster/forum.webp',
    calendar: '/assets/schaufenster/calendar.webp',
    marketplace: '/assets/schaufenster/marketplace.webp',
    newsboard: '/assets/schaufenster/newsboard.webp',
    schillerkiez: '/assets/schaufenster/schillerkiez.webp',
    blog: '/assets/schaufenster/blog.webp',
  };
  const PAPER_LINES = 'repeating-linear-gradient(90deg, rgb(243 234 216 / 0.12) 0 1px, transparent 1px 3px)';
  const SECTION: Record<SectionKey, { tint: string; lines: string }> = {
    forum: { tint: 'var(--k-wine-deep)', lines: 'var(--k-bar-lines)' },
    calendar: { tint: '#3f7e8a', lines: 'var(--k-bar-lines)' },
    marketplace: { tint: '#d68a1a', lines: 'var(--k-bar-lines)' },
    newsboard: { tint: 'var(--k-ink)', lines: PAPER_LINES },
    schillerkiez: { tint: 'var(--k-moss)', lines: 'var(--k-bar-lines)' },
    blog: { tint: 'var(--k-rust)', lines: 'var(--k-bar-lines)' },
  };
  const frames: Frame[] = $derived(buildFrames({ ...data, blog: blog[0] ?? null }, FALLBACKS));
  // ── motion: one native scroll container, rAF-driven scrollLeft, frames
  //    rendered twice for a seamless wrap (loop.ts). Reduced motion: one copy,
  //    no drive. Pause on any interaction, resume 4 s after the last one. ──
  const SPEED_PX_S = 40;
  const RESUME_MS = 4000;
  let trackEl = $state<HTMLDivElement | null>(null);
  let reduced = $state(false);
  let looping = $derived(!reduced && frames.length >= 2);
  let copies = $state(2); // 3 when one copy is narrower than the viewport plus a frame (wide screens), else the wrap point is unreachable
  let renderFrames = $derived(looping ? Array.from({ length: copies }, () => frames).flat() : frames);
  let paused = $state(false);       // user-held pause (toggle button)
  let interacting = $state(false);  // pointer/touch/wheel/focus/hover hold
  let inView = $state(true);     // IntersectionObserver
  let docVisible = $state(true); // document.visibilityState
  const visible = $derived(inView && docVisible);
  let active = $state(0);
  let raf = 0;
  let last = 0;
  let pos = 0;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;

  const running = $derived(looping && !paused && !interacting && visible);

  function step(): number {
    const first = trackEl?.querySelector<HTMLElement>('.lnd-sf-item');
    if (!trackEl || !first) return 0;
    const gap = parseFloat(getComputedStyle(trackEl).columnGap || getComputedStyle(trackEl).gap || '0') || 0;
    return first.offsetWidth + gap;
  }

  function tick(t: number) {
    if (!trackEl || !running) { raf = 0; return; }
    const dt = last ? Math.min(64, t - last) : 16;
    last = t;
    // float accumulator: scrollLeft reads back device-pixel-rounded, which skews or stalls the speed
    if (Math.abs(trackEl.scrollLeft - pos) > 1) pos = trackEl.scrollLeft;
    pos = advance(pos, step() * frames.length, (SPEED_PX_S * dt) / 1000);
    trackEl.scrollLeft = pos;
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (!trackEl || raf || !running) return;
    trackEl.style.scrollSnapType = 'none'; // a snap container re-snaps on every programmatic scroll
    last = 0;
    pos = trackEl.scrollLeft;
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (trackEl) trackEl.style.scrollSnapType = '';
  }
  function hold() {
    interacting = true;
    clearTimeout(resumeTimer);
  }
  function release() {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => { if (!hovering) interacting = false; }, RESUME_MS);
  }
  function onScroll() {
    if (!trackEl) return;
    const s = step();
    if (s > 0) active = activeIndex(trackEl.scrollLeft, s, frames.length);
  }
  function onKey(e: KeyboardEvent) {
    if (!trackEl || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    hold();
    trackEl.scrollBy({ left: e.key === 'ArrowRight' ? step() : -step(), behavior: 'auto' });
    release();
  }

  $effect(() => { if (running) start(); else stop(); });

  $effect(() => { if (looping && trackEl) fitCopies(); });

  function fitCopies() {
    if (!trackEl || !looping) return;
    const period = step() * frames.length;
    if (period > 0) copies = period + trackEl.clientWidth + 100 > 2 * period ? 3 : 2;
  }

  onMount(() => {
    fitCopies();
    const ro = trackEl ? new ResizeObserver(fitCopies) : null;
    if (trackEl && ro) ro.observe(trackEl);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    const onMq = () => { reduced = mq.matches; };
    mq.addEventListener('change', onMq);
    const io = trackEl ? new IntersectionObserver((es) => { inView = es.some((e) => e.isIntersecting); }, { threshold: 0.1 }) : null;
    if (trackEl && io) io.observe(trackEl);
    const onVis = () => { docVisible = document.visibilityState === 'visible'; };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mq.removeEventListener('change', onMq);
      io?.disconnect();
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      clearTimeout(resumeTimer);
      stop();
    };
  });

  function berlinDayDisc(iso: string): { wd: string; day: string; time: string } {
    const d = new Date(iso);
    const loc = $locale === 'de' ? 'de-DE' : 'en-GB';
    const wd = new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'Europe/Berlin' }).format(d).replace('.', '').toUpperCase();
    const day = new Intl.DateTimeFormat(loc, { day: 'numeric', timeZone: 'Europe/Berlin' }).format(d);
    const time = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(d);
    return { wd, day, time };
  }
  function priceFmt(n: number): string {
    return new Intl.NumberFormat($locale === 'de' ? 'de-DE' : 'en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  }
  function catLabel(cat: string | null): string {
    return (cat && ($t as Record<string, string>)[`cal.cat.${cat}.label`]) || '';
  }
  function hideOnError(e: Event) {
    (e.currentTarget as HTMLImageElement).style.display = 'none';
  }
  function frameLabel(f: Frame): string {
    const bar = $t[`lnd.sf.bar.${f.key}`];
    const cap = $t[`lnd.sf.cap.${f.key}`];
    const title = f.live && 'title' in f.live ? f.live.title : f.live?.key === 'newsboard' ? f.live.lead.title : '';
    return title ? `${bar}: ${cap} — ${title}` : `${bar}: ${cap}`;
  }
</script>

<div class="lnd-root">
  <!-- §02 VOLLBILD GESPIEGELT — z0 layer; every sibling is z1 via CSS below -->
  <div class="lnd-bg" aria-hidden="true"></div>

  <!-- date line -->
  <div class="lnd-dateline font-dmmono">
    <span>{dateLine}</span>
    <span class="lnd-loc">{$t['lnd.loc']}</span>
    <span class="lnd-dateline-right">
      <a href="/login" class="lnd-signin">{$t['lnd.signin']}</a>
      <span class="lnd-lang">
        <button type="button" class:active={$locale === 'de'} onclick={() => setLocale('de')}>DE</button>
        <span aria-hidden="true">|</span>
        <button type="button" class:active={$locale === 'en'} onclick={() => setLocale('en')}>EN</button>
      </span>
    </span>
  </div>

  <!-- masthead -->
  <header class="lnd-masthead">
    <h1 class="font-bricolage">M<span class="font-instrument lnd-a">a</span>halle</h1>
    <p class="font-instrument lnd-manifest">{$t['lnd.manifest']}</p>
  </header>
  <div class="lnd-rule"><div class="lnd-rule-thick"></div><div class="lnd-rule-thin"></div></div>

  <!-- Das Schaufenster (2026-09-28): six phone frames, live content, per-frame fallback -->
  {#if frames.length > 0}
    <section class="lnd-sf" aria-label={$t['lnd.sf.region']}>
      <div class="lnd-sf-head font-dmmono">
        <span class="lnd-sf-kicker">{$t['lnd.sf.kicker']}</span>
        <span class="lnd-sf-head-right">
          {#if !looping}<span class="lnd-sf-hint-phone">{$t['lnd.sf.hint.phone']}</span>{/if}
          <span class="lnd-sf-hint-desktop">{$t['lnd.sf.hint.desktop']}</span>
          {#if looping}
            <button type="button" class="lnd-sf-pausebtn font-dmmono" aria-pressed={paused} onclick={() => { paused = !paused; }}>{paused ? $t['lnd.sf.play'] : $t['lnd.sf.pause']}</button>
          {/if}
        </span>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="lnd-sf-track no-scrollbar" role="region" aria-label={$t['lnd.sf.region']} tabindex="0"
        bind:this={trackEl}
        onscroll={onScroll}
        onpointerdown={hold} onpointerup={release} onpointercancel={release}
        ontouchstart={hold} ontouchend={release} ontouchcancel={release}
        onwheel={() => { hold(); release(); }} onpointerenter={(e) => { if (e.pointerType === 'mouse') { hovering = true; hold(); } }} onpointerleave={(e) => { if (e.pointerType === 'mouse') { hovering = false; release(); } }}
        onfocusin={hold} onfocusout={release}
        onkeydown={onKey}>
        {#each renderFrames as f, i (`${f.key}-${i}`)}
          {@const dup = i >= frames.length}
          {@const S = SECTION[f.key]}
          <div class="lnd-sf-item" aria-hidden={dup ? 'true' : undefined}>
            <a class="lnd-sf-frame" href={f.href} tabindex={dup ? -1 : undefined} aria-label={frameLabel(f)} style="--sf-tint:{S.tint}">
              {#if f.live}
                <div class="lnd-sf-bar" style="background: {S.lines}, var(--k-bar-wash), var(--k-bar-shade), linear-gradient(var(--sf-tint), var(--sf-tint))">
                  <span class="lnd-sf-disc font-bricolage">m</span>
                  <span class="lnd-sf-barname font-dmmono">{$t[`lnd.sf.bar.${f.key}`]}</span>
                </div>
                <div class="lnd-sf-body">
                  <div class="lnd-sf-kicker font-dmmono">{$t[`lnd.sf.bar.${f.key}`]} · {$t['lnd.sf.today']}</div>
                  <div class="lnd-sf-title font-bricolage">{@html $t[`lnd.sf.title.${f.key}`]}</div>
                  {#if f.live.key === 'forum'}
                    <div class="lnd-sf-card">
                      <div class="lnd-sf-row font-dmmono"><span class="lnd-sf-chip" style="background:var(--sf-tint)">{$t[`chip.${f.live.kind}`]}</span><span class="lnd-sf-mute">{relTime(f.live.createdAt, $locale)}</span></div>
                      <div class="lnd-sf-h2 lnd-clamp2">{f.live.title}</div>
                      {#if f.live.tags.length}<div class="lnd-sf-tags font-dmmono">{f.live.tags.map((g) => `#${g}`).join(' ')}</div>{/if}
                    </div>
                    {#if f.live.weekCount > 0}<div class="lnd-sf-count font-dmmono">{tStr($t['lnd.sf.forum.week'], { n: f.live.weekCount })}</div>{/if}
                  {:else if f.live.key === 'calendar'}
                    {@const d = berlinDayDisc(f.live.startISO)}
                    <div class="lnd-sf-card lnd-sf-card-row">
                      <div class="lnd-sf-daydisc" style="background:var(--sf-tint)"><span class="font-dmmono">{d.wd}</span><span class="font-bricolage lnd-sf-daynum">{d.day}</span></div>
                      <div class="lnd-sf-col">
                        <div class="lnd-sf-mute font-dmmono">{f.live.allDay ? $t['lnd.sf.allDay'] : d.time}{#if catLabel(f.live.category)} · {catLabel(f.live.category)}{/if}</div>
                        <div class="lnd-sf-h2 lnd-clamp2">{f.live.title}</div>
                      </div>
                    </div>
                    {#if f.live.weekendCount > 0}<div class="lnd-sf-count font-dmmono">{tStr($t['lnd.sf.event.weekend'], { n: f.live.weekendCount })}</div>{/if}
                  {:else if f.live.key === 'marketplace'}
                    <div class="lnd-sf-card lnd-sf-card-photo">
                      {#if f.live.image}<img class="lnd-sf-photo" src={cloudinaryFit(optimizeCloudinary(f.live.image), 480)} alt="" width="480" height="240" loading="lazy" decoding="async" onerror={hideOnError}>{/if}
                      <div class="lnd-sf-row font-dmmono"><span class="lnd-sf-chip" style="background:var(--sf-tint)">{$t[`lnd.sf.kind.${f.live.kind}`]}</span>{#if f.live.price != null}<span>{priceFmt(f.live.price)}</span>{/if}</div>
                      <div class="lnd-sf-h2 lnd-clamp2">{f.live.title}</div>
                    </div>
                  {:else if f.live.key === 'newsboard'}
                    <div class="lnd-sf-card lnd-sf-card-photo">
                      {#if f.live.lead.imageUrl}<img class="lnd-sf-photo" src={f.live.lead.imageUrl} alt="" width="480" height="240" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={hideOnError}>{/if}
                      <div class="lnd-sf-h2 lnd-clamp3">{f.live.lead.title}</div>
                      <div class="lnd-sf-mute font-dmmono">{f.live.lead.sourceName.toUpperCase()} ↗</div>
                    </div>
                    {#if f.live.more.length}
                      <div class="lnd-sf-more">
                        <div class="lnd-sf-mute font-dmmono">{$t['lnd.sf.more']}</div>
                        {#each f.live.more as m}<div class="lnd-sf-h3 lnd-clamp2">{m.title}</div>{/each}
                      </div>
                    {/if}
                  {:else if f.live.key === 'schillerkiez'}
                    <div class="lnd-sf-card lnd-sf-card-ink">
                      <div class="lnd-sf-mute font-dmmono">{f.live.airGrade != null ? $t['lnd.sf.air'] : $t['lnd.sf.airMute']}</div>
                      {#if f.live.airGrade != null}<div class="lnd-sf-big font-dmmono">{f.live.airGrade} · {($t as Record<string, string>)[`lnd.daten.grade.${f.live.airGrade}`] ?? ''}</div>{/if}
                      {#if f.live.airSpark.some((v: number | null) => v != null)}
                        <div class="lnd-sf-bars" aria-hidden="true">
                          {#each f.live.airSpark as v}<span class="lnd-sf-barv" style="height:{v == null ? 4 : Math.round(6 + (5 - Math.min(5, Math.max(1, v))) * 6)}px; opacity:{v == null ? 0.3 : 1}"></span>{/each}
                        </div>
                      {/if}
                      {#if f.live.population != null}<div class="lnd-sf-pop font-bricolage">{new Intl.NumberFormat($locale === 'de' ? 'de-DE' : 'en-GB').format(f.live.population)}</div><div class="lnd-sf-mute font-dmmono">{$t['lnd.sf.pop']}</div>{/if}
                    </div>
                  {:else if f.live.key === 'blog'}
                    <div class="lnd-sf-card lnd-sf-card-photo">
                      {#if f.live.coverSrc}<img class="lnd-sf-photo" src={f.live.coverSrc} alt="" width="480" height="240" loading="lazy" decoding="async" onerror={hideOnError}>{/if}
                      <div class="lnd-sf-h2 lnd-clamp3">{f.live.title}</div>
                      <div class="lnd-sf-desc lnd-clamp2 font-instrument">{f.live.description}</div>
                      <div class="lnd-sf-mute font-dmmono">{fmtBlogDate(f.live.pubDateISO)}</div>
                    </div>
                  {/if}
                </div>
              {:else}
                <img class="lnd-sf-shot" src={f.fallback} alt="" width="480" height="800" loading="lazy" decoding="async">
              {/if}
            </a>
            <div class="lnd-sf-cap">
              <span class="lnd-sf-cap-label font-dmmono" style="color:{S.tint}">{$t[`lnd.sf.bar.${f.key}`]}</span>
              <span class="lnd-sf-cap-line font-instrument">{$t[`lnd.sf.cap.${f.key}`]}</span>
            </div>
          </div>
        {/each}
      </div>
      <div class="lnd-sf-dots" aria-hidden="true">
        {#each frames as f, i (f.key)}<span class="lnd-sf-dot" class:lnd-sf-dot--on={i === active} style="background:{SECTION[f.key].tint}"></span>{/each}
      </div>
    </section>
  {/if}

  <!-- BANNER SLOT (Sept launch banner, Gebietsfonds events) — stays EMPTY, do not build here -->

  <!-- §03 heartbeat strip — collapses entirely at 0 rows -->
  {#if data.rows.length > 0}
    <div class="lnd-strip" role="status">
      {#each data.rows as r (r.kind)}
        <div class="lnd-cell" class:lnd-cell-spark={!!r.spark}>
          <span class="lnd-dot" class:lnd-dot--mute={r.mute} style="background:{DOT[r.kind]}"></span>
          <span class="lnd-cell-label font-dmmono" class:lnd-mutetext={r.mute}>{rowLabel(r)}</span>
          {#if r.spark && r.spark.some((v) => v != null)}
            <svg class="lnd-cell-sparkline" width="62" height="16" viewBox="0 0 62 16" aria-hidden="true">
              <polyline points={sparkPoints(r.spark, 62, 16)} fill="none" stroke="#9db97c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          {/if}
        </div>
      {/each}
      <div class="lnd-strip-right font-dmmono">{$t['lnd.strip.right']}</div>
    </div>
  {/if}

  <!-- CTA (§08) — the page's ONE call to action -->
  <div class="lnd-cta">
    <h2 class="font-bricolage">{$t['lnd.cta.h']}</h2>
    <a href="/register" class="lnd-cta-btn font-bricolage">{$t['lnd.cta.btn']}</a>
    <div class="lnd-meta font-dmmono lnd-cta-sub">{$t['lnd.cta.sub']}</div>
    <div class="font-instrument lnd-slogan">{$t['lnd.cta.slogan']}</div>
  </div>

  <!-- footer (§09) — no language switcher here (it sits in the date line) -->
  <footer class="lnd-footer">
    <div class="lnd-footlinks font-dmmono">
      <a href="/impressum">{$t['lnd.foot.impressum']}</a>
      <a href="/datenschutz">{$t['lnd.foot.datenschutz']}</a>
      <a href="/blog/das-mahalle-manifest">{$t['lnd.foot.ueber']}</a>
      <a href="/blog/das-mahalle-manifest">{$t['lnd.foot.foerderung']}</a>
      <a href="mailto:admin@mahalle.digital">{$t['lnd.foot.kontakt']}</a>
      <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">{$t['lnd.foot.github']}</a>
    </div>
    <span class="font-dmmono lnd-copy">{tStr($t['lnd.foot.copyright'], { year })}</span>
  </footer>
</div>

<style>
  /* ── root + §02 background (VOLLBILD GESPIEGELT, non-negotiable) ── */
  .lnd-root { min-height: 100vh; display: flex; flex-direction: column; background: var(--k-paper); position: relative; overflow-x: clip; }
  .lnd-root > :global(*) { position: relative; z-index: 1; }
  .lnd-root > .lnd-bg {
    position: absolute; inset: 0; z-index: 0; pointer-events: none;
    background-image: url('/assets/background_landing_page.webp');
    background-size: cover; background-repeat: no-repeat; background-position: center top;
    /* opacity 0.16 → 0.42 (user, 2026-09-28: „too pale", then „remove that
       paleness"). NO `filter` here: a saturate() on this page-tall layer made
       Chrome rasterise it in tiles and the ribbons appeared cut while
       scrolling (user report 02:40). */
    mix-blend-mode: multiply; opacity: 0.42; transform: rotate(180deg);
  }

  /* ── date line ── */
  .lnd-dateline { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 12px 48px; border-bottom: 1px solid var(--k-rule); font-size: 10px; letter-spacing: 0.12em; color: var(--k-ink-mute); }
  .lnd-dateline-right { display: flex; gap: 18px; align-items: baseline; }
  .lnd-signin { color: var(--k-ink); text-decoration: underline; text-decoration-style: dashed; text-underline-offset: 3px; }
  .lnd-lang button { background: none; border: none; padding: 0 2px; font: inherit; color: var(--k-ink-mute); cursor: pointer; min-width: 24px; min-height: 24px; }
  .lnd-lang button.active { color: var(--k-ink); font-weight: 700; }

  /* ── masthead + double rule ── */
  .lnd-masthead { text-align: center; padding: 30px 48px 20px; }
  .lnd-masthead h1 { font-size: 96px; font-weight: 800; letter-spacing: -0.045em; line-height: 0.95; margin: 0; color: var(--k-ink); }
  .lnd-a { font-style: italic; font-weight: 400; letter-spacing: 0; }
  .lnd-manifest { font-style: italic; font-size: 23px; color: var(--k-ink-soft); margin: 13px 0 0; }
  .lnd-rule { padding: 0 48px; margin-bottom: 10px; }
  .lnd-rule-thick { height: 3px; background: var(--k-ink); }
  .lnd-rule-thin { height: 1px; background: var(--k-ink); margin-top: 3px; }

  /* ── heartbeat strip ── */
  .lnd-strip { background: var(--k-ink); color: var(--k-paper); display: flex; align-items: stretch; padding: 0 48px; }
  .lnd-cell { display: flex; align-items: center; gap: 9px; padding: 13px 18px; flex: 1; min-width: 0; }
  .lnd-cell + .lnd-cell { border-left: 1px solid rgba(243, 234, 216, 0.22); }
  .lnd-cell-spark { flex: 1.2; }
  .lnd-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; animation: lndPulse 2.4s ease-in-out infinite; }
  .lnd-dot--mute { animation: none; opacity: 0.45; }
  .lnd-cell-label { font-size: 10.5px; letter-spacing: 0.1em; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lnd-mutetext { color: rgba(243, 234, 216, 0.55); }
  .lnd-cell-sparkline { flex-shrink: 0; }
  .lnd-strip-right { display: flex; align-items: center; padding: 13px 0 13px 18px; border-left: 1px solid rgba(243, 234, 216, 0.22); margin-left: auto; font-size: 9.5px; letter-spacing: 0.12em; color: rgba(243, 234, 216, 0.5); white-space: nowrap; }
  @keyframes lndPulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }

  .lnd-meta { font-size: 9.5px; letter-spacing: 0.1em; color: var(--k-ink-mute); }

  /* ── Das Schaufenster (2026-09-28) ── */
  .lnd-sf { padding: 12px 0 0; }
  .lnd-sf-head { display: flex; justify-content: space-between; align-items: baseline; padding: 0 48px 10px; font-size: 10.5px; letter-spacing: 0.14em; color: var(--k-ink-mute); }
  .lnd-sf-head-right { display: inline-flex; align-items: center; gap: 12px; flex-shrink: 0; white-space: nowrap; }
  .lnd-sf-kicker { white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .lnd-sf-hint-phone { display: none; }
  .lnd-sf-track { display: flex; gap: 24px; padding: 4px 48px 6px; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x proximity; scroll-padding-left: 48px; scroll-behavior: auto; outline: none; -webkit-overflow-scrolling: touch; }
  .lnd-sf-track:focus-visible { outline: 2px dashed var(--k-ink); outline-offset: 2px; }
  .lnd-sf-item { flex: 0 0 200px; scroll-snap-align: start; display: flex; flex-direction: column; gap: 8px; }
  .lnd-sf-frame { display: flex; flex-direction: column; width: 200px; aspect-ratio: 3 / 5; box-sizing: border-box; border: 3px solid var(--sf-tint); border-radius: 16px; overflow: hidden; background: var(--k-paper); box-shadow: 3px 3px 0 var(--k-ink); text-decoration: none; color: var(--k-ink); }
  .lnd-sf-bar { flex: 0 0 44px; display: flex; align-items: center; gap: 8px; padding: 0 10px; color: var(--k-paper); }
  .lnd-sf-disc { width: 26px; height: 26px; border-radius: 50%; background: var(--k-wine); color: var(--k-paper); display: inline-flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 800; box-shadow: 0 0 0 2px var(--k-paper); }
  .lnd-sf-barname { font-size: 10px; letter-spacing: 0.16em; font-weight: 500; }
  .lnd-sf-body { flex: 1; min-height: 0; padding: 10px 10px 8px; display: flex; flex-direction: column; gap: 6px; }
  .lnd-sf-kicker { font-size: 8.5px; letter-spacing: 0.16em; color: var(--sf-tint); }
  .lnd-sf-title { font-size: 17px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.05; }
  .lnd-sf-title :global(em) { font-family: var(--k-font-serif); font-style: italic; font-weight: 400; color: var(--sf-tint); }
  .lnd-sf-card { margin-top: 4px; background: var(--k-paper-warm); border: 1.5px solid var(--k-ink); border-radius: 8px; padding: 8px 9px; display: flex; flex-direction: column; gap: 5px; box-shadow: 2px 2px 0 var(--k-ink); overflow: hidden; }
  .lnd-sf-card-row { flex-direction: row; align-items: center; gap: 9px; }
  .lnd-sf-card-photo { padding: 0; }
  .lnd-sf-card-photo > :not(img) { margin: 0 9px; }
  .lnd-sf-card-photo > :last-child { margin-bottom: 8px; }
  .lnd-sf-card-photo > .lnd-sf-row { margin-top: 7px; }
  .lnd-sf-card-photo > .lnd-sf-h2:first-child { margin-top: 8px; }
  .lnd-sf-card-ink { background: var(--k-ink); color: var(--k-paper); border-color: var(--k-ink); box-shadow: 2px 2px 0 var(--sf-tint); }
  .lnd-sf-card-ink .lnd-sf-mute { color: #9db97c; }
  .lnd-sf-photo { display: block; width: 100%; height: 96px; object-fit: cover; }
  .lnd-sf-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 9px; letter-spacing: 0.1em; }
  .lnd-sf-chip { color: var(--k-paper); padding: 2px 6px 3px; font-size: 8.5px; letter-spacing: 0.14em; }
  .lnd-sf-h2 { font-size: 13.5px; font-weight: 700; line-height: 1.22; letter-spacing: -0.01em; }
  .lnd-sf-h3 { font-size: 11.5px; font-weight: 600; line-height: 1.25; margin-top: 3px; }
  .lnd-sf-desc { font-style: italic; font-size: 11.5px; line-height: 1.3; color: var(--k-ink-soft); }
  .lnd-sf-tags { font-size: 8.5px; letter-spacing: 0.06em; color: var(--k-ink-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lnd-sf-mute { font-size: 8.5px; letter-spacing: 0.1em; color: var(--k-ink-mute); }
  .lnd-sf-count { margin-top: auto; font-size: 8.5px; letter-spacing: 0.1em; color: var(--k-ink-mute); padding-top: 6px; border-top: 1px dashed var(--k-rule); }
  .lnd-sf-more { margin-top: 2px; }
  .lnd-sf-daydisc { flex: 0 0 auto; width: 44px; height: 44px; border-radius: 50%; color: var(--k-paper); display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; }
  .lnd-sf-daydisc span:first-child { font-size: 7.5px; letter-spacing: 0.1em; }
  .lnd-sf-daynum { font-size: 17px; font-weight: 800; }
  .lnd-sf-col { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .lnd-sf-big { font-size: 22px; font-weight: 500; letter-spacing: 0.02em; }
  .lnd-sf-bars { display: flex; align-items: flex-end; gap: 3px; height: 32px; }
  .lnd-sf-barv { flex: 1; background: #9db97c; border-radius: 1px; }
  .lnd-sf-pop { font-size: 24px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; margin-top: 4px; }
  .lnd-sf-shot { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
  .lnd-sf-cap { display: flex; flex-direction: column; gap: 1px; padding: 0 2px; }
  .lnd-sf-cap-label { font-size: 9px; letter-spacing: 0.16em; font-weight: 500; }
  .lnd-sf-cap-line { font-style: italic; font-size: 14px; color: var(--k-ink-soft); }
  .lnd-sf-dots { display: flex; justify-content: center; gap: 6px; padding: 10px 0 16px; }
  .lnd-sf-dot { width: 6px; height: 6px; border-radius: 3px; transition: width 240ms ease; }
  .lnd-sf-dot--on { width: 18px; }
  .lnd-sf-pausebtn { background: none; border: 1px solid var(--k-rule); border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 9.5px; letter-spacing: 0.12em; color: var(--k-ink-soft); cursor: pointer; min-height: 28px; }
  .lnd-clamp2 { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .lnd-clamp3 { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .lnd-sf-track::-webkit-scrollbar { display: none; } .lnd-sf-track { scrollbar-width: none; }

  /* ── CTA (§08) ── */
  .lnd-cta { text-align: center; padding: 26px 48px 28px; border-top: 1px dashed var(--k-ochre); background: rgba(176, 117, 21, 0.10); }
  .lnd-cta h2 { font-size: 30px; font-weight: 800; letter-spacing: -0.025em; margin: 0 0 16px; }
  .lnd-cta-btn { display: inline-block; background: var(--k-ink); color: var(--k-paper); font-size: 16px; font-weight: 700; padding: 13px 30px; min-height: 48px; box-sizing: border-box; border-radius: 999px; border: 1.5px solid var(--k-ink); box-shadow: 3px 3px 0 var(--k-ochre); text-decoration: none; }
  .lnd-cta-sub { margin-top: 13px; }
  .lnd-slogan { font-style: italic; font-size: 21px; color: var(--k-ink); margin-top: 16px; }

  /* ── footer (§09) ── */
  .lnd-footer { border-top: 1px solid var(--k-rule); padding: 15px 48px 20px; display: flex; flex-wrap: wrap; gap: 16px; align-items: baseline; justify-content: space-between; }
  .lnd-footlinks { display: flex; flex-wrap: wrap; gap: 16px; }
  .lnd-footlinks a { font-size: 10px; letter-spacing: 0.08em; color: var(--k-ink-soft); text-decoration: underline; text-decoration-style: dashed; text-underline-offset: 3px; }
  .lnd-copy { font-size: 10px; letter-spacing: 0.08em; color: var(--k-ink-mute); }

  /* ── mobile (§10): stacked, strip as row-stack, teasers in one opaque wrapper ── */
  @media (max-width: 1023px) {
    .lnd-dateline { padding: 10px 18px; font-size: 9px; }
    .lnd-loc { display: none; }
    .lnd-masthead { padding: 22px 18px 16px; }
    .lnd-masthead h1 { font-size: 54px; }
    .lnd-manifest { font-size: 16.5px; line-height: 1.35; margin-top: 10px; }
    .lnd-rule { padding: 0 18px; }
    .lnd-strip { flex-direction: column; padding: 0; }
    .lnd-cell { padding: 11px 18px; }
    .lnd-cell + .lnd-cell { border-left: none; border-top: 1px solid rgba(243, 234, 216, 0.18); }
    .lnd-cell-sparkline { margin-left: auto; }
    .lnd-strip-right { display: none; }
    .lnd-sf-head { padding: 0 16px 10px; font-size: 10px; }
    .lnd-sf-hint-phone { display: inline; }
    .lnd-sf-hint-desktop { display: none; }
    .lnd-sf-track { gap: 14px; padding: 4px 16px 6px; scroll-padding-left: 16px; }
    .lnd-sf-item { flex-basis: 236px; }
    .lnd-sf-frame { width: 236px; }
    .lnd-sf-title { font-size: 19px; }
    .lnd-sf-h2 { font-size: 14.5px; }
    .lnd-sf-photo { height: 112px; }
    .lnd-cta { padding: 26px 18px; }
    .lnd-cta h2 { font-size: 26px; }
    .lnd-cta-btn { font-size: 15px; padding: 13px 26px; }
    .lnd-slogan { font-size: 18px; }
    .lnd-footer { padding: 16px 18px 20px; gap: 8px 14px; }
    .lnd-footlinks { gap: 8px 14px; }
    .lnd-footlinks a { min-height: 44px; display: inline-flex; align-items: center; }

    /* §10 tap-target fix: hit boxes only, visual design unchanged (CD spec
       §10, alle Tap-Targets ≥ 44px). The extra 40px of button min-width
       (2×20px) left the date-line row with ~0 slack at 390px — signin and
       the DE|EN pair were each sitting exactly at their one-line content
       width, so the enlarged buttons pushed both into an internal line-wrap
       (verified via screenshot: "Anmelden →" and "EN" both broke onto a
       second line — a real regression from the controller's literal patch,
       not a false read). Trimming the row's gap buys back real pixels
       instead of relying on flex-shrink math staying knife-edge exact;
       `white-space: nowrap` is a backstop so any residual sub-pixel
       rounding overflows (silently clipped by the project's global
       `overflow-x: clip` on html/body) rather than re-wrapping. */
    .lnd-dateline-right { align-items: center; gap: 10px; }
    .lnd-signin { display: inline-flex; align-items: center; min-height: 44px; white-space: nowrap; }
    .lnd-lang { white-space: nowrap; }
    .lnd-lang button { min-width: 44px; min-height: 44px; }
  }

  /* §12: reduced motion — dots static at FULL opacity, mute stays dimmed.
     MUST remain the last lnd-dot rules in this block (source order beats
     equal specificity — same guard as the .am-* block in global.css). */
  @media (prefers-reduced-motion: reduce) {
    .lnd-dot { animation: none; opacity: 1; }
    .lnd-dot--mute { opacity: 0.45; }
  }
</style>
