// Run: npx tsx --test src/lib/mentions/activeMembers.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findActiveMemberIds, activeSince, ACTIVE_WINDOW_DAYS } from './activeMembers';

const NOW = new Date('2026-09-22T00:00:00Z');
const since = activeSince(NOW);
const old = new Date('2026-05-01T00:00:00Z');
const fresh = new Date('2026-09-01T00:00:00Z');

// Minimal fake: each collection answers find(filter, {projection}).toArray() by
// applying only the operators this module uses ($gte, $ne, $in, $or).
function fakeDb(data: Record<string, any[]>) {
  const matches = (doc: any, f: any): boolean => Object.entries(f).every(([k, v]: [string, any]) => {
    if (k === '$or') return v.some((sub: any) => matches(doc, sub));
    const val = doc[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$gte' in v) return val !== undefined && val !== null && (typeof val === 'string' ? val >= String(v.$gte instanceof Date ? v.$gte.toISOString() : v.$gte) : new Date(val) >= new Date(v.$gte));
      if ('$ne' in v) return val !== v.$ne;
      if ('$in' in v) return v.$in.map(String).includes(String(val));
    }
    return val === v;
  });
  return { collection: (name: string) => ({ find: (f: any) => ({ toArray: async () => (data[name] ?? []).filter((d) => matches(d, f)) }) }) } as any;
}

test('activeSince is 90 days before now', () => {
  assert.equal(Math.round((NOW.getTime() - since.getTime()) / 86400000), ACTIVE_WINDOW_DAYS);
});

test('every activity signal counts, tombstones never, silent old accounts never', async () => {
  const db = fakeDb({
    users: [
      { _id: 'u_seen', lastSeenAt: fresh },
      { _id: 'u_new_iso', createdAt: '2026-09-10T10:00:00.000Z' },
      { _id: 'u_new_date', createdAt: fresh },
      { _id: 'u_author', createdAt: old },
      { _id: 'u_reader', createdAt: old },
      { _id: 'u_push', createdAt: old },
      { _id: 'u_silent', createdAt: '2026-01-01T00:00:00.000Z' },
      { _id: 'u_tomb', lastSeenAt: fresh, anonymized: true },
    ],
    comments: [{ author: 'u_author', createdAt: fresh }],
    notifications: [{ userId: 'u_reader', readAt: fresh }],
    pushSubscriptions: [{ userId: 'u_push', updatedAt: fresh }],
  });
  const ids = (await findActiveMemberIds(db, since)).sort();
  assert.deepEqual(ids, ['u_author', 'u_new_date', 'u_new_iso', 'u_push', 'u_reader', 'u_seen']);
});
