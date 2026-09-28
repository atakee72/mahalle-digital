/**
 * Inject `f_auto,q_auto` into a Cloudinary delivery URL so the browser
 * receives WebP/AVIF (when supported) at an auto-picked quality. No-op for
 * non-Cloudinary URLs or URLs that already carry f_auto/q_auto.
 *
 * Cloudinary URL shape:
 *   https://res.cloudinary.com/<cloud>/image/upload/<transforms>/<public_id>.<ext>
 */
export function optimizeCloudinary(url: string | undefined | null): string {
  if (!url) return '';
  if (!url.includes('res.cloudinary.com')) return url;
  // Already optimized — skip
  if (/\/upload\/[^/]*(f_auto|q_auto)/.test(url)) return url;
  return url.replace('/upload/', '/upload/f_auto,q_auto/');
}

/**
 * Like optimizeCloudinary, plus a width-fill so a card never downloads the
 * original. Strips an existing `f_auto,q_auto` segment first so the call is
 * idempotent. Landing „Schaufenster" listing photo (2026-09-28).
 */
export function cloudinaryFit(url: string | undefined | null, width: number): string {
  if (!url) return '';
  if (!url.includes('res.cloudinary.com')) return url;
  const w = Math.max(1, Math.round(width));
  const bare = url.replace(/\/upload\/f_auto,q_auto(?:,w_\d+,c_fill)?\//, '/upload/');
  return bare.replace('/upload/', `/upload/f_auto,q_auto,w_${w},c_fill/`);
}
