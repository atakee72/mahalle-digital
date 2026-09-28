<script lang="ts">
  // Das Schaufenster — public landing (design/handoffs/design_handoff_landing).
  // Data is SSR-provided via props (lib-direct, 1h cache); the ONLY runtime
  // JS behaviors are the locale toggle and the date line. Pulse is pure CSS.
  import { t, tStr, locale, setLocale } from '../../lib/kiosk-i18n';
  import type { LandingData, HeartbeatRow } from '../../lib/landing';

  let { data, blog } = $props<{
    data: LandingData;
    blog: { slug: string; title: string; description: string; pubDateISO: string }[];
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

  const popFmt = $derived(
    data.population != null
      ? new Intl.NumberFormat($locale === 'de' ? 'de-DE' : 'en-GB').format(data.population)
      : null,
  );
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

  <!-- teaser zone — ALWAYS opaque paper (§02) -->
  <main class="lnd-main">
    <section class="lnd-teaser lnd-teaser-blog">
      <div class="lnd-kicker"><span class="font-dmmono" style="background:#a3552e">{$t['lnd.blog.kicker']}</span></div>
      {#if blog[0]}
        <a href={`/blog/${blog[0].slug}`} class="lnd-plain"><h3 class="font-bricolage lnd-blog-h">{blog[0].title}</h3></a>
        <p class="lnd-blog-s">{blog[0].description}</p>
        <div class="lnd-meta font-dmmono">{fmtBlogDate(blog[0].pubDateISO)} · {$t['lnd.blog.byline']}</div>
      {/if}
      {#if blog[1]}
        <div class="lnd-blog2">
          <a href={`/blog/${blog[1].slug}`} class="lnd-plain"><div class="lnd-blog2-h">{blog[1].title}</div></a>
          <div class="lnd-meta font-dmmono">{fmtBlogDate(blog[1].pubDateISO)}</div>
        </div>
      {/if}
      <div class="lnd-linkrow"><a href="/blog" class="lnd-link" style="color:#a3552e">{$t['lnd.blog.link']}</a></div>
    </section>

    <section class="lnd-teaser lnd-teaser-daten">
      <div class="lnd-kicker"><span class="font-dmmono" style="background:var(--k-moss)">{$t['lnd.daten.kicker']}</span></div>
      {#if popFmt}
        <div class="lnd-bignum font-bricolage">{popFmt}</div>
        <div class="lnd-meta font-dmmono">{$t['lnd.daten.sub']}</div>
      {/if}
      {#if data.airGrade != null}
        <div class="lnd-airline">
          <span class="lnd-dot" style="background:var(--k-moss); width:9px; height:9px;"></span>
          <span>{tStr($t['lnd.daten.air'], { grade: $t[`lnd.daten.grade.${data.airGrade}`] ?? '' })}</span>
        </div>
      {/if}
      {#if data.airSpark.some((v) => v != null)}
        <div class="lnd-sparkrow">
          <svg width="120" height="26" viewBox="0 0 120 26" aria-hidden="true">
            <polyline points={sparkPoints(data.airSpark, 120, 26)} fill="none" stroke="var(--k-moss)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="lnd-meta font-dmmono">{$t['lnd.daten.spark']}</span>
        </div>
      {/if}
      <div class="lnd-linkrow"><a href="/schillerkiez" class="lnd-link" style="color:var(--k-moss)">{$t['lnd.daten.link']}</a></div>
    </section>

    <section class="lnd-teaser lnd-teaser-kurier">
      <div class="lnd-kicker"><span class="font-dmmono" style="background:var(--k-ink)">{$t['lnd.kurier.kicker']}</span></div>
      {#each data.kurier as h, i (h.sourceUrl + i)}
        <div class="lnd-head" class:lnd-head-first={i === 0}>
          <div class="lnd-head-t">{h.title}</div>
          <a href={h.sourceUrl} target="_blank" rel="noopener noreferrer" class="lnd-head-s font-dmmono">{h.sourceName.toUpperCase()} ↗</a>
        </div>
      {/each}
      <div class="font-instrument lnd-kurier-note">{$t['lnd.kurier.note']}</div>
    </section>
  </main>

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

  /* ── teaser zone (ALWAYS opaque paper, §02) ── */
  .lnd-main { flex: 1; display: grid; grid-template-columns: 1.18fr 1fr 1fr; padding: 28px 48px 22px; background: var(--k-paper); }
  .lnd-teaser-blog { padding-right: 26px; }
  .lnd-teaser-daten { padding: 0 26px; border-left: 1px solid var(--k-rule); }
  .lnd-teaser-kurier { padding-left: 26px; border-left: 1px solid var(--k-rule); display: flex; flex-direction: column; }
  .lnd-kicker { border-bottom: 1px dashed var(--k-rule); padding-bottom: 7px; margin-bottom: 14px; }
  .lnd-kicker span { font-size: 10.5px; font-weight: 500; letter-spacing: 0.16em; color: var(--k-paper); padding: 3px 9px 4px; display: inline-block; }
  .lnd-plain { text-decoration: none; color: inherit; }
  .lnd-blog-h { font-size: 25px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.12; margin: 0 0 10px; }
  .lnd-blog-s { font-size: 13.5px; line-height: 1.55; color: var(--k-ink-soft); margin: 0 0 8px; }
  .lnd-meta { font-size: 9.5px; letter-spacing: 0.1em; color: var(--k-ink-mute); }
  .lnd-blog2 { border-top: 1px dashed var(--k-rule); margin-top: 14px; padding-top: 12px; }
  .lnd-blog2-h { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.25; }
  .lnd-linkrow { margin-top: 16px; }
  .lnd-link { font-size: 13px; font-weight: 700; text-decoration: underline; text-decoration-style: dashed; text-underline-offset: 3px; }
  .lnd-bignum { font-size: 62px; font-weight: 800; letter-spacing: -0.04em; line-height: 1; color: var(--k-moss); }
  .lnd-airline { display: flex; align-items: center; gap: 9px; margin-top: 20px; padding-top: 14px; border-top: 1px dashed var(--k-rule); font-size: 14px; font-weight: 600; }
  .lnd-sparkrow { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
  .lnd-head { padding: 11px 0; border-top: 1px dashed var(--k-rule); }
  .lnd-head-first { padding-top: 0; border-top: none; }
  .lnd-head-t { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3; }
  .lnd-head-s { display: inline-block; font-size: 9.5px; letter-spacing: 0.1em; color: var(--k-ink-mute); margin-top: 5px; text-decoration: underline; text-decoration-style: dashed; text-underline-offset: 3px; }
  .lnd-kurier-note { font-style: italic; font-size: 12.5px; color: var(--k-ink-mute); margin-top: auto; padding-top: 10px; }

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
    .lnd-main { grid-template-columns: 1fr; padding: 4px 18px 12px; }
    .lnd-teaser-blog { padding: 16px 0 4px; }
    .lnd-teaser-daten { padding: 18px 0 4px; border-left: none; }
    .lnd-teaser-kurier { padding: 18px 0 0; border-left: none; }
    .lnd-blog-h { font-size: 20px; }
    .lnd-bignum { font-size: 42px; }
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
