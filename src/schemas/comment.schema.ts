import { z } from 'zod';
import { ObjectIdSchema } from './forum.schema';

import { COMMENT_MAX_LEN } from '../lib/forum/commentLimits';
import { BLOG_SLUG_RE } from '../lib/blog/blogCommentRules';

// One constant for create + edit (and the comment islands) so they can never drift.
export { COMMENT_MAX_LEN };

const CommentBody = z.string()
  .min(1, 'Comment cannot be empty')
  .max(COMMENT_MAX_LEN, `Comment must be at most ${COMMENT_MAX_LEN} characters`)
  .trim();

// Comment Create Schema — forum/calendar parent (topicId) OR a blog post (blogSlug)
export const CommentCreateSchema = z.union([
  z.object({
    body: CommentBody,
    topicId: ObjectIdSchema,
    collectionType: z.enum(['topics', 'announcements', 'recommendations', 'events'])
  }),
  z.object({
    body: CommentBody,
    blogSlug: z.string().regex(BLOG_SLUG_RE)
  })
]);

// Comment Update Schema
export const CommentUpdateSchema = z.object({
  body: z.string()
    .min(1, 'Comment cannot be empty')
    .max(COMMENT_MAX_LEN, `Comment must be at most ${COMMENT_MAX_LEN} characters`)
    .trim()
});

