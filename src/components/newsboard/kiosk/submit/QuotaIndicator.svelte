<script lang="ts">
  import { t } from '../../../../lib/kiosk-i18n';
  // `max` is the member's real daily limit (GET /api/news/daily-count → limit).
  // One slot per submission up to 10; above that the row of slots would not
  // fit, so only the „used / max" line is printed.
  let { used = 0, max = 5 }: { used?: number; max?: number } = $props();
  const remaining = $derived(Math.max(0, max - used));
</script>

<div class="flex items-center" style="gap:12px; padding:10px 12px; background:var(--k-paper-soft); border:1px solid var(--k-rule); border-radius:var(--k-radius-sm);">
  {#if max <= 10}
    <div class="flex" style="gap:3px;">
      {#each Array(max) as _, i}
        <div style="width:14px; height:18px; border:1px solid var(--k-ink); border-radius:2px; background:{i < used ? 'var(--k-ink)' : 'transparent'};"></div>
      {/each}
    </div>
  {/if}
  <div>
    <div class="font-dmmono" style="font-size:10px; color:var(--k-ink); letter-spacing:0.1em;">{used} / {max} {$t['news.submit.quotaUsed']}</div>
    <div class="font-instrument italic" style="font-size:11.5px; color:var(--k-ink-soft);">
      {remaining > 0 ? `${remaining} ${$t['news.submit.quotaRemaining']}` : $t['news.submit.quotaReached']}
    </div>
  </div>
</div>
