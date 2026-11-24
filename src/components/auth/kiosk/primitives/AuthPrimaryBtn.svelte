<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    loading = false,
    disabled = false,
    type = 'submit',
    onclick = () => {},
    ladybird = false,
    children,
  }: {
    loading?: boolean; disabled?: boolean; type?: 'submit' | 'button';
    onclick?: () => void;
    /** The Mahalle ladybird stands on the button's top edge. ONLY for the doors into Mahalle:
     *  „Anmelden" and „Konto erstellen" (and the landing page's „Mitmachen"); never on other
     *  buttons, or it stops meaning „this way in" (owner, 2026-11-25). */
    ladybird?: boolean;
    children?: Snippet;
  } = $props();
</script>

<button
  {type}
  disabled={disabled || loading}
  {onclick}
  class="auth-primary-btn font-bricolage"
  style="position:relative; width:100%; display:flex; align-items:center; justify-content:center; gap:9px;
         background:{disabled ? 'var(--k-ink-mute)' : 'var(--k-ink)'}; color:var(--k-paper);
         font-size:15px; font-weight:700; padding:13px 18px; border-radius:999px;
         border:1.5px solid var(--k-ink);
         box-shadow:{disabled ? 'none' : '3px 3px 0 var(--k-accent)'};
         cursor:{disabled || loading ? 'not-allowed' : 'pointer'};"
>
  {#if loading}
    <span class="auth-spin" style="width:13px; height:13px; border-radius:50%; border:2px solid var(--k-paper); border-top-color:transparent; display:inline-block;"></span>
  {/if}
  {@render children?.()}
  {#if ladybird}
    <!-- inline styles only: this component is reached through other islands (orphaned-stylesheet trap) -->
    <svg data-btn-bug aria-hidden="true" viewBox="-7.5 -9.5 21 14" style="position:absolute; width:30px; height:auto; left:30px; top:0; overflow:visible; pointer-events:none; color:var(--k-ink); transform:translate(0, -89.3%);"><path d="M-3,0 L-5,2.5 M0,0.5 L0,3 M3,0 L5,2.5 M6,-3.5 Q9,-8 10,-8 M7,-2.5 Q11,-5 12,-4.5" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" /><circle cx="6.2" cy="-2" r="2.6" fill="currentColor" /><path d="M-6,0 A6,5 0 0 1 6,0 Z" fill="#DB472D" stroke="currentColor" stroke-width="0.75" stroke-linejoin="round" /><path d="M0,0 L0,-5" fill="none" stroke="currentColor" stroke-width="0.7" stroke-linecap="round" /><g fill="currentColor"><circle cx="-3" cy="-2" r="0.95" /><circle cx="2.6" cy="-2.8" r="0.95" /><circle cx="3.3" cy="-0.8" r="0.7" /></g></svg>
  {/if}
</button>

<style>
  @keyframes authSpin { to { transform: rotate(360deg); } }
  .auth-spin { animation: authSpin 0.7s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .auth-spin { animation: none; } }
</style>
