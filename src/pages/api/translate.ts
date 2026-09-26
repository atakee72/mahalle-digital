import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { translateContent } from '../../lib/translation/translateContent';
import { translateBlogPost } from '../../lib/translation/translateBlog';
import { TranslateRequestSchema } from '../../schemas/translate.schema';
import { consumeRateLimit } from '../../lib/auth/rateLimit';

export const prerender = false;

const TRANSLATE_MAX_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId) return json(401, { error: 'Unauthorized' });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  const parsed = TranslateRequestSchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: 'invalid_request' });

  const rl = await consumeRateLimit(`tr:${userId}`, TRANSLATE_MAX_PER_HOUR, HOUR_MS);
  if (rl.limited) return json(429, { error: 'rate_limited' });

  if (parsed.data.contentType === 'blog') {
    const outcome = await translateBlogPost({ slug: parsed.data.contentId, targetLang: parsed.data.targetLang });
    switch (outcome.status) {
      case 'ok':
        return json(200, {
          title: outcome.title,
          description: outcome.description,
          blocks: outcome.blocks,
          detectedSource: outcome.detectedSource,
          cached: outcome.cached,
        });
      case 'not_found':
        return json(404, { error: 'not_found' });
      case 'bad_lang':
        return json(400, { error: 'invalid_request' });
      case 'too_long':
        return json(422, { error: 'too_long' });
      case 'unavailable':
        return json(503, { error: 'translate_unavailable' });
    }
  }

  const outcome = await translateContent({
    contentType: parsed.data.contentType,
    contentId: parsed.data.contentId,
    targetLang: parsed.data.targetLang,
    userId,
  });
  switch (outcome.status) {
    case 'ok':
      return json(200, {
        title: outcome.title,
        body: outcome.body,
        detectedSource: outcome.detectedSource,
        cached: outcome.cached,
      });
    case 'not_found':
      return json(404, { error: 'not_found' });
    case 'bad_lang':
      return json(400, { error: 'invalid_request' });
    case 'too_long':
      return json(422, { error: 'too_long' });
    case 'unavailable':
      return json(503, { error: 'translate_unavailable' });
  }
};
