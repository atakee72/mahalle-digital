// Pure rules for the read-only demo deployment (spec 2026-10-26). No imports.

export const DEMO_ALLOWED_WRITES = ['/api/auth/csrf', '/api/auth/callback/demo', '/api/auth/signout'] as const;
export const DEMO_BLOCKED_READS = ['/api/admin/errors'] as const;
export const DEMO_REFUSAL_BODY = { error: 'demo_read_only' } as const;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** One spelling per path: Astro serves `/api/admin/errors/` and `//api/admin/errors` like the
 *  bare path, so both lists must see repeated slashes collapsed and the trailing slash dropped. */
export function normalizePath(pathname: string): string {
  const p = pathname.replace(/\/{2,}/g, '/');
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

export function dbNameFromUri(uri: string | undefined): string {
  if (!uri) return '';
  try {
    return new URL(uri).pathname.slice(1);
  } catch {
    return '';
  }
}

export function isDemoEnabled(a: { demoMode: string | undefined; dbName: string }): boolean {
  return a.demoMode === '1' && /dev/i.test(a.dbName);
}

export function decideDemoRequest(a: { method: string; pathname: string; demoSession: boolean }): 'allow' | 'refuse' {
  const p = normalizePath(a.pathname);
  if (SAFE_METHODS.has(a.method.toUpperCase())) {
    // Blocked reads match by PREFIX (fail closed on any sub-path); allowed writes match EXACTLY.
    if (a.demoSession && DEMO_BLOCKED_READS.some((b) => p === b || p.startsWith(b + '/'))) return 'refuse';
    return 'allow';
  }
  return (DEMO_ALLOWED_WRITES as readonly string[]).includes(p) ? 'allow' : 'refuse';
}
