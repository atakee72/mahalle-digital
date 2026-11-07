import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { translateContent } from '../../lib/translation/translateContent';
import { translateBlogPost } from '../../lib/translation/translateBlog';
import { TranslateRequestSchema } from '../../schemas/translate.schema';
import { consumeRateLimit, peekRateLimit, hashIp, clientIpFrom } from '../../lib/auth/rateLimit';
import {
  decideTranslateAccess,
  MEMBER_MAX_PER_HOUR,
  VISITOR_IP_MAX_PER_HOUR,
  VISITOR_FRESH_MAX_PER_DAY,
  HOUR_MS,
  DAY_MS,
} from '../../lib/translation/translateAccess';

export const prerender = false;

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const session = await getSession(request);
  const userId = session?.user?.id;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  const parsed = TranslateRequestSchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: 'invalid_request' });

  // Visitors (no session) may translate BLOG posts only — see translateAccess.ts.
  const access = decideTranslateAccess({
    userId,
    contentType: parsed.data.contentType,
    ipHash: hashIp(clientIpFrom(request, clientAddress)),
  });
  if (access.kind === 'refused') return json(401, { error: 'Unauthorized' });

  if (access.kind === 'member') {
    const rl = await consumeRateLimit(access.key, MEMBER_MAX_PER_HOUR, HOUR_MS);
    if (rl.limited) return json(429, { error: 'rate_limited' });
  } else {
    const rl = await consumeRateLimit(access.ipKey, VISITOR_IP_MAX_PER_HOUR, HOUR_MS);
    if (rl.limited) return json(429, { error: 'rate_limited' });
  }

  if (parsed.data.contentType === 'blog') {
    // A visitor gets a fresh DeepL call only while the shared daily budget lasts;
    // cached translations are served either way. The budget is charged after a
    // real miss (a concurrent pair may overshoot by one — accepted).
    const visitor = access.kind === 'visitor';
    const allowFetch = visitor
      ? !(await peekRateLimit(access.freshKey, VISITOR_FRESH_MAX_PER_DAY, DAY_MS)).limited
      : true;
    const outcome = await translateBlogPost({
      slug: parsed.data.contentId,
      targetLang: parsed.data.targetLang,
      allowFetch,
    });
    if (visitor && outcome.status === 'ok' && !outcome.cached) {
      await consumeRateLimit(access.freshKey, VISITOR_FRESH_MAX_PER_DAY, DAY_MS);
    }
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
      case 'budget':
        return json(429, { error: 'rate_limited' });
      case 'unavailable':
        return json(503, { error: 'translate_unavailable' });
    }
  }

  // Only a member reaches this point (visitors were refused above for non-blog types).
  if (!userId) return json(401, { error: 'Unauthorized' });

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
