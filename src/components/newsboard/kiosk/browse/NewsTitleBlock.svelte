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
    <!-- Phones: the same title size as forum + calendar (34 px below 380, 36 px
         from 380; was 26 px — user, 2026-09-20). From md the old clamp stays. -->
    <h2 class="font-bricolage break-words text-[34px] min-[380px]:text-[36px] md:text-[length:clamp(26px,4vw,38px)]" style="font-weight:800; letter-spacing:-0.03em; line-height:1; margin:6px 0 0;">
      {@html $t['news.titleblock.heading']}
    </h2>
  </div>
  <!-- Desktop only since 2026-09-20: below lg the floating "+" (NewsboardIndexInner)
       is the way in and carries the same data-tour anchor. -->
  <span data-tour="kurier-submit" class="hidden lg:inline-flex shrink-0">
    <KioskBtn variant="secondary" href="/newsboard/submit">{$t['news.titleblock.submit']}</KioskBtn>
  </span>
</section>
