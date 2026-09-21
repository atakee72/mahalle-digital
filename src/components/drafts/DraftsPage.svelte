<script lang="ts">
  // The member's unfinished things, both kinds in one list. Plan:
  // docs/superpowers/plans/2026-09-21-drafts-page.md
  import { t, locale } from '../../lib/kiosk-i18n';
  import { relTime } from '../../lib/relTime';
  import { confirmAction, showError } from '../../utils/toast';
  import KioskBtn from '../forum/kiosk/KioskBtn.svelte';
  import { optimizeCloudinary } from '../../utils/cloudinary';
  import type { UnifiedDraft } from '../../lib/drafts/unifiedDrafts';

  let { initialDrafts = [], partial = false } = $props<{ initialDrafts?: UnifiedDraft[]; partial?: boolean }>();

  // svelte-ignore state_referenced_locally
  let drafts = $state<UnifiedDraft[]>(initialDrafts);
  let deleting = $state<string | null>(null);

  async function remove(d: UnifiedDraft) {
    if (deleting) return;
    const ok = await confirmAction($t['drafts.delete.confirm'] as string, { variant: 'danger', confirmLabel: $t['drafts.delete'] as string });
    if (!ok) return;
    deleting = d.id;
    try {
      const res = await fetch(d.deleteUrl, { method: 'DELETE', credentials: 'include' });
      if (!res.ok && res.status !== 404) throw new Error(); // 404 = already gone
      drafts = drafts.filter((x) => !(x.id === d.id && x.source === d.source));
    } catch {
      showError($t['drafts.delete.error'] as string);
    } finally {
      deleting = null;
    }
  }
</script>

<!-- A <div>, not <main>: KioskLayout already wraps the slot in <main class="flex-1">
     (BookmarksPage nests a second <main> — do not copy that). -->
<div data-drafts-page class="px-4 md:px-9 lg:px-10 pt-5 md:pt-6 pb-10">
  <section class="mb-5 pb-4 border-b border-dashed border-rule">
    <p class="font-dmmono text-[11px] uppercase tracking-[0.18em] mb-2" style="color: var(--k-accent);">{$t['draftsPage.kicker']}</p>
    <h1 class="font-bricolage font-extrabold text-[34px] min-[380px]:text-4xl md:text-5xl tracking-tight leading-[0.95] text-ink">
      {$t['draftsPage.title.prefix']}
      <em class="font-instrument italic font-normal" style="color: var(--k-accent);">{$t['draftsPage.title.accent']}</em>
    </h1>
    <p class="mt-3 font-instrument italic text-[15px] text-ink-soft max-w-[60ch]">{$t['draftsPage.intro']}</p>
  </section>

  {#if partial}
    <p data-drafts-partial class="mb-4 px-3 py-2 rounded-md border border-dashed border-warn font-dmmono text-[11px] text-ink-soft">{$t['draftsPage.partial']}</p>
  {/if}

  {#if drafts.length}
    <ul class="flex flex-col gap-2">
      {#each drafts as d (d.source + d.id)}
        <li data-draft-row data-source={d.source} class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg border-[1.5px] border-dashed border-ink/50 bg-paper-warm">
          {#if d.thumb}
            <img src={optimizeCloudinary(d.thumb)} alt="" loading="lazy" class="shrink-0 w-11 h-11 rounded-md object-cover border border-ink" />
          {/if}
          <span class={`shrink-0 px-[9px] py-[3px] rounded-lg border border-wine font-dmmono text-[10px] font-medium tracking-[0.08em] ${d.source === 'forum' ? 'bg-wine text-paper' : 'bg-transparent text-wine'}`}>
            {$t[d.source === 'forum' ? 'draftsPage.source.forum' : 'draftsPage.source.markt']}
          </span>
          <span class="shrink-0 font-dmmono text-[10px] uppercase tracking-[0.08em] text-ink-mute">{$t[d.kindKey as keyof typeof $t]}</span>
          <a href={d.resumeHref} class="min-w-0 flex-1 basis-[12rem] inline-flex items-center min-h-[36px] font-bricolage font-bold text-[15px] text-ink hover:underline">
            <span class="truncate">{d.title || $t['drafts.untitled']}</span>
          </a>
          <!-- Date + both actions travel together: on a phone they take ONE line
               under the title instead of leaving "löschen" alone on a third. -->
          <div class="flex items-center gap-x-4 basis-full sm:basis-auto sm:ml-auto">
          <span class="min-w-0 truncate font-dmmono text-[10px] text-ink-mute"><span class="hidden min-[430px]:inline">{$t['drafts.changed']} </span>{relTime(d.updatedAt, $locale)}</span>
          <a href={d.resumeHref} data-draft-resume class="shrink-0 inline-flex items-center min-h-[36px] font-dmmono text-[11px] uppercase tracking-[0.1em] text-wine underline">{$t['drafts.resume']}</a>
          <button type="button" data-draft-delete onclick={() => remove(d)} disabled={deleting === d.id}
            class="shrink-0 inline-flex items-center min-h-[36px] ml-auto sm:ml-0 font-dmmono text-[11px] uppercase tracking-[0.1em] text-ink-mute underline disabled:opacity-50">{$t['drafts.delete']}</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <div data-drafts-empty class="py-10 text-center">
      <p class="font-instrument italic text-[17px] text-ink-soft mb-5">{$t['draftsPage.empty']}</p>
      <div class="flex flex-wrap justify-center gap-3">
        <KioskBtn href="/topics/create">{$t['forum.cta.newTopic']}</KioskBtn>
        <KioskBtn variant="secondary" href="/marketplace/create">{$t['market.cta.newListing']}</KioskBtn>
      </div>
    </div>
  {/if}
</div>
