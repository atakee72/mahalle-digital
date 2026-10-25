// Pure rules for shrinking photos in the browser before upload (Vercel's 4.5 MB body cap).
// Dependency-pure: imported by islands AND API routes.

export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const SHRINK_PASS_BYTES = 1_000_000;
export const SHRINK_MAX_EDGE = 1600;
export const SHRINK_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ShrinkPlan =
  | { action: 'pass' }
  | { action: 'encode'; width: number; height: number; quality: number };

export function planShrink(
  src: { width: number; height: number; bytes: number; type: string },
  maxEdge: number = SHRINK_MAX_EDGE
): ShrinkPlan {
  const longEdge = Math.max(src.width, src.height);
  const typeOk = (SHRINK_TYPES as readonly string[]).includes(src.type);
  if (src.bytes <= SHRINK_PASS_BYTES && longEdge <= maxEdge && typeOk) return { action: 'pass' };
  const target = Math.min(maxEdge, longEdge);
  const ratio = longEdge > 0 ? target / longEdge : 1;
  return {
    action: 'encode',
    width: Math.max(1, Math.round(src.width * ratio)),
    height: Math.max(1, Math.round(src.height * ratio)),
    quality: 0.85,
  };
}

const LADDER_EDGES = [1600, 1280, 1024];

export function nextAttempt(prev: {
  width: number;
  height: number;
  quality: number;
}): { width: number; height: number; quality: number } | null {
  if (prev.quality > 0.7) return { width: prev.width, height: prev.height, quality: 0.7 };
  const longEdge = Math.max(prev.width, prev.height);
  const next = LADDER_EDGES.find((e) => e < longEdge);
  if (next === undefined || longEdge <= 1024) return null;
  const ratio = next / longEdge;
  return {
    width: Math.max(1, Math.round(prev.width * ratio)),
    height: Math.max(1, Math.round(prev.height * ratio)),
    quality: 0.7,
  };
}

export function uploadFileName(original: string): string {
  const dot = original.lastIndexOf('.');
  const base = dot > 0 ? original.slice(0, dot) : original;
  return `${base}.jpg`;
}
