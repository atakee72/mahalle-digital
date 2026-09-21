<script lang="ts">
  // Compose-page logic island. Wraps ComposeForm + ComposePreview in
  // the desktop split layout (form on the left, sticky preview sidebar
  // on the right) and orchestrates the submit flow:
  //
  //   1. validate (title 5–80, body 10–2000, ≤5 images)
  //   2. upload pending images sequentially via POST /api/posts/upload
  //   3. call createTopic mutation (POST /api/topics/create) — modal opens
  //   4. on resolve → clear draft, dismiss modal, navigate to /?just_posted=1
  //   5. on RateLimitError → swap form for RateLimitPanel
  //   6. on other errors → surface inline below the publish button
  //
  // Localstorage draft auto-saves on every form change with a 500 ms
  // debounce. Restored from `topicDraft` on first paint when present.
  //
  // The `?just_posted=1` query param is read by ForumIndexInner to
  // trigger the live-mode footer + slide-in for the new card on the
  // home page (handles the cross-page navigation case the
  // forumMutations.ts in-memory `lastSubmittedAt` writable can't span).
  //
  // `?prefill_tags` (comma-separated) seeds the tag field — consumed by
  // the blog „Die Beilage" Aufruf CTA (opens compose pre-tagged #blogidee).

  import ComposeForm, { type ComposeValues } from './ComposeForm.svelte';
  import ComposePreview from './ComposePreview.svelte';
  import ComposeMiniPreview from './ComposeMiniPreview.svelte';
  import ComposeStickyPublish from './ComposeStickyPublish.svelte';
  import ModeratingModal from './ModeratingModal.svelte';
  import KioskBtn from '../KioskBtn.svelte';
  import RateLimitPanel from '../states/RateLimitPanel.svelte';
  import {
    topicDraft,
    type DraftValues
  } from '../../../../lib/composeDraftStore';
  import {
    createTopicMutation,
    RateLimitError
  } from '../../../../lib/forumMutations';
  import { t } from '../../../../lib/kiosk-i18n';
  import { draftIsEmpty, type PostDraftDTO } from '../../../../lib/forum/postDrafts';

  let { currentUser, initialDraft = null } = $props<{
    currentUser: { id: string; name?: string; image?: string | null };
    initialDraft?: PostDraftDTO | null;
  }>();

  // A server-side draft is open (resumed via ?draft=<id>). Drafts live on the
  // server since 2026-09-21: several per member, on every device, listed under
  // the forum's "Meine" filter. The local slot below stays as a crash safety net.
  // svelte-ignore state_referenced_locally
  let draftId = $state<string | null>(initialDraft?.id ?? null);

  // ─── Form state ─────────────────────────────────────────────────────
  // The form bubbles values up via onChange. We mirror them here so the
  // preview sidebar can observe and the submit handler can read.
  let values = $state<ComposeValues>({
    title: '',
    body: '',
    kind: 'discussion',
    tags: [],
    pendingFiles: [],
    existingImages: []
  });

  // Compute initial form values SYNCHRONOUSLY, before <ComposeForm> initializes.
  // ComposeForm snapshots `initialValues` into local $state at init, so setting
  // this in onMount (which fires AFTER the child mounts) was too late — the fields
  // never populated. This island is client:only, so `window` is available at
  // script-init time. Precedence: ?prefill_title / ?prefill_body (the newsboard
  // "im Forum diskutieren" CTA) over a saved draft.
  function computeInitialValues(): Partial<ComposeValues> | undefined {
    let result: Partial<ComposeValues> | undefined;

    // A resumed server draft wins over everything — prefill params and the
    // local slot belong to a different piece of writing.
    if (initialDraft) {
      return {
        title: initialDraft.title,
        body: initialDraft.body,
        kind: initialDraft.kind,
        tags: initialDraft.tags,
        pendingFiles: [],
        existingImages: initialDraft.images
      };
    }

    let saved: DraftValues | null = null;
    topicDraft.subscribe((v) => (saved = v))();
    if (saved) {
      const s = saved as DraftValues;
      result = {
        title: s.title,
        body: s.body,
        kind: s.kind,
        tags: s.tags,
        pendingFiles: [],
        existingImages: []
      };
    }

    if (typeof window !== 'undefined') {
      try {
        const sp = new URLSearchParams(window.location.search);
        const pt = sp.get('prefill_title');
        const pb = sp.get('prefill_body');
        const ptags = sp.get('prefill_tags');
        // Mirrors ComposeForm's own addTag() rules exactly (lowercase, strip
        // leading '#', 3-tag cap) plus a safe charset/length whitelist so a
        // prefilled tag can never be a value the form itself would reject.
        const tags = ptags
          ? ptags.split(',').map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter((t) => /^[a-zäöüß0-9-]{2,24}$/.test(t)).slice(0, 3)
          : null;
        if (pt || pb || tags?.length) {
          result = {
            title: pt ?? result?.title ?? '',
            body: pb ?? result?.body ?? '',
            kind: result?.kind ?? 'discussion',
            tags: tags ?? result?.tags ?? [],
            pendingFiles: [],
            existingImages: []
          };
        }
      } catch { /* bad params — ignore */ }
    }
    return result;
  }

  const initialValues: Partial<ComposeValues> | undefined = computeInitialValues();

  // Debounced auto-save. Writes title/body/kind/tags only — pending
  // files are local object URLs that don't survive a reload anyway.
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    // Server draft open — the single local slot stays someone else's
    // (marketplace precedent: a resumed draft must not pollute it).
    if (draftId) return;
    const snapshot: DraftValues = {
      title: values.title,
      body: values.body,
      kind: values.kind,
      tags: values.tags
    };
    // No-op when everything's empty so we don't write a blank draft on
    // first paint of an unauthored form.
    if (!snapshot.title && !snapshot.body && !snapshot.tags.length) return;

    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => topicDraft.setDraft(snapshot), 500);
    return () => {
      if (draftTimer) clearTimeout(draftTimer);
    };
  });

  function handleChange(next: ComposeValues) {
    values = next;
  }

  // ─── Mutation ───────────────────────────────────────────────────────
  // svelte-ignore state_referenced_locally
  const create = createTopicMutation({
    id: currentUser.id,
    name: currentUser.name,
    image: currentUser.image
  });

  let submitting = $state(false);
  let modalOpen = $state(false);
  let rateLimited = $state(false);
  let inlineError = $state<string | null>(null);

  // Image upload (lazy — fires only on submit).
  async function uploadPendingFiles(files: File[]) {
    const uploaded: { url: string; publicId: string }[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/posts/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Image upload failed');
      }
      const json = (await res.json()) as { url: string; publicId: string };
      uploaded.push({ url: json.url, publicId: json.publicId });
    }
    return uploaded;
  }

  function validate(v: ComposeValues): string | null {
    if (v.title.trim().length < 5) return 'Titel zu kurz (mind. 5 Zeichen).';
    if (v.title.length > 80) return 'Titel zu lang (max. 80 Zeichen).';
    if (v.body.trim().length < 10) return 'Text zu kurz (mind. 10 Zeichen).';
    if (v.body.length > 2000) return 'Text zu lang (max. 2000 Zeichen).';
    if (v.tags.length > 3) return 'Zu viele Tags (max. 3).';
    if (v.existingImages.length + v.pendingFiles.length > 5)
      return 'Zu viele Bilder (max. 5).';
    return null;
  }

  async function onPublish() {
    if (submitting) return;
    inlineError = null;

    const err = validate(values);
    if (err) {
      inlineError = err;
      return;
    }

    submitting = true;
    modalOpen = true;
    try {
      const uploadedNew =
        values.pendingFiles.length > 0
          ? await uploadPendingFiles(values.pendingFiles)
          : [];
      const allImages = [...values.existingImages, ...uploadedNew];

      await create.mutateAsync({
        title: values.title.trim(),
        body: values.body.trim(),
        tags: values.tags,
        images: allImages,
        kind: values.kind
      });

      topicDraft.clearDraft();
      if (draftId) {
        // Best effort: the post exists; a leftover draft is only clutter. The
        // server keeps the images because the new post references them.
        await fetch(`/api/posts/drafts/${draftId}`, { method: 'DELETE', credentials: 'include', keepalive: true }).catch(() => {});
      }
      modalOpen = false;
      // Navigate to the forum index with a marker so ForumIndexInner can
      // show a success toast on arrival (the compose page unmounts before its
      // own toast could render). Target /forum, NOT / — the landing gate
      // redirects logged-in members off / to /forum and drops the query.
      if (typeof window !== 'undefined') {
        window.location.href = '/forum?just_posted=1';
      }
    } catch (caught) {
      modalOpen = false;
      submitting = false;
      if (caught instanceof RateLimitError) {
        rateLimited = true;
      } else {
        inlineError =
          caught instanceof Error ? caught.message : 'Veröffentlichen fehlgeschlagen.';
      }
    }
  }

  let savingDraft = $state(false);

  // Saves to the SERVER (uploads pending images first), then shows the draft
  // in its list. Until 2026-09-21 this wrote one local-storage slot and went
  // to /forum without a word — the user could not find his own draft.
  async function onSaveDraft() {
    if (savingDraft || submitting) return;
    inlineError = null;
    const candidate = { kind: values.kind, title: values.title, body: values.body, tags: values.tags, images: values.existingImages };
    if (draftIsEmpty(candidate) && values.pendingFiles.length === 0) {
      inlineError = $t['drafts.error.empty'] as string;
      return;
    }
    if (values.existingImages.length + values.pendingFiles.length > 5) {
      inlineError = 'Zu viele Bilder (max. 5).';
      return;
    }
    savingDraft = true;
    try {
      const uploaded = values.pendingFiles.length ? await uploadPendingFiles(values.pendingFiles) : [];
      const res = await fetch('/api/posts/drafts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(draftId ? { id: draftId } : {}), ...candidate, images: [...values.existingImages, ...uploaded] })
      });
      if (res.status === 409) throw new Error($t['drafts.error.limit'] as string);
      if (!res.ok) throw new Error($t['drafts.error.save'] as string);
      draftId = (await res.json()).draft.id;
      topicDraft.clearDraft();
      window.location.href = '/forum?kind=mine&draft_saved=1';
    } catch (caught) {
      savingDraft = false;
      inlineError = caught instanceof Error ? caught.message : ($t['drafts.error.save'] as string);
    }
  }

  // With a server draft open, "verwerfen" leaves WITHOUT saving changes and keeps
  // the draft — deleting happens in the list, behind a confirm.
  function onDiscard() {
    if (!draftId) topicDraft.clearDraft();
    if (typeof window !== 'undefined') window.location.href = draftId ? '/forum?kind=mine' : '/forum';
  }
</script>

{#if rateLimited}
  <RateLimitPanel unlocksIn={null} />
{:else}
  <div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-0 min-h-[calc(100vh-180px)]">
    <ComposeForm
      initialValues={initialValues}
      onChange={handleChange}
      showBreadcrumb={true}
    />
    <ComposePreview
      values={values}
      currentUser={{ name: currentUser.name, image: currentUser.image }}
      submitting={submitting || savingDraft}
      onPublish={onPublish}
      onSaveDraft={onSaveDraft}
      onDiscard={onDiscard}
    />
  </div>

  {#if inlineError}
    <div class="px-6 md:px-9 pb-6">
      <p
        class="font-bricolage text-sm text-danger px-3.5 py-2 bg-danger/10 border border-danger rounded-md"
        role="alert"
      >
        {inlineError}
      </p>
    </div>
  {/if}

  <!-- Mobile-only flow: mirrors the desktop sidebar order (preview →
       moderation → submit row) but split between inline (Save Draft +
       Discard) and the sticky bar (Publish). -->
  <div class="lg:hidden px-6 pt-4">
    <ComposeMiniPreview
      values={values}
      currentUser={{ name: currentUser.name, image: currentUser.image }}
    />
  </div>

  <div class="lg:hidden px-6">
    <div class="bg-paper border border-dashed border-rule rounded-sm px-3.5 py-3">
      <p class="font-dmmono text-[10px] uppercase tracking-[0.12em] text-teal mb-1.5">
        ◆ {$t['compose.moderation.kicker']}
      </p>
      <p class="font-dmmono text-[10.5px] leading-[1.65] text-ink-soft">
        {$t['compose.moderation.body']}
      </p>
    </div>
  </div>

  <div class="lg:hidden px-6 pt-4 flex flex-col gap-2.5">
    <KioskBtn
      variant="secondary"
      size="lg"
      onclick={onSaveDraft}
      disabled={submitting || savingDraft}
      class="w-full"
    >
      {$t['compose.cta.draft']}
    </KioskBtn>
    <KioskBtn
      variant="ghost"
      size="lg"
      onclick={onDiscard}
      disabled={submitting}
      class="w-full"
    >
      {$t['compose.cta.discard']}
    </KioskBtn>
  </div>

  <!-- Small bottom spacer. KioskFooter's mt-16 + its own height already
       provide most of the sticky-bar clearance; this just adds a tiny
       breathing margin so the inline buttons don't kiss the bar. -->
  <div class="lg:hidden h-8" aria-hidden="true"></div>

  <ComposeStickyPublish onPublish={onPublish} submitting={submitting} />

  <ModeratingModal open={modalOpen} onDismiss={() => (modalOpen = false)} />
{/if}
