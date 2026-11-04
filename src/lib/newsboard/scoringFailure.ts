// Pure: names WHY the GPT scoring of the daily news fetch failed, for the Sentry event's `extra`.
// The event message stays static (one issue, not one per error string); only this short class varies.
export function scoringFailureReason(err: unknown): string {
  if (err instanceof SyntaxError) return 'json parse';
  if (err && typeof err === 'object' && 'name' in err) {
    const name = String((err as { name: unknown }).name);
    if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
    return name || 'Error';
  }
  return 'unknown';
}
