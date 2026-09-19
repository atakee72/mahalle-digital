<script lang="ts">
  /**
   * Novel §01 · Lesefaden — sticky mini-mast + scroll-bound progress bar.
   * Docks directly under KioskNav's <header> (Decision 13): measures that
   * header's offsetHeight on mount + resize, sticks this bar at that offset.
   * Progress fill is a direct style binding — NO transition/animation, since
   * it must track scroll position 1:1 (prefers-reduced-motion leaves it
   * unchanged, it's position not motion). Only the 100% „gelesen ✓" swap
   * uses the `.bl-read-done` keyframe (blog.css), display-only, nothing
   * persisted.
   * Transcribed from design/handoffs/design_handoff_blog/jsx/kiosk-blog-article.jsx `BlogReadBar`
   * + mobile row from kiosk-blog-mobile.jsx `BlogMobileArticle`.
   */
  import { onMount } from 'svelte';
  import { t } from '../../../lib/kiosk-i18n';

  let { title, minutes }: { title: string; minutes: number } = $props();

  let topOffset = $state(0);
  let progress = $state(0); // 0..1

  onMount(() => {
    const header = document.querySelector('header');
    const measure = () => {
      topOffset = header?.offsetHeight ?? 0;
    };
    measure();

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const doc = document.documentElement;
        const max = doc.scrollHeight - window.innerHeight;
        progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    onScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      if (raf) cancelAnimationFrame(raf);
    };
  });

  const pct = $derived(Math.round(progress * 100));
  const done = $derived(progress >= 1);
</script>

<!-- Docks under the masthead's VISIBLE height: KioskNav publishes --k-mast-offset
     (0px while the bar is hidden on phones, 2026-09-19). The measured topOffset
     stays as the fallback for the first paint before the island has run. -->
<div
  class="transition-[top] duration-200 ease-out motion-reduce:transition-none"
  style="border-bottom: 1.5px solid var(--k-ink); background: var(--k-paper-warm); position: sticky; top: var(--k-mast-offset, {topOffset}px); z-index: 30;"
>
  <!-- Desktop row -->
  <div class="hidden lg:flex items-center" style="gap: 14px; padding: 9px 48px;">
    <a
      href="/blog"
      class="font-dmmono whitespace-nowrap"
      style="font-size: 10.5px; color: var(--k-rust-deep); text-decoration: none;"
    >{$t['blog.readbar.back']}</a>
    <span
      class="flex-1 text-center truncate"
      style="font-size: 13px; font-weight: 700; letter-spacing: -0.01em;"
    >Die <i class="font-instrument" style="font-weight: 400; color: var(--k-rust);">Beilage</i> · {title}</span>
    {#if done}
      <span class="font-dmmono whitespace-nowrap bl-read-done" style="font-size: 10px; color: var(--k-ink-mute);">{$t['blog.readbar.done']}</span>
    {:else}
      <span class="font-dmmono whitespace-nowrap" style="font-size: 10px; color: var(--k-ink-mute);">{pct} % {$t['blog.readbar.read']} · {minutes} {$t['blog.meta.min']}</span>
    {/if}
  </div>

  <!-- Mobile row -->
  <div class="lg:hidden flex items-center justify-between" style="padding: 8px 18px;">
    <a
      href="/blog"
      class="font-dmmono kiosk-tap inline-flex items-center"
      style="font-size: 10px; color: var(--k-rust-deep); text-decoration: none;"
    >{$t['blog.readbar.back.short']}</a>
    {#if done}
      <span class="font-dmmono bl-read-done" style="font-size: 9.5px; color: var(--k-ink-mute);">{$t['blog.readbar.done']}</span>
    {:else}
      <span class="font-dmmono" style="font-size: 9.5px; color: var(--k-ink-mute);">{pct} % · {minutes} {$t['blog.meta.min']}</span>
    {/if}
  </div>

  <div style="height: 4px; background: var(--k-paper-soft);">
    <div style="width: {progress * 100}%; height: 100%; background: var(--k-rust); {done ? '' : 'border-right: 1.5px solid var(--k-ink);'}"></div>
  </div>
</div>
