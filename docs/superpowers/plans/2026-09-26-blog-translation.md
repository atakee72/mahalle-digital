# Blog „Übersetzung anzeigen" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every blog article („Die Beilage", `/blog/<slug>`) the same „Übersetzung anzeigen" toggle the forum, calendar and market already have — translated title, standfirst and body, DeepL-backed, cached, one click back to the original.

**Architecture:** Blog posts are MDX files in the repo, not Mongo documents, so the existing `translateContent()` (loads by collection + ObjectId) cannot serve them. A server-only twin `translateBlogPost()` loads the entry through `astro:content` (same draft gate as the detail route), splits the raw markdown into typed text blocks with a pure, unit-tested parser, sends the block texts to DeepL in batches, rebuilds the blocks and caches them in the existing `translationCache` collection under `blog:<slug>:<lang>:<hash>`. `POST /api/translate` gains the content type `blog` (id = slug) and returns `{ title, description, blocks }`. On the page a new island `BlogTranslate.svelte` sits above the article body, renders the translated blocks with the layout's own `bl-prose` classes (Svelte text interpolation only — no HTML ever reaches the DOM), hides the server-rendered original while shown, and tells the header island the translated title/standfirst through a `bl:translation` DOM event.

**Tech Stack:** Astro 5 SSR (`astro:content` in a lib module, precedent `src/lib/search/blogEntries.ts`), Svelte 5 runes island, Zod, DeepL REST via the existing `translateTexts()`, MongoDB `translationCache`, `node:test` for the pure parser, Playwright (`scratchpad/*.cjs`, `NODE_PATH` to the CLI's bundled playwright) against the dev server `:4655`.

**Spec:** None written — the user's words are the spec: „we do not have "Übersetzung zeigen" in blog posts!! … ok, add it to blog posts too" (2026-09-26 20:00). The forum's translation feature is the behavioural reference: `src/components/forum/kiosk/TranslateControl.svelte`, `src/lib/translation/translateContent.ts`, `src/pages/api/translate.ts`.

## Global Constraints

- **Server-authoritative text.** The server translates only content it loaded itself (the MDX entry by slug). The client never sends text to translate (root `CLAUDE.md` → `translationCache`: „never client-supplied text").
- **Draft gate = detail route gate.** `!data.draft || !import.meta.env.PROD` — a draft translates in dev, is `not_found` in prod (`src/components/blog/CLAUDE.md` → „Draft gating semantics").
- **Login required, as today.** `POST /api/translate` stays 401 for anonymous callers (the blog is public, the DeepL quota is not). Logged-out readers see a login hint, not a generic failure.
- **No HTML from the network into the DOM.** Translated text is rendered with Svelte `{text}` interpolation per block. No `{@html}`, no `innerHTML`.
- **Existing route contract untouched** for the six Mongo content types: same status codes, same response shape, same `tr:<userId>` rate limit (30/h) shared with the blog.
- **Copy is the user's.** New i18n strings are DRAFTS, flagged in the final report: `tr.err.login` DE „Zum Übersetzen bitte anmelden" / EN „Please log in to translate". Existing `tr.*` keys are reused verbatim.
- **Nested-island CSS rule.** `BlogTranslate.svelte` is mounted directly from the three `.astro` layouts, so a scoped `<style>` would survive — but it needs none: it reuses the `.ktr-*` classes in `global.css` and the layout's `bl-prose` classes.
- **Gate budgets (ratchet, zero headroom):** tsc ≤ 23, svelte-check ≤ 89. Recount from raw output: `pnpm type-check 2>&1 | grep -c "error TS"` and `npx -y svelte-check@4 2>&1 | grep -oE "COMPLETED .* ERRORS"`. Use the annotated `$props()` form.
- **Tests:** `node:test` + `node:assert/strict`, run with `npx tsx --test <file>` (no test script in package.json). Existing style: `src/lib/blog/beilage.test.ts`.
- **Dev server:** the orchestrator's `pnpm dev --port 4655` is RUNNING — reuse it, never start another. Probe login: fetch-based as `jonas@mahalle-dev.test` with the password read from `scratchpad/devpw.txt` straight into the request body (recipe: `scratchpad/people-row-probe.cjs`). Never print, echo or `Read` that file. Never snapshot a page with a filled password field.
- **Secrets:** never print any `.env` VALUE (names only). `DEEPL_API_KEY` IS set locally (name checked), so the 200 path is testable on dev.
- **Git:** work on `main` directly (same ruling as the 09-26 clipper work), commit messages one line, no attribution footer, `git add` named files only, never `scratchpad/`. Push only on the user's word.

## Review Focus

1. **Logged-out reader clicks the toggle** → the 401 body is `{ error: 'Unauthorized' }` → must show `tr.err.login`, not `tr.err.generic`. Pinned in Task 3 probe check 7.
2. **DeepL answers with the wrong number of texts / a batch fails midway** → `translateTexts` throws (`upstream`) → route answers 503 `translate_unavailable`, never 500. Pinned in Task 1 (`withTexts` throws on mismatch) + Task 2 code path (`try` around the whole batch loop, `withTexts` inside it).
3. **Unknown or draft slug in prod** → 404 `not_found` → generic error message. Pinned in Task 2 script check 3.
4. **Inline markdown in prose** (`**fett**`, `[Text](url)`, `![alt](img)`) must reach DeepL as plain words, never as asterisks or URLs. Pinned in Task 1 tests „plainInline".
5. **Toggling back / leaving the page** must restore the original body's display and the header's title. Pinned in Task 3 probe checks 5–6 (`display` restored, event `null` swaps the title back); `onDestroy` publishes `null`.

Known, accepted: the sticky `BlogReadBar` keeps the original title while a translation is shown (it is a separate island; not worth a second event listener — say so in the docs). Links and emphasis are flattened to plain text in the translated view (the original is one click away).

---

### Task 1: Pure markdown-block parser

**Files:**
- Create: `src/lib/blog/markdownBlocks.ts`
- Test: `src/lib/blog/markdownBlocks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Block =
    | { kind: 'p' | 'h2' | 'h3' | 'quote'; text: string }
    | { kind: 'ul' | 'ol'; items: string[] };
  export const BLOG_TRANSLATE_MAX_CHARS = 12000;
  export function plainInline(s: string): string;
  export function parseBlocks(md: string): Block[];
  export function blockTexts(blocks: Block[]): string[];        // flat, document order
  export function withTexts(blocks: Block[], texts: string[]): Block[]; // throws on length mismatch
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/blog/markdownBlocks.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, plainInline, blockTexts, withTexts } from './markdownBlocks';

test('plainInline strips bold, italic, links, images and code', () => {
  assert.equal(plainInline('Das ist **fett** und *kursiv* und `code`.'), 'Das ist fett und kursiv und code.');
  assert.equal(plainInline('Mehr auf [unserer Seite](https://example.org/x) lesen.'), 'Mehr auf unserer Seite lesen.');
  assert.equal(plainInline('Bild: ![Herrfurthplatz](./images/platz.jpg) fertig'), 'Bild: Herrfurthplatz fertig');
  assert.equal(plainInline('Zeile<br />Umbruch  doppelt'), 'Zeile Umbruch doppelt');
});

test('paragraphs join soft line breaks and split on blank lines', () => {
  const md = 'Liebe Nachbarinnen und Nachbarn,\n\neigentlich sollte hier\njemand anderes schreiben.\n\n';
  assert.deepEqual(parseBlocks(md), [
    { kind: 'p', text: 'Liebe Nachbarinnen und Nachbarn,' },
    { kind: 'p', text: 'eigentlich sollte hier jemand anderes schreiben.' },
  ]);
});

test('headings map to h2/h3 and end the running paragraph', () => {
  const md = 'Intro\n# Eins\n## Zwei\n### Drei\n#### Vier\nText';
  assert.deepEqual(parseBlocks(md), [
    { kind: 'p', text: 'Intro' },
    { kind: 'h2', text: 'Eins' },
    { kind: 'h2', text: 'Zwei' },
    { kind: 'h3', text: 'Drei' },
    { kind: 'h3', text: 'Vier' },
    { kind: 'p', text: 'Text' },
  ]);
});

test('blockquotes join their lines, lists keep one item per line', () => {
  const md = '> Erste Zeile\n> zweite Zeile\n\n- **Eins**\n- Zwei\n\n1. Alpha\n2. Beta\n3) Gamma';
  assert.deepEqual(parseBlocks(md), [
    { kind: 'quote', text: 'Erste Zeile zweite Zeile' },
    { kind: 'ul', items: ['Eins', 'Zwei'] },
    { kind: 'ol', items: ['Alpha', 'Beta', 'Gamma'] },
  ]);
});

test('list followed directly by a paragraph line without a blank line ends the list', () => {
  assert.deepEqual(parseBlocks('- a\n- b\nDanach'), [
    { kind: 'ul', items: ['a', 'b'] },
    { kind: 'p', text: 'Danach' },
  ]);
});

test('indented continuation lines belong to the previous list item', () => {
  assert.deepEqual(parseBlocks('- a erste\n  a zweite\n- b'), [{ kind: 'ul', items: ['a erste a zweite', 'b'] }]);
});

test('horizontal rules and MDX import/export lines produce nothing', () => {
  const md = "import X from './X.astro'\n\nText\n\n---\n\n***\n\nexport const a = 1\n\nEnde";
  assert.deepEqual(parseBlocks(md), [{ kind: 'p', text: 'Text' }, { kind: 'p', text: 'Ende' }]);
});

test('empty and whitespace-only input yields no blocks', () => {
  assert.deepEqual(parseBlocks(''), []);
  assert.deepEqual(parseBlocks('\n  \n\r\n'), []);
});

test('blockTexts flattens in document order; withTexts rebuilds and checks the count', () => {
  const blocks = parseBlocks('## Kopf\n\nAbsatz\n\n- eins\n- zwei');
  assert.deepEqual(blockTexts(blocks), ['Kopf', 'Absatz', 'eins', 'zwei']);
  assert.deepEqual(withTexts(blocks, ['Head', 'Paragraph', 'one', 'two']), [
    { kind: 'h2', text: 'Head' },
    { kind: 'p', text: 'Paragraph' },
    { kind: 'ul', items: ['one', 'two'] },
  ]);
  assert.throws(() => withTexts(blocks, ['Head', 'Paragraph', 'one']), /too few/);
  assert.throws(() => withTexts(blocks, ['Head', 'Paragraph', 'one', 'two', 'extra']), /too many/);
});

test('withTexts does not mutate its input', () => {
  const blocks = parseBlocks('Absatz');
  withTexts(blocks, ['Paragraph']);
  assert.deepEqual(blocks, [{ kind: 'p', text: 'Absatz' }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/blog/markdownBlocks.test.ts`
Expected: FAIL — `Cannot find module './markdownBlocks'`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/blog/markdownBlocks.ts
// DEPENDENCY-PURE: imported by the server-only translateBlog.ts AND (type-only) by
// Svelte islands. No node/astro imports, ever.
//
// Splits a blog post's raw markdown (astro:content `entry.body`, frontmatter already
// stripped) into typed text blocks so each block's PLAIN text can go to DeepL and
// come back into the same shape. Inline markdown is flattened to words on purpose:
// the translated view is a reading aid, the original with its links is one click away.
// Not reused: src/lib/search/siteSearch.ts `plainMdx()` — it flattens the WHOLE body
// to one string for search and loses the paragraph/heading/list structure needed here.

export type Block =
  | { kind: 'p' | 'h2' | 'h3' | 'quote'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] };

/** title + description + every block text, in characters. Posts today are 1.8–3k. */
export const BLOG_TRANSLATE_MAX_CHARS = 12000;

export function plainInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // image → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // link → link text
    .replace(/(\*\*|__)(.+?)\1/g, '$2') // bold (before italic)
    .replace(/(\*|_)(.+?)\1/g, '$2') // italic
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '') // stray inline html
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function parseBlocks(md: string): Block[] {
  const out: Block[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let quote: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = () => {
    if (!para.length) return;
    const text = plainInline(para.join(' '));
    if (text) out.push({ kind: 'p', text });
    para = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const text = plainInline(quote.join(' '));
    if (text) out.push({ kind: 'quote', text });
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.filter(Boolean);
    if (items.length) out.push({ kind: list.kind, items });
    list = null;
  };
  const flushAll = () => {
    flushPara();
    flushQuote();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushAll();
      continue;
    }
    // MDX ESM lines and thematic breaks carry no prose.
    if (/^import\s.+\sfrom\s.+$/.test(line) || /^export\s/.test(line) || /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushAll();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushAll();
      const text = plainInline(h[2]);
      if (text) out.push({ kind: h[1].length <= 2 ? 'h2' : 'h3', text });
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
      continue;
    }
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      flushQuote();
      const kind: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push(plainInline((ul ?? ol)![1]));
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      // indented continuation of the previous list item
      list.items[list.items.length - 1] = `${list.items[list.items.length - 1]} ${plainInline(line)}`;
      continue;
    }
    flushQuote();
    flushList();
    para.push(line.trim());
  }
  flushAll();
  return out;
}

export function blockTexts(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if ('items' in b) out.push(...b.items);
    else out.push(b.text);
  }
  return out;
}

export function withTexts(blocks: Block[], texts: string[]): Block[] {
  let i = 0;
  const next = (): string => {
    if (i >= texts.length) throw new Error('withTexts: too few texts');
    return texts[i++];
  };
  const out = blocks.map((b): Block =>
    'items' in b ? { kind: b.kind, items: b.items.map(() => next()) } : { kind: b.kind, text: next() }
  );
  if (i !== texts.length) throw new Error('withTexts: too many texts');
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/lib/blog/markdownBlocks.test.ts`
Expected: `# pass 10`, `# fail 0`. If the TypeScript narrowing on `list` inside the loop complains under `pnpm type-check`, keep the closures as written (TS does not track closure side effects) — do not add `!` assertions beyond the one on `(ul ?? ol)!`.

- [ ] **Step 5: Type gate and commit**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → must print `23` (unchanged).

```bash
git add src/lib/blog/markdownBlocks.ts src/lib/blog/markdownBlocks.test.ts
git commit -m "blog: pure markdown → text-block parser for translation (10 tests)"
```

---

### Task 2: Server side — `translateBlogPost()`, schema, route branch, client helper

**Files:**
- Create: `src/lib/translation/translateBlog.ts`
- Modify: `src/schemas/translate.schema.ts` (whole file, 11 lines)
- Modify: `src/pages/api/translate.ts:32-50` (after the rate limit, the outcome switch)
- Modify: `src/lib/translation/client.ts` (append one function)
- Modify: `src/lib/translation/translateContent.ts:1-2` (header comment: name the twin)
- Create (local, gitignored, never committed): `scratchpad/blog-translate-api.mts`

**Interfaces:**
- Consumes (Task 1): `parseBlocks`, `blockTexts`, `withTexts`, `BLOG_TRANSLATE_MAX_CHARS`, `type Block` from `src/lib/blog/markdownBlocks`.
- Consumes (existing): `translateTexts(texts: string[], targetLang: string): Promise<{ texts: string[]; detectedSource: string | null }>`, `deeplTargetFor(lang): string | null`, `DeepLError` (`code: 'unavailable'|'quota'|'bad_lang'|'upstream'`) from `./deepl`; `connectDB()` from `../mongodb`.
- Produces:
  ```ts
  // src/lib/translation/translateBlog.ts
  export type BlogTranslateOutcome =
    | { status: 'ok'; title: string; description: string; blocks: Block[]; detectedSource: string | null; cached: boolean }
    | { status: 'not_found' } | { status: 'bad_lang' } | { status: 'too_long' } | { status: 'unavailable' };
  export async function translateBlogPost(input: { slug: string; targetLang: string }): Promise<BlogTranslateOutcome>;
  // src/lib/translation/client.ts
  export async function requestBlogTranslation(slug: string, targetLang: string):
    Promise<{ ok: true; title: string; description: string; blocks: Block[] } | { ok: false; error: string }>;
  ```
  HTTP: `POST /api/translate` body `{ contentType: 'blog', contentId: '<slug>', targetLang }` → 200 `{ title, description, blocks, detectedSource, cached }`; 400 `invalid_request` (bad slug / bad lang), 401 `Unauthorized`, 404 `not_found`, 422 `too_long`, 429 `rate_limited`, 503 `translate_unavailable`.

- [ ] **Step 1: Write the server module**

```ts
// src/lib/translation/translateBlog.ts
// SERVER-ONLY (astro:content + mongodb). Blog posts are repo MDX files, not Mongo
// documents, so translateContent() cannot load them — this is its blog twin:
// load by slug with the detail route's draft gate, split the markdown into blocks
// (pure parser, tested), translate the block texts, cache the rebuilt blocks in
// translationCache under `blog:<slug>:<lang>:<hash>`. Same 90d TTL, same
// content-hash keying (an edited post misses the cache by itself).
// astro:content is a virtual module of the Astro build: fine here the way
// src/lib/search/blogEntries.ts uses it, never importable by a unit test.
import { createHash } from 'crypto';
import { getCollection } from 'astro:content';
import { connectDB } from '../mongodb';
import { translateTexts, deeplTargetFor, DeepLError } from './deepl';
import { parseBlocks, blockTexts, withTexts, BLOG_TRANSLATE_MAX_CHARS, type Block } from '../blog/markdownBlocks';

const CACHE_COLLECTION = 'translationCache';
const DEEPL_BATCH = 50; // DeepL v2 accepts at most 50 texts per request

export type BlogTranslateOutcome =
  | { status: 'ok'; title: string; description: string; blocks: Block[]; detectedSource: string | null; cached: boolean }
  | { status: 'not_found' }
  | { status: 'bad_lang' }
  | { status: 'too_long' }
  | { status: 'unavailable' };

export async function translateBlogPost(input: { slug: string; targetLang: string }): Promise<BlogTranslateOutcome> {
  const target = deeplTargetFor(input.targetLang);
  if (!target) return { status: 'bad_lang' };
  const normLang = input.targetLang.trim().toLowerCase().split('-')[0];

  // Same gate as src/pages/blog/[...slug].astro: a draft resolves in dev, is gone in prod.
  const entries = await getCollection('blog', ({ data }) => !data.draft || !import.meta.env.PROD);
  const entry = entries.find((e) => e.id === input.slug);
  if (!entry) return { status: 'not_found' };

  const title = entry.data.title;
  const description = entry.data.description; // required by the content schema, but never send '' to DeepL
  const blocks = parseBlocks(entry.body ?? '');
  const texts = [title, ...(description ? [description] : []), ...blockTexts(blocks)];
  const bodyStart = description ? 2 : 1; // index of the first block text inside `texts`
  const total = texts.reduce((n, t) => n + t.length, 0);
  if (total === 0) return { status: 'not_found' };
  if (total > BLOG_TRANSLATE_MAX_CHARS) return { status: 'too_long' };

  const contentHash = createHash('sha256').update(texts.join('\n')).digest('hex').slice(0, 32);
  const cacheKey = `blog:${entry.id}:${normLang}:${contentHash}`;

  const db = await connectDB();
  const cacheCol = db.collection(CACHE_COLLECTION);
  const hit = await cacheCol.findOne({ key: cacheKey });
  if (hit && Array.isArray(hit.blocks)) {
    return {
      status: 'ok',
      title: String(hit.title ?? ''),
      description: String(hit.description ?? ''),
      blocks: hit.blocks as Block[],
      detectedSource: (hit.detectedSource as string | null) ?? null,
      cached: true,
    };
  }

  let trBlocks: Block[];
  let trTitle: string;
  let trDescription: string;
  let detectedSource: string | null = null;
  try {
    const translated: string[] = [];
    for (let i = 0; i < texts.length; i += DEEPL_BATCH) {
      const r = await translateTexts(texts.slice(i, i + DEEPL_BATCH), normLang);
      translated.push(...r.texts);
      detectedSource ??= r.detectedSource;
    }
    trTitle = translated[0] ?? '';
    trDescription = description ? (translated[1] ?? '') : '';
    trBlocks = withTexts(blocks, translated.slice(bodyStart)); // throws on a count mismatch → unavailable
  } catch (e) {
    if (e instanceof DeepLError && e.code === 'bad_lang') return { status: 'bad_lang' };
    return { status: 'unavailable' };
  }

  // Upsert, not insert: two concurrent misses on one key must not throw on the unique index.
  await cacheCol.updateOne(
    { key: cacheKey },
    {
      $set: {
        key: cacheKey,
        contentType: 'blog',
        contentId: entry.id,
        targetLang: normLang,
        contentHash,
        title: trTitle,
        description: trDescription,
        blocks: trBlocks,
        detectedSource,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  return { status: 'ok', title: trTitle, description: trDescription, blocks: trBlocks, detectedSource, cached: false };
}
```

- [ ] **Step 2: Widen the request schema**

Replace the whole of `src/schemas/translate.schema.ts` with:

```ts
// src/schemas/translate.schema.ts
// SERVER-ONLY: transitively imports mongodb via translateContent — never
// import this from a Svelte island or any client:* component.
import { z } from 'zod';
import { TRANSLATABLE_TYPES } from '../lib/translation/translateContent';

/** The six Mongo-backed types (ObjectId ids) plus the blog (repo MDX, slug ids). */
export const TRANSLATE_REQUEST_TYPES = [...TRANSLATABLE_TYPES, 'blog'] as const;

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const BLOG_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/; // astro:content ids of src/content/blog/*.mdx

export const TranslateRequestSchema = z
  .object({
    contentType: z.enum(TRANSLATE_REQUEST_TYPES),
    contentId: z.string().min(1).max(120),
    targetLang: z.string().min(2).max(12),
  })
  .refine((v) => (v.contentType === 'blog' ? BLOG_SLUG : OBJECT_ID).test(v.contentId), {
    message: 'invalid_id',
    path: ['contentId'],
  });
```

- [ ] **Step 3: Branch the route**

In `src/pages/api/translate.ts` add the import and replace everything from `const outcome = await translateContent(...)` to the end of the handler:

```ts
import { translateBlogPost } from '../../lib/translation/translateBlog';
```

```ts
  if (parsed.data.contentType === 'blog') {
    const outcome = await translateBlogPost({ slug: parsed.data.contentId, targetLang: parsed.data.targetLang });
    switch (outcome.status) {
      case 'ok':
        return json(200, {
          title: outcome.title,
          description: outcome.description,
          blocks: outcome.blocks,
          detectedSource: outcome.detectedSource,
          cached: outcome.cached,
        });
      case 'not_found':
        return json(404, { error: 'not_found' });
      case 'bad_lang':
        return json(400, { error: 'invalid_request' });
      case 'too_long':
        return json(422, { error: 'too_long' });
      case 'unavailable':
        return json(503, { error: 'translate_unavailable' });
    }
  }

  const outcome = await translateContent({
    contentType: parsed.data.contentType,
    contentId: parsed.data.contentId,
    targetLang: parsed.data.targetLang,
    userId,
  });
  switch (outcome.status) {
    // …the existing five cases, unchanged…
  }
```

The `if` narrows `parsed.data.contentType` to `TranslatableType` for the existing call — if tsc disagrees, cast once: `contentType: parsed.data.contentType as TranslatableType` with `import type { TranslatableType } from '../../lib/translation/translateContent'`.

- [ ] **Step 4: Client helper + twin comment**

Append to `src/lib/translation/client.ts`:

```ts
import type { Block } from '../blog/markdownBlocks'; // type-only: the module is dependency-pure anyway

export async function requestBlogTranslation(
  slug: string,
  targetLang: string
): Promise<{ ok: true; title: string; description: string; blocks: Block[] } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'blog', contentId: slug, targetLang }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      title?: string;
      description?: string;
      blocks?: Block[];
    };
    if (!res.ok) return { ok: false, error: data.error ?? `http_${res.status}` };
    return { ok: true, title: data.title ?? '', description: data.description ?? '', blocks: Array.isArray(data.blocks) ? data.blocks : [] };
  } catch {
    return { ok: false, error: 'network' };
  }
}
```

(Move the `import type` to the top of the file with the other imports — there are none today, so it becomes line 3 under the DEPENDENCY-PURE comment.)

In `src/lib/translation/translateContent.ts` extend the header comment (line 2):

```ts
// SERVER-ONLY: loads content, enforces visibility, returns cached or fresh translation.
// Mongo-backed types only — blog posts (repo MDX) go through ./translateBlog.ts.
```

- [ ] **Step 5: Type gate**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → `23`.

- [ ] **Step 6: Write the API probe (scratchpad, not committed)**

```ts
// scratchpad/blog-translate-api.mts — POST /api/translate for the blog on dev :4655.
// Fetch-login as jonas (recipe from scratchpad/people-row-probe.cjs). Never prints the password.
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE ?? 'http://localhost:4655';
const pw = readFileSync(new URL('./devpw.txt', import.meta.url), 'utf8').trim();
const jar = new Map<string, string>();
const ch = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const store = (r: Response) => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
const post = (body: unknown, auth = true) => fetch(`${BASE}/api/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { cookie: ch() } : {}) }, body: JSON.stringify(body) });
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

// 1 anonymous → 401
let r = await post({ contentType: 'blog', contentId: 'wahl2026-hempel', targetLang: 'en' }, false);
check('1 anonymous 401', r.status === 401);

// login
const csrf = await fetch(`${BASE}/api/auth/csrf`); store(csrf); const { csrfToken } = await csrf.json();
store(await fetch(`${BASE}/api/auth/callback/credentials`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: ch() }, body: new URLSearchParams({ csrfToken, email: 'jonas@mahalle-dev.test', password: pw }) }));
const sess = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: ch() } })).json();
check('login as jonas', !!sess?.user?.id);

// 2 bad slug (uppercase) → 400 ; 3 unknown slug → 404 ; 4 bad lang → 400
r = await post({ contentType: 'blog', contentId: 'Wahl2026-Hempel', targetLang: 'en' }); check('2 uppercase slug 400', r.status === 400);
r = await post({ contentType: 'blog', contentId: 'gibt-es-nicht', targetLang: 'en' }); check('3 unknown slug 404', r.status === 404);
r = await post({ contentType: 'blog', contentId: 'wahl2026-hempel', targetLang: 'xx' }); check('4 bad lang 400', r.status === 400);

// 5 real post → 200 with blocks (or 503 when DeepL is unreachable — reported, not failed)
r = await post({ contentType: 'blog', contentId: 'wahl2026-hempel', targetLang: 'en' });
const d: any = await r.json().catch(() => ({}));
if (r.status === 503) console.log('INFO 5 DeepL unavailable on this machine (503) — 200 path not exercised');
else {
  check('5 200', r.status === 200, `status ${r.status}`);
  check('5 title translated (no longer the German wording)', typeof d.title === 'string' && d.title.length > 0 && !/vorhabe/.test(d.title), d.title);
  check('5 blocks array with a paragraph', Array.isArray(d.blocks) && d.blocks.some((b: any) => b.kind === 'p' && b.text.length > 20), `${d.blocks?.length} blocks`);
  check('5 first block is English', /neighbo/i.test(d.blocks?.[0]?.text ?? ''), d.blocks?.[0]?.text);
  // 6 second call served from cache
  const r2 = await post({ contentType: 'blog', contentId: 'wahl2026-hempel', targetLang: 'en' });
  const d2: any = await r2.json();
  check('6 cached on repeat', r2.status === 200 && d2.cached === true);
}
// 7 the existing Mongo path is untouched: a nonsense ObjectId for a topic → 404, not 400
r = await post({ contentType: 'topic', contentId: '0123456789abcdef01234567', targetLang: 'en' }); check('7 topic path still 404 for unknown id', r.status === 404);
// 8 an ObjectId sent as a blog id passes the slug regex (24 lowercase hex chars) and is simply not a post → 404;
//   a slug sent as a topic id fails the ObjectId regex → 400
r = await post({ contentType: 'blog', contentId: '0123456789abcdef01234567', targetLang: 'en' }); check('8a ObjectId as blog id 404', r.status === 404);
r = await post({ contentType: 'topic', contentId: 'wahl2026-hempel', targetLang: 'en' }); check('8b slug as topic id 400', r.status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 7: Run the probe**

Run: `npx tsx scratchpad/blog-translate-api.mts`
Expected: every line `PASS` (or the single `INFO 5` line if DeepL is down at that moment, with checks 6 skipped). Run it twice: the second run must show `6 cached on repeat` PASS. Paste the output into the report.

- [ ] **Step 8: Commit (named files only — never the scratchpad)**

```bash
git add src/lib/translation/translateBlog.ts src/schemas/translate.schema.ts src/pages/api/translate.ts src/lib/translation/client.ts src/lib/translation/translateContent.ts
git commit -m "translate: blog posts via POST /api/translate (contentType blog, slug id, block texts, cached)"
```

---

### Task 3: Island, header swap, layouts, copy, browser probe

**Files:**
- Create: `src/components/blog/kiosk/BlogTranslate.svelte`
- Modify: `src/components/blog/kiosk/BlogArticleHeader.svelte` (script block; lines 49, 75, 89, 94 swap `post.title`/`post.description` for the derived values)
- Modify: `src/layouts/blog/StandardLayout.astro`, `src/layouts/blog/HeroLayout.astro`, `src/layouts/blog/GalleryLayout.astro` (prose div + island)
- Modify: `src/lib/kiosk-i18n.ts` — add `tr.err.login` next to `tr.err.generic` in BOTH locale blocks (DE block ≈ line 2094, EN block ≈ line 4049)
- Create (local, gitignored, never committed): `scratchpad/blog-translate-probe.cjs`

**Interfaces:**
- Consumes (Task 2): `requestBlogTranslation(slug, targetLang)`; (existing) `pickTargetLang($locale)` from `src/lib/translation/client`; `type Block` from `src/lib/blog/markdownBlocks`; i18n keys `tr.show`, `tr.working`, `tr.original`, `tr.label`, `tr.err.unavailable`, `tr.err.rate_limited`, `tr.err.too_long`, `tr.err.generic`, new `tr.err.login`; CSS `.ktr`, `.ktr-btn`, `.ktr-label`, `.ktr-err` (`global.css`).
- Produces: DOM contract — the server-rendered body div carries `id="bl-original"`; the island sets its inline `style.display` to `none` while a translation is shown and to `''` otherwise; it dispatches `document` event `bl:translation` with `detail: { title: string; description: string } | null`. `BlogArticleHeader` listens and shows `detail.title`/`detail.description` while non-null.

- [ ] **Step 1: i18n strings (drafts)**

DE block, directly after `'tr.err.generic': 'Übersetzung fehlgeschlagen',`:
```ts
  'tr.err.login': 'Zum Übersetzen bitte anmelden',
```
EN block, directly after `'tr.err.generic': 'Translation failed',`:
```ts
  'tr.err.login': 'Please log in to translate',
```

- [ ] **Step 2: The island**

```svelte
<!-- src/components/blog/kiosk/BlogTranslate.svelte
     „Übersetzung anzeigen" for a blog article. Mounted client:only from the three
     blog layouts ABOVE the server-rendered body (#bl-original). Shown: renders the
     translated blocks with the layout's own bl-prose classes (text interpolation only,
     never HTML), hides #bl-original and tells BlogArticleHeader the translated
     title/standfirst through the `bl:translation` document event. Reuses the .ktr-*
     classes from global.css; the blog's accent is rust. -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import { pickTargetLang, requestBlogTranslation } from '../../../lib/translation/client';
  import type { Block } from '../../../lib/blog/markdownBlocks';

  let {
    slug,
    proseClass,
    controlClass = '',
  }: {
    slug: string;
    proseClass: string;
    controlClass?: string;
  } = $props();

  type Tr = { title: string; description: string; blocks: Block[]; lang: string };

  // `phase`, not `state` — see TranslateControl.svelte for the svelte-check trap.
  let phase = $state<'idle' | 'working' | 'shown'>('idle');
  let error = $state<string | null>(null);
  let shown = $state<Tr | null>(null);
  let cache: Tr | null = null;
  let destroyed = false;

  const ERR_KEY: Record<string, string> = {
    translate_unavailable: 'tr.err.unavailable',
    rate_limited: 'tr.err.rate_limited',
    too_long: 'tr.err.too_long',
    Unauthorized: 'tr.err.login',
    http_401: 'tr.err.login',
  };

  function publish(tr: Tr | null) {
    const original = document.getElementById('bl-original');
    if (original) original.style.display = tr ? 'none' : '';
    document.dispatchEvent(
      new CustomEvent('bl:translation', { detail: tr ? { title: tr.title, description: tr.description } : null })
    );
  }

  onDestroy(() => {
    destroyed = true;
    if (shown) publish(null);
  });

  async function toggle() {
    error = null;
    if (phase === 'shown') {
      phase = 'idle';
      shown = null;
      publish(null);
      return;
    }
    if (cache) {
      shown = cache;
      phase = 'shown';
      publish(cache);
      return;
    }
    phase = 'working';
    const lang = pickTargetLang($locale);
    const res = await requestBlogTranslation(slug, lang);
    if (destroyed) return;
    if (!res.ok) {
      phase = 'idle';
      error = $t[(ERR_KEY[res.error] ?? 'tr.err.generic') as keyof typeof $t];
      return;
    }
    cache = { title: res.title, description: res.description, blocks: res.blocks, lang };
    shown = cache;
    phase = 'shown';
    publish(cache);
  }
</script>

<div class="ktr bl-print-hide {controlClass}" style="margin: 12px 0 2px;">
  {#if phase === 'shown'}
    <span class="ktr-label">● {$t['tr.label']}</span>
  {/if}
  <button type="button" class="ktr-btn" style="color: var(--k-rust);" onclick={toggle} disabled={phase === 'working'}>
    {phase === 'working' ? $t['tr.working'] : phase === 'shown' ? $t['tr.original'] : $t['tr.show']}
  </button>
  {#if error}
    <span class="ktr-err" role="status">{error}</span>
  {/if}
</div>

{#if shown}
  <div class={proseClass} lang={shown.lang} data-bl-translation>
    {#each shown.blocks as b, i (i)}
      {#if b.kind === 'ul'}
        <ul>{#each b.items as item, j (j)}<li>{item}</li>{/each}</ul>
      {:else if b.kind === 'ol'}
        <ol>{#each b.items as item, j (j)}<li>{item}</li>{/each}</ol>
      {:else if b.kind === 'h2'}
        <h2>{b.text}</h2>
      {:else if b.kind === 'h3'}
        <h3>{b.text}</h3>
      {:else if b.kind === 'quote'}
        <blockquote><p>{b.text}</p></blockquote>
      {:else}
        <p>{b.text}</p>
      {/if}
    {/each}
  </div>
{/if}
```

- [ ] **Step 3: Header listens**

In `src/components/blog/kiosk/BlogArticleHeader.svelte` add to the `<script lang="ts">` block (after the imports; keep the existing `$props()`):

```ts
  import { onMount } from 'svelte';

  // BlogTranslate.svelte (sibling island) publishes the translated title/standfirst
  // here through a document event — there is no shared store between islands.
  let tr = $state<{ title: string; description: string } | null>(null);
  onMount(() => {
    const onTr = (e: Event) => {
      tr = (e as CustomEvent<{ title: string; description: string } | null>).detail;
    };
    document.addEventListener('bl:translation', onTr);
    return () => document.removeEventListener('bl:translation', onTr);
  });
  const title = $derived(tr?.title ?? post.title);
  const description = $derived(tr?.description ?? post.description);
```

Then replace the FOUR rendered occurrences — `{post.title}` at lines 49 and 89 → `{title}`, `{post.description}` at lines 75 and 94 → `{description}`. Leave every other `post.*` reference (alt texts, meta, tags) untouched. Verify with `grep -n "{post.title}\|{post.description}" src/components/blog/kiosk/BlogArticleHeader.svelte` → no output.

- [ ] **Step 4: The three layouts**

`src/layouts/blog/StandardLayout.astro` — add the import and a computed class, mount the island, id the body:

```astro
import BlogTranslate from '../../components/blog/kiosk/BlogTranslate.svelte';
…
const { meta, related, rank } = Astro.props;
const proseClass = ['bl-prose bl-prose--cols pt-2 pb-4', Astro.props.post.data.lede === false ? 'bl-prose--nolede' : ''].join(' ').trim();
---

<ArticleShell post={meta} related={related}>
  <div slot="header" class="max-w-[940px] mx-auto px-5 lg:px-0 pt-8">
    <BlogArticleHeader client:only="svelte" post={meta} rank={rank} variant="standard" />
  </div>
  <BlogTranslate client:only="svelte" slug={meta.id} proseClass={proseClass} />
  <div id="bl-original" class={proseClass}>
    <slot />
  </div>
</ArticleShell>
```

`src/layouts/blog/HeroLayout.astro` — same shape; the prose is the narrow 720 column, so the control row gets the same width:

```astro
import BlogTranslate from '../../components/blog/kiosk/BlogTranslate.svelte';
…
const proseClass = ['bl-prose bl-prose--hero max-w-[720px] mx-auto pt-2 pb-4', Astro.props.post.data.lede === false ? 'bl-prose--nolede' : ''].join(' ').trim();
---
…
  <BlogTranslate client:only="svelte" slug={meta.id} proseClass={proseClass} controlClass="max-w-[720px] mx-auto" />
  <div id="bl-original" class={proseClass}>
    <slot />
  </div>
```

`src/layouts/blog/GalleryLayout.astro`:

```astro
import BlogTranslate from '../../components/blog/kiosk/BlogTranslate.svelte';
…
const proseClass = ['bl-prose max-w-[940px] mx-auto pt-2 pb-4', post.data.lede === false ? 'bl-prose--nolede' : ''].join(' ').trim();
---
…
  <BlogTranslate client:only="svelte" slug={meta.id} proseClass={proseClass} />
  <div id="bl-original" class={proseClass}>
    <slot />
  </div>
```

(The old `class:list={[…]}` on the prose div is replaced by `class={proseClass}` in all three — same classes, now shared with the island.)

- [ ] **Step 5: Gates**

Run both and paste the raw lines into the report:
- `pnpm type-check 2>&1 | grep -c "error TS"` → `23`
- `npx -y svelte-check@4 2>&1 | grep -oE "COMPLETED .* ERRORS"` → `… 89 ERRORS` (the count must not rise; if the new island adds one, fix the island, never the budget).

- [ ] **Step 6: Browser probe (scratchpad, not committed)**

```js
// scratchpad/blog-translate-probe.cjs — dev :4655, Chromium, navigator.language en.
// Login by redirect-bounce as jonas (password from scratchpad/devpw.txt straight into fill()).
// Screenshots → /mnt/c/Users/atakee/Downloads/blog-translate-{shown,restored}.png
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:4655';
const POST = '/blog/wahl2026-hempel';
const OUT = '/mnt/c/Users/atakee/Downloads';
const pw = fs.readFileSync(__dirname + '/devpw.txt', 'utf8').trim();
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

(async () => {
  const browser = await chromium.launch();
  // ── logged-out: the toggle is there, clicking it asks for login ──
  let ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  let page = await ctx.newPage();
  await page.goto(BASE + POST, { waitUntil: 'networkidle' });
  const btn = page.locator('.ktr-btn');
  check('1 toggle rendered for a logged-out reader', await btn.count() === 1);
  await btn.click();
  await page.waitForSelector('.ktr-err', { timeout: 8000 });
  const err = (await page.locator('.ktr-err').textContent()) || '';
  check('7 logged-out click → login hint', /log in|anmelden/i.test(err), err.trim());
  await ctx.close();

  // ── logged-in ──
  ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  await page.goto(BASE + '/login?redirect=' + encodeURIComponent(POST), { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', 'jonas@mahalle-dev.test');
  await page.fill('input[type="password"]', pw);
  // The login button carries no type="submit" attribute — submit with Enter, as scratchpad/hairline-shot.cjs does.
  await Promise.all([page.waitForURL('**' + POST, { timeout: 15000 }), page.keyboard.press('Enter')]);
  await page.waitForSelector('#bl-original', { timeout: 8000 });
  const origText = (await page.locator('#bl-original').innerText()).trim();
  const origTitle = (await page.locator('h1').first().innerText()).trim();
  check('2 original body visible before toggle', await page.locator('#bl-original').isVisible());

  await page.locator('.ktr-btn').click();
  await page.waitForSelector('[data-bl-translation]', { timeout: 20000 });
  const trText = (await page.locator('[data-bl-translation]').innerText()).trim();
  const trTitle = (await page.locator('h1').first().innerText()).trim();
  check('3 translated body shown, original hidden', trText.length > 200 && !(await page.locator('#bl-original').isVisible()), `${trText.length} chars`);
  check('3b translation is English', /neighbo/i.test(trText) && !/Nachbarinnen/.test(trText));
  check('3c translation carries lang attr', (await page.locator('[data-bl-translation]').getAttribute('lang')) === 'en');
  check('4 header title swapped', trTitle !== origTitle && trTitle.length > 10, trTitle);
  check('4b „Automatisch übersetzt" label + „Show original" button', (await page.locator('.ktr-label').count()) === 1 && /original/i.test((await page.locator('.ktr-btn').textContent()) || ''));
  await page.screenshot({ path: `${OUT}/blog-translate-shown.png`, fullPage: false });

  await page.locator('.ktr-btn').click();
  await page.waitForTimeout(300);
  check('5 toggle back: original visible again, same text', await page.locator('#bl-original').isVisible() && (await page.locator('#bl-original').innerText()).trim() === origText);
  check('5b translated block removed', (await page.locator('[data-bl-translation]').count()) === 0);
  check('6 header title restored', (await page.locator('h1').first().innerText()).trim() === origTitle);
  const st = (await page.locator('#bl-original').getAttribute('style')) || '';
  check('6b inline display cleared (no display rule left on #bl-original)', !/display/.test(st), JSON.stringify(st));
  await page.screenshot({ path: `${OUT}/blog-translate-restored.png`, fullPage: false });

  // ── second toggle is instant (island cache, no request) ──
  let requests = 0;
  page.on('request', (r) => { if (r.url().endsWith('/api/translate')) requests++; });
  await page.locator('.ktr-btn').click();
  await page.waitForSelector('[data-bl-translation]', { timeout: 3000 });
  check('8 re-show uses the island cache (no second request)', requests === 0);

  // ── a second article renders the same contract (regression, standard layout) ──
  await page.goto(BASE + '/blog/das-mahalle-manifest', { waitUntil: 'networkidle' });
  check('9 second article: #bl-original + toggle present', (await page.locator('#bl-original').count()) === 1 && (await page.locator('.ktr-btn').count()) === 1);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
```

Run: `NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/blog-translate-probe.cjs`
(If that `NODE_PATH` does not resolve `playwright`, copy the exact prefix used at the top of `scratchpad/people-row-probe.cjs` or `scratchpad/hairline-shot.cjs`.)
Expected: all PASS.

- [ ] **Step 6b: Build gate for the hero and gallery layouts**

All eleven published posts are `postLayout: "standard"` (checked 2026-09-26), so no browser probe can reach `HeroLayout.astro` / `GalleryLayout.astro`. tsc skips `.astro` files. The production build compiles all three layouts (they are imported by `src/pages/blog/[...slug].astro`):

Run: `pnpm build 2>&1 | tail -5`
Expected: ends in Astro's „Complete!" line with no `error` above it. Paste the tail into the report. (Output goes to the gitignored `.vercel/output`; the running dev server is unaffected.)

- [ ] **Step 7: Look at the screenshot**

Open `/mnt/c/Users/atakee/Downloads/blog-translate-shown.png` with the Read tool: the control row sits between the header and the body, the translated paragraphs run in the newspaper columns, the „● AUTOMATISCH ÜBERSETZT" label and the rust „SHOW ORIGINAL" link are visible, no doubled body. Describe what you see in one sentence in the report.

- [ ] **Step 8: Commit**

```bash
git add src/components/blog/kiosk/BlogTranslate.svelte src/components/blog/kiosk/BlogArticleHeader.svelte src/layouts/blog/StandardLayout.astro src/layouts/blog/HeroLayout.astro src/layouts/blog/GalleryLayout.astro src/lib/kiosk-i18n.ts
git commit -m "blog: „Übersetzung anzeigen" on every article (island above the body, header title swap, login hint)"
```

---

### Task 4: Docs

**Files:**
- Modify: `src/components/blog/CLAUDE.md` — new section before „## Audit record (2026-09-10 …)"
- Modify: `CLAUDE.md` (root) — the `translationCache` bullet under „Database Collections", and one clause in the „### Blog ("Die Beilage")" paragraph

- [ ] **Step 1: Blog area file**

Insert before `## Audit record`:

```markdown
## Übersetzung anzeigen (2026-09-26)

Every article carries the app's translation toggle, like forum posts, events and listings — but posts are repo MDX, not Mongo documents, so the path is its own:

- **Server:** `src/lib/translation/translateBlog.ts` (`translateBlogPost({ slug, targetLang })`) loads the entry via `astro:content` with the detail route's draft gate, splits `entry.body` with the pure `src/lib/blog/markdownBlocks.ts` (`parseBlocks` → `p | h2 | h3 | quote | ul | ol`, inline markdown flattened to words, tested), sends title + description + block texts to DeepL in batches of 50, rebuilds the blocks (`withTexts` throws on a count mismatch → 503) and caches them in `translationCache` as `blog:<slug>:<lang>:<hash>` with a `blocks` array instead of `body`. `POST /api/translate` accepts `contentType: 'blog'` with the slug as `contentId` (`src/schemas/translate.schema.ts` validates slug vs ObjectId per type) and answers `{ title, description, blocks }`; the six Mongo types are untouched. Same 401 for anonymous readers, same `tr:<userId>` 30/h limit.
- **Page:** `BlogTranslate.svelte` is mounted `client:only` from all three layouts ABOVE the body; the body div is `#bl-original`. Shown: the island renders the blocks with the layout's `proseClass` (text interpolation only — no HTML from the network ever reaches the DOM), sets `#bl-original`'s inline `display: none`, and dispatches the document event `bl:translation` `{ title, description } | null`, which `BlogArticleHeader` consumes to swap title and standfirst. Toggling back or `onDestroy` publishes `null`. Logged-out readers get `tr.err.login` (copy draft). Accepted: the sticky `BlogReadBar` keeps the original title; links/emphasis are flat text in the translation.
- Probes (local): `scratchpad/blog-translate-api.mts` (API, 10 checks), `scratchpad/blog-translate-probe.cjs` (browser, screenshots `blog-translate-*.png`).
```

- [ ] **Step 2: Root file**

In the `translationCache` bullet, after „Indexes via `scripts/create-translation-indexes.ts`." add:
```
Blog posts (repo MDX, not Mongo) use the same collection through `src/lib/translation/translateBlog.ts` — key `blog:<slug>:<lang>:<hash>`, a `blocks` array instead of `body` (2026-09-26).
```
In the „### Blog ("Die Beilage")" paragraph, after „Blog posts are repo files, so publishing one is a deploy." add:
```
Since 2026-09-26 every article has the „Übersetzung anzeigen" toggle (section „Übersetzung anzeigen" in the area file).
```

- [ ] **Step 3: Commit**

```bash
git add src/components/blog/CLAUDE.md CLAUDE.md
git commit -m "docs: blog translation toggle (area file section, root pointers)"
```

---

## Self-review record

- **Coverage:** user ask = toggle on blog posts → Task 3 (UI), Task 2 (data), Task 1 (parser), Task 4 (docs). Login-required behaviour, draft gate, cache, error copy all placed.
- **Placeholders:** none; every code step is complete. Hero/gallery layouts have no live post, so Task 3 step 6b gates them with `pnpm build`.
- **Type consistency:** `Block` (Task 1) is the type in `translateBlog.ts`, `client.ts` and the island; `requestBlogTranslation` name matches between Task 2 and Task 3; event name `bl:translation` and id `bl-original` match between island, header and layouts; `proseClass`/`controlClass` prop names match layouts ↔ island.
- **Review Focus → tests:** 1 → probe check 7; 2 → Task 1 `withTexts` throws + Task 2 try-block; 3 → API check 3; 4 → Task 1 `plainInline` test; 5 → probe checks 5/6/6b.
