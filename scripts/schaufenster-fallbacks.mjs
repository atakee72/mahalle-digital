// scripts/schaufenster-fallbacks.mjs
// Turns six phone screenshots (390×844 at 2×, i.e. 780×1688 PNG, taken logged
// in with the verify-e-mail banner hidden) into the landing Schaufenster
// fallback images: top 780×1300 crop → 480×800 WebP. Usage:
//   node scripts/schaufenster-fallbacks.mjs <dir with forum.png calendar.png marketplace.png newsboard.png schillerkiez.png blog.png>
// Re-run after any chrome redesign; the shots themselves are not in the repo.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/schaufenster-fallbacks.mjs <srcDir>'); process.exit(1); }
const out = path.resolve('public/assets/schaufenster');
await mkdir(out, { recursive: true });
for (const key of ['forum', 'calendar', 'marketplace', 'newsboard', 'schillerkiez', 'blog']) {
  const file = path.join(src, `${key}.png`);
  const meta = await sharp(file).metadata();
  const w = meta.width ?? 780;
  const h = Math.min(meta.height ?? 1300, Math.round((w * 5) / 3));
  const info = await sharp(file)
    .extract({ left: 0, top: 0, width: w, height: h })
    .resize(480, 800, { fit: 'cover', position: 'top' })
    .webp({ quality: 78 })
    .toFile(path.join(out, `${key}.webp`));
  console.log(key, info.size, 'bytes');
}
