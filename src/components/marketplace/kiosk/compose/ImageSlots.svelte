<script lang="ts">
  // 5-slot image grid with drag-to-reorder and eager Cloudinary upload.
  // Upload happens on file pick (not on form submit).
  // Slot 0 is the "HAUPT" (main) image — shown first in listing views.
  import { t } from '../../../../lib/kiosk-i18n';
  import { showError } from '../../../../utils/toast';

  let {
    images,
    catColor = 'var(--k-wine)',
    onChange
  }: {
    images: string[];
    catColor?: string;
    onChange: (urls: string[]) => void;
  } = $props();

  const MAX_SLOTS = 5;

  // Upload state — tracks which slots are uploading
  let uploading = $state<Set<number>>(new Set());

  // Hidden file input ref
  let fileInput: HTMLInputElement | null = $state(null);
  // Which empty slot was clicked — so we know where to push the result
  let pendingSlotClick: number | null = $state(null);

  // Drag state
  let dragSrcIdx: number | null = $state(null);

  function openPicker(slotIdx: number) {
    if (images.length >= MAX_SLOTS) return;
    pendingSlotClick = slotIdx;
    fileInput?.click();
  }

  async function onFilePick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    input.value = '';

    const slotIdx = images.length; // append to end

    // Mark as uploading
    uploading = new Set([...uploading, slotIdx]);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/posts/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? 'Upload fehlgeschlagen');
      }

      const { url } = await res.json() as { url: string; publicId: string };
      onChange([...images, url]);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      uploading = new Set([...uploading].filter((i) => i !== slotIdx));
      pendingSlotClick = null;
    }
  }

  function removeImage(idx: number) {
    const next = images.filter((_, i) => i !== idx);
    onChange(next);
  }

  // ─── Drag & drop reorder ─────────────────────────────────────────
  function onDragStart(e: DragEvent, idx: number) {
    dragSrcIdx = idx;
    e.dataTransfer?.setData('text/plain', String(idx));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function onDrop(e: DragEvent, targetIdx: number) {
    e.preventDefault();
    const srcStr = e.dataTransfer?.getData('text/plain');
    const src = srcStr !== undefined ? parseInt(srcStr, 10) : null;
    if (src === null || isNaN(src) || src === targetIdx) return;

    const next = [...images];
    const [moved] = next.splice(src, 1);
    next.splice(targetIdx, 0, moved);
    onChange(next);
    dragSrcIdx = null;
  }

  function onDragEnd() {
    dragSrcIdx = null;
  }

  const filledCount = $derived(images.length);
</script>

<!-- Hidden file input -->
<input
  bind:this={fileInput}
  type="file"
  accept="image/jpeg,image/png,image/webp"
  style="display: none;"
  onchange={onFilePick}
/>

<div>
  <!-- 5-slot grid -->
  <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;">
    {#each Array.from({ length: MAX_SLOTS }) as _, i (i)}
      {@const hasImage = i < images.length}
      {@const isUploading = uploading.has(i)}

      {#if hasImage}
        <!-- Filled slot. The stripe tint uses color-mix, NOT catColor + '33': catColor
             is always a CSS variable (var(--cat-…)), and a variable with two hex digits
             glued on is invalid CSS — the browser then drops the WHOLE background
             declaration, photo included. The preview never showed until 2026-09-21.
             (Keep comments OUT of the style attribute: a double quote in there breaks it.) -->
        <div
          draggable={true}
          ondragstart={(e: DragEvent) => onDragStart(e, i)}
          ondragover={onDragOver}
          ondrop={(e: DragEvent) => onDrop(e, i)}
          ondragend={onDragEnd}
          style="
            aspect-ratio: 1/1;
            border: 1.5px solid var(--k-ink);
            border-radius: var(--k-radius-sm);
            background:
              repeating-linear-gradient(
                45deg,
                color-mix(in srgb, {catColor} 20%, transparent) 0 8px,
                var(--k-paper-warm) 8px 16px
              ),
              url('{images[i]}') center/cover;
            background-blend-mode: multiply, normal;
            position: relative;
            cursor: grab;
            overflow: hidden;
          "
        >
          <!-- HAUPT / slot number badge -->
          <span
            style="
              position: absolute; top: 4px; left: 4px;
              font-family: var(--k-font-mono);
              font-size: 9px; font-weight: 700;
              background: var(--k-ink); color: var(--k-paper);
              padding: 1px 5px; border-radius: 3px;
            "
          >{i === 0 ? $t['market.compose.imageSlots.main'] : String(i + 1)}</span>

          <!-- Remove button -->
          <button
            type="button"
            onclick={() => removeImage(i)}
            aria-label="Bild entfernen"
            style="
              position: absolute; top: 4px; right: 4px;
              width: 18px; height: 18px;
              font-size: 10px;
              background: var(--k-paper);
              border: 1px solid var(--k-rule);
              border-radius: 3px;
              display: flex; align-items: center; justify-content: center;
              cursor: pointer; padding: 0;
              line-height: 1;
            "
          >✕</button>
        </div>
      {:else}
        <!-- Empty slot -->
        <div
          ondragover={onDragOver}
          ondrop={(e: DragEvent) => onDrop(e, i)}
          role="button"
          tabindex={i === filledCount ? 0 : -1}
          aria-label="Bild hinzufügen"
          onclick={() => i === filledCount && openPicker(i)}
          onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(i); } }}
          style="
            aspect-ratio: 1/1;
            border: 1.5px dashed var(--k-rule);
            border-radius: var(--k-radius-sm);
            background: var(--k-paper-soft);
            display: flex; align-items: center; justify-content: center;
            cursor: {i === filledCount ? 'pointer' : 'default'};
            font-family: var(--k-font-mono);
            font-size: 11px;
            color: var(--k-ink-mute);
            position: relative;
          "
        >
          {#if isUploading}
            <span style="font-size: 11px; font-family: var(--k-font-mono); color: var(--k-ink-mute);">◐</span>
          {:else}
            <span style="font-size: 22px;">＋</span>
          {/if}
        </div>
      {/if}
    {/each}
  </div>

  <!-- Counter + hint row -->
  <div
    style="
      display: flex;
      justify-content: space-between;
      margin-top: 6px;
      font-family: var(--k-font-mono);
      font-size: 10px;
      color: var(--k-ink-mute);
      letter-spacing: 0.05em;
    "
  >
    <span>{$t['market.compose.imageSlots.placeholder'].replace('{filled}', String(filledCount))}</span>
    <span>{$t['market.compose.imageSlots.reorder']}</span>
  </div>
</div>
