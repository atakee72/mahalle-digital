<script lang="ts">
  // Mobile accordion fold — below `lg` wraps Moderation/Konto in a
  // collapsible paperWarm card (4px accent top-rule, header with title +
  // optional badge + ▾/▴ toggle). Hidden entirely on `lg+` — desktop keeps
  // the plain PCard versions of those sections mounted separately (see
  // ProfileInner.svelte). Local `$state` toggle, default per `open` prop —
  // this is a presentational wrapper only, it owns no fetch state.
  // Design source: kiosk-profile-public.jsx (PMobileFold).

  import type { Snippet } from 'svelte';

  let {
    title,
    accent = 'var(--k-ochre)',
    open: initialOpen = false,
    hint,
    badge,
    children,
  }: {
    title: string;
    accent?: string;
    open?: boolean;
    // What is inside, shown beside the title while the fold is CLOSED.
    hint?: string;
    badge?: Snippet;
    children?: Snippet;
  } = $props();

  // svelte-ignore state_referenced_locally
  let open = $state(initialOpen);
</script>

<div
  class="lg:hidden"
  style="
    background: var(--k-paper-warm); border: 1.5px solid var(--k-ink);
    border-top: 4px solid {accent}; border-radius: 16px;
    box-shadow: 3px 3px 0 var(--k-ink); overflow: hidden;
  "
>
  <button
    type="button"
    onclick={() => (open = !open)}
    aria-expanded={open}
    style="
      width: 100%; min-height: 44px; padding: 13px 16px;
      display: flex; align-items: center; justify-content: space-between;
      background: none; border: none; cursor: pointer; text-align: left;
    "
  >
    <span style="display: flex; align-items: center; gap: 8px; min-width: 0;">
      <span class="font-bricolage" style="font-size: 14.5px; font-weight: 800;">{title}</span>
      {#if badge}{@render badge()}{/if}
      {#if hint && !open}
        <span class="font-dmmono" style="font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--k-ink-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{hint}</span>
      {/if}
    </span>
    <span class="font-dmmono" style="font-size: 12px; color: var(--k-ink-mute); flex-shrink: 0; padding-left: 8px;">{open ? '▴' : '▾'}</span>
  </button>
  {#if open}
    <div style="padding: 0 16px 16px; border-top: 1px dashed var(--k-rule); padding-top: 12px;">
      {@render children?.()}
    </div>
  {/if}
</div>
