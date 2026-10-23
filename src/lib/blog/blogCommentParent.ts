// SERVER-ONLY: resolves the parent of a blog comment (an MDX post, not a Mongo document).
// astro:content is imported dynamically so modules that merely import this file (reviewAction,
// mentionsStore) stay loadable in the node:test runs.
import type { Db } from 'mongodb';
import { pickBlogAuthor, type BlogCommentParent, type BlogPostRef } from './blogCommentRules';

/** Same gate as src/pages/blog/[...slug].astro: drafts are invisible in production. */
export async function findBlogPost(slug: string): Promise<BlogPostRef | null> {
  const { getCollection } = await import('astro:content');
  const posts = await getCollection('blog', ({ data }) => !data.draft || !import.meta.env.PROD);
  const post = posts.find((p) => p.id === slug);
  if (!post) return null;
  return { id: post.id, title: String(post.data.title ?? ''), authorHandle: post.data.authorHandle };
}

/** Live account id for a handle (tombstones never), or null. */
export async function lookupHandleId(db: Db, handle: string): Promise<string | null> {
  const u = await db.collection('users').findOne({ handle, anonymized: { $ne: true } }, { projection: { _id: 1 } });
  return u ? String(u._id) : null;
}

export async function findBlogCommentParent(db: Db, slug: string): Promise<BlogCommentParent | null> {
  const post = await findBlogPost(slug);
  if (!post) return null;
  const postAuthorId = post.authorHandle ? await lookupHandleId(db, post.authorHandle) : null;
  let adminId: string | null = null;
  if (!postAuthorId) {
    const admin = await db.collection('users')
      .findOne({ role: 'admin', anonymized: { $ne: true } }, { projection: { _id: 1 }, sort: { _id: 1 } });
    adminId = admin ? String(admin._id) : null;
  }
  return { collection: 'blog', author: pickBlogAuthor({ postAuthorId, adminId }), title: post.title, slug: post.id };
}
