<script lang="ts">
  // Suggestion list for „@" in a <textarea> (2026-09-21). Attach it right after
  // the textarea inside a `relative` wrapper:
  //   <MentionPopup textarea={el} onPick={(v) => (body = v)} placement="above" />
  //
  // NO <style> block: this component is reachable only through other islands, and
  // the prod build orphans such a stylesheet (root CLAUDE.md) — Tailwind only.
  // The $effect reads ONLY `textarea`; the handlers run at event time, so they add
  // no reactive dependencies (Svelte 5 trap, forum area file).
  import { tick } from 'svelte';
  import KioskAvatar from '../KioskAvatar.svelte';
  import { activeMentionQuery, applyMention } from '../../../../lib/mentions/mentions';

  type Hit = { id: string; name: string; handle: string; image: string | null };

  let { textarea, onPick, placement = 'below' }: {
    textarea: HTMLTextAreaElement | null;
    onPick: (next: string) => void;
    placement?: 'below' | 'above';
  } = $props();

  let items = $state<Hit[]>([]);
  let open = $state(false);
  let active = $state(0);
  let token: { start: number; query: string } | null = null;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;

  function close() { open = false; items = []; seq++; clearTimeout(timer); }
  // Belt and braces for browsers that blur anyway: the click on a row must win.
  function closeSoon() { clearTimeout(blurTimer); blurTimer = setTimeout(close, 200); }

  function refresh() {
    if (!textarea) return;
    token = activeMentionQuery(textarea.value, textarea.selectionStart ?? 0);
    if (!token || token.query.length < 1) { close(); return; }
    const q = token.query;
    const my = ++seq;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/mention-search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
        if (my !== seq) return; // a newer keystroke won
        if (!res.ok) { close(); return; }
        const data = await res.json();
        if (my !== seq) return;
        const hits: Hit[] = Array.isArray(data.users) ? data.users : [];
        // „@alle" Admin-Hinweis (2026-09-22): admins get a synthetic row ahead
        // of the real members. Picking it goes through the same applyMention
        // path, so the text gets „@alle ".
        items = data.broadcast === true
          ? [{ id: 'alle', name: 'alle aktiven Nachbar:innen', handle: 'alle', image: null }, ...hits]
          : hits;
        active = 0;
        open = items.length > 0;
      } catch { close(); }
    }, 180);
  }

  async function pick(hit: Hit) {
    if (!textarea || !token) return;
    const r = applyMention(textarea.value, token.start, textarea.selectionStart ?? 0, hit.handle);
    onPick(r.value);
    clearTimeout(blurTimer);
    close();
    await tick();
    textarea.focus();
    textarea.setSelectionRange(r.caret, r.caret);
  }

  // Registered directly on the textarea, capture phase: Svelte delegates the
  // host's own `onkeydown` to the root, so stopping propagation HERE keeps
  // Enter/Escape away from it (Cmd-Enter submit, the comment edit box's
  // window-level Escape that would cancel the whole edit).
  function onKeydown(e: KeyboardEvent) {
    if (!open || items.length === 0) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    if (e.key === 'ArrowDown') { stop(); active = (active + 1) % items.length; }
    else if (e.key === 'ArrowUp') { stop(); active = (active - 1 + items.length) % items.length; }
    else if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') { stop(); pick(items[active]); }
    else if (e.key === 'Escape') { stop(); close(); }
  }

  $effect(() => {
    const el = textarea;
    if (!el) return;
    el.addEventListener('input', refresh);
    el.addEventListener('click', refresh);
    el.addEventListener('keydown', onKeydown, true);
    el.addEventListener('blur', closeSoon);
    return () => {
      el.removeEventListener('input', refresh);
      el.removeEventListener('click', refresh);
      el.removeEventListener('keydown', onKeydown, true);
      el.removeEventListener('blur', closeSoon);
      clearTimeout(timer);
      clearTimeout(blurTimer);
    };
  });
</script>

{#if open}
  <ul
    role="listbox"
    data-mention-popup
    class={`absolute left-0 right-0 z-40 ${placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'} max-h-60 overflow-y-auto bg-paper-warm border-[1.5px] border-ink rounded-md shadow-[3px_3px_0_var(--k-ink)]`}
  >
    {#each items as hit, i (hit.id)}
      <li role="option" aria-selected={i === active}>
        <!-- mousedown (NOT pointerdown) is cancelled so the textarea keeps focus: focus
             moves on mousedown, also for the mouse events a touch synthesises. -->
        <button
          type="button"
          data-mention-option={hit.handle}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => pick(hit)}
          class={`w-full min-h-[44px] flex items-center gap-2 px-3 py-1.5 text-left ${i === active ? 'bg-paper-soft' : ''}`}
        >
          <KioskAvatar name={hit.name} image={hit.image} size="sm" />
          <span class="min-w-0 flex-1 truncate font-bricolage text-[13px] font-bold text-ink">{hit.name}</span>
          <span class="shrink-0 font-dmmono text-[10px] text-ink-mute">@{hit.handle}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
