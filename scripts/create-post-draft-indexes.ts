/**
 * Idempotent index creation for the forum drafts collection (`postDrafts`).
 *
 *   pnpm tsx scripts/create-post-draft-indexes.ts            # dry-run on the dev DB
 *   pnpm tsx scripts/create-post-draft-indexes.ts --apply    # write on the dev DB
 *   pnpm tsx scripts/create-post-draft-indexes.ts --prod --apply   # PROD — the user runs this one
 *
 * Refuses any database whose name lacks "dev" unless --prod is given. With --prod
 * the database is `mahalle` on the same cluster (the URI is never printed).
 * Raw MongoClient + dotenv because import.meta.env isn't available to plain tsx.
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required (set in .env or shell env).');
    process.exit(1);
  }
  const u = new URL(uri);
  if (PROD) u.pathname = '/mahalle';
  const dbName = u.pathname.slice(1);
  if (!PROD && !dbName.includes('dev')) {
    console.error(`Refusing: database "${dbName}" is not a dev database. Pass --prod if you mean it.`);
    process.exit(1);
  }
  console.log(`database: ${dbName}${APPLY ? '' : '  [DRY RUN — add --apply to write]'}`);
  if (!APPLY) {
    console.log('would create: postDrafts.postDrafts_user_updated { userId: 1, updatedAt: -1 }');
    return;
  }

  const client = new MongoClient(u.href);
  await client.connect();
  try {
    // The list under "Meine" and the 20-per-member count both filter on userId;
    // the list sorts newest change first.
    await client.db(dbName).collection('postDrafts').createIndex({ userId: 1, updatedAt: -1 }, { name: 'postDrafts_user_updated' });
    const names = (await client.db(dbName).collection('postDrafts').indexes()).map((i) => i.name);
    console.log(`indexes on postDrafts: ${names.join(', ')}`);
  } catch (e: any) {
    if (e?.code === 85 || e?.code === 86) console.error(`index conflict (${e.code}) — an index with this name or these keys already exists with a different spec; nothing changed.`);
    else throw e;
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
