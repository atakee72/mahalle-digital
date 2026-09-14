# Orphaned comments cleanup (one-shot, 2026-09-14)

**Why:** until `fix(comments): cascade the thread on every post delete` (2026-09-14), deleting an announcement or recommendation filtered comments on a `topic` field no comment has (`relevantPostId` is the real link), and the admin delete of official announcements never cascaded. Every such delete left its comment thread behind, invisible but present.

**What the script does:** `scripts/cleanup-orphan-comments.ts` lists every `relevantPostId` that exists in none of `topics` / `announcements` / `recommendations` / `events`, and (with `--apply`) deletes those comments and stamps their `flaggedContent` rows `contentDeleted` (never deletes flag rows). Dry-run by default.

**Prod run (user only — prod `MONGODB_URI` is a Vercel Sensitive var):**
1. Temporarily point `MONGODB_URI` in `.env` at prod (or `MONGODB_URI=<prod> pnpm tsx …` inline).
2. `pnpm tsx scripts/cleanup-orphan-comments.ts` — check the `db=mahalle` line and the per-parent list.
3. `pnpm tsx scripts/cleanup-orphan-comments.ts --apply`
4. Re-run the dry-run: expect `Would delete 0`.
5. Restore `.env` to `mahalle-dev`.

Idempotent; safe to re-run. Dev run on 2026-09-14 removed the orphans the seed + probes had produced.
