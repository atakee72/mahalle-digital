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

export function shortTextVerdict(results: readonly VerdictInput[]): 'clean' | 'refused' {
  for (const result of results) {
    if (isFailSafeResult(result)) continue;
    if (result.decision !== 'approved') return 'refused';
  }
  return 'clean';
}
