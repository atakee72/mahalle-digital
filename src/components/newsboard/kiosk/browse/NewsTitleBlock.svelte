<script lang="ts">
  import { t } from '../../../../lib/kiosk-i18n';
  import KioskBtn from '../../../forum/kiosk/KioskBtn.svelte';
</script>

<section
  class="flex justify-between items-end px-4 md:px-9 lg:px-10"
  style="padding-top:20px; padding-bottom:14px; border-bottom:1px dashed var(--k-rule);"
>
  <div>
    <div class="font-dmmono uppercase" style="font-size:11px; color:var(--k-ink); letter-spacing:0.16em;">
      {$t['news.titleblock.kicker']}
    </div>
    <h2 class="font-bricolage break-words" style="font-size:clamp(26px,4vw,38px); font-weight:800; letter-spacing:-0.03em; line-height:1; margin:6px 0 0;">
      {@html $t['news.titleblock.heading']}
    </h2>
  </div>
  <span data-tour="kurier-submit" class="inline-flex">
    <KioskBtn variant="secondary" href="/newsboard/submit">{$t['news.titleblock.submit']}</KioskBtn>
  </span>
</section>
