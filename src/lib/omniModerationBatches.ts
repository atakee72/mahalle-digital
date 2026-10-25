// Pure helper for the OpenAI moderation call (omni-moderation-latest): the endpoint accepts
// AT MOST ONE image per request ("Number of images (5) exceeds maximum of 1", 2026-10-25 —
// every listing with two or more photos had been failing into the manual queue since August).
// The text rides with the first image; every further image gets a request of its own.

export type OmniInput = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export function batchOmniInputs(inputs: OmniInput[]): OmniInput[][] {
  const texts = inputs.filter((i) => i.type === 'text');
  const images = inputs.filter((i) => i.type === 'image_url');
  if (images.length === 0) return texts.length ? [texts] : [];
  const [first, ...rest] = images;
  return [[...texts, first], ...rest.map((img) => [img])];
}

export type OmniResult = { flagged?: boolean; categories?: Record<string, boolean>; category_scores?: Record<string, number> };

/**
 * One result out of many (several requests × several inputs): the per-category MAXIMUM of the
 * scores and the union of flags, so a category flagged by any single image or by the text can
 * never be lost to another result with a higher score elsewhere. Empty input → null (fail-safe).
 */
export function mergeOmniResults(results: OmniResult[]): Required<OmniResult> | null {
  if (!results.length) return null;
  const categories: Record<string, boolean> = {};
  const category_scores: Record<string, number> = {};
  let flagged = false;
  for (const r of results) {
    flagged = flagged || r.flagged === true;
    for (const [k, v] of Object.entries(r.categories ?? {})) categories[k] = categories[k] === true || v === true;
    for (const [k, v] of Object.entries(r.category_scores ?? {})) if (typeof v === 'number') category_scores[k] = Math.max(category_scores[k] ?? 0, v);
  }
  return { flagged, categories, category_scores };
}
