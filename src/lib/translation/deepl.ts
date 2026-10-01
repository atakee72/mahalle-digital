// src/lib/translation/deepl.ts
// SERVER-ONLY: calls the DeepL REST API. Never import from client code.

const ALLOWED_TARGET_LANGS = [
  'de', 'en', 'tr', 'pl', 'ru', 'uk', 'ar', 'fr', 'es', 'it', 'ro', 'bg', 'el', 'nl', 'pt',
] as const;

const DEEPL_TARGET_MAP: Record<string, string> = {
  en: 'EN-US',
  pt: 'PT-PT',
};

export class DeepLError extends Error {
  code: 'unavailable' | 'quota' | 'bad_lang' | 'upstream';
  constructor(code: DeepLError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** Lowercase primary-subtag → DeepL target code, or null if unsupported. */
export function deeplTargetFor(lang: string): string | null {
  const primary = lang.trim().toLowerCase().split('-')[0];
  if (!(ALLOWED_TARGET_LANGS as readonly string[]).includes(primary)) return null;
  return DEEPL_TARGET_MAP[primary] ?? primary.toUpperCase();
}

export async function translateTexts(
  texts: string[],
  targetLang: string
): Promise<{ texts: string[]; detectedSource: string | null }> {
  const apiKey = import.meta.env.DEEPL_API_KEY;
  if (!apiKey) throw new DeepLError('unavailable', 'DEEPL_API_KEY not configured');

  const target = deeplTargetFor(targetLang);
  if (!target) throw new DeepLError('bad_lang', `Unsupported target language: ${targetLang}`);

  const host = apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(`${host}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: texts, target_lang: target }),
      signal: controller.signal,
    });
  } catch (e) {
    throw new DeepLError('upstream', `DeepL request failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 456) throw new DeepLError('quota', 'DeepL quota exceeded');
  if (res.status === 429) throw new DeepLError('upstream', 'DeepL rate-limited');
  if (!res.ok) throw new DeepLError('upstream', `DeepL HTTP ${res.status}`);

  const data = (await res.json()) as {
    translations?: { detected_source_language?: string; text?: string }[];
  };
  const translations = data.translations ?? [];
  if (translations.length !== texts.length) {
    throw new DeepLError('upstream', `DeepL returned ${translations.length} of ${texts.length} texts`);
  }
  return {
    texts: translations.map((t) => t.text ?? ''),
    detectedSource: translations[0]?.detected_source_language?.toLowerCase() ?? null,
  };
}
