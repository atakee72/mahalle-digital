# Unused Exports Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the scraps the 2026-09-30 dead-code cleanup left inside live files — 60 unused type exports, 104 unused value exports, 2 duplicate type names, 9 unread Svelte props and the unused dark-glass CSS — without changing what any page or API does.

**Architecture:** Pure deletion work, driven by a committed inventory (`docs/superpowers/plans/2026-10-01-unused-exports-sweep-inventory.md`) that lists every symbol with a pre-classification. Each kind is its own task and its own commit(s), so any one can be reverted alone. Every task ends on the same gate script: type-check and svelte-check budgets, the hand-run lib tests, an unused-locals diff and a production build.

**Tech Stack:** Astro 5, Svelte 5, TypeScript, Zod, pnpm. Tools used read-only: `npx -y fallow@latest dead-code`, `npx -y knip@latest`.

**Spec:** none — this is the parked remainder of the dead-code sweep described in root `CLAUDE.md` („parked: ~100 unused exports, 60 unused types, 9 unread Svelte props, the `global.css` glass block") and the user's go of 2026-10-01 („on a feature branch and with a plan", one commit per kind). Rulings made without a spec are recorded in the ledger.

## Global Constraints

- Branch `chore/unused-exports-sweep`, cut from `main`. The USER merges; never merge or push to `main`.
- **No behaviour change.** Do not edit a function body, a schema's shape, a string, a route or a style that is in use. The only allowed edits: delete a declaration, delete the word `export`, delete a name from a re-export list, delete an import that became unused, delete a prop and the attribute that passed it, delete unused CSS rules.
- **Never run a tool's fix mode** (`fallow fix`, `knip --fix`). The tools only report.
- The tools are blind to `scripts/`, `.github/`, `scratchpad/`, the root config files (`auth.config.ts`, `sentry.*.config.ts`, `astro.config.mjs`) and they treat every `*.test.ts` as an unused file. **A symbol used by any of those is KEPT.** `scratchpad/` is gitignored but holds the owner's repair and probe scripts — it counts.
- CI budgets must not rise: `tsc` ≤ 16 errors, `svelte-check` ≤ 81 errors. If a count DROPS, lower the budget in `.github/workflows/checks.yml` in Task 7 (ratchet), never raise it.
- Do not remove or move any package in `package.json`. If a deletion leaves a package without importers, write it into the task report; the owner decides.
- Do not touch `src/pages/**` exports (`GET`, `POST`, `prerender`, `getStaticPaths` are framework conventions), `src/content/**`, `src/emails/**`, `design/**`.
- Commit messages plain and concise. **No `Co-Authored-By` trailer, no „Generated with" line** — the repository owner's rule overrides any harness default.
- Never stage `.env*`, `scratchpad/`, `.vercel/`, `dist/`. Never print a value from `.env`.

## Review Focus

1. **A symbol the tools call unused but a blind spot uses** (a `scripts/*.ts` repair script, a `scratchpad/*.mts` probe, `sentry.client.config.ts`, a `*.test.ts`) → it must still be exported after the sweep. Pinned by gate step „blind-spot imports resolve" (Task 1 script) and the `KEEP-*` rows.
2. **Cascade deaths**: removing `export type X = z.infer<typeof XSchema>` leaves `XSchema` used by nothing; removing `export` from a helper leaves a private function nobody calls. Dead locals must go too. Pinned by the unused-locals diff in the gate script.
3. **A callback prop that was never wired** (`AgendaRow.onRsvp`, `ModeratingModal.onDismiss`) may be a missing feature, not dead code. Removing it keeps today's behaviour; the report must name both so the owner can decide to wire them instead. Pinned by Task 5 step 6.
4. **A CSS class used only from a string the grep misses** (class built by concatenation, a class in an MDX post, a class in `public/`). Pinned by the three greps in Task 6 step 1.
5. **A same-named symbol in another file** (two `JWTPayload`, two `TOKEN_TTL_MS`) — deleting the wrong one breaks an import far away. Pinned by reading every `CHECK-SRC` row in Task 1 and by the type-check gate.

---

### Task 1: Branch, gate script, baselines and the hand-check of the doubtful rows

**Files:**
- Create: `scratchpad/sweep/gates.sh` (gitignored helper, not committed)
- Create: `scratchpad/sweep/baseline-unused-locals.txt` (gitignored)
- Modify: `docs/superpowers/plans/2026-10-01-unused-exports-sweep-inventory.md` (the `CHECK-SRC` rows get a verdict)
- Commit: this plan + the inventory

**Interfaces:**
- Produces: `bash scratchpad/sweep/gates.sh` — prints six lines `GATE <name>: <value>` and exits non-zero if a budget rose, a test failed, a blind-spot import broke or the unused-locals diff is non-empty. Every later task runs it.
- Produces: in the inventory, every `CHECK-SRC` row rewritten to `KEEP (reason)`, `UNEXPORT` or `DELETE`.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull --ff-only && git checkout -b chore/unused-exports-sweep
```

- [ ] **Step 2: Write the gate script**

Create `scratchpad/sweep/gates.sh`:

```bash
#!/usr/bin/env bash
# Sweep gates. Run from the repo root. Exit 1 on any regression.
set -u
fail=0
mkdir -p scratchpad/sweep

# 1. tsc budget
pnpm exec tsc --noEmit > scratchpad/sweep/tsc.log 2>&1 || true
tsc_n=$(grep -c 'error TS' scratchpad/sweep/tsc.log || true)
echo "GATE tsc: $tsc_n (budget 16)"; [ "$tsc_n" -gt 16 ] && fail=1

# 2. svelte-check budget
# same parse as .github/workflows/checks.yml: field 5 of the machine-readable COMPLETED line
pnpm exec svelte-check --output machine > scratchpad/sweep/svelte.log 2>&1 || true
sv_n=$(grep ' COMPLETED ' scratchpad/sweep/svelte.log | tail -1 | awk '{print $5}'); sv_n=${sv_n:-999}
echo "GATE svelte-check: $sv_n (budget 81)"; [ "$sv_n" -gt 81 ] && fail=1

# 3. hand-run lib tests (node spec reporter prints "ℹ fail N")
t_fail=0
for f in $(git ls-files 'src/**/*.test.ts' 'src/*.test.ts'); do
  n=$(npx tsx --test "$f" 2>&1 | grep -E '^ℹ fail ' | awk '{print $3}')
  [ "${n:-1}" != "0" ] && { echo "  test failed: $f"; t_fail=$((t_fail+1)); }
done
echo "GATE tests: $t_fail failing files"; [ "$t_fail" -gt 0 ] && fail=1

# 4. blind spots still resolve: every scripts/ and scratchpad/ import of src/ names an export that exists
node --input-type=commonjs - <<'EOF' > scratchpad/sweep/blind.log 2>&1   # package.json is type:module, stdin must be forced to CommonJS
const fs=require('fs'),path=require('path');
const roots=['scripts','scratchpad','sentry.client.config.ts','sentry.server.config.ts','auth.config.ts'];
const files=[];
const walk=p=>{const s=fs.statSync(p); if(s.isDirectory()){ if(/node_modules|sweep$/.test(p)) return; for(const f of fs.readdirSync(p)) walk(path.join(p,f)); } else if(/\.(m?ts|c?js|mjs)$/.test(p)) files.push(p); };
roots.filter(fs.existsSync).forEach(walk);
let bad=0;
for(const f of files){
  const src=fs.readFileSync(f,'utf8');
  for(const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]*src\/[^'"]+|\.\.?\/[^'"]*)['"]/g)){
    let target=path.resolve(path.dirname(f),m[2]);
    const cand=[target,target+'.ts',target+'.tsx',target+'/index.ts',target.replace(/\.js$/,'.ts')].find(c=>fs.existsSync(c)&&fs.statSync(c).isFile());
    if(!cand||!cand.includes(path.sep+'src'+path.sep)) continue;
    const t=fs.readFileSync(cand,'utf8');
    for(const raw of m[1].split(',')){
      const name=raw.trim().replace(/^type\s+/,'').split(/\s+as\s+/)[0].trim(); if(!name) continue;
      const re=new RegExp('export\\s+(?:declare\\s+)?(?:async\\s+)?(?:const|let|function|class|type|interface|enum)\\s+'+name+'\\b|export\\s*(?:type\\s*)?\\{[^}]*\\b'+name+'\\b[^}]*\\}');
      if(!re.test(t)){ console.log(`MISSING ${name} — ${f} imports it from ${path.relative('.',cand)}`); bad++; }
    }
  }
}
console.log('missing:',bad); process.exit(bad?1:0);
EOF
blind_rc=$?
echo "GATE blind-spot imports: $(tail -1 scratchpad/sweep/blind.log)"; [ "$blind_rc" -ne 0 ] && { grep MISSING scratchpad/sweep/blind.log; fail=1; }

# 5. unused-locals diff against the Task 1 baseline (cascade deaths)
pnpm exec tsc --noEmit --noUnusedLocals 2>&1 | grep -E 'error TS(6133|6196|6192|6198)' \
  | sed -E 's/\([0-9]+,[0-9]+\)//' | sort -u > scratchpad/sweep/unused-locals-now.txt
if [ -f scratchpad/sweep/baseline-unused-locals.txt ]; then
  new=$(comm -13 scratchpad/sweep/baseline-unused-locals.txt scratchpad/sweep/unused-locals-now.txt | wc -l)
  echo "GATE new unused locals: $new"; [ "$new" -gt 0 ] && { comm -13 scratchpad/sweep/baseline-unused-locals.txt scratchpad/sweep/unused-locals-now.txt; fail=1; }
else
  echo "GATE new unused locals: (no baseline yet)"
fi

# 6. production build (skip with SKIP_BUILD=1 while iterating inside a task)
if [ "${SKIP_BUILD:-0}" = "1" ]; then echo "GATE build: skipped"; else
  pnpm build > scratchpad/sweep/build.log 2>&1 && echo "GATE build: ok" || { echo "GATE build: FAILED (see scratchpad/sweep/build.log)"; fail=1; }
fi
exit $fail
```

- [ ] **Step 3: Record the baselines**

```bash
chmod +x scratchpad/sweep/gates.sh
pnpm exec tsc --noEmit --noUnusedLocals 2>&1 | grep -E 'error TS(6133|6196|6192|6198)' \
  | sed -E 's/\([0-9]+,[0-9]+\)//' | sort -u > scratchpad/sweep/baseline-unused-locals.txt
wc -l scratchpad/sweep/baseline-unused-locals.txt
bash scratchpad/sweep/gates.sh
```

Expected: `GATE tsc: 16`, `GATE svelte-check: 81`, `GATE tests: 0 failing files`, `GATE blind-spot imports: missing: 0`, `GATE new unused locals: 0`, `GATE build: ok`, exit 0. If `blind-spot imports` reports a MISSING on an untouched tree, that import is already broken today: list it in the report, add its line to an allow-list at the top of the node block (`const KNOWN=[…]`, skip when the printed line is in it) and re-run — do not fix the script it belongs to.

- [ ] **Step 4: Hand-check every `CHECK-SRC` row (18 rows)**

For each row marked `CHECK-SRC` in the inventory, open the „Seen elsewhere" files and answer one question: does that file import or otherwise use THIS symbol from THIS file?

```bash
# example for one row (replace the name)
grep -rn -E "(^|[^A-Za-z0-9_$])MAX_PINS([^A-Za-z0-9_$]|$)" \
     src scripts scratchpad .github auth.config.ts astro.config.mjs sentry.client.config.ts sentry.server.config.ts \
     --include='*.ts' --include='*.mts' --include='*.cjs' --include='*.mjs' --include='*.js' \
     --include='*.svelte' --include='*.astro' --include='*.tsx' --include='*.yml' \
     --exclude-dir=node_modules --exclude-dir=sweep
```

Then rewrite the row's Pre-class cell:
- another file IMPORTS it from this path → `KEEP (imported by <file>)` — the tool was wrong;
- the other file only mentions the name in a comment or string, or declares/imports a DIFFERENT symbol with the same name → fall back to the own-file rule: used inside its own file → `UNEXPORT`, otherwise `DELETE`;
- the row is a re-export line (`export { X } from './y'`) and nobody imports `X` FROM THIS FILE → `DELETE` (the line, or just the name on it).

What the plan's audit found on 2026-10-01 — the EXPECTED verdicts. Confirm each with the search; if you find something different, write what you find.

| Symbol | File | Expected verdict | Why |
|---|---|---|---|
| `isClientNoise` | `src/lib/sentry/clientNoise.ts` | KEEP | imported by `sentry.client.config.ts` and its test |
| `COMMENT_MAX_LEN` | `src/schemas/comment.schema.ts:7` (re-export) | KEEP | `scratchpad/comment-len-check.mts` imports it from the schema file |
| `lastSubmittedAt` | `src/lib/forumMutations.ts` | UNEXPORT | `ComposePageInner.svelte` only mentions it in a comment |
| `attachLastCommentAt` | `src/lib/topicsQuery.ts` | UNEXPORT | comment in `ForumIndexInner.svelte` |
| `GRACE_MS` | `src/lib/auth/accountDeletion.ts` | UNEXPORT | comment in `schedule.ts` |
| `TOKEN_TTL_MS` | `src/lib/auth/emailChange.ts` | UNEXPORT | the two other files declare their own private const |
| `populateSellers` | `src/lib/listingsQuery.ts` | UNEXPORT | other hits are comments |
| `KiezDemographicsDoc` | `src/types/kiezStats.ts` | DELETE | comment in `zdw.ts` |
| `RegisterSchema` | `src/schemas/auth.schema.ts` | DELETE once Task 2 removed `RegisterInput` | other hits are comments; its only own-file reader is that inferred type |
| `MAX_PINS` | `src/lib/announcements/pin.ts:8` | DELETE the re-export line | everyone imports it from `pinRules.ts` |
| `JWTPayload` | `src/schemas/auth.schema.ts:104` AND `src/types/index.ts:285` | DELETE both | `src/lib/auth.ts:8` declares its own private `interface JWTPayload`; nothing imports either exported one |
| `safeParse` | `src/schemas/validation.utils.ts` | own-file rule | the auth islands call Zod's `.safeParse()` method, not this function |
| `FORUM_QUERY_OPTIONS`, `SearchPost`, `SearchComment`, `ForumPeek`, `ListingPeek` | re-export lines in `topicsQuery.ts`, `forum/searchStore.ts`, `landing.ts` | drop the name from the `export` only | nobody imports them through these files; the file may still use the imported name itself |

- [ ] **Step 5: Commit plan + inventory**

```bash
git add docs/superpowers/plans/2026-10-01-unused-exports-sweep.md docs/superpowers/plans/2026-10-01-unused-exports-sweep-inventory.md
git commit -m "docs: plan and inventory for the unused-exports sweep"
```

---

### Task 2: Unused type exports (inventory Part A, 60 symbols)

**Files:**
- Modify: the 17 files listed in inventory Part A (largest: `src/schemas/forum.schema.ts` 12, `src/schemas/auth.schema.ts` 7, `src/schemas/listing.schema.ts` 7, `src/schemas/comment.schema.ts` 5, `src/schemas/moderation.schema.ts` 5, `src/types/index.ts` 4)

**Interfaces:**
- Consumes: `bash scratchpad/sweep/gates.sh`; the verdicts written in Task 1.
- Produces: no unused type export left except `KEEP` rows. Schemas whose only reader was a deleted `z.infer` type are NOT deleted here — they stay exported and are handled in Task 3 (they are value exports).

**The per-symbol rule (apply to every row of Part A, in file order):**

1. Run the search — exactly this command, with the file filters (without them `scratchpad/sweep/*.json|*.log` and the `CLAUDE.md` area docs match every name). A hit counts only if it is CODE that refers to this symbol: **a mention in a comment or a string does not count, and neither does a same-named symbol that the other file declares itself**:
   ```bash
   grep -rn -E "(^|[^A-Za-z0-9_$])NAME([^A-Za-z0-9_$]|$)" \
        src scripts scratchpad .github auth.config.ts astro.config.mjs sentry.client.config.ts sentry.server.config.ts \
        --include='*.ts' --include='*.mts' --include='*.cjs' --include='*.mjs' --include='*.js' \
        --include='*.svelte' --include='*.astro' --include='*.tsx' --include='*.yml' \
        --exclude-dir=node_modules --exclude-dir=sweep
   ```
2. Hit in another file that uses this symbol → **KEEP**; write `KEEP (used by <file>)` into the inventory row and move on.
3. No outside use, but used inside its own file besides the declaration → delete only the word `export`.
4. No use at all → delete the whole declaration together with its doc comment. For a re-export line (`export type { A, B } from './x'`) delete just the name; delete the line when it becomes empty.
5. If the deletion leaves an `import` in that file unused, delete that import (or that name from it).

- [ ] **Step 1: Apply the rule to `src/schemas/*.ts` (38 rows: auth 7, comment 5, forum 12, listing 7, moderation 5, news 2)**

Typical shape in these files — the tail block of inferred types:

```ts
// before (src/schemas/comment.schema.ts, tail)
export type CommentCreate = z.infer<typeof CommentCreateSchema>;
export type CommentUpdate = z.infer<typeof CommentUpdateSchema>;
export type CommentDelete = z.infer<typeof CommentDeleteSchema>;
```

A row classed `DELETE` loses its whole line. Do not touch the `…Schema` constants in this task.

- [ ] **Step 2: Gate (no build yet), then commit**

```bash
SKIP_BUILD=1 bash scratchpad/sweep/gates.sh
git add src/schemas && git commit -m "chore: drop unused inferred types from the schemas"
```
Expected: exit 0. A rise in `tsc` or `svelte-check` means a deleted type was in use — the log names the importing file; restore that one type and mark its row `KEEP`.

- [ ] **Step 3: Apply the rule to `src/types/*.ts` and `src/lib/**` (22 rows)**

Special rows:
- `src/lib/forum/searchStore.ts:14` `SearchComment`, `SearchPost` — a re-export line; `src/lib/forum/searchQuery.ts` defines the originals. Remove the names from the re-export only if nothing imports them FROM `searchStore`.
- `src/lib/landing.ts:24` `ForumPeek`, `ListingPeek` — same pattern against `src/lib/landing/frames.ts`.
- `src/types/kiezStats.ts` `KiezDemographicsDoc` — `src/lib/kiez/zdw.ts` mentions the name in a comment only (see the Task 1 verdict in the inventory).
- `src/schemas/moderation.schema.ts` — `ReportReason` (around line 148) is NOT in the inventory and must stay exported: `KioskReportModal.svelte` imports it and Task 4 builds on it.

- [ ] **Step 4: Full gate, then commit**

```bash
bash scratchpad/sweep/gates.sh
git add src/types src/lib docs/superpowers/plans/2026-10-01-unused-exports-sweep-inventory.md
git commit -m "chore: drop unused type exports in lib and types"
```
Expected: exit 0, `GATE build: ok`.

---

### Task 3: Unused value exports (inventory Part B, 104 symbols)

**Files:**
- Modify: the files listed in inventory Part B (largest: `src/schemas/listing.schema.ts` 11, `src/lib/kiez/airLog.ts` 6, `src/types/listing.ts` 6, `src/schemas/moderation.schema.ts` 5, `src/lib/forumMutations.ts` 4, `src/lib/moderation.ts` 4, `src/schemas/comment.schema.ts` 4, `src/schemas/forum.schema.ts` 4, `src/schemas/validation.utils.ts` 4, `src/lib/auth.ts` 3)

**Interfaces:**
- Consumes: gate script; Task 1 verdicts; Task 2's state (schemas whose inferred type is gone now have one reader fewer).
- Produces: no unused value export left except `KEEP` rows; no new unused local.

**The per-symbol rule** is the one from Task 2 (search → KEEP / drop `export` / delete declaration / clean imports), plus:

6. **Re-count after Task 2.** The inventory's `UNEXPORT` was computed while the inferred types still existed. For a schema constant, run the step-1 search again: if its only remaining mention is its own declaration, it is `DELETE`.
7. **Cascade.** After finishing a file, run `SKIP_BUILD=1 bash scratchpad/sweep/gates.sh`. Every line under `GATE new unused locals` is a declaration that just lost its last reader: delete it (and repeat until the gate prints 0). This is how a private helper that only served a deleted function goes too.
8. **Never delete a symbol whose row is `KEEP-scripts`, `KEEP-scratchpad` or `KEEP-scripts+test`:** `PLR_CODES` (`src/components/kiez/plrPaths.ts`), `repairedAllDayBounds` (`src/lib/calendar/allDayRepair.ts`), `AIR_DAILY_COLLECTION` and `recomputeDailyRollup` (`src/lib/kiez/airLog.ts`), plus the two KEEP verdicts from Task 1: `COMMENT_MAX_LEN` (the re-export in `src/schemas/comment.schema.ts`) and `isClientNoise` (`src/lib/sentry/clientNoise.ts`).

- [ ] **Step 1: `src/schemas/*.ts`**

Apply rules 1–7. Notes: `COMMENT_MAX_LEN` in `comment.schema.ts:7` is a re-export of `src/lib/forum/commentLimits.ts` — **KEEP it**: `scratchpad/comment-len-check.mts` imports it from the schema file (the composers import from `commentLimits`). `RegisterSchema` and `JWTPayloadSchema` in `auth.schema.ts` lose their last reader once Task 2 removed `RegisterInput` / `JWTPayload` — rule 6 deletes them; before deleting `RegisterSchema` confirm `src/pages/api/auth/register.ts` and `AuthRegisterInner.svelte` only name it in comments. `validation.utils.ts` `safeParse`: the auth islands call Zod's own `.safeParse()` method, which is not this function — decide by the import lines, not by the name.

```bash
SKIP_BUILD=1 bash scratchpad/sweep/gates.sh
git add src/schemas && git commit -m "chore: remove unused schema exports"
```

- [ ] **Step 2: `src/types/listing.ts` and `src/lib/auth.ts`**

`src/types/listing.ts`: `isRichText`, `deltaToPlainText` are leftovers of the removed rich-text editor (Quill Delta descriptions). Before deleting, confirm nothing renders a listing description through them:

```bash
grep -rn -E "isRichText|deltaToPlainText|\.ops\b" src --include=*.ts --include=*.svelte --include=*.astro | grep -v '^src/types/listing.ts'
```
No hit → they follow the normal rule. A hit → KEEP and say so in the report.

`src/lib/auth.ts`: `signToken`, `verifyToken`, `extractTokenFromHeader` are the pre-Auth.js JWT helpers. Normal rule. Their deletion leaves the file's private `interface JWTPayload` (line ~8), `JWT_SECRET` and the `jsonwebtoken` import without readers — the gate lists them under „new unused locals"; delete them (rule 7). `src/lib/auth.ts` is the only importer of `jsonwebtoken`: **report the package as a removal candidate — do not edit `package.json`**. `requireAdminSession`, `requireMemberSession` and everything they use stay untouched.

```bash
SKIP_BUILD=1 bash scratchpad/sweep/gates.sh
git add src/types src/lib/auth.ts && git commit -m "chore: remove unused listing and legacy token helpers"
```

- [ ] **Step 3: the rest of `src/lib/**`, `src/utils/**`, `src/components/**/*.ts`**

Apply rules 1–8 file by file. Notes: `src/lib/forumMutations.ts` — `lastSubmittedAt` is named in `ComposePageInner.svelte` in a comment only (Task 1 verdict: UNEXPORT). `src/lib/moderation.ts` — `moderateContent`, `moderateImages`, `getCategoryDisplayName`, `getSeverityLevel`: deleting a 100-line function is fine when the rule says so; its private helpers then show up under rule 7.

```bash
bash scratchpad/sweep/gates.sh
git add src docs/superpowers/plans/2026-10-01-unused-exports-sweep-inventory.md
git commit -m "chore: remove unused exports in lib, utils and component helpers"
```
Expected: exit 0, `GATE build: ok`.

- [ ] **Step 4: Tool re-run (read-only) as the task's proof**

```bash
npx -y fallow@latest dead-code 2>/dev/null | grep -E '^● Unused (exports|type exports)'
```
Expected: both counts equal the number of `KEEP` rows in their inventory part (the tools still cannot see those users). Any other remaining symbol: apply the rule to it or justify it in the report.

---

### Task 4: One home for `ModerationDecision` and `ReportReason`

**Files:**
- Modify: `src/types/index.ts` — the two definitions; their line numbers moved when Task 2 deleted types above them, locate them with `grep -n -E "^export type (ModerationDecision|ReportReason)\b" src/types/index.ts`
- Read: `src/lib/moderation.ts:39`, `src/schemas/moderation.schema.ts` (`ReportReasonSchema` at ~32, `export type ReportReason` at ~148)

**Interfaces:**
- Produces: each name is DEFINED in exactly one file. `ModerationDecision` lives in `src/lib/moderation.ts`; `ReportReason` lives in `src/schemas/moderation.schema.ts` (inferred from `ReportReasonSchema`, which `KioskReportModal.svelte` already imports from there). `src/types/index.ts` keeps exporting both names, as type re-exports, so no importer changes.

- [ ] **Step 1: Check `ReportReason` exists as a type in the schema file**

```bash
grep -n "ReportReason\b" src/schemas/moderation.schema.ts
```
If Task 2 deleted `export type ReportReason = z.infer<typeof ReportReasonSchema>` there, it must not have (the modal imports it) — restore that line. It must read exactly:

```ts
export type ReportReason = z.infer<typeof ReportReasonSchema>;
```

- [ ] **Step 2: Check the two definitions are the same unions**

The `ModerationDecision` line in `src/types/index.ts` and `src/lib/moderation.ts:39` must both read `'approved' | 'pending_review' | 'urgent_review'`. The `ReportReason` line in `src/types/index.ts` must list exactly the seven members of `ReportReasonSchema` (`spam`, `harassment`, `hate_speech`, `violence`, `inappropriate`, `misinformation`, `other`). If they differ, STOP and report — that is a real bug, not a tidy-up.

- [ ] **Step 3: Replace the two definitions in `src/types/index.ts` with re-exports**

`src/types/index.ts` uses both names further down (`decision: ModerationDecision;`, `reportReason?: ReportReason;`), so import them for local use and re-export them:

```ts
// replaces the two `export type … = '…' | …` lines
import type { ModerationDecision } from '../lib/moderation';
import type { ReportReason } from '../schemas/moderation.schema';
export type { ModerationDecision, ReportReason };
```

Put the two `import type` lines with the file's other imports at the top; leave the `export type { … }` line where the definitions were. `import type` is erased at build time (valid under this repo's `verbatimModuleSyntax`; `moderation.ts` already does `import type … from '../types'`, so the cycle is type-only), so `src/types/index.ts` gains no runtime dependency on `moderation.ts` (which imports the OpenAI client) — verify with the build gate: islands that import from `types/` must still hydrate.

- [ ] **Step 4: Gate and commit**

```bash
bash scratchpad/sweep/gates.sh
npx -y fallow@latest dead-code 2>/dev/null | grep -A8 'Duplicate exports' | head -10
git add src/types/index.ts src/schemas/moderation.schema.ts
git commit -m "chore: single definition for ModerationDecision and ReportReason"
```
Expected: gate exit 0; the fallow „Duplicate exports" section is gone or no longer lists these two names.

---

### Task 5: Nine unread Svelte props

**Files (component → the callers that pass the prop):**
- `src/components/admin/kiosk/ModerationApp.svelte:32` `adminName` → `src/pages/admin/moderation.astro:16`
- `src/components/admin/kiosk/announce/AnnounceApp.svelte:20` `adminName` → `src/pages/admin/announcements.astro:44`
- `src/components/calendar/kiosk/AgendaRow.svelte:21` `onRsvp` → `CalendarDayView.svelte:114,142`, `CalendarAgendaView.svelte:113,135`; both views declare `onRsvp` themselves (`CalendarDayView.svelte:23,32`, `CalendarAgendaView.svelte:23,31`) only to pass it on, and `CalendarPageInner.svelte:496,506` passes `onRsvp={onPickEvent}` into them — the whole chain goes; `onPickEvent` stays (it is also passed as `onPick`)
- `src/components/calendar/kiosk/compose/EventComposePageInner.svelte:43` `currentUser` → `EventComposePage.svelte:24`; `EventComposePage.svelte` declares the prop itself (lines 10–11) only to pass it on, and gets it from `src/pages/events/create.astro:37` and `src/pages/events/edit/[id].astro:69`, each of which builds a `const currentUser = {…}` (`create.astro:29`, `edit/[id].astro:55`) — remove the chain up to and including those two constants IF nothing else in the page reads them
- `src/components/forum/kiosk/BookmarksPage.svelte:13` `currentUserId` → `src/pages/bookmarks.astro:96`
- `src/components/forum/kiosk/compose/ModeratingModal.svelte:23` `onDismiss` → `ComposePageInner.svelte:409`, `EventComposePageInner.svelte:392`, `src/pages/design-system.astro:637`
- `src/components/kiez/kiosk/KzKanalSocial.svelte:20` `plr` → `KiezPageInner.svelte:121`
- `src/components/marketplace/kiosk/detail/OwnerActions.svelte:8` `currentUserId` → `MarketDetailInner.svelte:390`
- `src/components/newsboard/kiosk/primitives/ArticleImage.svelte:9` `sektion` → `browse/NewsCard.svelte:45` (find any other caller with the grep below)

**Interfaces:**
- Produces: none of the nine props is declared or passed. Rendered output identical.

- [ ] **Step 1: For each prop, confirm it is unread**

```bash
# the name must appear ONLY in the $props() destructure / its type in the component
grep -n -E "\badminName\b" src/components/admin/kiosk/ModerationApp.svelte
```
If the name is read anywhere else in the component's CODE (template included), the tool was wrong: leave it, note it in the report. **Comments do not count as reads** — `ModeratingModal.svelte` mentions `onDismiss` in two comments (lines ~14 and ~48); the prop still goes, the comments stay as they are (rewording them is outside the allowed edits).

- [ ] **Step 2: Remove the prop from the component**

Three forms occur in this codebase — remove the name from the destructure AND from the type. The third form is the generic one in `BookmarksPage.svelte`: `let { initialItems = [], currentUserId = null } = $props<{ initialItems?: …; currentUserId?: string | null }>();` → drop `currentUserId` from both braces.

```svelte
<!-- before -->
let { adminName }: { adminName: string } = $props();
<!-- after: the component takes no props; delete the whole statement -->
```

```svelte
<!-- before -->
let {
  imageUrl = '',
  quelle,
  sektion,
  ratio = '16/9',
}: { imageUrl?: string; quelle: QuelleKey; sektion: SektionKey; ratio?: string } = $props();
<!-- after -->
let {
  imageUrl = '',
  quelle,
  ratio = '16/9',
}: { imageUrl?: string; quelle: QuelleKey; ratio?: string } = $props();
```
Then delete imports that only served the removed type (here `SektionKey`, if nothing else uses it). The gate cannot see this for you: svelte-check reports an unused import in a `.svelte` file only as a hint, so check each touched component by eye.

- [ ] **Step 3: Remove the attribute at every caller**

```bash
grep -rn -E "<ArticleImage\b" src --include=*.svelte --include=*.astro
```
Delete `sektion={…}` / `{onRsvp}` / `adminName={adminName}` etc. at each site.

- [ ] **Step 4: Follow the chain one level up**

A caller that only received the value to pass it on now has an unread prop or an unused variable itself (for example `onRsvp` in `CalendarDayView.svelte` / `CalendarAgendaView.svelte`, `adminName` computed in `moderation.astro` frontmatter). Check each:

```bash
grep -n -E "\bonRsvp\b" src/components/calendar/kiosk/CalendarDayView.svelte src/components/calendar/kiosk/CalendarAgendaView.svelte src/components/calendar/kiosk/*.svelte
```
If the name is still used for something else there (another child, a handler), stop. If it is now unread, remove it there too and repeat one level up, until a level where it is used or where it is computed (then delete the computation only if nothing else reads it — in `.astro` frontmatter, check the whole file, the layout may receive it).

- [ ] **Step 5: Gate and commit**

```bash
bash scratchpad/sweep/gates.sh
npx -y fallow@latest dead-code 2>/dev/null | grep -A12 'Unused component props' | head -14
git add src && git commit -m "chore: remove nine component props that nothing read"
```
Expected: gate exit 0 (svelte-check must not rise; it may drop); the fallow section is gone, or lists only props you ruled KEEP.

- [ ] **Step 6: Write the two callback findings into the task report**

State plainly, for the owner: `AgendaRow` accepted `onRsvp` and never called it — an agenda row has no RSVP action today (the page passed its open-the-event handler `onPickEvent` under that name, so wiring it would have opened the event, not RSVPed). `ModeratingModal` accepted `onDismiss` and never called it — the moderation-progress modal cannot be dismissed by the member. Removing the props keeps exactly that behaviour; wiring them would be a feature and is not part of this plan.

---

### Task 6: The unused dark-glass CSS

**Files:**
- Modify: `src/styles/global.css` — the „Dark glass page background" block (`.dark-glass-bg`, `.dark-glass-gradient`, `.dark-glass-gradient-drift`, its `@media` wrapper, `@keyframes dark-glass-drift`; starts at the comment on line ~90) and the „Glass Add-ons" block (`.glass-inner-glow`, `.glass-luxe`, `.glass-luxe-edge`, `.low-perf …`, `.glass-smooth`, `.glass-smooth-edge` with their `::after`, `> *`, `:hover` and reduced-motion rules; from the `/* ─── Glass Add-ons ─── */` comment on line ~399 to the rule before the `/* Native <select> open-list styling` comment on line ~580)
- Modify: root `CLAUDE.md` sections „Glass Utility System" and „Low-perf Device Detector"
- NOT touched: `src/layouts/KioskLayout.astro` (its header comment mentions `GlassFilters` and the low-perf detector — history, leave it) and the area `CLAUDE.md` files under `src/**` that mention glass classes or removed symbols.

**Interfaces:**
- Produces: no selector containing `glass-` or `dark-glass` or `low-perf` in `global.css`. Everything else in the file byte-identical.

**Not in scope (leave untouched, even if they look legacy):** `.carved-title` and `--carved-accent`, `.font-space-grotesk`, the `option { … }` rule, the Google-Fonts `@import` on line 1, every `.kiosk-*` / `.am-*` block.

- [ ] **Step 1: Prove no markup uses the classes**

```bash
# a) literal class names anywhere outside the stylesheet
grep -rn -E "glass-(inner-glow|luxe|luxe-edge|smooth|smooth-edge)|dark-glass-(bg|gradient)|low-perf" \
  src public --include=*.astro --include=*.svelte --include=*.tsx --include=*.ts --include=*.mdx --include=*.md --include=*.html --include=*.js \
  | grep -v '^src/styles/' | grep -v -E '^\S+:\s*(//|\*|<!--)'
# b) names assembled from pieces
grep -rn -E "['\"\`]glass-|['\"\`]dark-glass|glass-\$\{|'glass' *\+" src --include=*.astro --include=*.svelte --include=*.tsx --include=*.ts
# c) other stylesheets that extend or reference them
grep -rn -E "glass-|dark-glass|low-perf|glass-distortion" src/styles --include=*.css | grep -v '^src/styles/global.css'
```
Expected: (a) nothing but comment lines, (b) nothing, (c) nothing. Any real hit: STOP, keep the rule that hit needs, report.

- [ ] **Step 2: Record the stylesheet's selectors before the edit**

```bash
grep -o -E "^[.@#a-zA-Z\[:][^{]*\{" src/styles/global.css | sed 's/ *{$//' | sort > scratchpad/sweep/selectors-before.txt
wc -l scratchpad/sweep/selectors-before.txt
```

- [ ] **Step 3: Delete the two blocks**

Block 1 (lines 90–128 on `main @ 71779106`): delete from the comment `/* Dark glass page background — fixed position, covers BaseLayout body bg.` through the closing brace of `@keyframes dark-glass-drift { … }`. Everything from the following `/* Google Fonts + utility font classes` comment on (`.font-inter`, `.font-space-grotesk`, `.carved-title` …) stays.

Block 2 (lines 399–578 before block 1 was removed): delete from `/* ─── Glass Add-ons ─── */` through the closing brace of `.glass-smooth-edge > * { … }`. The comment `/* Native <select> open-list styling` and its `option` rule stay.

- [ ] **Step 4: Verify only glass selectors left the file**

```bash
grep -o -E "^[.@#a-zA-Z\[:][^{]*\{" src/styles/global.css | sed 's/ *{$//' | sort > scratchpad/sweep/selectors-after.txt
comm -23 scratchpad/sweep/selectors-before.txt scratchpad/sweep/selectors-after.txt
grep -c -E "glass|low-perf" src/styles/global.css
```
Expected: every removed selector contains `glass`, `low-perf`, `dark-glass-drift`, or is a `@media (prefers-reduced-motion: no-preference)` / `(prefers-reduced-motion: reduce)` wrapper of one of them; nothing else. The remaining count is 3, all comments and no selector: line 1 (font `@import` comment), `/* Carved/beveled glass text effect` above `.carved-title`, and the `/* Native <select> … dark glass palette` comment.

- [ ] **Step 5: Update root `CLAUDE.md`**

Replace the body of „### Glass Utility System" (keep the heading) with:

```markdown
Removed 2026-10-01: the five `.glass-*` utilities, the `.dark-glass-*` page background and the `.low-perf` override left `global.css` with the unused-exports sweep — no live surface had used them since the kiosk migrations. The reasoning that outlived them: put a heavy `filter`/`backdrop-filter` on a `::after`, never on a host that can contain a `position: fixed` overlay (see „`backdrop-filter` creates a containing block" below), and drop SVG filters under `prefers-reduced-motion`. The old rules are in git history before that date.
```

In „### Low-perf Device Detector", change the sentence beginning `` `.low-perf .glass-luxe-edge::after, … in `global.css` drops the filter `` to past tense and add „(rule removed 2026-10-01 with the glass block)". In „## Development Commands", change the sweep comment's tail `parked: ~100 unused exports, 60 unused types, 9 unread Svelte props, the `global.css` glass block.` — leave it for Task 7.

- [ ] **Step 6: Gate and commit**

```bash
bash scratchpad/sweep/gates.sh
git add src/styles/global.css CLAUDE.md
git commit -m "chore: remove the unused dark-glass CSS"
```
Expected: exit 0, `GATE build: ok`.

---

### Task 7: Preview smoke, ratchet, closing docs

**Files:**
- Create: `scratchpad/sweep/smoke.cjs` (gitignored)
- Modify: `.github/workflows/checks.yml` (only if a budget dropped)
- Modify: root `CLAUDE.md` („## Development Commands" sweep comment)

**Interfaces:**
- Consumes: the pushed branch's Vercel preview URL.
- Produces: a 9-page logged-in smoke result; budgets ratcheted; docs say the sweep is closed.

- [ ] **Step 1: Push the branch and wait for the preview**

```bash
git push -u origin chore/unused-exports-sweep
vercel ls 2>/dev/null | grep -m1 -o 'https://[^ ]*'     # the newest deployment URL
```
Poll that URL every 30 s until it answers 200 on `/login` (never loop on `vercel inspect`).

- [ ] **Step 2: Write the smoke driver**

Create `scratchpad/sweep/smoke.cjs` (the dev test password is read from `scratchpad/devpw.txt` and never printed):

```js
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2];
const PW = fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim();
const PAGES = ['/forum', '/calendar', '/marketplace', '/newsboard', '/schillerkiez', '/blog', '/profile', '/bookmarks', '/entwuerfe'];
(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'ayse@mahalle-dev.test');
    await page.fill('input[type="password"]', PW);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
    for (const p of PAGES) {
      errors.length = 0;
      const res = await page.goto(BASE + p, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500); // client:only islands hydrate after load
      const text = (await page.locator('main').first().innerText().catch(() => '')).trim();
      const unstyled = await page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)');
      const ok = res.status() === 200 && text.length > 40 && errors.length === 0 && !unstyled;
      if (!ok) failed++;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${w}px ${p} — status ${res.status()}, main ${text.length} chars, ${errors.length} page errors${errors[0] ? ' (' + errors[0] + ')' : ''}${unstyled ? ', body unstyled' : ''}`);
      await page.screenshot({ path: `scratchpad/sweep/shot-${w}-${p.slice(1)}.png` });
    }
    await ctx.close();
  }
  await browser.close();
  console.log(failed ? `FAILED: ${failed}` : 'ALL OK');
  process.exit(failed ? 1 : 0);
})();
```

- [ ] **Step 3: Run it against the preview**

```bash
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/sweep/smoke.cjs https://<preview-url>
```
Expected: 18 `OK` lines, `ALL OK`. Also open the admin pages once by eye-equivalent: log in as `admin@mahalle-dev.test` (same password file) and load `/admin/moderation` and `/admin/announcements` (their `adminName` prop went in Task 5) — both must render their queue/board. Look at three screenshots (`shot-390-forum.png`, `shot-1440-marketplace.png`, `shot-1440-newsboard.png`) and confirm normal styling.

- [ ] **Step 4: Ratchet the CI budgets if a count dropped**

```bash
grep -E '^GATE (tsc|svelte-check)' <(SKIP_BUILD=1 bash scratchpad/sweep/gates.sh)
grep -n -E 'TSC_ERROR_BUDGET|SVELTE_CHECK_ERROR_BUDGET' .github/workflows/checks.yml
```
If `tsc` is below 16 or `svelte-check` below 81, set the budget to the new number in `checks.yml` and add one comment line in the block above it in the file's existing style (`# Lowered A/B→C/D on 2026-10-01: the unused-exports sweep.`). Update the two numbers in root `CLAUDE.md` („ratchet-only error budgets: tsc ≤16, svelte-check ≤81 (… )") and append the same clause to its history parenthesis. If neither dropped, change nothing.

- [ ] **Step 5: Close the sweep in root `CLAUDE.md`**

In „## Development Commands", replace `— the sweep is closed; parked: ~100 unused exports, 60 unused types, 9 unread Svelte props, the `global.css` glass block.` with:

```
— the file/package sweep is closed; the remainder (unused exports and types, 9 unread Svelte props, the duplicate `ModerationDecision`/`ReportReason`, the `global.css` glass block) landed 2026-10-01 with `docs/superpowers/plans/2026-10-01-unused-exports-sweep.md`. What the tools still report afterwards is the KEEP list in that plan's inventory file (symbols used only by `scripts/`, `scratchpad/`, tests or root configs).
```

- [ ] **Step 6: Final tool run and commit**

```bash
npx -y fallow@latest dead-code 2>/dev/null | grep -E '^● (Unused exports|Unused type exports|Duplicate exports|Unused component props)'
git add CLAUDE.md .github/workflows/checks.yml
git commit -m "docs: unused-exports sweep closed; budgets ratcheted where they dropped"
git push
```
Expected: the remaining counts equal the inventory's `KEEP` rows; put the four numbers and the list of anything kept by ruling into the final report, together with: packages that lost their last importer (Task 3), the two never-wired callbacks (Task 5), and total lines removed (`git diff --shortstat main...HEAD`).
