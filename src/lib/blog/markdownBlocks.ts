// DEPENDENCY-PURE: imported by the server-only translateBlog.ts AND (type-only) by
// Svelte islands. No node/astro imports, ever.
//
// Splits a blog post's raw markdown (astro:content `entry.body`, frontmatter already
// stripped) into typed text blocks so each block's PLAIN text can go to DeepL and
// come back into the same shape. Inline markdown is flattened to words on purpose:
// the translated view is a reading aid, the original with its links is one click away.
// Not reused: src/lib/search/siteSearch.ts `plainMdx()` — it flattens the WHOLE body
// to one string for search and loses the paragraph/heading/list structure needed here.

/** One picture of a guide post's step group. `src` is always one of our own files under /assets/. */
export type Pic = { src: string; alt: string; width?: number; height?: number };

export type Block =
  | { kind: 'p' | 'h2' | 'h3' | 'quote'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  // `<div class="bl-steps">` with plain <img> tags: kept in its place so the translated view shows
  // the pictures too. Only the alt texts are translated.
  | { kind: 'pics'; wide: boolean; pics: Pic[] };

/** title + description + every block text, in characters. Posts today are 1.8–3k. */
export const BLOG_TRANSLATE_MAX_CHARS = 12000;

export function plainInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // image → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // link → link text
    .replace(/(?<![\p{L}\p{N}])(\*\*|__)(?=\S)(.+?)(?<=\S)\1(?![\p{L}\p{N}])/gu, '$2') // bold: markers must not sit inside a word
    .replace(/(?<![\p{L}\p{N}*])\*(?=\S)(.+?)(?<=\S)\*(?![\p{L}\p{N}*])/gu, '$1') // italic *
    .replace(/(?<![\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, '$1') // italic _
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '') // stray inline html
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const OWN_PICTURE = /^\/assets\/[A-Za-z0-9_\-./]+\.(svg|png|jpe?g|webp|avif)$/;

/** The <img> tags of one line of a `bl-steps` group; anything that is not our own file is skipped. */
function picsIn(line: string): Pic[] {
  const out: Pic[] = [];
  for (const tag of line.match(/<img\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag)?.[1];
    const src = attr('src') ?? '';
    if (!OWN_PICTURE.test(src) || src.includes('..')) continue;
    const size = (v: string | undefined) => (v && /^\d{1,5}$/.test(v) ? Number(v) : undefined);
    const pic: Pic = { src, alt: (attr('alt') ?? '').trim() };
    const width = size(attr('width'));
    const height = size(attr('height'));
    if (width) pic.width = width;
    if (height) pic.height = height;
    out.push(pic);
  }
  return out;
}

export function parseBlocks(md: string): Block[] {
  const out: Block[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let quote: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  let steps: { wide: boolean; pics: Pic[] } | null = null;

  const flushSteps = () => {
    if (steps?.pics.length) out.push({ kind: 'pics', wide: steps.wide, pics: steps.pics });
    steps = null;
  };
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
    if (steps) {
      // inside a picture group: only its <img> tags count, `</div>` ends it
      if (/^\s*<\/div>\s*$/.test(line)) flushSteps();
      else steps.pics.push(...picsIn(line));
      continue;
    }
    const group = /^<div\s+class="([^"]*)"\s*>\s*$/.exec(line.trim());
    if (group && /(^|\s)bl-steps(\s|$)/.test(group[1])) {
      flushAll();
      steps = { wide: /(^|\s)bl-steps--wide(\s|$)/.test(group[1]), pics: [] };
      continue;
    }
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
  flushSteps(); // a group the file never closed still shows its pictures
  return out;
}

export function blockTexts(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === 'pics') out.push(...b.pics.map((p) => p.alt).filter(Boolean)); // never send '' to DeepL
    else if ('items' in b) out.push(...b.items);
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
  const out = blocks.map((b): Block => {
    if (b.kind === 'pics') return { ...b, pics: b.pics.map((p) => (p.alt ? { ...p, alt: next() } : p)) };
    return 'items' in b ? { kind: b.kind, items: b.items.map(() => next()) } : { kind: b.kind, text: next() };
  });
  if (i !== texts.length) throw new Error('withTexts: too many texts');
  return out;
}
