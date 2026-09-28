<script lang="ts">
  // Kiosk variant of the global footer. Reactive to locale; uses paper/ink
  // tokens + JetBrains Mono for the Editorial Kiosk feel.
  import { t, tStr } from '../../../lib/kiosk-i18n';

  // Year is captured at render time — fine for SSR (re-evaluated each request).
  // No need for reactive state since the year doesn't change mid-session.
  const year = new Date().getFullYear();
</script>

<footer
  class="relative z-10 mt-16 py-6 pb-16 lg:pb-6 px-4 md:px-8 border-t border-rule"
>
  <div class="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 text-center font-dmmono text-[11px] text-ink-mute">
    <span>
      {tStr($t['footer.copyright.before'], { year })}<a
        href="https://ercan-atak.de"
        class="inline-block kiosk-tap underline decoration-rule decoration-1 underline-offset-2 hover:text-ink hover:decoration-ink transition-colors"
        target="_blank"
        rel="me noopener noreferrer"
      >{$t['footer.author']}</a>{$t['footer.copyright.after']}
    </span>
    <span>
      {$t['footer.licensedUnder']}
      <a
        href="https://polyformproject.org/licenses/noncommercial/1.0.0"
        class="inline-block kiosk-tap underline decoration-rule decoration-1 underline-offset-2 hover:text-ink hover:decoration-ink transition-colors"
        target="_blank"
        rel="noopener noreferrer"
      >
        {$t['footer.license']}
      </a>.
    </span>
  </div>
</footer>
