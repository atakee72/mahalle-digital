// DEPENDENCY-PURE: imported by the server-only deepl.ts AND by client.ts (Svelte islands).
// No node/astro imports, ever.
//
// Every target language DeepL offers, as lowercase primary subtags — fetched from
// `GET /v2/languages?type=target` on 2026-10-13 (111 codes, 101 languages once the
// regional variants fold into their primary). The landing page promises „spricht 30+
// Sprachen"; until this day the list held 15 picked by hand. Refresh recipe (the key stays
// in the process, never print it):
//   node --env-file=.env -e 'const k=process.env.DEEPL_API_KEY;const h=k.endsWith(":fx")?"api-free.deepl.com":"api.deepl.com";fetch(`https://${h}/v2/languages?type=target`,{headers:{Authorization:"DeepL-Auth-Key "+k}}).then(r=>r.json()).then(d=>console.log(d.map(x=>x.language).join(" ")))'
export const TARGET_LANGS = [
  'af', 'an', 'ar', 'as', 'ay', 'az', 'ba', 'be', 'bg', 'bn', 'br', 'bs', 'ca', 'cs', 'cy', 'da',
  'de', 'el', 'en', 'eo', 'es', 'et', 'eu', 'fa', 'fi', 'fr', 'ga', 'gl', 'gn', 'gu', 'ha', 'he',
  'hi', 'hr', 'ht', 'hu', 'hy', 'id', 'ig', 'is', 'it', 'ja', 'jv', 'ka', 'kk', 'ko', 'ky', 'la',
  'lb', 'ln', 'lt', 'lv', 'mg', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'nb', 'ne', 'nl',
  'oc', 'om', 'pa', 'pl', 'ps', 'pt', 'qu', 'ro', 'ru', 'sa', 'sk', 'sl', 'sq', 'sr', 'st', 'su',
  'sv', 'sw', 'ta', 'te', 'tg', 'th', 'tk', 'tl', 'tn', 'tr', 'ts', 'tt', 'uk', 'ur', 'uz', 'vi',
  'wo', 'xh', 'yi', 'zh', 'zu',
] as const;

/** Primary subtags DeepL offers only as regional variants → the variant we send. */
const REGIONAL_DEFAULT: Record<string, string> = {
  en: 'EN-US',
  pt: 'PT-PT',
};

/** Lowercase primary subtag of a BCP 47 tag ('tr-TR' → 'tr'). */
export function primaryLang(tag: string): string {
  return tag.trim().toLowerCase().split('-')[0];
}

/** Lowercase primary-subtag → DeepL target code, or null if DeepL does not offer the language. */
export function deeplTargetFor(lang: string): string | null {
  const primary = primaryLang(lang);
  if (!(TARGET_LANGS as readonly string[]).includes(primary)) return null;
  return REGIONAL_DEFAULT[primary] ?? primary.toUpperCase();
}
