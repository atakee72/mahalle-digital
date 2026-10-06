<script lang="ts">
  // „verschoben" — shown on an event whose author moved the date or time (events.movedAt,
  // set by /api/events/edit). Tailwind classes only: this component is reachable only through
  // other islands, so a scoped <style> would be orphaned in the production build.
  import { t } from '../../../lib/kiosk-i18n';

  let { invert = false, size = 'sm' }: { invert?: boolean; size?: 'sm' | 'md' } = $props();
</script>

<span
  data-moved-tag
  class={`inline-flex items-center gap-1 rounded-[3px] border font-dmmono font-semibold uppercase tracking-[0.08em] whitespace-nowrap ${
    size === 'md' ? 'px-2 py-0.5 text-[10.5px]' : 'px-[5px] py-px text-[9.5px]'
  } ${invert ? 'text-paper border-paper/70' : 'text-ink border-ink'}`}
>
  <span aria-hidden="true">↦</span>{$t['cal.moved.label']}
</span>
