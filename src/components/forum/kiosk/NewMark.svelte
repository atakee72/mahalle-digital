<script lang="ts">
  // „neu" chip on a card that was published since the member's previous visit of the
  // section (and is not the member's own). Tailwind classes only — no <style> block:
  // this component is reached only through other islands (see root CLAUDE.md,
  // „Nested-island Svelte <style> blocks get orphaned").
  import { t } from '../../../lib/kiosk-i18n';
  import { visitState } from '../../../lib/visits/visitClient';
  import { isNewItem, type VisitSection } from '../../../lib/visits/visitRules';

  let { section, created, authorId = null, invert = false }: {
    section: VisitSection;
    created: unknown;
    authorId?: string | null;
    /** paper chip for a card with an ink background */
    invert?: boolean;
  } = $props();

  const show = $derived(isNewItem(created, authorId, $visitState.since[section], $visitState.me));
</script>

{#if show}
  <span
    data-new-mark
    class="inline-block shrink-0 align-middle font-dmmono text-[9.5px] leading-none uppercase tracking-[0.12em] px-1.5 py-[3px] rounded-[3px] {invert ? 'bg-paper text-ink' : 'bg-ink text-paper'}"
  >{$t['common.new']}</span>
{/if}
