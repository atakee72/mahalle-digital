/**
 * Resend webhook events → what to do with the Kiez-Brief. Pure, NO imports.
 * Only a Permanent bounce and a spam complaint switch a member's Kiez-Brief off.
 */
export type BounceAction =
  | { kind: 'bounce'; addresses: string[]; type: string; subType: string; at: Date }
  | { kind: 'complaint'; addresses: string[] }
  | { kind: 'ignore'; why: string };

function addressesOf(to: unknown): string[] {
  if (!Array.isArray(to)) return [];
  const out = new Set<string>();
  for (const v of to) {
    if (typeof v !== 'string') continue;
    const a = v.trim().toLowerCase();
    if (a) out.add(a);
  }
  return [...out];
}

export function decideBounceEvent(body: unknown): BounceAction {
  if (!body || typeof body !== 'object') return { kind: 'ignore', why: 'malformed' };
  const ev = body as { type?: unknown; created_at?: unknown; data?: { to?: unknown; bounce?: { type?: unknown; subType?: unknown } } };
  const addresses = addressesOf(ev.data?.to);
  if (ev.type === 'email.bounced') {
    if (ev.data?.bounce?.type !== 'Permanent') return { kind: 'ignore', why: 'not permanent' };
    if (!addresses.length) return { kind: 'ignore', why: 'no address' };
    const parsed = typeof ev.created_at === 'string' ? new Date(ev.created_at) : new Date(NaN);
    const subType = ev.data.bounce.subType;
    return {
      kind: 'bounce',
      addresses,
      type: 'Permanent',
      subType: typeof subType === 'string' ? subType : '',
      at: isNaN(+parsed) ? new Date() : parsed,
    };
  }
  if (ev.type === 'email.complained') {
    if (!addresses.length) return { kind: 'ignore', why: 'no address' };
    return { kind: 'complaint', addresses };
  }
  return { kind: 'ignore', why: 'other event' };
}
