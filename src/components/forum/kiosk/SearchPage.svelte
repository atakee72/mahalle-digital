<script lang="ts">
  // Search results — direct port of `ForumSearchMobile` from
  // design/handoffs/design_handoff_forum/forum-design-jsx-files/kiosk-forum-extras.jsx
  // (lines 195–268). Slim purpose-built result cards with ochre `<mark>`
  // highlight on first match, instant client-side filter across topics
  // AND comments (kicker promises "BEITRÄGE + KOMMENTARE"), `?q=` URL
  // sync via history.replaceState.
  //
  // Comment-match card is a documented extension — design's kicker
  // promises comment search but the JSX only shows post results.
  // Comment cards re-use the same outer frame, swap PostTypeChip for a
  // `↪ KOMMENTAR` mono kicker, and prepend the parent topic title on a
  // small line above the body excerpt.

  import { shortenUrlsInText } from '../../../lib/linkify';
  import { onMount } from 'svelte';
  import PostTypeChip from './PostTypeChip.svelte';
  import { locale } from '../../../lib/kiosk-i18n';

  type Topic = {
    _id: string;
    title: string;
    body?: string;
    description?: string;
    author?: { name?: string } | null;
    tags?: string[];
    date?: string;
  };

  type Comment = {
    _id: string;
    body: string;
    topicId: string;
    date?: string;
    parentTitle: string;
  };

  let {
    initialItems = [],
    initialComments = [],
    currentUserId = null
  } = $props<{
    initialItems?: Topic[];
    initialComments?: Comment[];
    currentUserId?: string | null;
  }>();

  const items = $derived(initialItems as Topic[]);
  const comments = $derived(initialComments as Comment[]);
  let query = $state('');

  // ─── URL sync (?q=) ──────────────────────────────────────────────
  onMount(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const initialQ = url.searchParams.get('q') ?? '';
    if (initialQ) query = initialQ;
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    window.history.replaceState({}, '', url.toString());
  });

  // ─── Filter logic ────────────────────────────────────────────────
  function topicMatches(t: Topic, q: string): boolean {
    if (!q) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return false;
    const fields: (string | undefined)[] = [
      t.title,
      t.body,
      t.description,
      t.author?.name,
      ...(t.tags ?? [])
    ];
    return fields.some(
      (v) => typeof v === 'string' && v.toLowerCase().includes(needle)
    );
  }
  function commentMatches(c: Comment, q: string): boolean {
    if (!q) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return false;
    return typeof c.body === 'string' && c.body.toLowerCase().includes(needle);
  }

  const filteredTopics = $derived(items.filter((t) => topicMatches(t, query)));
  const filteredComments = $derived(comments.filter((c) => commentMatches(c, query)));
  const totalMatches = $derived(filteredTopics.length + filteredComments.length);

  // ─── Highlight (XSS-safe) ────────────────────────────────────────
  // No `{@html}` — split into prefix / match / suffix segments and let
  // Svelte auto-escape each piece individually.
  function splitOnFirstMatch(
    text: string | undefined | null,
    q: string
  ): { prefix: string; match: string; suffix: string } | null {
    if (!text || !q) return null;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return null;
    return {
      prefix: text.slice(0, idx),
      match: text.slice(idx, idx + q.length),
      suffix: text.slice(idx + q.length)
    };
  }

  function excerpt(body?: string): string {
    if (!body) return '';
    const short = shortenUrlsInText(body);
    return short.length > 100 ? short.slice(0, 100) + '…' : short;
  }

  // ─── Time / kicker copy ──────────────────────────────────────────
  function relTime(iso?: string): string {
    if (!iso) return '';
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
    if (min < 1) return $locale === 'de' ? 'gerade eben' : 'just now';
    if (min < 60) return $locale === 'de' ? `vor ${min} min` : `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return $locale === 'de' ? `vor ${hr} std` : `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 7) return $locale === 'de' ? `vor ${d} t` : `${d}d ago`;
    return new Date(iso).toLocaleDateString($locale === 'de' ? 'de-DE' : 'en-GB', {
      day: '2-digit',
      month: 'short'
    });
  }

  const placeholder = $derived(
    $locale === 'de'
      ? 'Worüber suchst du? (Titel, Tag, Autor:in)'
      : 'What are you looking for? (title, tag, author)'
  );

  const kickerCopy = $derived.by(() => {
    const de = $locale === 'de';
    if (!query) {
      return de
        ? `${items.length + comments.length} BEITRÄGE + KOMMENTARE IM INDEX`
        : `${items.length + comments.length} POSTS + COMMENTS INDEXED`;
    }
    return de
      ? `${totalMatches} TREFFER · BEITRÄGE + KOMMENTARE`
      : `${totalMatches} RESULTS · POSTS + COMMENTS`;
  });
</script>

<main class="max-w-3xl mx-auto pb-10">
  <!-- ── Search bar block (matches ForumSearchMobile L198–223) ──── -->
  <section class="px-[18px] py-2.5 bg-paper-warm border-b border-dashed border-rule">
    <div
      class="flex items-center gap-2 bg-paper border-[1.5px] border-ink rounded-full px-3.5 py-2"
    >
      <span
        class="font-dmmono text-[14px] text-ink-mute pointer-events-none shrink-0"
        aria-hidden="true">⌕</span>
      <input
        type="search"
        bind:value={query}
        placeholder={placeholder}
        autocomplete="off"
        class="flex-1 min-w-0 bg-transparent border-none outline-none font-bricolage text-[14px] font-semibold text-ink placeholder:text-ink-mute placeholder:font-normal"
      />
      {#if query}
        <button
          type="button"
          onclick={() => (query = '')}
          aria-label={$locale === 'de' ? 'Suche leeren' : 'Clear search'}
          class="shrink-0 w-4 h-4 rounded-full bg-ink-mute text-paper text-[9px] font-bold flex items-center justify-center hover:bg-ink transition-colors"
        >×</button>
      {/if}
    </div>
    <p class="mt-1.5 font-dmmono text-[9.5px] uppercase tracking-[0.05em] text-wine">
      {kickerCopy}
    </p>
  </section>

  <!-- ── Results ─────────────────────────────────────────────────── -->
  {#if !query}
    <!-- Idle state — show no result list, just the kicker count above. -->
    <div class="px-[18px] py-10 text-center">
      <p class="font-bricolage text-ink-mute">
        {$locale === 'de'
          ? 'Tippe einen Suchbegriff oben ein.'
          : 'Type a search term above.'}
      </p>
    </div>
  {:else if totalMatches === 0}
    <div
      class="mx-[18px] my-6 px-6 py-10 bg-paper-warm border-[1.5px] border-dashed border-rule rounded-xl text-center"
    >
      <p class="font-bricolage text-2xl text-ink mb-2">
        {$locale === 'de' ? 'Nichts gefunden.' : 'Nothing found.'}
      </p>
      <p class="font-bricolage text-ink-soft">
        {$locale === 'de'
          ? 'Probier andere Wörter oder einen Tag (z. B. spielplatz).'
          : 'Try other words or a tag (e.g. spielplatz).'}
      </p>
    </div>
  {:else}
    <div class="px-[18px] py-2.5 flex flex-col gap-2.5">
      <!-- Topic matches -->
      {#each filteredTopics as topic (topic._id)}
        {@const titleSplit = splitOnFirstMatch(topic.title, query)}
        {@const ex = excerpt(topic.body ?? topic.description)}
        {@const bodySplit = splitOnFirstMatch(ex, query)}
        <a
          href={`/topics/${topic._id}`}
          class="block focus:outline-none focus:ring-2 focus:ring-ink rounded-xl"
        >
          <article
            class="bg-paper border-[1.5px] border-ink rounded-xl px-3.5 py-3"
          >
            <div class="flex items-center gap-1.5 mb-1.5">
              <PostTypeChip kind="discussion" size="sm" />
              <span class="font-dmmono text-[9.5px] text-ink-mute">
                · {relTime(topic.date)}
              </span>
            </div>
            <h3
              class="font-bricolage font-extrabold text-[15px] tracking-[-0.015em] leading-[1.2] mb-1 m-0 text-ink"
            >
              {#if titleSplit}{titleSplit.prefix}<mark
                  class="bg-ochre text-ink px-0.5"
                  >{titleSplit.match}</mark>{titleSplit.suffix}{:else}{topic.title}{/if}
            </h3>
            {#if ex}
              <p
                class="font-bricolage text-[12.5px] leading-[1.45] text-ink-soft m-0"
              >
                {#if bodySplit}{bodySplit.prefix}<mark
                    class="bg-ochre text-ink px-0.5"
                    >{bodySplit.match}</mark>{bodySplit.suffix}{:else}{ex}{/if}
              </p>
            {/if}
          </article>
        </a>
      {/each}

      <!-- Comment matches (extends design — ↪ KOMMENTAR kicker variant) -->
      {#each filteredComments as comment (comment._id)}
        {@const ex = excerpt(comment.body)}
        {@const bodySplit = splitOnFirstMatch(ex, query)}
        <a
          href={`/topics/${comment.topicId}`}
          class="block focus:outline-none focus:ring-2 focus:ring-ink rounded-xl"
        >
          <article
            class="bg-paper border-[1.5px] border-ink rounded-xl px-3.5 py-3"
          >
            <div class="flex items-center gap-2 mb-0.5">
              <span
                class="font-dmmono text-[9.5px] uppercase tracking-[0.12em] text-wine"
              >
                ↪ {$locale === 'de' ? 'KOMMENTAR' : 'COMMENT'}
              </span>
              <span class="font-dmmono text-[9.5px] text-ink-mute">
                · {relTime(comment.date)}
              </span>
            </div>
            <p
              class="font-dmmono text-[9.5px] text-ink-mute tracking-[0.05em] truncate mb-1.5"
            >
              ↪ {comment.parentTitle}
            </p>
            <p
              class="font-bricolage text-[12.5px] leading-[1.45] text-ink-soft m-0"
            >
              {#if bodySplit}{bodySplit.prefix}<mark
                  class="bg-ochre text-ink px-0.5"
                  >{bodySplit.match}</mark>{bodySplit.suffix}{:else}{ex}{/if}
            </p>
          </article>
        </a>
      {/each}
    </div>
  {/if}
</main>
