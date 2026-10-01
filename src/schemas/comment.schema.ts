import { z } from 'zod';
import { ObjectIdSchema } from './forum.schema';

import { COMMENT_MAX_LEN } from '../lib/forum/commentLimits';

// One constant for create + edit (and the comment islands) so they can never drift.
export { COMMENT_MAX_LEN };

// Comment Create Schema
export const CommentCreateSchema = z.object({
  body: z.string()
    .min(1, 'Comment cannot be empty')
    .max(COMMENT_MAX_LEN, `Comment must be at most ${COMMENT_MAX_LEN} characters`)
    .trim(),
  topicId: ObjectIdSchema,
  collectionType: z.enum(['topics', 'announcements', 'recommendations', 'events'])
});

// Comment Update Schema
export const CommentUpdateSchema = z.object({
  body: z.string()
    .min(1, 'Comment cannot be empty')
    .max(COMMENT_MAX_LEN, `Comment must be at most ${COMMENT_MAX_LEN} characters`)
    .trim()
});

