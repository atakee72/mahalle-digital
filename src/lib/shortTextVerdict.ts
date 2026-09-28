/**
 * Verdict for short public-text fields (display name, profile motto) from the
 * OpenAI safety-net results. Dependency-pure on purpose: testable without
 * OpenAI, Sentry or `import.meta.env`.
 *
 * Why this exists (2026-09-18): `moderateText()` / `checkSpamWithGPT()` never
 * throw. On an API error, timeout or 429 they RETURN the fail-safe result
 * (`decision: 'pending_review'`, `flaggedCategories: ['moderation_error']`).
 * That is right for a post — it can wait in the queue — but a name has no
 * queue: the old `decision !== 'approved'` test refused EVERY signup with
 * "Name contains inappropriate content" for the length of an OpenAI outage.
 * The three blocklists have already run by the time these results exist, so an
 * absent judge is not a no.
 *
 * Same reasoning covers an advert label (2026-09-18 → widened 2026-09-28): GPT
 * has no business-name category and labels a place-plus-product display name
 * (e.g. "Berlin Cigkofte") `spam_check:ad_promotional` — for a short public
 * text with no review queue that is a shop registering under its own name,
 * not spam. `TOLERATED` below is deliberately narrow: it never covers a real
 * abuse category (spam, scam, hate, harassment), only the two harmless shapes.
 */
export interface VerdictInput {
  decision: string;
  flaggedCategories: readonly string[];
}

/** True only for the pure fail-safe shape — a real category alongside it is a real flag. */
export function isFailSafeResult(result: VerdictInput): boolean {
  return (
    result.flaggedCategories.length > 0 &&
    result.flaggedCategories.every((c) => c === 'moderation_error')
  );
}

/** Categories a short public text (name, motto) may carry without being refused: an absent judge, and an
 *  „advert" label — a business registering under its own name is normal here (2026-09-28: „Berlin Cigkofte"). */
const TOLERATED = new Set(['moderation_error', 'spam_check:ad_promotional']);

/** True when every flagged category is tolerated for a short public text (fail-safe shape included). */
export function isToleratedResult(result: VerdictInput): boolean {
  return result.flaggedCategories.length > 0 && result.flaggedCategories.every((c) => TOLERATED.has(c));
}

export function shortTextVerdict(results: readonly VerdictInput[]): 'clean' | 'refused' {
  for (const result of results) {
    if (isToleratedResult(result)) continue;
    if (result.decision !== 'approved') return 'refused';
  }
  return 'clean';
}
