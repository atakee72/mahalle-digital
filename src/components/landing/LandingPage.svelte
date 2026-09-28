<script lang="ts">
  // Das Schaufenster — public landing (design/handoffs/design_handoff_landing).
  // Data is SSR-provided via props (lib-direct, 1h cache). Runtime JS: the
  // locale toggle, the date line and the Schaufenster strip's rAF drive
  // (pause/resume, wrap). Pulse is pure CSS.
  import { onMount } from 'svelte';
  import { advance, activeIndex } from '../../lib/landing/loop';
  import { t, tStr, locale, setLocale } from '../../lib/kiosk-i18n';
  import type { LandingData, HeartbeatRow } from '../../lib/landing';
  import { buildFrames, monthCells, berlinYearMonth, type Frame, type Live, type SectionKey, type BlogPeek, type BlogMeta } from '../../lib/landing/frames';
  import { CATEGORIES, CATEGORY_ORDER } from '../../lib/calendar/categories';
  import type { EventCategory } from '../../types';
  import { cloudinaryFit, optimizeCloudinary } from '../../utils/cloudinary';
  import { fmtDate, fmtDateKicker } from '../../lib/blog/beilage';
  import { relTime } from '../../lib/relTime';
  import { SEKTION_TOKEN, type SektionKey as NewsSektion } from '../../lib/newsboard/newsTaxonomy';

  let { data, blog, blogMeta } = $props<{
    data: LandingData;
    blog: BlogPeek[];
    blogMeta: BlogMeta | null;
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
  const frames: Frame[] = $derived(buildFrames({ ...data, blog: blog[0] ?? null, blogMeta, computedAt: data.computedAt }, FALLBACKS));
  // ── motion: one native scroll container, rAF-driven scrollLeft, frames
  //    rendered twice for a seamless wrap (loop.ts). Reduced motion: one copy,
  //    no drive. Pause on any interaction, resume 4 s after the last one. ──
  const SPEED_PX_S = 40;
  const RESUME_MS = 4000;
  let trackEl = $state<HTMLDivElement | null>(null);
  let reduced = $state(false);
  let looping = $derived(!reduced && frames.length >= 2);
  let copies = $state(2); // grows on wide screens until one period covers the viewport plus a frame, else the wrap point is unreachable
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
  }
  // Snap comes back only while the user actively scrolls (never on a hover pause: it would jump the strip).
  function snapOn() {
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
    snapOn();
    hold();
    trackEl.scrollBy({ left: e.key === 'ArrowRight' ? step() : -step(), behavior: 'auto' });
    release();
  }

  $effect(() => { if (running) start(); else stop(); });

  $effect(() => { if (looping && trackEl) fitCopies(); });

  function fitCopies() {
    if (!trackEl || !looping) return;
    const period = step() * frames.length;
    if (period > 0) copies = Math.max(2, Math.ceil((trackEl.clientWidth + 100) / period) + 1);
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

  function kickerDate(iso: string | undefined): { dow: string; dm: string; hhmm: string } {
    const d = new Date(iso ?? Date.now());
    const loc = $locale === 'de' ? 'de-DE' : 'en-GB';
    const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, { timeZone: 'Europe/Berlin', ...o }).format(d);
    return { dow: f({ weekday: 'long' }).toUpperCase(), dm: f({ day: 'numeric', month: 'short' }).toUpperCase(), hhmm: f({ hour: '2-digit', minute: '2-digit' }) };
  }
  function monthYearLabel(iso: string): string {
    return new Intl.DateTimeFormat($locale === 'de' ? 'de-DE' : 'en-GB', { timeZone: 'Europe/Berlin', month: 'long', year: 'numeric' }).format(new Date(iso)).toUpperCase();
  }
  function catStyle(cat: string | null) {
    return CATEGORIES[((cat ?? 'kiez') in CATEGORIES ? (cat ?? 'kiez') : 'kiez') as EventCategory];
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

{#snippet bar(key: SectionKey)}
  {@const S = SECTION[key]}
  {@const de = $locale === 'de'}
  <div class="lnd-sf-repbar border-b-2 border-ink" style="background: {S.lines}, var(--k-bar-wash), var(--k-bar-shade), linear-gradient({S.tint}, {S.tint})" aria-hidden="true">
    <div class="px-4 py-2 flex items-center justify-between">
      <span class="w-9 h-9 rounded-full bg-wine text-paper flex items-center justify-center font-bricolage font-bold text-xl leading-none" style="box-shadow: 0 0 0 2px var(--k-paper), inset 0 -0.25px 0 1.75px var(--k-wine), inset 0 0 0 2px var(--k-ink)">m</span>
      <span class="flex items-center gap-2">
        <span class="inline-flex items-center h-[25px] rounded-full border-2 border-paper font-dmmono text-[11px] uppercase tracking-[0.12em] bg-ink"><span class="inline-flex items-center justify-center h-[21px] px-2.5 leading-none rounded-l-full {de ? 'bg-paper text-ink' : 'bg-ink text-paper'}">DE</span><span class="inline-flex items-center justify-center h-[21px] px-2.5 leading-none rounded-r-full {de ? 'bg-ink text-paper' : 'bg-paper text-ink'}">EN</span></span>
        <span class="w-9 h-9 rounded-full border-2 border-paper bg-paper text-ink flex items-center justify-center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg></span>
        <span class="w-9 h-9 rounded-full border-2 border-paper bg-paper text-ink flex items-center justify-center"><svg width="19" height="19" viewBox="0 0 24 24"><path d="M12 4.4c-3.3 0-4.9 2.5-4.9 5.9v3.5L5.3 16.1h13.4l-1.8-2.3v-3.5c0-3.4-1.6-5.9-4.9-5.9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /><path d="M9.7 18.6a2.3 2.3 0 004.6 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg></span>
        <span class="w-9 h-9 rounded-full border-2 border-paper bg-paper"></span>
      </span>
    </div>
  </div>
{/snippet}

{#snippet forumRep(l: Extract<Live, { key: 'forum' }>)}
  {@const k = kickerDate(data.computedAt)}
  {@const isAnn = l.kind === 'announcement'}
  {@const isRec = l.kind === 'recommendation'}
  {@const pill = 'shrink-0 px-4 py-1 rounded-full font-bricolage font-medium text-sm border-2'}
  <div class="px-4 pt-5 pb-8">
    <section class="mb-3 pb-4 border-b border-dashed border-rule">
      <p class="font-dmmono text-[11px] uppercase tracking-[0.18em] text-wine mb-2">FORUM · {k.dow} {k.dm} · {k.hhmm}</p>
      <div class="font-bricolage font-extrabold text-4xl tracking-tight leading-[0.95] text-ink">
        {$t['forum.title.prefix']}
        <em class="font-instrument italic font-normal text-wine">{$t['forum.title.accent']}</em>
        {$t['forum.title.suffix']}
      </div>
      {#if l.stats}
        <div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 mt-3 font-dmmono text-[10px] text-ink-mute">
          <span class="whitespace-nowrap"><span class="font-bold text-ink">{l.stats.total}</span> {$t['forum.stats.topics']}</span>
          <span class="whitespace-nowrap"><span class="font-bold text-ink">{l.stats.newSinceYesterday}</span> {$t['forum.stats.new']}</span>
          <span class="whitespace-nowrap"><span class="font-bold text-ink">{l.stats.discussedToday}</span> {$t['forum.stats.discussed']}</span>
        </div>
      {/if}
    </section>
    <div class="mb-5 flex items-center gap-2">
      <div class="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
        <span class="{pill} bg-ink text-paper border-ink">{$t['filter.all']}</span>
        <span class="{pill} bg-transparent text-ink border-ink/30">{$t['filter.discussion']}</span>
        <span class="{pill} bg-transparent text-ink border-ink/30">{$t['filter.announcement']}</span>
        <span class="{pill} bg-transparent text-ink border-ink/30">{$t['filter.recommendation']}</span>
      </div>
      <span class="shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full font-bricolage font-medium text-sm bg-transparent text-ink border-2 border-ink/30"><span>{$t['filter.tagsChip']}</span><span aria-hidden="true" class="text-[10px]">▾</span></span>
    </div>
    <article class="bg-paper-warm {isAnn ? 'border-[1.5px] border-teal shadow-[2px_2px_0_var(--k-teal)]' : isRec ? 'border-[1.5px] border-moss shadow-[2px_2px_0_var(--k-moss)]' : 'border border-wine'} flex flex-col overflow-hidden rounded-lg">
      {#if isAnn || isRec}
        <div class="{isAnn ? 'bg-teal' : 'bg-moss'} text-paper border-b border-ink flex items-center justify-between gap-3 px-3.5 py-1">
          <span class="font-dmmono text-[9.5px] uppercase font-semibold tracking-[0.12em]">{isAnn ? $t['card.strap.announcement'] : $t['card.strap.recommendation']}</span>
        </div>
      {/if}
      <div class="px-5 py-4">
        <div class="flex items-start justify-between gap-3 mb-2.5">
          <div class="font-dmmono text-[10px] tracking-[0.05em] text-ink-mute pt-1">{relTime(l.createdAt, $locale, Date.parse(data.computedAt))}</div>
          {#if !isAnn && !isRec}
            <span class="inline-flex items-center font-dmmono font-medium text-[10px] tracking-[0.08em] text-paper border border-ink rounded-lg px-[9px] py-[3px] bg-wine">{$t[`chip.${l.kind}`].toUpperCase()}</span>
          {/if}
        </div>
        {#if l.image}
          <div class="relative mb-3 rounded-md border-[1.5px] border-ink overflow-hidden h-[100px]">
            <img src={cloudinaryFit(optimizeCloudinary(l.image), 480)} alt="" class="w-full h-full object-cover" width="480" height="200" loading="lazy" decoding="async" onerror={hideOnError}>
            <div class="pointer-events-none absolute inset-0" style="background: repeating-linear-gradient(0deg, transparent 0 4px, rgba(0,0,0,0.04) 4px 5px);"></div>
          </div>
        {/if}
        <div class="font-bricolage font-extrabold tracking-tight leading-[1.18] mb-2 text-balance text-ink text-[16.5px] lnd-clamp3">{l.title}</div>
        {#if l.tags.length}
          <div class="flex gap-2 flex-wrap font-dmmono text-[10px] mb-2.5 text-ink-mute">{#each l.tags as tg (tg)}<span>#{tg}</span>{/each}</div>
        {/if}
        <div class="flex items-center justify-between font-dmmono text-[11px] pt-2.5 border-t border-dashed border-rule text-ink-mute">
          <span class="flex items-center gap-3">
            <span class="flex items-center gap-1"><span aria-hidden="true">♥</span> {l.likes ?? 0}</span>
            <span class="flex items-center gap-1"><span aria-hidden="true">💬</span> {l.comments ?? 0}</span>
            <span class="flex items-center gap-1"><span aria-hidden="true">🔖</span> {l.saves ?? 0}</span>
          </span>
          <span class="flex items-center gap-1">→ {$t['card.cta.read']}</span>
        </div>
      </div>
    </article>
  </div>
{/snippet}

{#snippet calendarRep(l: Extract<Live, { key: 'calendar' }>)}
  {@const k = kickerDate(data.computedAt)}
  {@const ym = berlinYearMonth(data.computedAt)}
  {@const views = ['month', 'agenda', 'day']}
  <section class="px-4 pt-5 pb-3 border-b border-dashed border-rule">
    <div class="font-dmmono text-[11px] uppercase tracking-[0.18em] text-teal mb-2">{$t['cal.title.kicker']} · {k.dow} {k.dm} · {k.hhmm}</div>
    <div class="font-bricolage font-extrabold text-ink leading-[0.95] tracking-tight text-4xl">
      {$t['cal.title.q1']}
      <span class="font-instrument italic font-normal text-teal">{$t['cal.title.q2']}</span>
      {$t['cal.title.q3']}
    </div>
    <div class="flex items-center justify-end gap-2 mt-4">
      <div class="inline-flex items-center border-[1.5px] border-ink rounded-full font-dmmono text-[11px] font-semibold leading-none">
        <span class="px-2.5 py-1">‹</span>
        <span class="px-3 py-1 border-l-[1.5px] border-r-[1.5px] border-ink uppercase tracking-[0.05em]">{monthYearLabel(data.computedAt)}</span>
        <span class="px-2.5 py-1">›</span>
      </div>
    </div>
    <div class="flex items-center justify-between gap-3 mt-3">
      <div class="font-dmmono text-[11px] text-ink-mute">{#if l.monthCount != null}<b class="text-ink">{l.monthCount}</b> {$t['cal.mobile.statsMonthEvents']}{/if}</div>
      <div class="inline-flex border-2 border-ink rounded-full font-dmmono text-[12px] font-semibold shrink-0">
        {#each views as v, i (v)}
          <span class="px-3 py-1 {v === 'month' ? 'bg-ink text-paper' : 'bg-transparent text-ink'} {i > 0 ? 'border-l-2 border-ink' : ''} {i === 0 ? 'rounded-l-full' : i === views.length - 1 ? 'rounded-r-full' : ''}">{($t as Record<string, string>)[`cal.view.${v}`]}</span>
        {/each}
      </div>
    </div>
  </section>
  <section class="px-4 py-3 flex items-center gap-2 border-b border-dashed border-rule overflow-hidden">
    <span class="shrink-0 inline-flex items-center px-3.5 py-1 rounded-full font-bricolage font-semibold text-[12px] border-[1.5px] border-ink bg-ink text-paper">{$t['cal.filter.all']}</span>
    {#each CATEGORY_ORDER.slice(0, 3) as cat (cat)}
      <span class="shrink-0 inline-flex items-center gap-2 px-3 py-1 rounded-full font-bricolage font-semibold text-[12px] border-[1.5px] border-ink bg-transparent text-ink">
        <span class="w-[8px] h-[8px] {CATEGORIES[cat].bgClass} border border-ink/40"></span>
        <span>{catLabel(cat)}</span>
      </span>
    {/each}
  </section>
  <div class="px-4 pt-4">
    <div class="grid grid-cols-7 gap-[2px] font-dmmono text-[12px]">
      {#each ($locale === 'de' ? ['M','D','M','D','F','S','S'] : ['M','T','W','T','F','S','S']) as label, i (`${label}-${i}`)}
        <div class="text-ink-mute py-0.5 text-center tracking-[0.05em]">{label}</div>
      {/each}
      {#each monthCells(ym.year, ym.month, l.days) as c, i (i)}
        {@const today = c.day === ym.day}
        <div class="relative py-2 text-center {today ? 'lnd-sf-today bg-teal text-paper border border-ink rounded-[4px] font-bold' : 'text-ink'}">
          {c.day ?? ''}
          {#if c.day != null && c.category && !today}
            <div class="absolute left-1/2 -translate-x-1/2 bottom-0.5 w-1 h-1 rounded-full {catStyle(c.category).bgClass}"></div>
          {/if}
        </div>
      {/each}
    </div>
    <div class="mt-4 bg-paper-warm border border-dashed border-rule rounded-sm px-3 py-2.5 font-instrument italic text-[13px] text-ink-soft leading-[1.5]">{$t['cal.agenda.quote']}</div>
  </div>
{/snippet}

{#snippet marketRep(l: Extract<Live, { key: 'marketplace' }>)}
  {@const k = kickerDate(data.computedAt)}
  {@const kindKey = l.kind === 'sell' ? 'verkaufen' : l.kind === 'exchange' ? 'tausch' : 'verschenken'}
  {@const today = l.createdAt != null && (() => { const a = berlinYearMonth(l.createdAt); const b = berlinYearMonth(data.computedAt); return a.year === b.year && a.month === b.month && a.day === b.day; })()}
  {@const dm = l.createdAt ? new Intl.DateTimeFormat($locale === 'de' ? 'de-DE' : 'en-GB', { timeZone: 'Europe/Berlin', day: 'numeric', month: 'short' }).format(new Date(l.createdAt)).toUpperCase() : ''}
  {@const pillOn = 'shrink-0 font-bricolage font-semibold border-2 border-ink bg-ink text-paper rounded-full px-[13px] py-[5px] text-[12.5px]'}
  {@const pillOff = 'shrink-0 font-bricolage font-semibold border-2 border-ink text-ink rounded-full px-[13px] py-[5px] text-[12.5px]'}
  {@const lab = 'font-dmmono uppercase shrink-0 text-[10px] text-ink-mute tracking-[0.12em]'}
  <section class="px-4 py-5" style="border-bottom: 1px dashed var(--k-rule);">
    <div class="font-dmmono text-[11px] uppercase tracking-[0.12em] text-wine">MARKT · {k.dow} {k.dm}</div>
    <div class="font-bricolage font-extrabold text-ink leading-[0.95] tracking-tight mt-1.5 text-[32px]">
      {$t['market.title.q1']}
      <em class="font-instrument font-normal not-italic" style="font-style: italic; color: var(--k-ochre);">{$t['market.title.q1.italic']}</em>
      {$t['market.title.q1.suffix']}
    </div>
    {#if l.stats}
      <div class="font-dmmono text-[11px] text-ink-mute mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <span><b class="text-ink font-semibold">{l.stats.available}</b> {$t['market.titlemeta.listings']}</span>
        <span><b class="text-ink font-semibold">{l.stats.newSinceYesterday}</b> {$t['market.titlemeta.new']}</span>
        <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full flex-shrink-0" style="background: var(--k-ochre);"></span><b class="text-ink font-semibold">{l.stats.fresh}</b> {$t['market.titlemeta.fresh']}</span>
      </div>
    {/if}
  </section>
  <div class="px-4" style="border-bottom: 1px dashed var(--k-rule);">
    <div class="py-3 flex flex-col gap-2">
      <div class="flex items-center gap-2 overflow-hidden">
        <span class={lab}>{$t['market.filter.kind.label']}</span>
        <span class={pillOn}>{$t['market.filter.kind.all']}</span>
        <span class={pillOff}>{$t['market.filter.kind.verkaufen']}</span>
        <span class={pillOff}>{$t['market.filter.kind.tausch']}</span>
        <span class={pillOff}>{$t['market.filter.kind.verschenken']}</span>
      </div>
      <span class="font-dmmono text-[12px] w-full truncate" style="padding: 5px 10px; background: var(--k-paper-soft); border: 1px solid var(--k-rule); border-radius: var(--k-radius-md, 8px); min-width: 0; display: block; color: var(--k-ink-mute);">{$t['market.filter.search']}</span>
    </div>
    <div class="pb-3 flex items-center gap-3 overflow-hidden">
      <span class={lab}>{$t['market.filter.category.label']}</span>
      <span class="shrink-0 font-bricolage font-semibold rounded-full text-[12.5px] border-2 border-ink bg-ink text-paper" style="padding: 5px 12px;">{$t['market.filter.cat.all']}</span>
      <span class="cat-chip shrink-0" style="--cat-color: var(--cat-moebel);">{$t['market.cat.moebel']}</span>
      <span class="cat-chip shrink-0" style="--cat-color: var(--cat-garten);">{$t['market.cat.garten']}</span>
    </div>
  </div>
  <article class="relative overflow-hidden mx-4 my-3.5" style="background: var(--k-paper-warm); border: var(--k-border-ink); border-radius: var(--k-radius-lg); box-shadow: 4px 4px 0 var(--k-ochre);">
    <div class="flex items-center justify-between gap-2 px-3 py-1.5 bg-ink text-paper font-dmmono font-semibold uppercase tracking-[0.14em] text-[9.5px]">
      {#if today}
        <span class="whitespace-nowrap overflow-hidden text-ellipsis">★ {$t['market.lead.banner']}</span>
        <span class="shrink-0 whitespace-nowrap" style="color: var(--k-ochre);">● {dm}</span>
      {:else}
        <span class="shrink-0 whitespace-nowrap" style="color: var(--k-ochre);">● {relTime(l.createdAt, $locale, Date.parse(data.computedAt))}</span>
      {/if}
    </div>
    <div class="px-3.5 pt-2.5 pb-3" style="border-bottom: 1px dashed var(--k-rule);">
      <div class="relative overflow-hidden border-2 border-ink rounded-md h-[96px]" style="background: repeating-linear-gradient(30deg, color-mix(in srgb, var(--k-ochre) 20%, transparent) 0 14px, var(--k-paper-warm) 14px 28px);">
        {#if l.image}<img src={cloudinaryFit(optimizeCloudinary(l.image), 480)} alt="" class="absolute inset-0 w-full h-full object-cover" width="480" height="300" loading="lazy" decoding="async" onerror={hideOnError}>{/if}
      </div>
      {#if l.photos}
        <div class="mt-2"><span class="font-dmmono text-[10px] text-ink-mute">{l.photos} {$locale === 'de' ? 'Fotos' : 'photos'}</span></div>
      {/if}
    </div>
    <div class="px-3.5 pt-3.5 pb-4 flex flex-col gap-2.5 min-w-0">
      <span class="cat-chip cat-chip--active lnd-sf-nodot self-start" style="--cat-color: var(--k-ochre); --cat-fg: var(--k-ink);">{$t[`market.filter.kind.${kindKey}`]}</span>
      <div class="font-extrabold text-ink tracking-[-0.022em] leading-[1.1] m-0 text-[22px] lnd-clamp3" style="word-break: break-word;">
        <span style="font-family: var(--k-font-serif); font-style: italic; font-weight: 400; color: var(--k-ochre);">{l.title}</span>
      </div>
    </div>
  </article>
{/snippet}

{#snippet kurierRep(l: Extract<Live, { key: 'newsboard' }>)}
  {@const sk = (l.lead.sektion && l.lead.sektion in SEKTION_TOKEN ? l.lead.sektion : 'lokales') as NewsSektion}
  {@const pillOn = 'shrink-0 font-bricolage font-semibold rounded-full text-[12.5px] border-2 border-ink bg-ink text-paper'}
  {@const pillOff = 'shrink-0 font-bricolage font-semibold rounded-full text-[12.5px] border-[1.5px] border-rule text-ink'}
  <section class="px-4" style="padding-top:20px; padding-bottom:14px; border-bottom:1px dashed var(--k-rule);">
    <div class="font-dmmono uppercase text-ink" style="font-size:11px; letter-spacing:0.16em;">{$t['news.titleblock.kicker']}</div>
    <div class="font-bricolage break-words text-[36px]" style="font-weight:800; letter-spacing:-0.03em; line-height:1; margin:6px 0 0;">{@html $t['news.titleblock.heading']}</div>
  </section>
  <section class="relative px-4 py-3" style="border-bottom:2px solid var(--k-ink);">
    <div class="font-instrument italic text-center text-[28px] leading-none mb-1.5" style="font-weight:400; letter-spacing:-0.025em; color:var(--k-ink);">Schillerkiez Kurier</div>
    {#if l.stats}
      <div class="flex flex-wrap justify-center items-center font-dmmono uppercase" style="gap:0 6px; font-size:9.5px; color:var(--k-ink-soft); letter-spacing:0.08em;">
        <span>{$t['news.masthead.edition']}</span><span aria-hidden="true">·</span>
        <span>{$t['news.masthead.issueAbbr']} <b style="color:var(--k-ink);">{l.stats.issue}</b></span><span aria-hidden="true">·</span>
        <span><b style="color:var(--k-ink);">{l.stats.articles}</b> {$t['news.masthead.articles']}</span><span aria-hidden="true">·</span>
        <span><b style="color:var(--k-ink);">{l.stats.sources}</b> {$t['news.masthead.sources']}</span>
      </div>
    {/if}
  </section>
  <section class="px-4" style="border-bottom:1px dashed var(--k-rule);">
    <div class="pt-3 pb-2 flex items-center gap-2 overflow-hidden">
      <span class="font-dmmono uppercase shrink-0" style="font-size:9.5px; color:var(--k-ink-mute); letter-spacing:0.12em; min-width:56px;">{$t['news.filter.sektion']}</span>
      <span class={pillOn} style="padding:5px 12px;">{$t['news.filter.all']}</span>
      <span class={pillOff} style="padding:5px 12px;">{$t['news.sektion.politik']}</span>
      <span class={pillOff} style="padding:5px 12px;">{$t['news.sektion.kultur']}</span>
      <span class={pillOff} style="padding:5px 12px;">{$t['news.sektion.lokales']}</span>
    </div>
    <div class="pb-3 flex items-center gap-2 overflow-hidden">
      <span class={pillOff} style="padding:5px 12px;">{$t['news.filter.today']}</span>
      <span class={pillOn} style="padding:5px 12px;">{$t['news.filter.week']}</span>
      <span class={pillOff} style="padding:5px 12px;">{$t['news.filter.month']}</span>
    </div>
  </section>
  <div class="px-4">
    <div class="flex items-center" style="gap:12px; margin:10px 0 4px;">
      <div class="flex-1" style="height:1px; border-top:1px dashed var(--k-rule);"></div>
      <span class="font-dmmono uppercase" style="font-size:10px; font-weight:700; color:var(--k-ink-mute); letter-spacing:0.18em;">{l.stats && !l.stats.today ? $t['news.divider.yesterday'] : $t['news.divider.today']}</span>
      <div class="flex-1" style="height:1px; border-top:1px dashed var(--k-rule);"></div>
    </div>
    <article class="flex flex-col" style="background:var(--k-paper); border:var(--k-border-hair); border-radius:var(--k-radius-md); padding:14px; gap:12px;">
      {#if l.lead.imageUrl}
        <img src={cloudinaryFit(optimizeCloudinary(l.lead.imageUrl), 480)} alt="" class="w-full object-cover shrink-0" style="height:96px; border:var(--k-border-ink); border-radius:var(--k-radius-md);" width="480" height="240" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={hideOnError}>
      {/if}
      <div class="flex flex-col min-w-0 shrink-0">
        <div class="flex items-center flex-wrap" style="gap:6px; margin-bottom:8px;">
          <span class="inline-flex items-center font-dmmono uppercase whitespace-nowrap" style="font-size:9px; font-weight:600; letter-spacing:0.12em; padding:1px 6px; background:var({SEKTION_TOKEN[sk]}); color:var({SEKTION_TOKEN[sk]}-text); border:1px solid var(--k-ink); border-radius:var(--k-radius-sm);">{$t[`news.sektion.${sk}`]}</span>
        </div>
        <div class="font-bricolage break-words text-[22px] lnd-clamp3" style="font-weight:700; line-height:1.15; letter-spacing:-0.02em; margin:0 0 6px; color:var(--k-ink);">{l.lead.title}</div>
        <div class="font-dmmono uppercase" style="font-size:10px; color:var(--k-ink-mute); letter-spacing:0.08em;">{l.lead.sourceName}</div>
      </div>
    </article>
  </div>
{/snippet}

{#snippet kiezRep(l: Extract<Live, { key: 'schillerkiez' }>)}
  {@const K = l.kiez}
  {@const loc = $locale === 'de' ? 'de-DE' : 'en-GB'}
  {@const kickFull = tStr($t['kiez.kicker'], { stand: K?.stand ?? '' })}
  {@const kicker = K?.stand ? kickFull : kickFull.split(' · ').slice(0, -1).join(' · ')}
  {@const popLabel = l.population != null ? new Intl.NumberFormat(loc).format(l.population) : null}
  {@const gc = (g: number | null) => g == null ? 'var(--k-paper)' : g <= 2 ? 'var(--kz-grade-good-on-ink, #9fd08a)' : g === 3 ? 'var(--kz-grade-mid-on-ink, #ecc76e)' : 'var(--kz-grade-bad-on-ink, #e08a8a)'}
  {@const gw = (g: number | null) => g == null || g < 1 || g > 5 ? $t['kiez.air.grade.none'] : ($t as Record<string, string>)[`kiez.air.grade.${g}`]}
  {@const readTs = K?.readingAt ? (() => { const d = new Date(K.readingAt); const df = new Intl.DateTimeFormat(loc, { day: '2-digit', month: $locale === 'de' ? '2-digit' : 'short', timeZone: 'Europe/Berlin' }).format(d); const tf = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }).format(d); return `${df} · ${tf}`; })() : null}
  {@const comps = [['PM10', K?.components?.pm10 ?? null], ['NO₂', K?.components?.no2 ?? null], ['O₃', K?.components?.o3 ?? null], ['CO', K?.components?.co ?? null]] as [string, number | null][]}
  {@const spark = l.airSpark as (number | null)[]}
  {@const hasGap = spark.some((v: number | null) => v == null)}
  {@const wk = (i: number) => i === spark.length - 1 ? $t['kiez.strip.today'] : new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'Europe/Berlin' }).format(new Date(new Date(data.computedAt).getTime() - (spark.length - 1 - i) * 86400000))}
  {@const lqi = K?.lqiWeekMean != null ? (K.lqiWeekMean).toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : null}
  <div class="bg-[var(--k-ink)] text-[var(--k-paper)] px-4 py-3">
    <div class="flex items-center gap-[7px] font-dmmono text-[10px] uppercase tracking-[0.18em] text-[var(--k-ochre)]">
      <span class="inline-block h-[7px] w-[7px] rounded-full {l.airGrade != null ? 'bg-[var(--k-success)]' : 'bg-[var(--k-ink-mute)]'}"></span>
      {$t['kiez.strip.station']} · {l.airGrade != null ? $t['kiez.strip.live'] : $t['kiez.strip.noSignal']}
    </div>
    {#if l.airGrade != null}
      <div class="mt-0.5 text-[18px] font-extrabold">
        {$t['kiez.strip.airQuality']}: <span style="color:{gc(l.airGrade)}">{l.airGrade} · {gw(l.airGrade)}</span>
        {#if readTs}<span class="ml-3 font-dmmono text-[10px] font-normal opacity-60">{readTs}</span>{/if}
      </div>
    {:else}
      <div class="mt-0.5 text-[17px] font-extrabold opacity-75">{$t['kiez.strip.offTitle']}</div>
    {/if}
    <div class="flex gap-2 mt-3.5">
      {#each comps as [nm, g] (nm)}
        <div class="min-w-[58px] rounded-[var(--k-radius-md)] px-[9px] py-[5px] text-center border-[1.5px] border-[rgba(243,234,216,0.3)] {g == null ? 'opacity-55' : ''}">
          <div class="font-dmmono text-[9.5px] opacity-65">{nm}</div>
          <div class="font-dmmono text-[16px] font-medium" style="color:{gc(g)}">{g ?? '–'}</div>
        </div>
      {/each}
    </div>
    {#if spark.length}
      <div class="mt-3.5 text-right">
        <svg viewBox="0 0 170 52" class="h-10 w-[130px] inline-block" aria-hidden="true">
          {#each spark as v, i (i)}
            {#if v != null}
              {@const h = (Math.min(5, Math.max(1, v)) / 5) * 40}
              <rect x={i * 24} y={40 - h} width="16" height={h} rx="2" fill={gc(Math.round(v))} opacity={i === spark.length - 1 ? 1 : 0.55} />
            {:else}
              <rect x={i * 24} y="18" width="16" height="22" rx="3" fill="none" stroke="rgba(243,234,216,0.35)" stroke-width="1.2" stroke-dasharray="3 3" />
            {/if}
            <text x={i * 24 + 8} y="50" text-anchor="middle" font-family="var(--k-font-mono)" font-size="7" fill="var(--k-paper)" opacity="0.6">{wk(i)}</text>
          {/each}
        </svg>
        <div class="font-dmmono text-[9px] tracking-[0.1em] opacity-60">{$t['kiez.strip.week']}</div>
        {#if hasGap}<div class="font-dmmono text-[9px] leading-snug opacity-60">{$t['kiez.strip.gap']}</div>{/if}
      </div>
    {/if}
  </div>
  <section class="px-4 py-5 border-b border-dashed border-rule">
    <div class="font-dmmono text-[11px] uppercase tracking-[0.14em]" style="color: var(--k-moss);">{kicker}</div>
    <div class="font-bricolage font-extrabold text-ink leading-[0.95] mt-1.5 text-[36px]" style="letter-spacing: -0.035em;">
      {$t['kiez.title.pre']}<span class="font-instrument italic font-normal" style="color: var(--k-moss);">{$t['kiez.title.italic']}</span>
    </div>
    {#if popLabel}
      <p class="font-instrument italic text-[15px] text-ink-soft mt-2">{tStr($t['kiez.dek'], { pop: popLabel })}</p>
    {/if}
    {#if popLabel || K?.areas != null}
      <div class="flex flex-wrap gap-4 mt-3 font-dmmono text-[11px] text-ink-mute">
        {#if popLabel}<span><b class="text-ink">{popLabel}</b> {$t['kiez.fact.residents']}</span>{/if}
        {#if K?.areas != null}<span><b class="text-ink">{K.areas}</b> {$t['kiez.fact.areas']}</span>{/if}
        <span><b class="text-ink">{$t['kiez.fact.syncRate']}</b> {$t['kiez.fact.sync']}</span>
      </div>
    {/if}
    {#if K && lqi != null}
      <div class="mt-5 border-2 border-ink rounded-2xl bg-paper-warm shadow-[3px_3px_0_var(--k-ink)] px-5 py-4">
        <div class="flex items-center justify-between font-dmmono text-[9.5px] uppercase tracking-[0.14em] text-ink-mute">
          <span class="font-semibold" style="color: var(--k-moss);">{$t['kiez.zdw.label']}</span>
          <span>{tStr($t['kiez.zdw.kw'], { kw: String(K.kw) })}</span>
        </div>
        <div class="font-dmmono font-medium text-[40px] leading-none tracking-tight mt-2 mb-0.5 text-ink">LQI Ø {lqi}</div>
        <p class="text-[13.5px] leading-snug text-ink-soft">{$t['kiez.zdw.read.airWeekMean']}</p>
      </div>
    {/if}
  </section>
{/snippet}

{#snippet blogRep(l: Extract<Live, { key: 'blog' }>)}
  {@const M = l.meta}
  {@const chip = 'font-dmmono rounded-full whitespace-nowrap inline-block shrink-0 border-[1.5px]'}
  <div class="text-center" style="padding: 26px 24px 0;">
    <div class="font-dmmono inline-block" style="font-size: 10px; letter-spacing: 0.22em; color: var(--k-ink-mute); border-top: 1px solid var(--k-ink); padding-top: 8px;">{$t['blog.mast.strap']}</div>
    <div class="font-bricolage text-[34px]" style="font-weight: 800; letter-spacing: -0.035em; line-height: 0.95; margin: 10px 0 6px;">
      Die <span class="font-instrument italic font-normal" style="color: var(--k-rust);">Beilage</span>
    </div>
    {#if M}
      <div class="font-dmmono flex justify-center items-center flex-wrap" style="gap: 18px; font-size: 10.5px; color: var(--k-ink-mute); margin: 4px 0 12px;">
        <span>{$t['blog.mast.from']}</span><span>·</span>
        <span>{M.total} {$t['blog.mast.posts']}</span>
        {#if M.latestISO}<span>·</span><span style="color: var(--k-rust);">{$t['blog.mast.latest']}: {fmtDateKicker(M.latestISO, $locale)}</span>{/if}
      </div>
    {/if}
    <div style="border-top: 2.5px solid var(--k-ink); height: 2px; border-bottom: 1px solid var(--k-ink);"></div>
  </div>
  <div class="px-6 py-3 border-b border-dashed" style="border-color: var(--k-rule);">
    <div class="flex overflow-hidden" style="gap: 8px; padding-bottom: 2px;">
      <span class="{chip}" style="font-size: 10.5px; padding: 3px 10px; border-color: var(--k-rust); background: var(--k-rust); color: var(--k-paper);">#{$t['blog.rubric.all']}</span>
      {#if M}{#each M.tags as tg (tg.tag)}
        <span class="{chip}" style="font-size: 10.5px; padding: 3px 10px; border-color: var(--k-ink); color: var(--k-ink);">#{tg.tag}<span style="opacity: 0.55;">{' '}{tg.n}</span></span>
      {/each}{/if}
    </div>
    <div style="margin-top: 8px;">
      <div class="flex items-center min-h-[44px]" style="gap: 8px; background: var(--k-paper-soft); border: 1px solid var(--k-rule); border-radius: var(--k-radius-md); padding: 9px 14px;">
        <span style="font-size: 14px; opacity: 0.5;">⌕</span>
        <span class="font-bricolage flex-1 min-w-0 truncate" style="font-size: 13px; color: var(--k-ink-mute);">{$t['blog.search.placeholder']}</span>
      </div>
    </div>
  </div>
  <div class="px-6 pt-5">
    <span class="font-dmmono inline-block" style="font-size: 10px; letter-spacing: 0.14em; background: var(--k-rust); color: var(--k-paper); padding: 3px 10px; border-radius: 4px; border: 1px solid var(--k-ink);">{$t['blog.lead.strap']}</span>
    <div class="font-bricolage text-[21px] lnd-clamp3" style="font-weight: 800; letter-spacing: -0.025em; line-height: 1.04; margin: 12px 0 8px;">{l.title}</div>
    <div class="font-instrument italic lnd-clamp3" style="font-size: 16.5px; line-height: 1.45; color: var(--k-ink-soft); margin-bottom: 10px;">{l.description}</div>
    <div class="font-dmmono flex items-center flex-wrap" style="gap: 8px; font-size: 10.5px; color: var(--k-ink-mute);">
      <span>{fmtDate(l.pubDateISO, $locale)}</span>
      {#if l.author}<span>·</span><span>{l.author === 'Mahalle Team' ? $t['blog.meta.team'] : l.author}</span>{/if}
      {#if l.minutes != null}<span>·</span><span>{l.minutes} {$t['blog.meta.min']}</span>{/if}
    </div>
    {#if l.coverSrc}
      <div style="margin-top: 14px; border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-lg); overflow: hidden; box-shadow: 2px 2px 0 var(--k-ink);">
        <img src={l.coverSrc} alt="" class="w-full object-cover" style="height: 220px;" width="480" height="220" loading="lazy" decoding="async" onerror={hideOnError}>
      </div>
    {/if}
  </div>
{/snippet}

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
    <section class="lnd-sf">
      <div class="lnd-sf-head font-dmmono">
        <span class="lnd-sf-head-kicker">{$t['lnd.sf.kicker']}</span>
        <span class="lnd-sf-head-right">
          {#if !looping}<span class="lnd-sf-hint-phone">{$t['lnd.sf.hint.phone']}</span>{/if}
          <span class="lnd-sf-hint-desktop">{$t['lnd.sf.hint.desktop']}</span>
          {#if looping}
            <button type="button" class="lnd-sf-pausebtn font-dmmono" onclick={() => { paused = !paused; }}>{paused ? $t['lnd.sf.play'] : $t['lnd.sf.pause']}</button>
          {/if}
        </span>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="lnd-sf-track no-scrollbar" role="region" aria-label={$t['lnd.sf.region']} tabindex="0"
        bind:this={trackEl}
        onscroll={onScroll}
        onpointerdown={() => { snapOn(); hold(); }} onpointerup={release} onpointercancel={release}
        ontouchstart={() => { snapOn(); hold(); }} ontouchend={release} ontouchcancel={release}
        onwheel={() => { snapOn(); hold(); release(); }} onpointerenter={(e) => { if (e.pointerType === 'mouse') { hovering = true; hold(); } }} onpointerleave={(e) => { if (e.pointerType === 'mouse') { hovering = false; release(); } }}
        onfocusin={hold} onfocusout={release}
        onkeydown={onKey}>
        {#each renderFrames as f, i (`${f.key}-${i}`)}
          {@const dup = i >= frames.length}
          {@const S = SECTION[f.key]}
          <div class="lnd-sf-item" aria-hidden={dup ? 'true' : undefined}>
            <a class="lnd-sf-frame" href={f.live?.key === 'blog' ? `/blog/${f.live.slug}` : f.href} tabindex={dup ? -1 : undefined} aria-label={frameLabel(f)} style="--sf-tint:{S.tint}">
              {#if f.live}
                <div class="lnd-sf-repbox"><div class="lnd-sf-rep">
                  {@render bar(f.key)}
                  {#if f.live.key === 'forum'}{@render forumRep(f.live)}
                  {:else if f.live.key === 'calendar'}{@render calendarRep(f.live)}
                  {:else if f.live.key === 'marketplace'}{@render marketRep(f.live)}
                  {:else if f.live.key === 'newsboard'}{@render kurierRep(f.live)}
                  {:else if f.live.key === 'schillerkiez'}{@render kiezRep(f.live)}
                  {:else if f.live.key === 'blog'}{@render blogRep(f.live)}{/if}
                </div></div>
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
  .lnd-sf-nodot::before { display: none; }
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
  .lnd-sf-head-kicker { white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .lnd-sf-hint-phone { display: none; }
  .lnd-sf-track { display: flex; gap: 24px; padding: 4px 48px 6px; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x proximity; scroll-padding-left: 48px; scroll-behavior: auto; outline: none; -webkit-overflow-scrolling: touch; }
  .lnd-sf-track:focus-visible { outline: 2px dashed var(--k-ink); outline-offset: 2px; }
  .lnd-sf-item { flex: 0 0 200px; min-width: 0; scroll-snap-align: start; display: flex; flex-direction: column; gap: 8px; }
  .lnd-sf-frame { display: flex; flex-direction: column; width: 200px; aspect-ratio: 3 / 5; box-sizing: border-box; border: 3px solid var(--sf-tint); border-radius: 16px; overflow: hidden; background: var(--k-paper); box-shadow: 3px 3px 0 var(--k-ink); text-decoration: none; color: var(--k-ink); }
  .lnd-sf-frame { --sf-scale: calc(194 / 390); }
  .lnd-sf-repbox { width: 100%; aspect-ratio: 390 / 650; overflow: hidden; position: relative; background: var(--k-paper); }
  .lnd-sf-rep { position: absolute; top: 0; left: 0; width: 390px; height: 650px; transform-origin: top left; transform: scale(var(--sf-scale)); overflow: hidden; background: var(--k-paper); color: var(--k-ink); font-size: 14px; line-height: 1.5; }
  .lnd-sf-repbar { height: 54px; }
  .lnd-sf-shot { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
  .lnd-sf-cap { min-width: 0; display: flex; flex-direction: column; gap: 1px; padding: 0 2px; }
  .lnd-sf-cap-label { font-size: 9px; letter-spacing: 0.16em; font-weight: 500; }
  .lnd-sf-cap-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-style: italic; font-size: 14px; color: var(--k-ink-soft); }
  .lnd-sf-dots { display: flex; justify-content: center; gap: 6px; padding: 10px 0 16px; }
  .lnd-sf-dot { width: 6px; height: 6px; border-radius: 3px; transition: width 240ms ease; }
  .lnd-sf-dot--on { width: 18px; }
  .lnd-sf-pausebtn { background: none; border: 1px solid var(--k-rule); border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 9.5px; letter-spacing: 0.12em; color: var(--k-ink-soft); cursor: pointer; min-height: 28px; }
  .lnd-clamp3 { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .lnd-sf-track::-webkit-scrollbar { display: none; } .lnd-sf-track { scrollbar-width: none; }

  /* ── CTA (§08) ── */
  .lnd-cta { margin-top: auto; text-align: center; padding: 26px 48px 28px; border-top: 1px dashed var(--k-ochre); background: rgba(176, 117, 21, 0.10); }
  .lnd-cta h2 { font-size: 30px; font-weight: 800; letter-spacing: -0.025em; margin: 0 0 16px; }
  .lnd-cta-btn { display: inline-block; background: var(--k-ink); color: var(--k-paper); font-size: 16px; font-weight: 700; padding: 13px 30px; min-height: 48px; box-sizing: border-box; border-radius: 999px; border: 1.5px solid var(--k-ink); box-shadow: 3px 3px 0 var(--k-ochre); text-decoration: none; }
  .lnd-cta-sub { margin-top: 13px; }
  .lnd-slogan { font-style: italic; font-size: 21px; color: var(--k-ink); margin-top: 16px; }

  /* ── footer (§09) ── */
  .lnd-footer { border-top: 1px solid var(--k-rule); padding: 15px 48px 20px; display: flex; flex-wrap: wrap; gap: 16px; align-items: baseline; justify-content: space-between; }
  .lnd-footlinks { display: flex; flex-wrap: wrap; gap: 16px; }
  .lnd-footlinks a { font-size: 10px; letter-spacing: 0.08em; color: var(--k-ink-soft); text-decoration: underline; text-decoration-style: dashed; text-underline-offset: 3px; }
  .lnd-copy { font-size: 10px; letter-spacing: 0.08em; color: var(--k-ink-mute); }

  /* ── mobile (§10): stacked, strip as row-stack, Schaufenster frames a little wider ── */
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
    .lnd-sf-frame { width: 236px; --sf-scale: calc(230 / 390); }
    .lnd-sf-pausebtn { min-height: 44px; }
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
