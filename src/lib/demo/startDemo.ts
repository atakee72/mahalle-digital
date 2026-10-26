// BROWSER. Starts a demo session (spec 2026-10-26). Does what auth-astro's signIn('credentials')
// does, for the provider id `demo` (auth-astro routes only the literal 'credentials' to
// /callback/): csrf token, then POST /api/auth/callback/demo. Auth.js reports a failed
// authorize NOT as a status code but as ?error=... on the returned url.
import { safeInternalPath } from '../auth/safeRedirect';

export async function startDemo(role: 'member' | 'admin', redirect?: string | null): Promise<boolean> {
  try {
    const csrfRes = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    if (!csrfRes.ok) return false;
    const { csrfToken } = (await csrfRes.json()) as { csrfToken?: string };
    if (!csrfToken) return false;

    const res = await fetch('/api/auth/callback/demo', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1' },
      body: new URLSearchParams({ csrfToken, role, callbackUrl: location.origin + '/', json: 'true' }),
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { url?: string } | null;
    if (data?.url) {
      const err = new URL(data.url, location.origin).searchParams.get('error');
      if (err) return false;
    }
    const target = role === 'admin' ? '/admin/moderation' : safeInternalPath(redirect, '/forum');
    location.assign(target);
    return true;
  } catch {
    return false;
  }
}
