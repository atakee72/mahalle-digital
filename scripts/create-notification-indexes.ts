/**
 * Idempotent index creation for the notification collection. Run manually at deploy
 * (dev DB now, prod DB when this ships):
 *   pnpm tsx scripts/create-notification-indexes.ts
 *
 * Raw MongoClient + dotenv (not src/lib/mongodb.ts) because import.meta.env
 * isn't available to plain tsx — same pattern as scripts/create-listing-indexes.ts.
 */
import 'dotenv/config';
import { MongoClient, type Db, type IndexSpecification, type CreateIndexesOptions } from 'mongodb';

/**
 * createIndex, but a spec conflict reports itself and lets the run continue.
 *
 * Re-running with an identical name+spec is a genuine no-op. Re-running after
 * someone hand-created an index in Compass/Atlas, or after a spec is edited
 * here, throws 85 (IndexOptionsConflict) or 86 (IndexKeySpecsConflict). Left
 * unguarded, that aborts main() and every LATER createIndex silently never
 * runs — so a script advertised as "idempotent" would quietly half-apply.
 * Anything other than 85/86 is unexpected and still throws.
 */
async function ensureIndex(
  db: Db,
  coll: string,
  keys: IndexSpecification,
  opts: CreateIndexesOptions & { name: string },
): Promise<void> {
  try {
    await db.collection(coll).createIndex(keys, opts);
  } catch (e: any) {
    if (e?.code === 85) {
      console.error(
        `  ! ${coll}.${opts.name}: IndexOptionsConflict (85) — that name exists with DIFFERENT options. ` +
        `Drop it deliberately (db.${coll}.dropIndex('${opts.name}')) before re-running; continuing.`
      );
    } else if (e?.code === 86) {
      console.error(
        `  ! ${coll}.${opts.name}: IndexKeySpecsConflict (86) — these keys are already indexed under another name. ` +
        `Continuing.`
      );
    } else {
      throw e;
    }
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required (set in .env or shell env).');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const dbName = new URL(uri).pathname.slice(1) || 'mahalle-dev';
  const db = client.db(dbName);

  // List + unread count: both queries filter userId and sort/filter on the
  // second key, so one compound index serves both.
  await ensureIndex(db, 'notifications', { userId: 1, createdAt: -1 }, {
    name: 'notifications_user_created',
  });

  // Like rows: one doc per (recipient, liked item) — the upsert in src/lib/likeNotify.ts
  // finds its row by exactly these three keys.
  await ensureIndex(db, 'notifications', { userId: 1, type: 1, 'meta.sourceId': 1 }, {
    name: 'notifications_user_type_source',
  });

  // Retention: a REAL Mongo TTL index (unlike chronikCache's in-code check).
  // Read and unread expire alike after 90 days; no prune script.
  await ensureIndex(db, 'notifications', { createdAt: 1 }, {
    name: 'notifications_ttl',
    expireAfterSeconds: 7776000, // 90 days
  });

  // R2: push subscriptions. Endpoint is the natural key (one row per browser
  // subscription; re-subscribe/account-switch upserts take it over).
  await ensureIndex(db, 'pushSubscriptions', { endpoint: 1 }, {
    name: 'push_endpoint_unique',
    unique: true,
  });
  // Send-time fan-in: sendPushToUsers queries { userId: { $in: [...] } }.
  await ensureIndex(db, 'pushSubscriptions', { userId: 1 }, {
    name: 'push_user',
  });

  console.log(`Done (db: ${dbName}).`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
