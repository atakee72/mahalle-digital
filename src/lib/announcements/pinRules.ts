// Dependency-pure pin rules shared by the admin island (optimistic UI)
// and the server helper. No mongodb/connectDB imports here — this file
// is bundled into a client:only="svelte" island.

export const MAX_PINS = 3;

interface Pinnable {
  _id?: unknown;
  pinnedUntil?: string | Date | null;
}

/** True when the item currently holds a pin. */
function isCurrentlyPinned(item: Pinnable, now = Date.now()): boolean {
  return !!item.pinnedUntil && new Date(item.pinnedUntil).getTime() > now;
}

/**
 * Given the items that are currently pinned, return the ONE item that must
 * lose its pin so a new pin fits under MAX_PINS — or null if there's room.
 * The oldest pin (earliest pinnedUntil) goes. `excludeId` is the item being
 * (re-)pinned; it never displaces itself.
 */
export function pickDisplaced<T extends Pinnable>(pinned: T[], excludeId?: string): T | null {
  const candidates = pinned
    .filter((it) => isCurrentlyPinned(it))
    .filter((it) => String(it._id) !== excludeId);
  if (candidates.length < MAX_PINS) return null;
  return candidates
    .slice()
    .sort((a, b) => new Date(a.pinnedUntil!).getTime() - new Date(b.pinnedUntil!).getTime())[0];
}
