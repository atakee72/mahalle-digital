/**
 * Idempotent index creation for auth collections. Run manually at deploy
 * (dev DB now, prod DB when this ships):
 *   pnpm tsx scripts/create-auth-indexes.ts
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

  // Token collections: TTL hygiene (queries already filter expiresAt/usedAt —
  // this just stops dead rows accumulating) + hash-lookup index.
  await ensureIndex(db, 'passwordResetTokens',
    { expiresAt: 1 }, { expireAfterSeconds: 0, name: 'prt_ttl' });
  await ensureIndex(db, 'passwordResetTokens',
    { tokenHash: 1 }, { name: 'prt_tokenHash' });
  await ensureIndex(db, 'emailVerifyTokens',
    { expiresAt: 1 }, { expireAfterSeconds: 0, name: 'evt_ttl' });
  await ensureIndex(db, 'emailVerifyTokens',
    { tokenHash: 1 }, { name: 'evt_tokenHash' });
  await ensureIndex(db, 'emailChangeTokens',
    { expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ect_ttl' });
  await ensureIndex(db, 'emailChangeTokens',
    { tokenHash: 1 }, { name: 'ect_tokenHash' });
  // Task 10 note: this TTL deletes the undo token AT the deletion date —
  // fine, since by then Task 11's day-7 pipeline has run and undo is moot.
  await ensureIndex(db, 'accountDeletionTokens',
    { expiresAt: 1 }, { expireAfterSeconds: 0, name: 'adt_ttl' });
  await ensureIndex(db, 'accountDeletionTokens',
    { tokenHash: 1 }, { name: 'adt_tokenHash' });

  // rateLimits: exact-key bucket lookup (unique — consume() handles the
  // E11000 upsert race), TTL cleanup, clear-by-baseKey.
  await ensureIndex(db, 'rateLimits',
    { key: 1 }, { unique: true, name: 'rl_key' });
  await ensureIndex(db, 'rateLimits',
    { expiresAt: 1 }, { expireAfterSeconds: 0, name: 'rl_ttl' });
  await ensureIndex(db, 'rateLimits',
    { baseKey: 1 }, { name: 'rl_baseKey' });

  // chronikCache: 24h-cached Kiez-Chronik payload per user (src/lib/profile/chronik.ts).
  await ensureIndex(db, 'chronikCache',
    { userId: 1 }, { unique: true, name: 'chronik_user' });
  await ensureIndex(db, 'chronikCache',
    { expiresAt: 1 }, { expireAfterSeconds: 0, name: 'chronik_ttl' });

  // ── users ──────────────────────────────────────────────────────────────
  // LAST on purpose: these are the newest specs and therefore the likeliest
  // to hit a conflict; anything after them would be the tail that a bare
  // throw would skip.
  //
  // users_handle_unique is re-ensured here so `users` indexes have one
  // canonical home, but it ORIGINATES in scripts/backfill-user-handles.ts
  // (which had to backfill handles before it could add the index). The spec
  // below is copied from there byte-for-byte — note there is deliberately NO
  // collation. Any divergence throws 85 against the already-live index.
  await ensureIndex(db, 'users',
    { handle: 1 },
    { unique: true, partialFilterExpression: { handle: { $type: 'string' } }, name: 'users_handle_unique' });

  // users_inviteCode_unique (2026-10-07) — a member's personal invitation code; the register
  // page looks it up. PARTIAL for the same reason as the handle index: most documents have no
  // code (minted on first eligible read; tombstones lose it). The lookup works without the
  // index too (a neighbourhood-sized collection) — this makes the collision guard in
  // src/lib/invites/invites.ts real.
  await ensureIndex(db, 'users',
    { inviteCode: 1 },
    { unique: true, partialFilterExpression: { inviteCode: { $type: 'string' } }, name: 'users_inviteCode_unique' });

  // users_email_unique — closes the check-then-act race that let two accounts
  // share an address (register, e-mail-change start/confirm, and register-vs-
  // confirm across flows).
  //
  //  - PARTIAL on $type:'string' is load-bearing: accountDeletion.ts's
  //    tombstone $unsets `email`, and a plain unique index treats every
  //    missing field as the same null key — the SECOND account deletion
  //    would then fail, silently (that step swallows its error). Same reason
  //    users_handle_unique is partial. Do NOT "simplify" this to
  //    $exists:true, which would index a literal null and reopen the hole.
  //  - COLLATION matches all five app-side lookups (auth.config.ts login,
  //    register, email-change start + confirm, forgot-password), so the DB
  //    guarantee equals the app's intent and legacy mixed-case rows count as
  //    duplicates. Note $type is a BSON-type test, so collation cannot affect
  //    how the partial filter is evaluated.
  //  - The collation is a ONE-WAY DOOR: MongoDB >= 7.3 refuses two partial
  //    indexes with the same keys and filter differing only by collation, so
  //    it can never be changed online — only dropped and recreated, leaving a
  //    window with no uniqueness enforcement at all.
  //  - This index is NOT used by those lookups. A partial index only becomes
  //    plan-eligible when the query itself restates the filter, which none of
  //    them do (verified: equality on `handle` still COLLSCANs). It exists for
  //    the write-side guarantee, not for read speed.
  await ensureIndex(db, 'users',
    { email: 1 },
    {
      unique: true,
      partialFilterExpression: { email: { $type: 'string' } },
      collation: { locale: 'en', strength: 2 },
      name: 'users_email_unique',
    });

  console.log('Auth indexes ensured on', dbName);
  // Evidence, not assertion: print what `users` actually carries now.
  console.log('users indexes:');
  for (const ix of await db.collection('users').listIndexes().toArray()) {
    console.log('  ', JSON.stringify({
      name: ix.name, key: ix.key, unique: ix.unique,
      partial: ix.partialFilterExpression, collation: ix.collation?.locale && {
        locale: ix.collation.locale, strength: ix.collation.strength,
      },
    }));
  }
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
