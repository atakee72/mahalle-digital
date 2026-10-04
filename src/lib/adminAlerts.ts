// src/lib/adminAlerts.ts — SERVER-ONLY. One-way operational alerts to the
// single admin: Telegram (all kinds) + email mirror (admin-action kinds).
// Contract: never throws, never blocks a user request beyond its 10s cap,
// silent no-op when env is unset (dev + preview deploys stay quiet).
import * as Sentry from '@sentry/astro';
import { isMailerConfigured, sendMail } from './email/mailer';

type AdminAlertKind =
  | 'member_new'
  | 'member_type'
  | 'moderation_flagged'
  | 'report_new'
  | 'content_new'
  | 'comment_new'
  | 'contact_relay'
  | 'sentry_issue'
  | 'kiez_brief';

const EMAIL_KINDS: ReadonlySet<AdminAlertKind> = new Set([
  'member_new',
  'moderation_flagged',
  'report_new',
]);

const ALERT_BASE_URL = 'https://mahalle.digital';
const MOD_QUEUE_URL = `${ALERT_BASE_URL}/admin/moderation`;

function trunc(s: string, n = 80): string {
  // Coerce: builders run OUTSIDE sendAdminAlert's try, so a null/undefined
  // title (e.g. a title-less draft reaching listings/edit) must not throw
  // here and break the caller's request.
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

async function sendAdminAlert(alert: { kind: AdminAlertKind; text: string }): Promise<void> {
  try {
    // Telegram leg first (primary channel).
    const token = import.meta.env.TELEGRAM_BOT_TOKEN;
    const chatId = import.meta.env.TELEGRAM_ADMIN_CHAT_ID;
    if (token && chatId) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: alert.text,
            disable_web_page_preview: true,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          Sentry.captureMessage('admin alert delivery failed', {
            level: 'warning',
            extra: { leg: 'telegram', kind: alert.kind, status: res.status },
          });
          await Sentry.flush(2000);
        }
      } finally {
        clearTimeout(timer);
      }
    }

    // Email mirror — admin-action kinds only.
    const mirrorTo = import.meta.env.ADMIN_ALERT_EMAIL;
    if (mirrorTo && EMAIL_KINDS.has(alert.kind) && isMailerConfigured()) {
      try {
        await sendMail({
          to: mirrorTo,
          subject: `[Mahalle] ${alert.text.split('\n')[0].slice(0, 100)}`,
          html: `<p>${alert.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`,
        });
      } catch (e) {
        Sentry.captureMessage('admin alert delivery failed', {
          level: 'warning',
          extra: { leg: 'email', kind: alert.kind, error: String(e) },
        });
        await Sentry.flush(2000);
      }
    }
  } catch (e) {
    // Belt and suspenders: nothing escapes to the caller.
    Sentry.captureMessage('admin alert delivery failed', {
      level: 'warning',
      extra: { leg: 'outer', kind: alert.kind, error: String(e) },
    });
    await Sentry.flush(2000);
  }
}

// --- Per-kind builders: call sites stay one-liners. Terse German copy. ---

// Tag wording for the alert text — same words the member sees beside a name.
const MEMBER_TYPE_WORD: Record<'organisation' | 'business', string> = {
  organisation: 'Initiative',
  business: 'Gewerbe',
};

export function alertNewMember(p: { name: string; handle: string; memberType?: 'person' | 'organisation' | 'business' }): Promise<void> {
  const typ = p.memberType === 'organisation' || p.memberType === 'business'
    ? ` — als ${MEMBER_TYPE_WORD[p.memberType]}`
    : '';
  return sendAdminAlert({
    kind: 'member_new',
    text: `🆕 Neues Mitglied: ${trunc(p.name)} (@${p.handle})${typ}`,
  });
}

/** A member chose Initiative or Gewerbe in profile edit. Never sent for a change to person. */
export function alertMemberType(p: { name: string; handle: string | null; memberType: 'organisation' | 'business' }): Promise<void> {
  const at = p.handle ? ` (@${p.handle})` : '';
  return sendAdminAlert({
    kind: 'member_type',
    text: `🏷️ ${trunc(p.name)}${at} hat sich als ${MEMBER_TYPE_WORD[p.memberType]} eingetragen\n→ ${ALERT_BASE_URL}/admin/mitglieder`,
  });
}

export function alertModerationFlagged(p: { contentType: string; title: string; authorName?: string | null }): Promise<void> {
  const von = p.authorName ? ` von ${trunc(p.authorName, 40)}` : '';
  return sendAdminAlert({
    kind: 'moderation_flagged',
    text: `🚩 Moderation (${p.contentType}): „${trunc(p.title)}"${von}\n→ ${MOD_QUEUE_URL}`,
  });
}

export function alertReport(p: { contentType: string; title?: string; reason: string }): Promise<void> {
  const titel = p.title ? ` „${trunc(p.title)}"` : '';
  return sendAdminAlert({
    kind: 'report_new',
    text: `⚠️ Meldung (${p.contentType})${titel} — Grund: ${trunc(p.reason, 60)}\n→ ${MOD_QUEUE_URL}`,
  });
}

export function alertContentNew(p: { type: string; title: string; authorName?: string | null; pending: boolean }): Promise<void> {
  const von = p.authorName ? ` von ${trunc(p.authorName, 40)}` : '';
  return sendAdminAlert({
    kind: 'content_new',
    text: `📝 Neu (${p.type}): „${trunc(p.title)}"${von} — ${p.pending ? 'wartet auf Freigabe' : 'live'}`,
  });
}

export function alertComment(p: { authorName?: string | null; parentTitle: string }): Promise<void> {
  const von = p.authorName ? ` von ${trunc(p.authorName, 40)}` : '';
  return sendAdminAlert({
    kind: 'comment_new',
    text: `💬 Kommentar${von} zu „${trunc(p.parentTitle)}"`,
  });
}

export function alertContactRelay(p: { listingTitle: string }): Promise<void> {
  return sendAdminAlert({
    kind: 'contact_relay',
    text: `📬 Marktplatz-Kontakt zu „${trunc(p.listingTitle)}"`,
  });
}

export function alertSentryIssue(p: { title: string; url?: string }): Promise<void> {
  return sendAdminAlert({
    kind: 'sentry_issue',
    text: `🔴 Sentry: ${trunc(p.title, 120)}${p.url ? `\n→ ${p.url}` : ''}`,
  });
}


/** The weekly member mail: what the run did. `test` = the admin's own copy from the preview route. */
export function alertKiezBrief(p: { week: string; outcome: 'sent' | 'quiet' | 'no-recipients' | 'failed' | 'test'; recipients?: number; group?: number; more?: boolean }): Promise<void> {
  const kw = `KW ${Number(p.week.slice(-2))}`;
  const text =
    p.outcome === 'sent'
      ? `✉️ Kiez-Brief ${kw}: Gruppe ${p.group ?? 1} an ${p.recipients ?? 0} Mitglieder verschickt${p.more ? ' — die nächste Gruppe folgt morgen früh' : ''}\n→ ${ALERT_BASE_URL}/kiez-brief/${p.week}`
      : p.outcome === 'test'
        ? `✉️ Kiez-Brief ${kw}: Testausgabe an deine Adresse verschickt`
        : p.outcome === 'quiet'
          ? `✉️ Kiez-Brief ${kw}: ruhige Woche — nichts verschickt`
          : p.outcome === 'no-recipients'
            ? `✉️ Kiez-Brief ${kw}: keine Empfänger — nichts verschickt`
            : `⚠️ Kiez-Brief ${kw}: Versand fehlgeschlagen — Näheres in Sentry`;
  return sendAdminAlert({ kind: 'kiez_brief', text });
}
