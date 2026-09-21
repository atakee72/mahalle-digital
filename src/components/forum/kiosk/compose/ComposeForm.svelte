<script lang="ts">
  // Compose form — used by /topics/create AND inline edit on the post
  // detail page. Per kiosk-forum-compose.jsx ForumComposeDesktop (line 350).
  //
  // Sections (top → bottom):
  //   1. Kicker — "◆ WORÜBER REDEN WIR HEUTE?" mono wine
  //   2. Title input — transparent, ink bottom rule, 36 px display, char counter
  //   3. Type selector — 3 cards (Diskussion / Empfehlung / Ankündigung); the
  //      selected card is filled with its kind colour
  //   4. Body editor — paper-soft bg, 1.5 px ink border, 130 px min-height,
  //      char counter
  //   5. Image upload — 84 px tiles per uploaded image, dashed +Hochladen slot
  //   6. Tags — FilterChip-style pills with hashtags + suggested row
  //
  // The form does NOT submit on its own. It calls `onChange(values)` when any
  // field changes; the parent (topics/create.astro page or ForumPostDetail
  // edit mode) drives the actual submit + draft persistence + image upload.
  //
  // Image upload is eager-preview, lazy-upload: when the user picks files
  // we render object-URL previews so they can review/remove. The actual
  // POST /api/posts/upload happens on submit, in the parent.

  import { t } from '../../../../lib/kiosk-i18n';
  import MentionPopup from './MentionPopup.svelte';

  type Kind = 'discussion' | 'recommendation' | 'announcement';

  export type ComposeValues = {
    title: string;
    body: string;
    kind: Kind;
    tags: string[];
    // Pending images — mix of uploaded ({url, publicId}) and to-upload (File).
    pendingFiles: File[];
    existingImages: { url: string; publicId: string }[];
  };

  let {
    initialValues,
    suggestedTags = [],
    showBreadcrumb = false,
    onChange
  } = $props<{
    initialValues?: Partial<ComposeValues>;
    suggestedTags?: string[];
    showBreadcrumb?: boolean;
    onChange: (values: ComposeValues) => void;
  }>();

  // Core form state. `$state` runes scope to this component instance —
  // the auto-save store on the consumer side decides what to persist.
  // svelte-ignore state_referenced_locally
  let title = $state(initialValues?.title ?? '');
  // svelte-ignore state_referenced_locally
  let body = $state(initialValues?.body ?? '');
  // svelte-ignore state_referenced_locally
  let kind = $state<Kind>(initialValues?.kind ?? 'discussion');
  // svelte-ignore state_referenced_locally
  let tags = $state<string[]>(initialValues?.tags ?? []);
  // svelte-ignore state_referenced_locally
  let existingImages = $state(initialValues?.existingImages ?? []);
  let pendingFiles = $state<File[]>([]);
  let tagInput = $state('');

  // Image previews — object URLs from pendingFiles, revoked on unmount.
  let previews = $state<string[]>([]);
  $effect(() => {
    const urls = pendingFiles.map((f) => URL.createObjectURL(f));
    previews = urls;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  });

  // Bubble values up whenever anything changes. The parent owns
  // debounced draft-saving so we don't double-write on every keystroke.
  $effect(() => {
    onChange({ title, body, kind, tags, pendingFiles, existingImages });
  });

  // ─── Title ──────────────────────────────────────────────────────────
  const TITLE_MAX = 80;
  const titleCount = $derived(`${title.length} / ${TITLE_MAX}`);

  // ─── Body ───────────────────────────────────────────────────────────
  // „@" autocomplete (2026-09-21) — the popup listens on this element.
  let bodyEl = $state<HTMLTextAreaElement | null>(null);

  const BODY_MAX = 2000;
  const bodyCount = $derived(`${body.length} / ${BODY_MAX}`);

  // ─── Type selector ──────────────────────────────────────────────────
  const types: { k: Kind; labelKey: string; hintKey: string; colorVar: string }[] = [
    { k: 'discussion',     labelKey: 'compose.type.discussion',     hintKey: 'compose.type.discussion.hint',     colorVar: '--k-wine' },
    { k: 'recommendation', labelKey: 'compose.type.recommendation', hintKey: 'compose.type.recommendation.hint', colorVar: '--k-moss' },
    { k: 'announcement',   labelKey: 'compose.type.announcement',   hintKey: 'compose.type.announcement.hint',   colorVar: '--k-teal' }
  ];

  // ─── Image upload ───────────────────────────────────────────────────
  const MAX_IMAGES = 5;
  const totalImages = $derived(existingImages.length + pendingFiles.length);
  let fileInputEl: HTMLInputElement | null = $state(null);

  function onFilePick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files) return;
    const remaining = MAX_IMAGES - totalImages;
    const accepted = Array.from(input.files).slice(0, remaining);
    pendingFiles = [...pendingFiles, ...accepted];
    input.value = ''; // allow re-picking the same file later
  }

  function removeExisting(i: number) {
    existingImages = existingImages.filter((_: any, idx: number) => idx !== i);
  }
  function removePending(i: number) {
    pendingFiles = pendingFiles.filter((_, idx) => idx !== i);
  }

  // ─── Tags ───────────────────────────────────────────────────────────
  function addTag(raw: string) {
    const clean = raw.trim().replace(/^#/, '').toLowerCase();
    if (!clean) return;
    if (tags.includes(clean)) return;
    if (tags.length >= 3) return;
    tags = [...tags, clean];
    tagInput = '';
  }

  function removeTag(tag: string) {
    tags = tags.filter((t) => t !== tag);
  }

  function onTagInputKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === 'Backspace' && !tagInput && tags.length) {
      tags = tags.slice(0, -1);
    }
  }
</script>

<form
  class="px-6 md:px-9 py-6 md:py-7 bg-paper"
  onsubmit={(e) => e.preventDefault()}
>
  {#if showBreadcrumb}
    <div
      class="flex items-center mb-5 pb-2.5 border-b border-dashed border-rule font-dmmono text-[10.5px] uppercase tracking-[0.05em] text-ink-mute"
    >
      <a href="/forum" class="inline-flex items-center gap-2 hover:text-ink transition-colors">
        <span aria-hidden="true">←</span>
        <span>{$t['compose.crumb.forum']}</span>
      </a>
      <span aria-hidden="true" class="mx-2">·</span>
      <span class="underline decoration-dashed underline-offset-[3px]">{$t['compose.crumb.new']}</span>
    </div>
  {/if}

  <!-- ── Kicker ────────────────────────────────────────────────────── -->
  <p class="font-dmmono text-[10px] uppercase tracking-[0.12em] text-wine mb-1.5">
    ◆ {$t['compose.kicker']}
  </p>

  <!-- ── Title input (required) ────────────────────────────────────── -->
  <div class="relative mb-4 pb-1.5 border-b-[1.5px] border-ink">
    <input
      type="text"
      maxlength={TITLE_MAX}
      bind:value={title}
      placeholder={$t['compose.title.placeholder']}
      aria-required="true"
      class="w-full bg-transparent border-0 outline-none font-bricolage font-extrabold tracking-tight text-2xl md:text-[36px] leading-[1.1] text-ink placeholder:text-ink-mute/45 pr-20"
    />
    <span class="absolute right-0 bottom-2 font-dmmono text-[10px] text-ink-mute">
      <span class="font-bold text-wine mr-1" aria-hidden="true">*</span>{titleCount}
    </span>
  </div>

  <!-- ── Type selector ─────────────────────────────────────────────── -->
  <div class="mb-5">
    <p class="font-dmmono text-[10px] uppercase tracking-[0.1em] text-ink-mute mb-1.5">
      {$t['compose.type.label']}
    </p>
    <div class="flex flex-col sm:flex-row gap-2">
      {#each types as opt (opt.k)}
        {@const active = kind === opt.k}
        <button
          type="button"
          onclick={() => (kind = opt.k)}
          class={`flex-1 text-left px-3 py-3.5 sm:py-2.5 rounded-md border-[1.5px] transition-colors duration-[180ms] ease-out ${
            active
              ? 'text-paper border-transparent'
              : 'bg-paper-warm text-ink border-ink hover:bg-paper-soft'
          }`}
          style={active ? `background:var(${opt.colorVar});border-color:var(${opt.colorVar});` : ''}
        >
          <div class="font-bricolage font-bold text-[13px] tracking-tight">
            {$t[opt.labelKey]}
          </div>
          <div
            class={`font-dmmono text-[9.5px] tracking-[0.04em] mt-0.5 ${
              active ? 'text-paper/75' : 'text-ink-mute'
            }`}
          >
            {$t[opt.hintKey]}
          </div>
        </button>
      {/each}
    </div>
  </div>

  <!-- ── Body editor ───────────────────────────────────────────────── -->
  <div class="mb-5">
    <div
      class="flex justify-between items-center font-dmmono text-[10px] uppercase tracking-[0.1em] text-ink-mute mb-1.5"
    >
      <span>
        {$t['compose.body.label']}
        <span class="text-wine font-bold ml-0.5" aria-hidden="true">*</span>
      </span>
      <span class="flex gap-2.5 normal-case tracking-normal">
        <b>B</b>
        <span class="italic">i</span>
        <span class="underline">U</span>
        <span>“ ”</span>
        <span>{'· { } ·'}</span>
      </span>
    </div>
    <div class="relative">
    <textarea
      maxlength={BODY_MAX}
      bind:value={body}
      bind:this={bodyEl}
      placeholder={$t['compose.body.placeholder']}
      aria-required="true"
      rows="6"
      class="w-full bg-paper-soft border-[1.5px] border-ink rounded-md px-4 py-3.5 font-bricolage text-[14px] leading-relaxed text-ink placeholder:text-ink-mute/55 outline-none focus:border-wine resize-y min-h-[130px]"
    ></textarea>
    <MentionPopup textarea={bodyEl} onPick={(v) => (body = v)} />
    </div>
    <div
      class="flex justify-between font-dmmono text-[10px] text-ink-mute mt-1.5"
    >
      <span>{$t['compose.body.tip']}</span>
      <span>{bodyCount}</span>
    </div>
  </div>

  <!-- ── Image upload ──────────────────────────────────────────────── -->
  <div class="mb-5">
    <p class="font-dmmono text-[10px] uppercase tracking-[0.1em] text-ink-mute mb-1.5">
      {$t['compose.images.label']} · {totalImages} / {MAX_IMAGES}
    </p>
    <div class="flex flex-wrap gap-2">
      {#each existingImages as img, i (img.publicId)}
        <div
          class="relative w-[84px] h-[84px] rounded-sm border-[1.5px] border-ink overflow-hidden bg-paper-warm"
        >
          <img src={img.url} alt="" class="w-full h-full object-cover" />
          <button
            type="button"
            onclick={() => removeExisting(i)}
            aria-label="Bild entfernen"
            class="absolute top-1 right-1 w-6 h-6 sm:w-[18px] sm:h-[18px] rounded-full bg-ink text-paper text-[11px] leading-none flex items-center justify-center"
          >×</button>
          <span
            class="absolute bottom-1 left-1 font-dmmono text-[8px] text-ink bg-paper px-1 rounded-sm"
          >
            {String(i + 1).padStart(2, '0')}
          </span>
        </div>
      {/each}
      {#each previews as src, i (src)}
        <div
          class="relative w-[84px] h-[84px] rounded-sm border-[1.5px] border-ink overflow-hidden bg-paper-warm"
        >
          <img src={src} alt="" class="w-full h-full object-cover" />
          <button
            type="button"
            onclick={() => removePending(i)}
            aria-label="Bild entfernen"
            class="absolute top-1 right-1 w-6 h-6 sm:w-[18px] sm:h-[18px] rounded-full bg-ink text-paper text-[11px] leading-none flex items-center justify-center"
          >×</button>
          <span
            class="absolute bottom-1 left-1 font-dmmono text-[8px] text-ink bg-paper px-1 rounded-sm"
          >
            {String(existingImages.length + i + 1).padStart(2, '0')}
          </span>
        </div>
      {/each}

      {#if totalImages < MAX_IMAGES}
        <button
          type="button"
          onclick={() => fileInputEl?.click()}
          class="w-[84px] h-[84px] rounded-sm border-[1.5px] border-dashed border-ink-mute flex flex-col items-center justify-center font-dmmono text-[10px] text-ink-mute hover:border-ink hover:text-ink transition-colors"
        >
          <span class="text-[22px] leading-none mb-0.5">+</span>
          {$t['compose.images.upload']}
        </button>
      {/if}

      <p
        class="w-[180px] font-dmmono text-[9.5px] text-ink-mute leading-relaxed self-center"
      >
        {$t['compose.images.formats']}
      </p>

      <input
        bind:this={fileInputEl}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        class="hidden"
        onchange={onFilePick}
      />
    </div>
  </div>

  <!-- ── Tags ──────────────────────────────────────────────────────── -->
  <div class="mb-5">
    <p class="font-dmmono text-[10px] uppercase tracking-[0.1em] text-ink-mute mb-1.5">
      {$t['compose.tags.label']}
    </p>
    <div class="flex flex-wrap items-center gap-1.5">
      {#each tags as tag (tag)}
        <span
          class="inline-flex items-center gap-1 px-3 py-2 sm:py-[5px] rounded-full bg-ink text-paper font-dmmono text-[12.5px] font-medium"
        >
          #{tag}
          <button
            type="button"
            onclick={() => removeTag(tag)}
            aria-label={`#${tag} entfernen`}
            class="text-paper/70 hover:text-paper text-[12px] leading-none"
          >×</button>
        </span>
      {/each}

      {#if tags.length < 3}
        <input
          type="text"
          bind:value={tagInput}
          onkeydown={onTagInputKey}
          placeholder={$t['compose.tags.add']}
          class="px-3 py-2 sm:py-[5px] rounded-full font-dmmono text-[12.5px] font-medium text-ink-mute border-[1.5px] border-dashed border-ink-mute outline-none bg-transparent placeholder:text-ink-mute focus:border-ink focus:text-ink min-w-[120px]"
        />
      {/if}

      <span
        class="ml-2 font-dmmono text-[10px] text-ink-mute self-center"
      >
        {$t['compose.tags.suggested']}
      </span>
      {#each suggestedTags as tag (tag)}
        {#if !tags.includes(tag)}
          <button
            type="button"
            onclick={() => addTag(tag)}
            class="font-dmmono text-[12px] text-ink-mute hover:text-ink underline-offset-2 hover:underline"
          >
            #{tag}
          </button>
        {/if}
      {/each}
    </div>
  </div>

  <!-- Footnote — explains the wine '*' marker on required fields. -->
  <p class="mt-4 font-dmmono text-[10px] text-ink-mute">
    <span class="text-wine font-bold" aria-hidden="true">*</span> {$t['compose.requiredNote'].replace(/^\*\s*/, '')}
  </p>
</form>
