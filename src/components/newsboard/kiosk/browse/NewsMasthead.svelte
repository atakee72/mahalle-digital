<script lang="ts">
  import { t, locale } from '../../../../lib/kiosk-i18n';
  import KuratiertChip from '../primitives/KuratiertChip.svelte';

  let {
    issue,
    articleCount,
    sourceCount,
    degraded = false,
  }: { issue: number; articleCount: number; sourceCount: number; degraded?: boolean } = $props();

  // Server passes issue; the dateline is purely cosmetic and may use the client
  // locale's today (acceptable — the issue NUMBER is the server-fixed value).
  const dateline = $derived(
    new Date().toLocaleDateString($locale === 'de' ? 'de-DE' : 'en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  );
</script>

<!-- Condensed head (2026-09-22, user: the first article sat far below the top
     on a phone). Below md the nameplate is two lines — the wordmark at 28 px and
     ONE mono line with edition, number and the counts; the tagline and the
     KURATIERT chip are desktop-only. From md the full nameplate stays, with
     tighter vertical padding than before (30/22 → 16/16). -->
<!-- Condensed head (2026-09-22, user: on a phone the first article sat far
     below the top). Below md the nameplate is two lines: the wordmark at 28 px
     and ONE mono line with edition, number and counts; ribbons, tagline and the
     KURATIERT chip are md+ only. From md the vertical padding went 30/22 → 16/16. -->
<section class="relative px-4 py-3 md:px-9 md:py-4" data-tour="kurier-masthead" style="border-bottom:2px solid var(--k-ink);">
  <!-- Top ribbon (md+) -->
  <div
    class="hidden md:flex justify-between items-center font-dmmono uppercase"
    style="font-size:10.5px; font-weight:600; color:var(--k-ink); letter-spacing:0.16em;
           padding-bottom:12px; border-bottom:1px solid var(--k-ink);"
  >
    <span>{$t['news.masthead.edition']}</span>
    <span>{dateline}</span>
    <span>{$t['news.masthead.issueAbbr']} {issue}</span>
  </div>

  <!-- Name — 28 px on phones, the big nameplate from md -->
  <h1
    class="font-instrument italic text-center text-[28px] leading-none mb-1.5 md:text-[clamp(36px,9vw,88px)] md:leading-[0.92] md:mt-3 md:mb-1"
    style="font-weight:400; letter-spacing:-0.025em; color:var(--k-ink);"
  >Schillerkiez Kurier</h1>

  <!-- Phone: ONE mono line — edition · number · counts -->
  <div
    class="md:hidden flex flex-wrap justify-center items-center font-dmmono uppercase"
    style="gap:0 6px; font-size:9.5px; color:var(--k-ink-soft); letter-spacing:0.08em;"
  >
    <span>{$t['news.masthead.edition']}</span><span aria-hidden="true">·</span>
    <span>{$t['news.masthead.issueAbbr']} <b style="color:var(--k-ink);">{issue}</b></span><span aria-hidden="true">·</span>
    <span><b style="color:var(--k-ink);">{articleCount}</b> {$t['news.masthead.articles']}</span><span aria-hidden="true">·</span>
    <span><b style="color:var(--k-ink);">{sourceCount}</b> {$t['news.masthead.sources']}</span>
  </div>
  {#if degraded}<div class="md:hidden text-center font-dmmono" style="font-size:9.5px; color:var(--k-warn); margin-top:4px;">{$t['news.masthead.degraded']}</div>{/if}

  <!-- Tagline (md+) -->
  <div
    class="hidden md:block font-bricolage text-center"
    style="font-size:14px; font-weight:500; color:var(--k-ink-soft); letter-spacing:0.02em; margin:0 0 12px;"
  >{$t['news.masthead.tagline']}</div>

  <!-- Bottom ribbon (md+) -->
  <div
    class="hidden md:flex justify-between items-center font-dmmono"
    style="padding-top:12px; border-top:1px solid var(--k-ink); font-size:10.5px;
           color:var(--k-ink-soft); letter-spacing:0.06em;"
  >
    <span><b style="color:var(--k-ink);">{articleCount}</b> {$t['news.masthead.articles']}</span>
    <span>
      <b style="color:var(--k-ink);">{sourceCount}</b> {$t['news.masthead.sources']}
      {#if degraded}<span style="color:var(--k-warn); margin-left:6px;">· {$t['news.masthead.degraded']}</span>{/if}
    </span>
    <KuratiertChip />
  </div>
</section>
