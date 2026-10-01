<script lang="ts">
  // The small tag beside a member's name: „Initiative" or „Gewerbe".
  // A private person carries none, and so does any missing or unknown value —
  // the tag can never print for data it does not recognise.
  // Tailwind classes only: this component is reached through other islands,
  // and a scoped <style> block would be orphaned in production builds.
  import { t } from '../../../lib/kiosk-i18n';
  import { memberTypeTagKey } from '../../../lib/members/memberType';

  let { type, tone = 'paper' }: {
    type?: string | null;
    /** `ink` for dark (ink) cards, `paper` everywhere else. */
    tone?: 'paper' | 'ink';
  } = $props();

  const key = $derived(memberTypeTagKey(type));
</script>

{#if key}
  <span
    data-member-tag={type}
    class={`shrink-0 inline-flex items-center font-dmmono text-[8.5px] font-semibold uppercase tracking-[0.08em] px-1.5 py-px rounded-sm border align-middle ${
      tone === 'ink' ? 'border-paper text-paper' : 'border-ink text-ink'
    }`}
  >{$t[key]}</span>
{/if}
