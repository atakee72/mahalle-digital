// Pure rules for comments under blog articles — no astro:content, no mongodb, so the schema
// (imported by client code) and the unit tests can use it.
export const BLOG_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$/;

export interface BlogPostRef { id: string; title: string; authorHandle?: string }
export interface BlogCommentParent { collection: 'blog'; author: string | null; title: string; slug: string }

/** Picks the notification recipient: the post's member author (by handle, live account only) or the admin, else null. */
export function pickBlogAuthor(args: { postAuthorId: string | null; adminId: string | null }): string | null {
  return args.postAuthorId ?? args.adminId ?? null;
}
