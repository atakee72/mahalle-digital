// Run: npx tsx --test src/schemas/postImage.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TopicCreateSchema } from './forum.schema';

const base = { title: 'Ein Titel', body: 'Ein Text mit genug Zeichen', tags: [] };
const img = (url: string) => ({ url, publicId: 'mahalle/posts/x' });

test('a Cloudinary image url passes', () => {
  const r = TopicCreateSchema.safeParse({ ...base, images: [img('https://res.cloudinary.com/demo/image/upload/x.jpg')] });
  assert.equal(r.success, true);
});
test('a foreign image host is rejected', () => {
  const r = TopicCreateSchema.safeParse({ ...base, images: [img('https://evil.example/x.jpg')] });
  assert.equal(r.success, false);
});
