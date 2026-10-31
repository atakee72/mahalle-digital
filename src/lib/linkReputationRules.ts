// Pure rules for the Google Safe Browsing link check (no I/O, no env).
// The server module linkReputation.ts does the request; this file only builds
// the request body and reads the answer.
//
// hitsFromLookup deliberately has NO "only URLs we sent" filter: Google may
// echo a canonicalised form of a URL, and an exact-string filter would
// silently drop real hits. Google only ever answers for what was sent.

export const MAX_URLS_PER_CHECK = 50;
export const LOOKUP_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
export const THREAT_TYPES = [
  'MALWARE',
  'SOCIAL_ENGINEERING',
  'UNWANTED_SOFTWARE',
  'POTENTIALLY_HARMFUL_APPLICATION',
] as const;

export interface LookupBody {
  client: { clientId: string; clientVersion: string };
  threatInfo: {
    threatTypes: readonly string[];
    platformTypes: readonly string[];
    threatEntryTypes: readonly string[];
    threatEntries: { url: string }[];
  };
}

export interface LinkHit {
  url: string;
  threatType: string;
}

export function buildLookupBody(urls: string[]): LookupBody {
  return {
    client: { clientId: 'mahalle-digital', clientVersion: '1.0.0' },
    threatInfo: {
      threatTypes: THREAT_TYPES,
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: urls.slice(0, MAX_URLS_PER_CHECK).map((url) => ({ url })),
    },
  };
}

export function hitsFromLookup(json: unknown): LinkHit[] {
  if (typeof json !== 'object' || json === null) return [];
  const matches = (json as { matches?: unknown }).matches;
  if (!Array.isArray(matches)) return [];
  const hits = new Map<string, string>();
  for (const m of matches) {
    if (typeof m !== 'object' || m === null) continue;
    const { threatType, threat } = m as { threatType?: unknown; threat?: unknown };
    const url = typeof threat === 'object' && threat !== null ? (threat as { url?: unknown }).url : undefined;
    if (typeof url !== 'string' || !url || typeof threatType !== 'string' || !threatType) continue;
    if (!hits.has(url)) hits.set(url, threatType);
  }
  return [...hits].map(([url, threatType]) => ({ url, threatType }));
}
