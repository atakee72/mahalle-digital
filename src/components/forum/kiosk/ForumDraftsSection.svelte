<script lang="ts">
  // The member's own forum drafts — rendered only under the "Meine" filter.
  // Tailwind classes only: this component is reachable only through the forum
  // island, a <style> block here would be orphaned in the prod build.
  // Design: docs/superpowers/plans/2026-09-21-forum-server-drafts.md
  import { onMount } from 'svelte';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import { relTime } from '../../../lib/relTime';
  import { confirmAction, showError } from '../../../utils/toast';
  import { draftResumeHref, type PostDraftDTO } from '../../../lib/forum/postDrafts';

  let drafts = $state<PostDraftDTO[]>([]);
  let deleting = $state<string | null>(null);

  const chip: Record<PostDraftDTO['kind'], { key: 'chip.discussion' | 'chip.announcement' | 'chip.recommendation'; cls: string }> = {
    discussion: { key: 'chip.discussion', cls: 'bg-wine' },
    announcement: { key: 'chip.announcement', cls: 'bg-teal' },
    recommendation: { key: 'chip.recommendation', cls: 'bg-moss' }
  };

  onMount(async () => {
    try {
      const res = await fetch('/api/posts/drafts', { credentials: 'include' });
      if (res.ok) drafts = (await res.json()).drafts ?? [];
    } catch { /* a missing drafts list must never break the feed */ }
  });

  async function remove(d: PostDraftDTO) {
    if (deleting) return;
    const ok = await confirmAction($t['drafts.delete.confirm'] as string, { variant: 'danger', confirmLabel: $t['drafts.delete'] as string });
    if (!ok) return;
    deleting = d.id;
    try {
      const res = await fetch(`/api/posts/drafts/${d.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok && res.status !== 404) throw new Error();
      drafts = drafts.filter((x) => x.id !== d.id);
    } catch {
      showError($t['drafts.delete.error'] as string);
    } finally {
      deleting = null;
    }
  }
</script>

{#if drafts.length}
  <section id="entwuerfe" data-forum-drafts class="mb-6 rounded-lg border-[1.5px] border-dashed border-ink/50 bg-paper-warm px-4 py-3">
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
      <h2 class="font-bricolage font-bold text-base tracking-tight">{$t['drafts.section.title']} · {drafts.length}</h2>
      <p class="font-instrument italic text-[13px] text-ink-soft">{$t['drafts.section.hint']}</p>
    </div>
    <ul class="flex flex-col divide-y divide-dashed divide-rule">
      {#each drafts as d (d.id)}
        <li data-draft-row class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <span class={`shrink-0 px-[9px] py-[3px] rounded-lg border border-ink font-dmmono text-[10px] font-medium tracking-[0.08em] text-paper ${chip[d.kind].cls}`}>{$t[chip[d.kind].key]}</span>
          <a href={draftResumeHref(d.id)} class="min-w-0 flex-1 basis-[12rem] inline-flex items-center min-h-[36px] font-bricolage font-bold text-[15px] text-ink hover:underline">
            <span class="truncate">{d.title.trim() || $t['drafts.untitled']}</span>
          </a>
          <span class="shrink-0 font-dmmono text-[10px] text-ink-mute">{$t['drafts.changed']} {relTime(d.updatedAt, $locale)}</span>
          <a href={draftResumeHref(d.id)} data-draft-resume class="shrink-0 inline-flex items-center min-h-[36px] font-dmmono text-[11px] uppercase tracking-[0.1em] text-wine underline">{$t['drafts.resume']}</a>
          <button type="button" data-draft-delete onclick={() => remove(d)} disabled={deleting === d.id}
            class="shrink-0 inline-flex items-center min-h-[36px] font-dmmono text-[11px] uppercase tracking-[0.1em] text-ink-mute underline disabled:opacity-50">{$t['drafts.delete']}</button>
        </li>
      {/each}
    </ul>
  </section>
{/if}
