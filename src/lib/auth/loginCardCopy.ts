/**
 * Link-preview copy for the login page. A shared link to a members-only page
 * lands every crawler on /login?redirect=…, so the preview card is the login
 * page's. For a shared calendar event the card says what is behind the door —
 * WITHOUT any event data (the calendar stays members-only, deliberate
 * 2026-09-18). Dependency-pure apart from the redirect validator.
 */
import { safeInternalPath } from './safeRedirect';

export interface LoginCardCopy {
  title: string;
  description: string;
}

export function loginCardCopy(redirect: string | null | undefined): LoginCardCopy | null {
  const path = safeInternalPath(redirect, '');
  if (!path) return null;
  const u = new URL(path, 'http://mahalle.internal');
  if (u.pathname === '/calendar' && u.searchParams.get('event')) {
    return {
      title: 'Ein Termin im Schillerkiez | Mahalle',
      description:
        'Jemand hat einen Termin aus dem Mahalle-Kalender mit dir geteilt. Melde dich an oder registriere dich kostenlos, um ihn zu sehen.',
    };
  }
  return null;
}
