<script lang="ts">
  // The list of sent Kiez-Brief issues (/kiez-brief). Rows link to the browser view, which is the
  // mail's own HTML and not an Astro page — hence `data-astro-reload` (no ClientRouter swap).
  // No <style> block on purpose: Tailwind classes only.
  import { t, tStr, locale } from '../../lib/kiosk-i18n';
  import type { IssueListItem } from '../../lib/newsletter/kiezBriefStore';

  let { issues = [] } = $props<{ issues?: IssueListItem[] }>();

  const sentOn = (ms: number, loc: string) =>
    new Date(ms).toLocaleDateString(loc === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' });
</script>

<div data-kiez-brief-archive class="px-4 md:px-9 lg:px-10 pt-5 md:pt-6 pb-10">
  <section class="mb-5 pb-4 border-b border-dashed border-rule">
    <p class="font-dmmono text-[11px] uppercase tracking-[0.18em] mb-2" style="color: var(--k-accent);">{$t['kiezBrief.kicker']}</p>
    <h1 class="font-bricolage font-extrabold text-[34px] min-[380px]:text-4xl md:text-5xl tracking-tight leading-[0.95] text-ink">
      {$t['kiezBrief.title.prefix']}
      <em class="font-instrument italic font-normal" style="color: var(--k-accent);">{$t['kiezBrief.title.accent']}</em>
    </h1>
    <p class="mt-3 font-instrument italic text-[15px] text-ink-soft max-w-[60ch]">{$t['kiezBrief.intro']}</p>
  </section>

  {#if issues.length}
    <ul class="flex flex-col gap-2">
      {#each issues as issue (issue.week)}
        <li>
          <a
            href={`/kiez-brief/${issue.week}`}
            data-astro-reload
            data-kiez-brief-issue={issue.week}
            class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-3 min-h-[44px] rounded-lg border-[1.5px] border-ink bg-paper-warm hover:bg-paper"
          >
            <span class="font-bricolage font-bold text-[16px] text-ink">{tStr($t['kiezBrief.week'] as string, { n: Number(issue.week.slice(-2)), year: issue.week.slice(0, 4) })}</span>
            <span class="font-dmmono text-[11px] text-ink-mute">{tStr($t['kiezBrief.sent'] as string, { date: sentOn(issue.sentAtMs, $locale) })}</span>
            <span class="ml-auto font-dmmono text-[11px] uppercase tracking-[0.1em] underline" style="color: var(--k-accent);">{$t['kiezBrief.read']}</span>
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <p data-kiez-brief-empty class="py-10 text-center font-instrument italic text-[17px] text-ink-soft">{$t['kiezBrief.empty']}</p>
  {/if}
</div>
