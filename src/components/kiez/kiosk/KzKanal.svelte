<script lang="ts">
  // Kanal frame — shared header (mono kicker + bold title + optional right
  // meta snippet) + dashed bottom rule wrapping every chart module. Every
  // Kanal (K01, K02, …) renders through this shell. Spec:
  // kiosk-kiezdaten.jsx:251-267 (KZKanal).
  import { t } from '../../../lib/kiosk-i18n';
  import type { Snippet } from 'svelte';

  let { nr, title, area, right, children }: {
    nr: string;
    title: string;
    area: string;
    right?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="mx-4 md:mx-9 border-b border-dashed border-rule py-5 lg:mx-10">
  <div class="mb-3.5 flex flex-wrap items-end justify-between gap-3" data-tour={nr === '01' ? 'kiez-kanal' : undefined}>
    <div class="min-w-0">
      <div class="font-dmmono text-[10px] uppercase tracking-[0.16em] text-ink-mute">
        {$t['kiez.kanal.label']} {nr} · {area}
      </div>
      <div class="mt-0.5 text-2xl font-extrabold tracking-tight text-ink">{title}</div>
    </div>
    {#if right}{@render right()}{/if}
  </div>
  {@render children()}
</section>
