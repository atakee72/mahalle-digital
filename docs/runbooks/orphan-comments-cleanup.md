# Orphaned comments cleanup (one-shot, 2026-09-14)

**Why:** until `fix(comments): cascade the thread on every post delete` (2026-09-14), deleting an announcement or recommendation filtered comments on a `topic` field no comment has (`relevantPostId` is the real link), and the admin delete of official announcements never cascaded. Every such delete left its comment thread behind, invisible but present.

**What the script does:** `scripts/cleanup-orphan-comments.ts` lists every `relevantPostId` that exists in none of `topics` / `announcements` / `recommendations` / `events`, and (with `--apply`) deletes those comments and stamps their `flaggedContent` rows `contentDeleted` (never deletes flag rows). The delete/query filter matches `relevantPostId` stored as either an `ObjectId` or its hex string (`$in: [oid, oid.toHexString()]`) — a plain `{ relevantPostId: oid }` query does not match string-typed rows in real MongoDB, so without the `$in` form such rows would print `0 comment(s)` and survive. Dry-run by default. In `--apply` mode, the full matched documents are written (JSON Lines, oldest first) to `scratchpad/orphan-comments-backup-<db>-<timestamp>.jsonl` before the delete; the path is printed at the end of the run.

**Restore from backup (if a delete needs undoing):**
```
mongoimport --uri "$MONGODB_URI" --collection comments --file <backup.jsonl>
```
**Backup format:** each line is MongoDB Extended JSON (relaxed) via `EJSON.stringify`, so `_id`/`relevantPostId` are `{ "$oid": … }` and dates `{ "$date": … }` — `mongoimport` restores them with their original types (verified on dev 2026-09-14 after the fix wave; the first version used plain `JSON.stringify`, which would have restored `_id` as a string).

**Step 0 — verify prod data shape before the dry-run (user only, run against prod):**
```
mongosh "$MONGODB_URI" --eval "db.comments.countDocuments({ relevantPostId: { \$type: 'string' } })"
mongosh "$MONGODB_URI" --eval "db.comments.countDocuments({ relevantPostId: { \$exists: false } })"
```
Both must print `0` before proceeding. A non-zero first count means string-typed `relevantPostId` rows exist — the script's `$in` filter now handles them, but the count is worth knowing going in. A non-zero second count means comments with no `relevantPostId` at all exist — those are invisible to both this script and the cascade fix, and need a manual look before running.

**Prod run (user only — prod `MONGODB_URI` is a Vercel Sensitive var):**
1. Temporarily point `MONGODB_URI` in `.env` at prod (or `MONGODB_URI=<prod> pnpm tsx …` inline).
2. `pnpm tsx scripts/cleanup-orphan-comments.ts` — check the `db=mahalle` line and the per-parent list. The script refuses to run (exits 1) if `MONGODB_URI` has no database path, rather than guessing a default.
3. `pnpm tsx scripts/cleanup-orphan-comments.ts --apply` — note the printed backup path.
4. Re-run the dry-run: expect `Would delete 0`.
5. Restore `.env` to `mahalle-dev`.

Idempotent; safe to re-run. Dev run on 2026-09-14 removed the orphans the seed + probes had produced.
