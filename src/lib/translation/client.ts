// DEPENDENCY-PURE: imported by Svelte islands. No server imports, ever.
import type { Block } from '../blog/markdownBlocks'; // type-only: the module is dependency-pure anyway

const CLIENT_LANGS = ['de', 'en', 'tr', 'pl', 'ru', 'uk', 'ar', 'fr', 'es', 'it', 'ro', 'bg', 'el', 'nl', 'pt'];

export function pickTargetLang(kioskLocale: string): string {
  try {
    const nav = (navigator.language || '').toLowerCase().split('-')[0];
    if (CLIENT_LANGS.includes(nav)) return nav;
  } catch {
    /* SSR or exotic env */
  }
  return kioskLocale || 'de';
}

/**
 * A link from the English Kiez-Brief carries `?translate=1`: open the translation on load — but
 * only when the target language is not German (a German reader would get a German→German
 * „translation" and burn DeepL quota). Once true, the parameter leaves the address bar
 * (history.state kept: Astro's ClientRouter needs it). Call ONCE per component instance.
 */
export function wantsAutoTranslate(appLocale: string): boolean {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('translate') !== '1') return false;
    if (pickTargetLang(appLocale) === 'de') return false;
    url.searchParams.delete('translate');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    return true;
  } catch {
    return false;
  }
}

export async function requestTranslation(
  contentType: string,
  contentId: string,
  targetLang: string
): Promise<{ ok: true; title: string | null; body: string } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, contentId, targetLang }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as any).error ?? `http_${res.status}` };
    return { ok: true, title: (data as any).title ?? null, body: (data as any).body ?? '' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function requestBlogTranslation(
  slug: string,
  targetLang: string
): Promise<{ ok: true; title: string; description: string; blocks: Block[] } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'blog', contentId: slug, targetLang }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      title?: string;
      description?: string;
      blocks?: Block[];
    };
    if (!res.ok) return { ok: false, error: data.error ?? `http_${res.status}` };
    return { ok: true, title: data.title ?? '', description: data.description ?? '', blocks: Array.isArray(data.blocks) ? data.blocks : [] };
  } catch {
    return { ok: false, error: 'network' };
  }
}
