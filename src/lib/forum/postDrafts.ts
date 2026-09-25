// Forum drafts — the rules both the server and the islands need. Dependency-pure
// (no mongodb, no zod): imported by API routes AND by client:only islands.
// Design: docs/superpowers/plans/2026-09-21-forum-server-drafts.md
import type { PostKind } from './postKind';

export const MAX_POST_DRAFTS = 20;

export type PostDraftInput = {
  kind: PostKind;
  title: string;
  body: string;
  tags: string[];
  images: { url: string; publicId: string; width?: number; height?: number }[];
};

/** What the API returns and the islands render. Dates are ISO strings. */
export type PostDraftDTO = PostDraftInput & { id: string; createdAt: string; updatedAt: string };

/** A draft may be unfinished, but there must be SOMETHING to come back to. */
export function draftIsEmpty(d: PostDraftInput): boolean {
  return !d.title.trim() && !d.body.trim() && d.tags.length === 0 && d.images.length === 0;
}

export function draftResumeHref(id: string): string {
  return `/topics/create?draft=${id}`;
}
