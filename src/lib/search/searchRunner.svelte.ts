// One fetch state machine for both search islands (page + modal): debounce
// 250 ms, „last request wins", and `pending` = a query is typed but ITS
// answer is not in yet — while pending neither an empty state nor the
// previous query's hits may show (review 2026-09-24). Runes in a .svelte.ts
// module; call it during component init (it creates an $effect). Islands
// write `runner.query` from oninput (no bind: on the accessor).
import { normalizeQuery } from '../forum/searchQuery';
import type { SiteSearchResult } from './siteSearch';

export function createSearchRunner(initial: { query?: string; results?: SiteSearchResult | null } = {}) {
  let query = $state(initial.query ?? '');
  let results = $state<SiteSearchResult | null>(initial.results ?? null);
  let loading = $state(false);
  let failed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  const normalized = $derived(normalizeQuery(query));
  const hits = $derived(results && normalized && results.q === normalized ? results : null);
  const pending = $derived(!!normalized && !hits);

  async function run(q: string) {
    const my = ++seq;
    loading = true;
    failed = false;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (my !== seq) return;
      if (!r.ok) { failed = true; return; }
      results = (await r.json()) as SiteSearchResult;
    } catch {
      if (my === seq) failed = true;
    } finally {
      if (my === seq) loading = false;
    }
  }

  $effect(() => {
    const q = normalized;
    clearTimeout(timer);
    if (!q) { loading = false; failed = false; return; }
    if (results && results.q === q) return; // SSR answer or the same query again
    failed = false;
    timer = setTimeout(() => run(q), 250);
    return () => clearTimeout(timer);
  });

  return {
    get query() { return query; },
    set query(v: string) { query = v; },
    get normalized() { return normalized; },
    get hits() { return hits; },
    get loading() { return loading; },
    get failed() { return failed; },
    get pending() { return pending; },
  };
}
