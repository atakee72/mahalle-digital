import type { APIRoute } from 'astro';
import { lookup } from 'node:dns/promises';
import { getSession } from 'auth-astro/server';
import { decodeHtmlEntities } from '../../../utils/decodeHtmlEntities';
import { consumeRateLimit } from '../../../lib/auth/rateLimit';
import {
  checkPreviewUrl,
  clipPreviewText,
  isPrivateAddress,
  safePreviewImage
} from '../../../lib/newsboard/previewUrlGuard';

// Reads title / description / image / site name from a news article a member is
// about to submit (the submit form fills its empty fields from it).
//
// The server fetches an address a member typed, so this is an SSRF surface.
// Hardened 2026-09-21 — before that it fetched ANY valid URL, followed redirects
// blindly and read the whole body:
//   1. https only, default port, no credentials, no IP literals / internal names
//      (pure `checkPreviewUrl`, tested);
//   2. every resolved address must be public (`isPrivateAddress`) — for the first
//      address AND for every redirect hop (redirects are followed by hand, max 3);
//   3. HTML only, first 512 KB only, 8 s budget;
//   4. 30 lookups per member per hour;
//   5. static error codes — nothing about the target leaks back.
// Residual, accepted: DNS could answer differently between our lookup and
// fetch's own (rebinding). Pinning the address needs a custom undici dispatcher;
// on Vercel there is no private network behind the function worth that.

const MAX_HOPS = 3;
const MAX_BYTES = 512 * 1024;
const LIMIT_PER_HOUR = 30;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

async function resolvesPublic(hostname: string): Promise<boolean> {
  try {
    const addrs = await lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/** First MAX_BYTES of the body as text — the meta tags live in <head>. */
async function readHead(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}

export const GET: APIRoute = async ({ url, request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);

    const first = checkPreviewUrl(url.searchParams.get('url') ?? '');
    if (!first.ok) return json({ error: 'url_not_allowed' }, 400);

    const cap = await consumeRateLimit(`newsprev:${session.user.id}`, LIMIT_PER_HOUR, 60 * 60 * 1000);
    if (cap.limited) return json({ error: 'throttled' }, 429);

    const signal = AbortSignal.timeout(8000);
    let target = first.url;
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (!(await resolvesPublic(target.hostname))) return json({ error: 'url_not_allowed' }, 400);
      const res = await fetch(target, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MahalleBot/1.0; +https://mahalle.digital)',
          Accept: 'text/html,application/xhtml+xml'
        },
        signal
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        const next = checkPreviewUrl(new URL(res.headers.get('location') ?? '', target).href);
        if (!next.ok) return json({ error: 'url_not_allowed' }, 400);
        target = next.url;
        continue;
      }
      response = res;
      break;
    }

    if (!response || !response.ok) return json({ error: 'fetch_failed' }, 422);
    const type = response.headers.get('content-type') ?? '';
    if (!/^(text\/html|application\/xhtml\+xml)/i.test(type)) {
      await response.body?.cancel().catch(() => {});
      return json({ error: 'not_html' }, 422);
    }

    const html = await readHead(response);

    // Extract Open Graph and standard meta tags
    const getMetaContent = (property: string): string | undefined => {
      const ogMatch = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'));
      if (ogMatch) return ogMatch[1];
      const nameMatch = html.match(new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, 'i'));
      return nameMatch ? nameMatch[1] : undefined;
    };

    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    const title = getMetaContent('og:title') || getMetaContent('twitter:title') || titleTag;
    const description = getMetaContent('og:description') || getMetaContent('twitter:description') || getMetaContent('description');
    const image = getMetaContent('og:image') || getMetaContent('twitter:image');
    const siteName = getMetaContent('og:site_name') || getMetaContent('application-name');

    // Shared decoder: numeric entities (`&#8222;` „) must not leak onto the newsboard.
    // Lengths match the submit form's field limits.
    return json(
      {
        title: clipPreviewText(decodeHtmlEntities(title), 200),
        description: clipPreviewText(decodeHtmlEntities(description), 1000),
        image: safePreviewImage(decodeHtmlEntities(image), target),
        siteName: clipPreviewText(decodeHtmlEntities(siteName), 100)
      },
      200
    );
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return json({ error: timedOut ? 'timeout' : 'fetch_failed' }, timedOut ? 504 : 422);
  }
};
