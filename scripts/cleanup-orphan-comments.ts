// scripts/cleanup-orphan-comments.ts
// Run (dry-run, default): pnpm tsx scripts/cleanup-orphan-comments.ts
// Run (write):            pnpm tsx scripts/cleanup-orphan-comments.ts --apply
//
// ONE-SHOT cleanup: comments whose parent post no longer exists in ANY of
// topics / announcements / recommendations / events. Until 2026-09-14 the
// announcement + recommendation self-delete routes filtered comments on a
// `topic` field no comment has, and the admin delete of official
// announcements never cascaded — each such delete orphaned its thread.
// Orphans are invisible in the UI (no parent page renders them) but still
// count in per-user stats and clutter admin tooling.
//
// Reported orphans keep their flaggedContent row, stamped contentDeleted
// (same rule as a live delete). Default is dry-run: it prints what it would
// remove. Reads MONGODB_URI from .env — point it at prod deliberately.
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const PARENTS = ['topics', 'announcements', 'recommendations', 'events'] as const;

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI missing'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const dbName = new URL(uri).pathname.slice(1) || 'mahalle-dev';
  const db = client.db(dbName);
  console.log(`db=${dbName}  mode=${apply ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);

  const comments = db.collection('comments');
  const parentIds = await comments.distinct('relevantPostId');
  const orphanParents: ObjectId[] = [];
  const unparseable: unknown[] = [];
  for (const raw of parentIds) {
    const oid = raw instanceof ObjectId ? raw : (typeof raw === 'string' && ObjectId.isValid(raw) ? new ObjectId(raw) : null);
    if (!oid) { unparseable.push(raw); continue; }
    const hits = await Promise.all(PARENTS.map((n) => db.collection(n).countDocuments({ _id: oid }, { limit: 1 })));
    if (!hits.some(Boolean)) orphanParents.push(oid);
  }
  console.log(`${parentIds.length} distinct parents referenced, ${orphanParents.length} no longer exist, ${unparseable.length} unparseable ids (left alone: ${JSON.stringify(unparseable)})`);

  let total = 0;
  for (const oid of orphanParents) {
    const rows = await comments.find({ relevantPostId: oid }, { projection: { _id: 1, createdAt: 1 } }).toArray();
    total += rows.length;
    console.log(`  parent ${oid.toHexString()}: ${rows.length} comment(s)` + (rows[0]?.createdAt ? `, oldest ${new Date(rows[0].createdAt).toISOString().slice(0, 10)}` : ''));
    if (!apply) continue;
    const ids = rows.map((r) => String(r._id));
    const del = await comments.deleteMany({ relevantPostId: oid });
    const flagged = await db.collection('flaggedContent').updateMany(
      { contentType: 'comment', contentId: { $in: ids } },
      { $set: { contentDeleted: true, contentDeletedAt: new Date() } }
    );
    console.log(`    deleted ${del.deletedCount}, flagged rows marked ${flagged.modifiedCount}`);
  }
  console.log(`${apply ? 'Deleted' : 'Would delete'} ${total} orphaned comment(s).`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
