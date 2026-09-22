<script lang="ts">
  import { t } from '../../../../lib/kiosk-i18n';
  import { scrollFade } from '../../../../lib/scrollFade';
  import { SEKTION_KEYS, type SektionKey } from '../../../../lib/newsboard/newsTaxonomy';

  let {
    activeSektion = null,
    activeZeitraum = 'week',
    savedOnly = false,
    isAuthenticated = false,
    onSektionChange = (_s: SektionKey | null) => {},
    onZeitraumChange = (_z: string) => {},
    onSavedToggle = (_v: boolean) => {},
  }: {
    activeSektion?: SektionKey | null;
    activeZeitraum?: string;
    savedOnly?: boolean;
    isAuthenticated?: boolean;
    onSektionChange?: (s: SektionKey | null) => void;
    onZeitraumChange?: (z: string) => void;
    onSavedToggle?: (v: boolean) => void;
  } = $props();

  const ZEITRAUM: { id: string; key: string }[] = [
    { id: 'today', key: 'news.filter.today' },
    { id: 'week',  key: 'news.filter.week' },
    { id: 'month', key: 'news.filter.month' },
  ];
</script>

<section class="px-4 md:px-9 lg:px-10" style="border-bottom:1px dashed var(--k-rule);">
  <!-- Two rows on every width (2026-09-22 condensed head): below lg each row
       scrolls sideways (scrollFade) instead of wrapping — the phone head used
       to wrap to four filter rows. The SEKTION label rides inside the scroller
       (scrolls away with it); ZEITRAUM's label is md+ only — the three period
       words explain themselves on a phone. -->
  <!-- Row 1: Sektion -->
  <div data-tour="kurier-sections" class="pt-3 pb-2 md:pb-3 flex items-center">
    <div use:scrollFade class="kiosk-scroll-fade no-scrollbar flex items-center gap-2 overflow-x-auto min-w-0 lg:flex-wrap lg:overflow-visible">
    <span class="font-dmmono uppercase shrink-0" style="font-size:9.5px; color:var(--k-ink-mute); letter-spacing:0.12em; min-width:56px;">
      {$t['news.filter.sektion']}
    </span>
      <button type="button" onclick={() => onSektionChange(null)} aria-pressed={activeSektion === null}
        class="shrink-0 kiosk-tap-box inline-flex items-center justify-center font-bricolage font-semibold">
        <span style="padding:5px 12px; font-size:12.5px; border-radius:var(--k-radius-pill);
               border:{activeSektion === null ? '2px solid var(--k-ink)' : '1.5px solid var(--k-rule)'};
               background:{activeSektion === null ? 'var(--k-ink)' : 'transparent'};
               color:{activeSektion === null ? 'var(--k-paper)' : 'var(--k-ink-mute)'};">
          {$t['news.filter.all']}
        </span>
      </button>
      {#each SEKTION_KEYS as key (key)}
        <button type="button" onclick={() => onSektionChange(activeSektion === key ? null : key)} aria-pressed={activeSektion === key}
          class="shrink-0 kiosk-tap-box inline-flex items-center justify-center font-bricolage font-semibold">
          <span style="padding:5px 12px; font-size:12.5px; border-radius:var(--k-radius-pill);
                 border:{activeSektion === key ? '2px solid var(--k-ink)' : '1.5px solid var(--k-rule)'};
                 background:{activeSektion === key ? 'var(--k-ink)' : 'transparent'};
                 color:{activeSektion === key ? 'var(--k-paper)' : 'var(--k-ink)'};">
            {$t[`news.sektion.${key}` as keyof typeof $t]}
          </span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Row 2: Zeitraum + Saved + Unread -->
  <div use:scrollFade class="kiosk-scroll-fade no-scrollbar pb-3 flex items-center gap-2 md:gap-3 overflow-x-auto lg:flex-wrap lg:overflow-visible" data-tour="kurier-fade">
    <span class="hidden md:inline font-dmmono uppercase shrink-0" style="font-size:9.5px; color:var(--k-ink-mute); letter-spacing:0.12em;">
      {$t['news.filter.zeitraum']}
    </span>
    {#each ZEITRAUM as z (z.id)}
      <button type="button" onclick={() => onZeitraumChange(z.id)} aria-pressed={activeZeitraum === z.id}
        class="shrink-0 kiosk-tap-box inline-flex items-center justify-center font-bricolage font-semibold">
        <span style="padding:5px 12px; font-size:12.5px; border-radius:var(--k-radius-pill);
               border:{activeZeitraum === z.id ? '2px solid var(--k-ink)' : '1.5px solid var(--k-rule)'};
               background:{activeZeitraum === z.id ? 'var(--k-ink)' : 'transparent'};
               color:{activeZeitraum === z.id ? 'var(--k-paper)' : 'var(--k-ink)'};">
          {$t[z.key as keyof typeof $t]}
        </span>
      </button>
    {/each}

    <div class="flex-1 hidden lg:block"></div>

    <button type="button" onclick={() => onSavedToggle(!savedOnly)} disabled={!isAuthenticated}
      title={!isAuthenticated ? $t['news.filter.saved.gated'] : undefined} aria-pressed={savedOnly}
      data-tour="kurier-saved"
      class="shrink-0 kiosk-tap-box inline-flex items-center justify-center font-bricolage font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
      <span style="padding:5px 13px; font-size:12.5px; border-radius:var(--k-radius-pill);
             border:{savedOnly ? '2px solid var(--k-ink)' : '2px dashed var(--k-rule)'};
             background:{savedOnly ? 'var(--k-ink)' : 'transparent'};
             color:{savedOnly ? 'var(--k-paper)' : 'var(--k-ink-soft)'};">
        ☆ {$t['news.filter.saved']}
      </span>
    </button>

    <!-- Unread toggle: rendered but disabled in Phase 1 (needs read-state, Phase 3) -->
    <button type="button" disabled title={$t['news.filter.unread.soon']}
      class="shrink-0 kiosk-tap-box inline-flex items-center justify-center font-bricolage font-semibold opacity-50 cursor-not-allowed">
      <span style="padding:5px 13px; font-size:12.5px; border-radius:var(--k-radius-pill);
             border:2px dashed var(--k-rule); background:transparent; color:var(--k-ink-soft);">
        ● {$t['news.filter.unread']}
      </span>
    </button>
  </div>
</section>
