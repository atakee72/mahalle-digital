<script lang="ts">
  // Live preview sidebar for the compose route. Per JSX
  // ForumComposeDesktop (line 562). Renders a mini ForumPostCard that
  // updates as the user types, plus the moderation note + submit row.
  //
  // The preview card here is hand-rolled (not a reused ForumPostCard)
  // because the composed post doesn't yet have a real `_id` or
  // moderation state, and the scaled-down typography differs from a
  // production card. Rolling a small dedicated preview keeps this file
  // self-contained.
  //
  // The submit row's three CTAs are wired up by the parent — this
  // component is presentational. Disabling the publish button when
  // values are invalid is also the parent's job (it has the form
  // validity context).
  //
  // Props:
  //   values     — current ComposeValues from the form
  //   currentUser — { name, image } for the byline avatar
  //   submitting — disables CTAs while a mutation is in flight
  //   onPublish/onSaveDraft/onDiscard — three CTA click handlers

  import KioskBtn from '../KioskBtn.svelte';
  import ComposeMiniPreview from './ComposeMiniPreview.svelte';
  import { t } from '../../../../lib/kiosk-i18n';

  type Kind = 'discussion' | 'recommendation' | 'announcement';
  type Values = {
    title: string;
    body: string;
    kind: Kind;
    tags: string[];
  };

  let {
    values,
    currentUser,
    submitting = false,
    error = null,
    onPublish,
    onSaveDraft,
    onDiscard
  } = $props<{
    values: Values;
    currentUser: { name?: string; image?: string | null };
    submitting?: boolean;
    /** Error line shown right above the buttons (2026-09-21: it used to sit under the whole form). */
    error?: string | null;
    onPublish: () => void;
    onSaveDraft?: () => void;
    onDiscard: () => void;
  }>();
</script>

<aside
  class="hidden lg:flex bg-paper-soft border-l border-dashed border-rule px-5 py-7 flex-col h-full"
>
  <ComposeMiniPreview values={values} currentUser={currentUser} />

  <!-- Moderation note -->
  <div
    class="bg-paper border border-dashed border-rule rounded-sm px-3.5 py-3 mb-4"
  >
    <p class="font-dmmono text-[10px] uppercase tracking-[0.12em] text-teal mb-1.5">
      ◆ {$t['compose.moderation.kicker']}
    </p>
    <p class="font-dmmono text-[10.5px] leading-[1.65] text-ink-soft">
      {$t['compose.moderation.body']}
    </p>
  </div>

  <!-- Submit row -->
  <div class="mt-auto flex flex-col gap-2.5">
    {#if error}
      <p data-compose-error role="alert" class="font-bricolage text-sm text-danger px-3.5 py-2 bg-danger/10 border border-danger rounded-md">{error}</p>
    {/if}
    <KioskBtn
      variant="primary"
      size="md"
      onclick={onPublish}
      disabled={submitting}
    >
      {$t['compose.cta.publish']}
    </KioskBtn>
    {#if onSaveDraft}
      <KioskBtn variant="secondary" size="md" onclick={onSaveDraft} disabled={submitting}>
        {$t['compose.cta.draft']}
      </KioskBtn>
    {/if}
    <KioskBtn variant="ghost" size="md" onclick={onDiscard} disabled={submitting}>
      {$t['compose.cta.discard']}
    </KioskBtn>
    <p class="font-dmmono text-[9.5px] text-ink-mute leading-relaxed mt-1.5">
      {$t['compose.terms']}
    </p>
  </div>
</aside>
