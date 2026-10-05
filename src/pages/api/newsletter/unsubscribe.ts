import type { APIRoute } from 'astro';
import { setOwnNewsletterMode } from '../../../lib/newsletter/preference';
import { unsubSecret, verifyUnsubToken } from '../../../lib/newsletter/unsubToken';
import { clientIpFrom, consumeRateLimit, hashIp } from '../../../lib/auth/rateLimit';

// RFC 8058 one-click unsubscribe: Gmail/Yahoo POST here from their own „Abbestellen" button
// (body `List-Unsubscribe=One-Click`). The token is the secret; the IP limit only blunts scanning.
// Answers 200 with no body on success, 400 on a bad token — never a page, never a redirect.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ip = clientIpFrom(request, clientAddress);
  const limit = await consumeRateLimit(`unsub:${hashIp(ip)}`, 60, 60 * 60 * 1000).catch(() => ({ limited: false }));
  if (limit.limited) return new Response(null, { status: 429 });

  const token = new URL(request.url).searchParams.get('t');
  const userId = verifyUnsubToken(token, unsubSecret());
  if (!userId) return new Response(null, { status: 400 });

  await setOwnNewsletterMode(userId, 'off', 'one-click');
  return new Response(null, { status: 200 });
};
