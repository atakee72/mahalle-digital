// scripts/backfill-post-image-dimensions.ts
// Run: pnpm tsx scripts/backfill-post-image-dimensions.ts            (DRY RUN, dev db)
//      pnpm tsx scripts/backfill-post-image-dimensions.ts --apply    (writes, dev db)
//      pnpm tsx scripts/backfill-post-image-dimensions.ts --apply --prod   (prod — the USER runs this)
//
// ADDITIVE: stamps width/height on posts' `images[]` entries that lack them, so the
// detail hero can reserve its box before the file arrives (no layout shift — see
// src/components/forum/kiosk/CLAUDE.md, "Hero image reserves its height"). Nothing
// else on the document is touched, and an entry that already has both stays as is.
//
// Dimensions come from Cloudinary's admin API (`api.resource(publicId)`), which
// reports the STORED asset size (the upload route limit-crops to 1200x800, so that
// is the size the browser gets). Images we did not upload (no publicId in our
// folder, or a resource Cloudinary doesn't know) are skipped and counted.
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { v2 as cloudinary } from 'cloudinary';

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');
const COLLECTIONS = ['topics', 'announcements', 'recommendations', 'postDrafts'] as const;
const PACE_MS = 120; // Cloudinary admin API is rate-limited (500/h on free plans)

type Img = { url?: string; publicId?: string; width?: number; height?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const raw = process.env.MONGODB_URI;
  if (!raw) { console.error('MONGODB_URI missing'); process.exit(1); }
  // --prod forces the prod database on the same cluster (precedent:
  // scripts/create-post-draft-indexes.ts) — the local .env points at
  // mahalle-dev, so without this the "prod run" silently hit dev (09-25).
  const u = new URL(raw);
  if (PROD) u.pathname = '/mahalle';
  const uri = u.toString();
  const dbName = u.pathname.slice(1);
  if (!dbName.includes('dev') && !PROD) {
    console.error(`refusing: db name "${dbName}" does not look like a dev db (pass --prod to override)`);
    process.exit(1);
  }
  // The app reads CLOUD_NAME (not CLOUDINARY_CLOUD_NAME) — see /api/posts/upload.
  const cloudName = process.env.CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error('CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET missing');
    process.exit(1);
  }
  cloudinary.config({
    cloud_name: cloudName,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  console.log(`db ${dbName} · ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const sizes = new Map<string, { width: number; height: number } | null>();
  let docsSeen = 0, docsChanged = 0, imgsStamped = 0, imgsSkipped = 0;

  for (const name of COLLECTIONS) {
    const col = db.collection(name);
    const docs = await col
      .find({ images: { $elemMatch: { publicId: { $type: 'string' }, width: { $exists: false } } } },
            { projection: { images: 1 } })
      .toArray();
    console.log(`${name}: ${docs.length} document(s) with un-sized images`);

    for (const doc of docs as unknown as { _id: unknown; images: Img[] }[]) {
      docsSeen++;
      const next: Img[] = [];
      let changed = false;
      for (const img of doc.images ?? []) {
        if (!img?.publicId || (img.width && img.height)) { next.push(img); continue; }
        if (!sizes.has(img.publicId)) {
          try {
            const res = await cloudinary.api.resource(img.publicId);
            sizes.set(img.publicId, { width: Number(res.width), height: Number(res.height) });
          } catch {
            sizes.set(img.publicId, null);
          }
          await sleep(PACE_MS);
        }
        const size = sizes.get(img.publicId)!;
        if (size && size.width > 0 && size.height > 0) {
          next.push({ ...img, width: size.width, height: size.height });
          imgsStamped++; changed = true;
          console.log(`  ${name}/${doc._id} ${img.publicId} -> ${size.width}x${size.height}`);
        } else {
          next.push(img); imgsSkipped++;
          console.log(`  ${name}/${doc._id} ${img.publicId} -> SKIP (not found at Cloudinary)`);
        }
      }
      if (!changed) continue;
      docsChanged++;
      if (APPLY) await col.updateOne({ _id: doc._id as never }, { $set: { images: next } });
    }
  }

  console.log(`\n${APPLY ? 'stamped' : 'would stamp'} ${imgsStamped} image(s) in ${docsChanged}/${docsSeen} document(s); ${imgsSkipped} skipped`);
  if (!APPLY) console.log('dry run — nothing written. Re-run with --apply.');
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
