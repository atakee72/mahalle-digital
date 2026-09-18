/**
 * Comment length limit — dependency-pure on purpose: imported by the zod
 * schema (server) AND by the comment islands (client). Importing it from
 * `comment.schema.ts` instead would pull zod into the island bundles.
 * 1000 → 3000 on 2026-09-18. The server counts JS string length (an emoji = 2).
 */
export const COMMENT_MAX_LEN = 3000;

/** The counter stays hidden until the draft passes this share of the limit. */
export const COMMENT_COUNTER_FROM = 0.8;

export function commentCounterVisible(length: number): boolean {
  return length >= COMMENT_MAX_LEN * COMMENT_COUNTER_FROM;
}
