<script lang="ts">
  // Bookmarks listing — direct port of `ForumBookmarksMobile` from
  // design/handoffs/design_handoff_forum/forum-design-jsx-files/kiosk-forum-extras.jsx
  // (lines 273–318). Slim 1-line items, day-grain savedAt labels, no
  // QueryClient (SSR data is the only source — users navigate to a topic
  // to unsave/save).

  import PostTypeChip from './PostTypeChip.svelte';
  import KioskBtn from './KioskBtn.svelte';
  import { locale } from '../../../lib/kiosk-i18n';
  import { hrefForPost, isPostCollection, kindForCollection } from '../../../lib/forum/postKind';

  let { initialItems = [], currentUserId = null } = $props<{
    initialItems?: (any & { savedAt?: string | null })[];
    currentUserId?: string | null;
  }>();

  const items = $derived(initialItems as any[]);

  // Items are tagged server-side; anything untagged (legacy) is a discussion.
  const collectionOf = (t: any) => (isPostCollection(t.collection) ? t.collection : 'topics');

  // Day-grain savedAt label, distinct from the minute-grain `relTime`
  // used elsewhere on the kiosk forum. Calendar-day delta (zeroed to
  // local midnight) so saving at 23:59 yesterday reads `gestern`, not
  // `heute`.
  function savedAtRel(iso?: string | null): string {
    if (!iso) return '';
    const a = new Date(iso);
    if (Number.isNaN(a.getTime())) return '';
    a.setHours(0, 0, 0, 0);
    const b = new Date();
    b.setHours(0, 0, 0, 0);
    const days = Math.round((b.getTime() - a.getTime()) / 86_400_000);
    const de = $locale === 'de';
    if (days <= 0) return de ? 'heute' : 'today';
    if (days === 1) return de ? 'gestern' : 'yesterday';
    if (days < 7) return de ? `vor ${days} Tagen` : `${days}d ago`;
    if (days === 7) return de ? 'vor 1 Woche' : '1w ago';
    if (days < 29) {
      const w = Math.floor(days / 7);
      return de ? `vor ${w} Wochen` : `${w}w ago`;
    }
    return new Date(iso).toLocaleDateString(de ? 'de-DE' : 'en-GB', {
      day: '2-digit',
      month: 'short',
    });
  }
</script>

<main class="max-w-3xl mx-auto pb-10">
  <!-- ── Title block (matches ForumBookmarksMobile L278–289) ─────── -->
  <section class="px-[18px] pt-4 pb-2 border-b border-dashed border-rule">
    <p class="font-dmmono text-[9.5px] uppercase tracking-[0.12em] text-wine">
      ◆ {$locale === 'de' ? 'GESPEICHERT' : 'BOOKMARKS'}
    </p>
    <h1
      class="font-bricolage font-extrabold text-[28px] leading-none tracking-[-0.025em] mt-1 m-0"
    >
      {#if $locale === 'de'}
        Was du dir <em class="font-instrument italic font-normal text-wine">merken</em> wolltest.
      {:else}
        What you wanted to <em class="font-instrument italic font-normal text-wine">remember</em>.
      {/if}
    </h1>
    <p class="font-dmmono text-[10px] uppercase tracking-[0.05em] text-ink-mute mt-1.5">
      {items.length}
      {#if items.length === 1}
        {$locale === 'de' ? 'BEITRAG' : 'POST'}
      {:else}
        {$locale === 'de' ? 'BEITRÄGE' : 'POSTS'}
      {/if}
    </p>
  </section>

  {#if items.length === 0}
    <!-- Empty state — design doesn't show one. Minimal kiosk paragraph
         + escape-hatch CTA so the route isn't a dead end. -->
    <div
      class="mx-[18px] mt-6 px-6 py-10 bg-paper-warm border-[1.5px] border-dashed border-rule rounded-xl text-center"
    >
      <p class="font-bricolage text-2xl text-ink mb-2">
        {$locale === 'de' ? 'Noch nichts gespeichert.' : 'Nothing saved yet.'}
      </p>
      <p class="font-bricolage text-ink-soft mb-4">
        {$locale === 'de'
          ? 'Tippe auf das Lesezeichen eines Beitrags, um ihn hier zu sammeln.'
          : 'Tap the bookmark on a post to collect it here.'}
      </p>
      <KioskBtn variant="secondary" size="md" href="/forum">
        ← {$locale === 'de' ? 'zum Forum' : 'to forum'}
      </KioskBtn>
    </div>
  {:else}
    <!-- ── List (matches ForumBookmarksMobile L292–315) ──────────── -->
    <div class="px-[18px] py-2.5 flex flex-col gap-2">
      {#each items as topic (topic._id)}
        <a
          href={hrefForPost(collectionOf(topic), topic._id)}
          class="block focus:outline-none focus:ring-2 focus:ring-ink rounded-xl"
        >
          <article
            class="bg-paper border-[1.5px] border-ink rounded-xl px-3 py-2.5 grid grid-cols-[1fr_auto] gap-2 items-center"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 mb-0.5">
                <PostTypeChip kind={kindForCollection(collectionOf(topic))} size="sm" />
                <span
                  class="font-dmmono text-[9px] text-ink-mute tracking-[0.05em] truncate"
                >
                  ⌂ {savedAtRel(topic.savedAt ?? topic.date)}
                </span>
              </div>
              <div
                class="font-bricolage font-bold text-[13px] leading-[1.25] tracking-[-0.01em] truncate"
              >
                {topic.title}
              </div>
            </div>
            <span class="text-[16px] text-ochre" aria-hidden="true">🔖</span>
          </article>
        </a>
      {/each}
    </div>
  {/if}
</main>
