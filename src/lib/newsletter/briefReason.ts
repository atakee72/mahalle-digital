/**
 * Why a member's Kiez-Brief is off, for the admin list — and the address-change rule. Pure, NO
 * imports (the admin island imports the type).
 */
export type BriefReason =
  | 'banned' | 'deleting' | 'profile' | 'link' | 'one-click' | 'admin' | 'bounce' | 'complaint';

const VIAS: readonly string[] = ['profile', 'link', 'one-click', 'admin', 'bounce', 'complaint'];

type UserLike = { [k: string]: any } | null | undefined;

export function briefReasonFor(u: UserLike): BriefReason | null {
  if (!u) return null;
  if (u.isBanned === true) return 'banned';
  if (u.deletionScheduledAt) return 'deleting';
  if (u.newsletter !== 'off') return null;
  const via = (u.newsletterOff as { via?: unknown } | null | undefined)?.via;
  return typeof via === 'string' && VIAS.includes(via) ? (via as BriefReason) : null;
}

/** The reason the admin's own toggle leaves behind; banned / deleting stay whatever the toggle. */
export function briefReasonAfterAdminToggle(prev: BriefReason | null, next: 'weekly' | 'off'): BriefReason | null {
  if (prev === 'banned' || prev === 'deleting') return prev;
  return next === 'off' ? 'admin' : null;
}

/** A confirmed new address switches the Kiez-Brief back on only when a bounce had switched it off. */
export function reenableAfterAddressChange(before: unknown): boolean {
  const via = (before as { newsletterOff?: { via?: unknown } } | null | undefined)?.newsletterOff;
  return typeof via === 'object' && via !== null && (via as { via?: unknown }).via === 'bounce';
}

export type OffStamp = { via: string; at: Date };

/**
 * The `newsletterOff` stamp to store when the Kiez-Brief is switched off with `via`.
 * A deliberate opt-out (anything but 'bounce') beats a bounce; a bounce never relabels a
 * deliberate stamp, nor an old opt-out that has no stamp (-> null: write no stamp);
 * the same via again keeps the first stamp (idempotent redelivery).
 */
export function nextOffStamp(prev: UserLike, via: string, at: Date): OffStamp | null {
  const wasOff = !!prev && prev.newsletter === 'off';
  const raw = (prev?.newsletterOff ?? null) as { via?: unknown; at?: unknown } | null;
  const prevVia = wasOff && raw && typeof raw.via === 'string' ? raw.via : null;
  if (!wasOff) return { via, at };
  if (prevVia === null) return via === 'bounce' ? null : { via, at };
  if (prevVia === via) return { via: prevVia, at: raw!.at as Date };
  if (via === 'bounce') return { via: prevVia, at: raw!.at as Date };
  return { via, at };
}
