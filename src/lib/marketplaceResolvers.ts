import { KioskCategorySchema } from '../schemas/listing.schema';

const KIOSK_CATEGORY_KEYS = KioskCategorySchema.options;

// Pure function — no MongoDB, no auth. Safe for both server + client imports.
export function resolveCategory(raw: string | null | undefined) {
  if (!raw) return { key: null, token: null, label: null, legacy: false };
  if (KIOSK_CATEGORY_KEYS.includes(raw as any)) {
    return { key: raw, token: `--cat-${raw}`, label: raw, legacy: false as const };
  }
  // Legacy passthrough — no color, no chip
  return { key: 'legacy' as const, token: '--k-ink-mute', label: raw, legacy: true as const };
}
