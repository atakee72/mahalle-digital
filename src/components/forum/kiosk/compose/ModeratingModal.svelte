<script lang="ts">
  // Centered moderating modal that overlays the forum after the user
  // submits a topic. Per JSX ForumModeratingDesktop (line 640).
  //
  // Cosmetic 5-stage pipeline. The API runs all moderation checks in
  // parallel server-side (~15–20 s) and returns a single result; the
  // staged labels here are honest about the categories of work
  // happening, not their server-side ordering. The modal auto-dismisses
  // when the create mutation resolves OR the cosmetic pipeline reaches
  // stage 5 — whichever is later.
  //
  // The component is presentational. The parent owns:
  //   • binding `open` to the mutation state (e.g. `submitting`)
  //   • calling `onDismiss` on resolve so the parent can navigate / show
  //     the optimistic card
  //
  // No keyboard cancel — see plan note "Cancel-mid-screening dropped".

  import { t } from '../../../../lib/kiosk-i18n';

  let {
    open = false,
    embedded = false
  } = $props<{
    open: boolean;
    // Sandbox-only escape hatch: render with `absolute inset-0` instead
    // of `fixed inset-0` so the modal stays inside its parent box on
    // /design-system. Live consumers leave this false (default) so the
    // modal covers the actual viewport.
    embedded?: boolean;
  }>();

  // Stage names + hints come from i18n. The list is fixed; the index of
  // the currently-running stage is what we drive on a setInterval.
  const stages = [
    { id: 'language', labelKey: 'moderating.stage.language', hintKey: 'moderating.stage.language.hint' },
    { id: 'content',  labelKey: 'moderating.stage.content',  hintKey: 'moderating.stage.content.hint'  },
    { id: 'context',  labelKey: 'moderating.stage.context',  hintKey: 'moderating.stage.context.hint'  },
    { id: 'images',   labelKey: 'moderating.stage.images',   hintKey: 'moderating.stage.images.hint'   },
    { id: 'publish',  labelKey: 'moderating.stage.publish',  hintKey: 'moderating.stage.publish.hint'  }
  ];

  // 0 → only language running, 1 → language done + content running, …
  // 5 → all done. Pipeline pacing: each stage takes ~2.8 s; the whole
  // cycle runs ~14 s before parking at "all done" until the parent
  // fires onDismiss.
  let stageIdx = $state(0);
  const STAGE_MS = 2800;

  $effect(() => {
    if (!open) {
      stageIdx = 0;
      return;
    }
    const id = setInterval(() => {
      stageIdx = Math.min(stageIdx + 1, stages.length);
    }, STAGE_MS);
    return () => clearInterval(id);
  });

  // Progress bar fill — fills smoothly over the cosmetic pipeline.
  const progress = $derived(`${Math.min((stageIdx / stages.length) * 100, 100)}%`);
</script>

{#if open}
  <div
    class={`${embedded ? 'absolute' : 'fixed'} inset-0 z-50 flex items-center justify-center px-6 py-10`}
    role="dialog"
    aria-modal="true"
    aria-live="polite"
    style="background: rgba(27,26,23,0.42);"
  >
    <div
      class="w-full max-w-[720px] bg-paper border-2 border-ink rounded-lg px-7 md:px-9 py-7 shadow-[3px_3px_0_var(--k-wine)]"
    >
      <!-- Header -->
      <div class="flex items-center gap-2.5 mb-1">
        <span
          class="block k-pulse-dot"
          style="width: 14px; height: 14px; border-radius: 50%; background: var(--k-ochre); border: 2px solid var(--k-ink);"
          aria-hidden="true"
        ></span>
        <span class="font-dmmono text-[11px] uppercase tracking-[0.14em] text-wine">
          ◆ {$t['moderating.kicker']}
        </span>
      </div>
      <h2
        class="font-bricolage font-extrabold tracking-tight text-[26px] md:text-[30px] leading-[1.05] mt-1 mb-1.5 text-ink"
      >
        {$t['moderating.title.prefix']}
        <span class="font-instrument italic font-normal text-wine">{$t['moderating.title.accent']}</span>
        {$t['moderating.title.suffix']}
      </h2>
      <p class="font-instrument italic text-[15px] text-ink-soft mb-5">
        {$t['moderating.subtitle']}
      </p>

      <!-- Pipeline -->
      <ul class="mb-4 list-none p-0 m-0">
        {#each stages as st, i (st.id)}
          {@const isDone = i < stageIdx}
          {@const isRun = i === stageIdx && stageIdx < stages.length}
          {@const dotChar = isDone ? '✓' : isRun ? '◐' : '·'}
          {@const dotBg = isDone ? 'bg-success' : isRun ? 'bg-ochre' : 'bg-transparent'}
          {@const dotBorder = isDone ? 'border-success' : isRun ? 'border-ochre' : 'border-ink-mute'}
          {@const labelTone = isDone || isRun ? 'text-ink' : 'text-ink-mute'}
          <li
            class={`grid grid-cols-[28px_1fr] gap-2.5 items-center py-2.5 ${
              i < stages.length - 1 ? 'border-b border-dashed border-rule' : ''
            }`}
          >
            <span
              class={`w-6 h-6 rounded-full border-[1.5px] ${dotBg} ${dotBorder} flex items-center justify-center font-dmmono text-[11px] font-bold ${
                isRun ? 'k-spin text-paper' : isDone ? 'text-paper' : 'text-ink-mute'
              }`}
              aria-hidden="true"
            >
              {dotChar}
            </span>
            <div>
              <div class={`font-bricolage font-bold text-[13.5px] ${labelTone}`}>
                {$t[st.labelKey]}
              </div>
              <div class="font-dmmono text-[10.5px] text-ink-mute mt-0.5 tracking-[0.04em]">
                {$t[st.hintKey]}
              </div>
            </div>
          </li>
        {/each}
      </ul>

      <!-- Striped progress bar -->
      <div
        class="bg-paper-soft border border-rule rounded-full h-2 overflow-hidden mb-2"
      >
        <div
          class="h-full rounded-full k-prog-stripe transition-[width] duration-[600ms] ease-out"
          style={`
            width: ${progress};
            background: repeating-linear-gradient(45deg, var(--k-ochre) 0 6px, var(--k-wine) 6px 12px);
            background-size: 24px 24px;
          `}
        ></div>
      </div>
      <div class="flex justify-between font-dmmono text-[10px] text-ink-mute">
        <span>
          {Math.min(stageIdx + (stageIdx < stages.length ? 1 : 0), stages.length)} / {stages.length}
        </span>
        <span>···</span>
      </div>

      <!-- Note -->
      <div
        class="mt-4 bg-paper-warm border border-dashed border-rule rounded-sm px-3 py-2.5 font-instrument italic text-[12px] text-ink-soft leading-[1.5]"
      >
        {$t['moderating.note']}
      </div>
    </div>
  </div>
{/if}
