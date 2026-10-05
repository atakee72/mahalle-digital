// src/lib/newsletter/preference.ts — SERVER-ONLY. The one writer of a member's OWN Kiez-Brief
// choice (profile switch, unsubscribe page, one-click route) and the admin's Telegram ping about it.
// The admin's pill on /admin/mitglieder writes the same field through its own route and stays silent.
import { ObjectId } from 'mongodb';
import { connectDB } from '../mongodb';
import { consumeRateLimit } from '../auth/rateLimit';
import { alertKiezBriefChoice } from '../adminAlerts';
import { newsletterChange, type NewsletterMode, type NewsletterVia } from './kiezBriefRules';

export async function setOwnNewsletterMode(userId: string, mode: NewsletterMode, via: NewsletterVia): Promise<void> {
  const db = await connectDB();
  // The document BEFORE the write tells a real change from a repeated click (atomic per member,
  // so two simultaneous requests cannot both count as the change).
  const before = await db.collection('users').findOneAndUpdate(
    { _id: new ObjectId(userId) },
    mode === 'weekly' ? { $unset: { newsletter: '' } } : { $set: { newsletter: mode } },
    { returnDocument: 'before', projection: { name: 1, handle: 1, newsletter: 1, role: 1, anonymized: 1 } },
  );
  if (!before || before.role === 'admin' || before.anonymized === true) return;
  const change = newsletterChange(before.newsletter, mode);
  if (!change) return;
  // At most 5 pings an hour per member: the switch itself is never refused, the admin's Telegram
  // must not be floodable by toggling it. (A bucket failure only skips the ping.)
  const ping = await consumeRateLimit(`briefpref:${userId}`, 5, 60 * 60 * 1000).catch(() => ({ limited: true }));
  if (ping.limited) return;
  await alertKiezBriefChoice({
    name: String(before.name ?? ''),
    handle: typeof before.handle === 'string' ? before.handle : null,
    change,
    via,
  });
}
