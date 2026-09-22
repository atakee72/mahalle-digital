/**
 * Web-push sender. SERVER-ONLY (imports connectDB + web-push).
 *
 * NEVER-THROW by contract, same as src/lib/notifications.ts: a failed push
 * must never fail the parent request. Dead subscriptions (404/410 from the
 * push service) are pruned on send. With VAPID env unset (preview deploys,
 * fresh dev), every send is a silent no-op — the in-app center is the
 * canonical channel; push is best-effort garnish.
 *
 * Payload copy is GERMAN ONLY: the DE/EN toggle is client-side localStorage,
 * invisible to the server. Accepted limitation (site default lang="de").
 * No actor names in push copy — notify() never knows them (read-time join);
 * the panel row carries the full story after tap-through.
 */
import webpush from 'web-push';
import * as Sentry from '@sentry/astro';
import { connectDB } from './mongodb';
import type { NotificationMeta, NotificationTarget, NotificationType } from '../types/notification';

export interface PushPayload {
  title: string;
  body: string;
  href: string;
}

interface SubDoc {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userId: string;
}

let configured = false;
function ensureConfigured(): boolean {
  const pub = import.meta.env.PUBLIC_VAPID_PUBLIC_KEY;
  const priv = import.meta.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!configured) {
    webpush.setVapidDetails('mailto:admin@mahalle.digital', pub, priv);
    configured = true;
  }
  return true;
}

export function buildPushPayload(
  type: NotificationType,
  target: NotificationTarget,
  meta?: NotificationMeta,
): PushPayload {
  const title = 'Mahalle';
  const href = target.href || '/forum';
  const t = target.title;
  let body: string;
  switch (type) {
    case 'comment':
      // \u201A / \u2018 = German single quotes — written as escape
      // sequences so no editor/tool Unicode normalization can corrupt them.
      body = `Neue Antwort auf \u201A${t}\u2018`;
      break;
    case 'official':
      body = `Amtliche Mitteilung: ${t}`;
      break;
    case 'market_contact':
      body = `Neue Anfrage zu deinem Angebot \u201A${t}\u2018`;
      break;
    case 'mention':
      body = meta?.contentKind === 'comment'
        ? `Du wurdest in einem Kommentar erw\u00e4hnt: \u201a${t}\u2018`
        : `Du wurdest erw\u00e4hnt: \u201a${t}\u2018`;
      break;
    case 'admin_hint':
      body = meta?.contentKind === 'comment'
        ? `Admin-Hinweis in einem Kommentar zu \u201a${t}\u2018`
        : `Admin-Hinweis zu \u201a${t}\u2018`;
      break;
    case 'moderation': {
      const noun = meta?.contentKind === 'comment' ? 'Kommentar' : 'Beitrag';
      if (meta?.outcome === 'rejected') body = `Dein ${noun} wurde abgelehnt — Details in deinem Profil`;
      else if (meta?.outcome === 'warned') body = `Dein ${noun} ist veröffentlicht — mit Hinweis`;
      else body = `Dein ${noun} ist veröffentlicht`;
      break;
    }
    default:
      body = t;
  }
  return { title, body, href };
}

async function sendToSubs(db: Awaited<ReturnType<typeof connectDB>>, subs: SubDoc[], payload: PushPayload): Promise<void> {
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((s) =>
      // timeout is load-bearing: without it web-push registers no socket
      // timeout, and an endpoint that accepts the connection but never
      // responds would hang the awaited send past the never-throw envelope
      // (Promise.allSettled never settles) until Vercel kills the function.
      webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, {
        TTL: 3600,
        timeout: 10000,
      }),
    ),
  );
  const dead: string[] = [];
  let capturedAny = false;
  results.forEach((r, i) => {
    if (r.status !== 'rejected') return;
    const code = (r.reason as { statusCode?: number } | undefined)?.statusCode;
    if (code === 404 || code === 410) {
      dead.push(subs[i].endpoint);
    } else {
      Sentry.captureException(r.reason);
      capturedAny = true;
    }
  });
  if (dead.length) {
    await db.collection('pushSubscriptions').deleteMany({ endpoint: { $in: dead } });
  }
  if (capturedAny) await Sentry.flush(2000);
}

/** Push to specific recipients. Never throws. */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  try {
    if (!ensureConfigured() || !userIds.length) return;
    const db = await connectDB();
    const subs = (await db
      .collection('pushSubscriptions')
      .find({ userId: { $in: userIds } })
      .toArray()) as unknown as SubDoc[];
    await sendToSubs(db, subs, payload);
  } catch (err) {
    console.error('[push] send failed:', err);
    try {
      Sentry.captureException(err);
      await Sentry.flush(2000);
    } catch {
      /* best-effort */
    }
  }
}

/** Broadcast push (official announcements). Never throws. */
export async function sendPushToAllExcept(
  exceptUserId: string | undefined,
  payload: PushPayload,
): Promise<void> {
  try {
    if (!ensureConfigured()) return;
    const db = await connectDB();
    const filter = exceptUserId ? { userId: { $ne: exceptUserId } } : {};
    const subs = (await db.collection('pushSubscriptions').find(filter).toArray()) as unknown as SubDoc[];
    await sendToSubs(db, subs, payload);
  } catch (err) {
    console.error('[push] broadcast failed:', err);
    try {
      Sentry.captureException(err);
      await Sentry.flush(2000);
    } catch {
      /* best-effort */
    }
  }
}
