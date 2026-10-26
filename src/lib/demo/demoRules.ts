// Pure rules for the read-only demo deployment (spec 2026-10-26). No imports.

export const DEMO_ALLOWED_WRITES = ['/api/auth/csrf', '/api/auth/callback/demo', '/api/auth/signout'] as const;
export const DEMO_BLOCKED_READS = ['/api/admin/errors'] as const;
export const DEMO_REFUSAL_BODY = { error: 'demo_read_only' } as const;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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
  if (SAFE_METHODS.has(a.method.toUpperCase())) {
    if (a.demoSession && (DEMO_BLOCKED_READS as readonly string[]).includes(a.pathname)) return 'refuse';
    return 'allow';
  }
  return (DEMO_ALLOWED_WRITES as readonly string[]).includes(a.pathname) ? 'allow' : 'refuse';
}
