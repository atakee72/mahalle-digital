<script lang="ts">
  import { t } from '../../../lib/kiosk-i18n';
  // Sources line is a literal, per kiosk-kiezdaten.jsx:546 — not i18n (institution
  // names don't translate). Print route lives at Task 10 (src/pages/schillerkiez/druck.astro).
  //
  // The label used to lead with a raw "⎙" (U+2398, PRINT SCREEN SYMBOL)
  // baked into the translated string, which rendered as a tofu box in the
  // pill's mono font — neither Tailwind's default mono stack nor
  // `--k-font-mono`/DM Mono ships that glyph. Fixed by dropping the glyph
  // from the string and drawing a small inline SVG printer icon instead —
  // deterministic across devices/fonts, unlike a font-stack fallback chase.
  // Same icon reused on the /schillerkiez/druck on-page "Drucken" button.
  // (Task 11 cleanup: `.font-mono` below normalized to `.font-dmmono` —
  // both strings are plain ASCII now that the glyph is gone, so nothing
  // depends on Tailwind's default mono stack anymore.)
</script>

<footer class="flex flex-col items-start gap-4 px-4 md:px-9 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-10 lg:py-6">
  <div class="font-dmmono text-[10px] leading-relaxed text-[var(--k-ink-mute)]">
    {$t['kiez.footer.sources']}: Amt für Statistik Berlin-Brandenburg · Monitoring Soziale Stadtentwicklung · BLUME-Messnetz (mc042)<br />
    † {$t['kiez.footer.loggerNote']}
  </div>
  <a
    href="/schillerkiez/druck"
    data-tour="kiez-druck"
    class="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] border-[var(--k-ink)] px-4 py-2 font-dmmono text-[11.5px] font-semibold text-[var(--k-ink)] shadow-[2px_2px_0_var(--k-ink)]"
  >
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0">
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
    {$t['kiez.footer.print']}
  </a>
</footer>
