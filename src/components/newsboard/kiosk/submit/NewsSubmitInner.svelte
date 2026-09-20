<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../../../lib/kiosk-i18n';
  import { showToast } from '../../../../utils/toast';
  import { type SektionKey } from '../../../../lib/newsboard/newsTaxonomy';
  import KioskBtn from '../../../forum/kiosk/KioskBtn.svelte';
  import QuotaIndicator from './QuotaIndicator.svelte';
  import SektionPicker from './SektionPicker.svelte';

  let title = $state('');
  let description = $state('');
  let sourceUrl = $state('');
  let sourceName = $state('');
  let sektion = $state<SektionKey | null>(null);
  let imageUrl = $state('');
  let uploading = $state(false);
  let submitting = $state(false);

  let used = $state(0);
  let quotaReached = $state(false);

  onMount(async () => {
    try {
      const res = await fetch('/api/news/daily-count');
      if (res.ok) { const d = await res.json(); used = d.count; quotaReached = !d.canSubmit; }
    } catch { /* ignore */ }
  });

  // Paste a link → the server reads the article's title, text, image and site
  // name (GET /api/news/preview, hardened) and we fill the fields that are still
  // EMPTY — never overwrite what the member typed. One lookup per address.
  let previewState = $state<'idle' | 'loading' | 'filled' | 'failed'>('idle');
  let lastPreviewed = '';
  async function fillFromUrl() {
    const url = sourceUrl.trim();
    if (!/^https:\/\/\S+\.\S+/.test(url) || url === lastPreviewed) return;
    lastPreviewed = url;
    previewState = 'loading';
    try {
      const res = await fetch(`/api/news/preview?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      if (sourceUrl.trim() !== url) return; // the member changed the link meanwhile
      let filled = false;
      if (!title.trim() && d.title) { title = d.title; filled = true; }
      if (!description.trim() && d.description) { description = d.description; filled = true; }
      if (!sourceName.trim() && d.siteName) { sourceName = d.siteName; filled = true; }
      if (!imageUrl && !uploading && d.image) { imageUrl = d.image; filled = true; }
      previewState = filled ? 'filled' : 'idle';
    } catch {
      if (sourceUrl.trim() === url) previewState = 'failed';
    }
  }

  const valid = $derived(
    title.trim().length >= 5 && description.trim().length >= 10 &&
    /^https?:\/\//.test(sourceUrl) && !!sektion
  );

  async function onImagePick(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploading = true;
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/news/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error();
      imageUrl = (await res.json()).url;
    } catch { showToast($t['news.submit.error'], { type: 'error' }); }
    finally { uploading = false; }
  }

  async function submit() {
    if (!valid || submitting) return;
    if (!sektion) { showToast($t['news.submit.sectionRequired'], { type: 'warning' }); return; }
    submitting = true;
    try {
      const res = await fetch('/api/news/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, sourceUrl, sourceName: sourceName || new URL(sourceUrl).hostname, imageUrl, sektion }),
      });
      if (res.status === 429) { quotaReached = true; throw new Error($t['news.submit.quotaReached']); }
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err?.error || 'submit failed'); }
      // Toast fires on the DESTINATION page (flash param): a toast shown here
      // dies in the immediate full-page navigation before it can render.
      window.location.href = '/newsboard?just_submitted=1';
    } catch (e) {
      showToast((e as Error).message || $t['news.submit.error'], { type: 'error' });
      submitting = false;
    }
  }
</script>

<div class="px-4 md:px-9" style="padding-top:30px; padding-bottom:50px;">
  <div>
    <div class="font-dmmono uppercase" style="font-size:11px; color:var(--k-ink); letter-spacing:0.16em; margin-bottom:6px;">{$t['news.submit.kicker']}</div>
    <h1 class="font-bricolage" style="font-size:clamp(30px,5vw,44px); font-weight:800; letter-spacing:-0.03em; line-height:1; margin:0 0 10px;">{@html $t['news.submit.heading']}</h1>
    <p class="font-instrument italic" style="font-size:16px; color:var(--k-ink-soft); margin:0 0 18px; max-width:55ch;">{$t['news.submit.intro']}</p>

    <div style="margin-bottom:18px; max-width:420px;"><QuotaIndicator {used} /></div>

    {#if quotaReached}
      <div style="padding:16px; background:var(--k-paper-soft); border:1.5px solid var(--k-warn); border-radius:var(--k-radius-md); max-width:560px;">
        <div class="font-dmmono" style="font-size:10px; color:var(--k-warn); letter-spacing:0.12em; margin-bottom:6px;">⊘ {$t['news.submit.quotaReached']}</div>
        <div class="font-bricolage" style="font-size:14px; font-weight:700; margin-bottom:6px;">{$t['news.submit.quotaReachedTitle']}</div>
        <div class="font-instrument italic" style="font-size:12px; color:var(--k-ink-soft); line-height:1.45;">{$t['news.submit.quotaReachedBody']}</div>
        <div style="margin-top:12px;"><KioskBtn variant="ghost" href="/newsboard">{$t['news.submit.cancel']}</KioskBtn></div>
      </div>
    {:else}
      <div class="flex flex-col" style="gap:18px; max-width:640px;">
        <!-- The link comes FIRST since 2026-09-21: pasting it fills the fields below. -->
        <label class="flex flex-col" style="gap:6px;">
          <span class="font-dmmono uppercase" style="font-size:10px; letter-spacing:0.12em; font-weight:700;">{$t['news.submit.field.url']}</span>
          <input
            bind:value={sourceUrl}
            data-news-url
            onpaste={() => setTimeout(fillFromUrl, 0)}
            onchange={fillFromUrl}
            placeholder="https://" type="url" class="font-dmmono" style="padding:8px 10px; background:var(--k-paper-soft); border:1px solid var(--k-rule); border-radius:var(--k-radius-md);" />
          <span data-news-url-status aria-live="polite" class="font-instrument italic" style={`font-size:12px; line-height:1.4; color:${previewState === 'failed' ? 'var(--k-warn)' : 'var(--k-ink-mute)'};`}>
            {previewState === 'loading' ? $t['news.submit.url.loading'] : previewState === 'filled' ? $t['news.submit.url.filled'] : previewState === 'failed' ? $t['news.submit.url.failed'] : $t['news.submit.url.hint']}
          </span>
        </label>
        <label class="flex flex-col" style="gap:6px;">
          <span class="font-dmmono uppercase" style="font-size:10px; letter-spacing:0.12em; font-weight:700;">{$t['news.submit.field.title']}</span>
          <input bind:value={title} placeholder={$t['news.submit.ph.title']} maxlength="200" class="font-bricolage" style="padding:8px 10px; background:var(--k-paper-soft); border:1px solid var(--k-rule); border-radius:var(--k-radius-md);" />
        </label>
        <label class="flex flex-col" style="gap:6px;">
          <span class="font-dmmono uppercase" style="font-size:10px; letter-spacing:0.12em; font-weight:700;">{$t['news.submit.field.desc']}</span>
          <textarea bind:value={description} rows="4" placeholder={$t['news.submit.ph.desc']} maxlength="1000" class="font-bricolage" style="padding:10px; background:var(--k-paper-soft); border:1px solid var(--k-rule); border-radius:var(--k-radius-md);"></textarea>
        </label>
        <div class="flex flex-col" style="gap:6px;">
          <span class="font-dmmono uppercase" style="font-size:10px; letter-spacing:0.12em; font-weight:700;">{$t['news.submit.section']}</span>
          <SektionPicker value={sektion} onSelect={(s) => (sektion = s)} />
        </div>
        <label class="flex flex-col" style="gap:6px;">
          <span class="font-dmmono uppercase" style="font-size:10px; letter-spacing:0.12em; font-weight:700;">{$t['news.submit.field.source']}</span>
          <input bind:value={sourceName} placeholder={$t['news.submit.ph.source']} maxlength="100" class="font-bricolage" style="padding:8px 10px; background:var(--k-paper-soft); border:1px solid var(--k-rule); border-radius:var(--k-radius-md);" />
        </label>
        <div class="flex flex-col" style="gap:6px;">
          <span class="font-dmmono uppercase" style="font-size:10px; letter-spacing:0.12em; font-weight:700;">{$t['news.submit.image']}</span>
          {#if imageUrl}
            <div class="flex items-center" style="gap:12px; padding:10px; background:var(--k-paper-warm); border:1px solid var(--k-ink); border-radius:var(--k-radius-md);">
              <img src={imageUrl} alt="" style="width:80px; height:60px; object-fit:cover; border:1px solid var(--k-ink); border-radius:4px;" />
              <button type="button" onclick={() => (imageUrl = '')} class="font-dmmono" style="font-size:11px; color:var(--k-ink-soft); text-decoration:underline;">{$t['news.submit.imageRemove']}</button>
            </div>
          {:else}
            <label class="font-dmmono" style="display:block; text-align:center; padding:18px 12px; background:var(--k-paper-soft); border:1.5px dashed var(--k-rule); border-radius:var(--k-radius-md); font-size:11px; color:var(--k-ink-mute); cursor:pointer;">
              {uploading ? $t['news.submit.imageUploading'] : $t['news.submit.imageDrop']}
              <input type="file" accept="image/*" onchange={onImagePick} style="display:none;" />
            </label>
          {/if}
        </div>

        <div class="flex items-center" style="gap:8px; margin-top:6px;">
          <KioskBtn onclick={submit} disabled={!valid || submitting || uploading}>{submitting ? $t['news.submit.submitting'] : $t['news.submit.cta']}</KioskBtn>
          <KioskBtn variant="ghost" href="/newsboard">{$t['news.submit.cancel']}</KioskBtn>
        </div>

        <div class="font-dmmono" style="margin-top:6px; padding:10px 12px; background:var(--k-paper-soft); border:1px dashed var(--k-rule); border-radius:var(--k-radius-sm); font-size:9.5px; color:var(--k-ink-mute); line-height:1.55;">↳ {$t['news.submit.modnote']}</div>
      </div>
    {/if}
  </div>
</div>
