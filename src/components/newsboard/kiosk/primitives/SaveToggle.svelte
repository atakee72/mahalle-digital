<script lang="ts">
  import { t } from '../../../../lib/kiosk-i18n';

  let {
    saved = false,
    mini = false,
    disabled = false,
    onToggle = (_e: MouseEvent) => {},
  }: { saved?: boolean; mini?: boolean; disabled?: boolean; onToggle?: (e: MouseEvent) => void } = $props();

  // verb while unsaved, state once saved (user, 2026-09-10) — same pill as the forum detail
  const label = $derived(saved ? $t['detail.engagement.saved'] : $t['detail.engagement.save']);
</script>

<!-- The app's 🔖 pill (copied from ForumPostDetail). Border/text read the
     --k-ink token, not the static Tailwind `border-ink`, so the pill inverts on
     an ink (Kiez) card; the saved state pins its text to ink so the inversion
     can't turn it paper-on-ochre. -->
<button
  type="button"
  {disabled}
  onclick={(e) => { e.stopPropagation(); onToggle(e); }}
  aria-pressed={saved}
  aria-label={label}
  data-save-pill
  class={`relative inline-flex items-center shrink-0 rounded-full font-semibold whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
    mini ? 'gap-1 px-2.5 py-0.5 text-[11.5px]' : 'gap-1.5 px-3 py-1 text-[14px]'
  } ${saved ? 'bg-ochre' : 'bg-transparent hover:bg-paper-warm hover:!text-[#1b1a17]'}`}
  style={`border:2px solid ${saved ? '#1b1a17' : 'var(--k-ink)'}; color:${saved ? '#1b1a17' : 'var(--k-ink)'};`}
>
  <span aria-hidden="true">🔖</span>
  <span>{label}</span>
  <!-- invisible hit-area extender: pads the tap target to ≥44px without growing the visible pill -->
  <span aria-hidden="true" style={`position:absolute; inset:${mini ? '-12px -8px' : '-8px -8px -13px'};`}></span>
</button>
