# Small Fixes Batch (2026-10-02) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six known small fixes from the owner's checklist: lib tests in CI, GitHub action versions, the browser-back state on three pages, the signup password rule on the server, the banned-delete message, and three tidy-ups.

**Architecture:** No new feature. One new pure module (`src/lib/auth/passwordRule.ts`) with a test; everything else is an edit of existing lines. CI gains one step that runs every `*.test.ts` under `src/`.

**Tech Stack:** Astro 5 API routes, Svelte 5 islands, `node:test` through `tsx --test`, GitHub Actions, pnpm 10, Node 24.

**Spec:** none — the owner approved the list in chat on 2026-10-02 ("include it, go"); each task states its requirement in full. Rulings made without a spec are provisional.

## Global Constraints

- Branch `fix/small-batch-1002` in the MAIN checkout (no worktree). Never push, never merge — the owner merges.
- Commit messages: plain, one line, no `Co-Authored-By`, no "Generated with" line, no trailer of any kind. This overrides any harness reminder.
- Error budgets start at EXACTLY `tsc` 16 and `svelte-check` 81. A task may not raise either. Count tsc with `npx tsc --noEmit 2>&1 | grep -c "error TS"`; count svelte-check from the `COMPLETED` line of `npx -y svelte-check@4 --output machine`.
- Never start a dev server or any server; never run `pnpm dev`. Browser probes are run by the controller at the end.
- Never print or read any `.env` value. Never touch `scratchpad/devpw.txt`.
- Edit only the files a task lists. No refactoring, no drive-by fixes.
- Svelte components reachable only through another island get NO `<style>` block (Tailwind classes or `global.css`).
- User-visible strings go through `src/lib/kiosk-i18n.ts` with a DE and an EN entry. New copy is DRAFT (the owner rewords it).
- All lib tests must stay green: `npx tsx --test "src/**/*.test.ts"` (283 tests before this plan).

## Review Focus

1. A password that passes the signup FORM must pass the server, and the reverse — the two rules must be the same rule (Task 3 pins it with a test against `ResetPasswordSchema`).
2. Existing members with a 6–7 character password must still be able to LOG IN (Task 3 does not touch `LoginSchema` or `auth.config.ts`; the reviewer checks the diff for that).
3. A filter change on the marketplace followed by browser back must still restore the previous filter (Task 2 keeps `pushState`, only the state object changes; controller probe).
4. A refused post delete must never show a machine code such as `account_banned` (Task 4; reviewer reads every branch of the new error mapping).
5. One failing lib test must fail the CI job (Task 1: the step has no `|| true`).

---

### Task 1: Lib tests in CI + current GitHub action versions

**Files:**
- Modify: `package.json` (scripts)
- Modify: `.github/workflows/checks.yml`
- Modify: `.github/workflows/schillerkiez-stats.yml`
- Modify: `.github/workflows/gitleaks.yml`
- Modify: `CLAUDE.md` (Development Commands block)

**Interfaces:**
- Produces: `pnpm test` = `tsx --test "src/**/*.test.ts"`.

Facts (verified 2026-10-02): all 47 test files use `node:test`; `npx tsx --test "src/**/*.test.ts"` runs 283 tests in ~6 s without any env var. Latest majors: `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`, `gitleaks/gitleaks-action@v3` (v3 = Node 24 runtime, no input changes). `setup-node` v6+ auto-caches only npm; both workflows already pass `cache: pnpm` explicitly, keep that line.

- [ ] **Step 1: Add the script.** In `package.json` `"scripts"`, after the `"check:svelte"` line add:

```json
    "test": "tsx --test \"src/**/*.test.ts\"",
```

- [ ] **Step 2: Run it.** `pnpm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → `tests 283`, `pass 283`, `fail 0`.

- [ ] **Step 3: Add the CI step.** In `.github/workflows/checks.yml`, append as the LAST step of the `budgets` job (same indentation as `- name: svelte-check budget`):

```yaml
      # Every src/**/*.test.ts (node:test via tsx). Pure tests, no secrets.
      # No "|| true": one failing test fails the job.
      - name: lib tests
        run: pnpm test
```

- [ ] **Step 4: Bump the actions.** Exact replacements (each must match the count given):
  - `checks.yml`: `actions/checkout@v4` → `actions/checkout@v7` (1), `pnpm/action-setup@v4` → `pnpm/action-setup@v6` (1), `actions/setup-node@v4` → `actions/setup-node@v7` (1).
  - `schillerkiez-stats.yml`: the same three replacements (1 each).
  - `gitleaks.yml`: `actions/checkout@v4` → `actions/checkout@v7` (1), `gitleaks/gitleaks-action@v2` → `gitleaks/gitleaks-action@v3` (1).
  Verify: `grep -n "uses:" .github/workflows/*.yml` shows 8 lines, none ending in `@v4` or `@v2`.

- [ ] **Step 5: Document.** In `CLAUDE.md`, directly after the line starting `pnpm type-check   # TypeScript validation`, add:

```
pnpm test         # all lib tests (src/**/*.test.ts, node:test via tsx) — also a step in checks.yml since 2026-10-02
```

- [ ] **Step 6: Validate YAML.** `node -e "const y=require('js-yaml');for(const f of ['checks','schillerkiez-stats','gitleaks'])y.load(require('fs').readFileSync('.github/workflows/'+f+'.yml','utf8'));console.log('yaml ok')"` → `yaml ok`. (If `js-yaml` is not resolvable, use `python3 -c "import yaml,sys;[yaml.safe_load(open('.github/workflows/'+f+'.yml')) for f in ['checks','schillerkiez-stats','gitleaks']];print('yaml ok')"`.)

- [ ] **Step 7: Commit.** `git add package.json .github/workflows/checks.yml .github/workflows/schillerkiez-stats.yml .github/workflows/gitleaks.yml CLAUDE.md && git commit -m "ci: run lib tests, bump actions to Node 24 majors"`

---

### Task 2: Keep the router's history state (calendar, Kurier, market)

**Files:**
- Modify: `src/components/calendar/kiosk/CalendarPageInner.svelte` (lines ~94 and ~391)
- Modify: `src/components/newsboard/kiosk/NewsboardIndexInner.svelte` (line ~132)
- Modify: `src/components/marketplace/kiosk/browse/MarketplaceBrowseInner.svelte` (lines ~243 and ~305)

Why: Astro's ClientRouter keeps `{ index, scrollX, scrollY }` in `history.state` and reads `state.index` on `popstate`. Passing `{}` wipes it. The forum index already passes `history.state` through (root `CLAUDE.md` → "Astro Script + ViewTransitions"). The market's `pushState` STAYS a push (browser back steps through filters; the island has its own `popstate` listener) — only its state object changes: it copies the current entry's state, so the entry keeps a valid `index` and Astro's own counter stays in step.

- [ ] **Step 1: Five exact replacements** (each `old` string occurs exactly once in its file; assert that before replacing):

`CalendarPageInner.svelte`:
```
window.history.replaceState({}, '', clean);
→
window.history.replaceState(window.history.state, '', clean);
```
```
window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
→
window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : ''));
```

`NewsboardIndexInner.svelte`:
```
window.history.replaceState({}, '', url.toString());
→
window.history.replaceState(window.history.state, '', url.toString());
```

`MarketplaceBrowseInner.svelte`:
```
    history.pushState({}, '', url.toString());
→
    // Copy the current entry's state: Astro's ClientRouter reads state.index on popstate.
    history.pushState(history.state, '', url.toString());
```
```
      window.history.replaceState({}, '', url.toString());
→
      window.history.replaceState(window.history.state, '', url.toString());
```

- [ ] **Step 2: Verify none is left.** `grep -rn -E "(replace|push)State\(\s*\{\}" src --include=*.svelte --include=*.ts --include=*.astro` → no output.

- [ ] **Step 3: Gates.** svelte-check COMPLETED line shows 81 errors; `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 16.

- [ ] **Step 4: Commit.** `git add src/components/calendar/kiosk/CalendarPageInner.svelte src/components/newsboard/kiosk/NewsboardIndexInner.svelte src/components/marketplace/kiosk/browse/MarketplaceBrowseInner.svelte && git commit -m "fix: keep the router's history state on calendar, Kurier and market"`

(The browser check is the controller's — see Final Gate.)

---

### Task 3: One password rule for signup, enforced on the server

**Files:**
- Create: `src/lib/auth/passwordRule.ts`
- Create: `src/lib/auth/passwordRule.test.ts`
- Modify: `src/pages/api/auth/register.ts` (the `password.length < 6` block, ~line 40)
- Modify: `src/components/auth/kiosk/AuthRegisterInner.svelte` (server-error mapping, ~line 84)

**Interfaces:**
- Produces: `isAcceptablePassword(pw: unknown): boolean`, `PASSWORD_MIN = 8`, `PASSWORD_MAX = 100`.

Today the signup FORM requires 8+ characters with a lowercase letter, an uppercase letter and a digit (`pwOk` in `AuthRegisterInner.svelte`), and password change / reset enforce the same through `ChangePasswordSchema` / `ResetPasswordSchema`; only `POST /api/auth/register` accepts 6 characters of anything. New rule on the server = the form's rule. Login is NOT touched: members with an older, shorter password keep logging in.

- [ ] **Step 1: Write the failing test** — `src/lib/auth/passwordRule.test.ts`:

```ts
// Run: npx tsx --test src/lib/auth/passwordRule.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAcceptablePassword, PASSWORD_MIN, PASSWORD_MAX } from './passwordRule';
import { ResetPasswordSchema } from '../../schemas/auth.schema';

test('accepts 8+ characters with lower, upper and digit', () => {
  assert.equal(isAcceptablePassword('Abcdefg1'), true);
  assert.equal(isAcceptablePassword('Sch1llerkiez!'), true);
});

test('refuses short, one-class and non-string input', () => {
  assert.equal(isAcceptablePassword('Abcde1'), false);        // 6 — the old server minimum
  assert.equal(isAcceptablePassword('Abcdef1'), false);       // 7
  assert.equal(isAcceptablePassword('abcdefg1'), false);      // no uppercase
  assert.equal(isAcceptablePassword('ABCDEFG1'), false);      // no lowercase
  assert.equal(isAcceptablePassword('Abcdefgh'), false);      // no digit
  assert.equal(isAcceptablePassword(''), false);
  assert.equal(isAcceptablePassword(undefined), false);
  assert.equal(isAcceptablePassword(12345678), false);
  assert.equal(isAcceptablePassword({ length: 12 }), false);
});

test('length bounds are inclusive', () => {
  assert.equal(PASSWORD_MIN, 8);
  assert.equal(PASSWORD_MAX, 100);
  assert.equal(isAcceptablePassword('Aa1' + 'x'.repeat(97)), true);   // 100
  assert.equal(isAcceptablePassword('Aa1' + 'x'.repeat(98)), false);  // 101
});

test('agrees with the reset-password schema on every sample', () => {
  const samples = ['Abcdefg1', 'Abcde1', 'abcdefg1', 'ABCDEFG1', 'Abcdefgh', '', 'Aa1' + 'x'.repeat(97), 'Aa1' + 'x'.repeat(98), 'Äbcdefg1', 'ÄÖÜäöü12'];
  for (const pw of samples) {
    const schemaOk = ResetPasswordSchema.safeParse({ token: 't', password: pw, confirmPassword: pw }).success;
    assert.equal(isAcceptablePassword(pw), schemaOk, `sample ${JSON.stringify(pw)}`);
  }
});
```

- [ ] **Step 2: Run it, expect failure.** `npx tsx --test src/lib/auth/passwordRule.test.ts` → fails (module not found).

- [ ] **Step 3: Write the module** — `src/lib/auth/passwordRule.ts`:

```ts
// The one password rule for NEW passwords (signup). Dependency-pure: safe for islands.
// Same rule as ChangePasswordSchema / ResetPasswordSchema in src/schemas/auth.schema.ts
// (pinned by passwordRule.test.ts). Login is deliberately not bound to it: members
// with an older, shorter password must keep logging in.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 100;

export function isAcceptablePassword(pw: unknown): boolean {
  if (typeof pw !== 'string') return false;
  if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) return false;
  return /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw);
}
```

- [ ] **Step 4: Run the test, expect pass.** Same command → 4 tests pass. If the last test fails on an umlaut sample, the SCHEMA is the authority: change nothing in the schema, report the sample and the two results as DONE_WITH_CONCERNS.

- [ ] **Step 5: Use it in the route.** In `src/pages/api/auth/register.ts` add the import after the `parseMemberType` import:

```ts
import { isAcceptablePassword } from "../../../lib/auth/passwordRule";
```

and replace

```ts
        if (password.length < 6) {
            return new Response(
                JSON.stringify({ error: 'Password must be at least 6 characters' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
```

with

```ts
        // Same rule as the signup form (8–100 characters, lower + upper + digit).
        // Until 2026-10-02 the server accepted 6 characters of anything.
        if (!isAcceptablePassword(password)) {
            return new Response(
                JSON.stringify({ error: 'password_weak' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
```

- [ ] **Step 6: Map the code in the form.** In `src/components/auth/kiosk/AuthRegisterInner.svelte`, directly after the line

```ts
        if (code === 'member_type_invalid') { memberTypeErr = $t['auth.err.memberType']; status = 'idle'; return; }
```

add

```ts
        if (code === 'password_weak') { pwErr = $t['auth.err.pwWeak']; status = 'idle'; return; }
```

(`auth.err.pwWeak` exists in DE and EN — no new copy.)

- [ ] **Step 7: Gates.** `pnpm test`-equivalent `npx tsx --test "src/**/*.test.ts" 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → `tests 287`, `fail 0`; tsc 16; svelte-check 81. Confirm with `git diff --stat` that `src/schemas/auth.schema.ts` and `auth.config.ts` are NOT in the diff.

- [ ] **Step 8: Commit.** `git add src/lib/auth/passwordRule.ts src/lib/auth/passwordRule.test.ts src/pages/api/auth/register.ts src/components/auth/kiosk/AuthRegisterInner.svelte && git commit -m "fix: signup enforces the form's password rule on the server"`

---

### Task 4: A refused post delete shows a sentence, never a code

**Files:**
- Modify: `src/lib/kiosk-i18n.ts` (two keys, DE + EN)
- Modify: `src/components/forum/kiosk/ForumPostDetail.svelte` (`confirmDelete`, ~line 455)

Today `confirmDelete()` throws `new Error(err.error || 'Löschen fehlgeschlagen.')` and prints the message — a banned member sees the literal `account_banned`, everyone else may see any internal error string, and the fallback is German on an English page.

- [ ] **Step 1: Add the copy.** In `src/lib/kiosk-i18n.ts`, directly after the DE line `'comment.toast.delete.error': 'Konnte nicht gelöscht werden.',` add:

```ts
  'detail.delete.error': 'Löschen fehlgeschlagen. Bitte versuch es erneut.',
  'detail.delete.banned': 'Dein Konto ist gesperrt — Löschen ist nicht möglich.',
```

and directly after the EN line `'comment.toast.delete.error': "Couldn't delete the comment.",` add:

```ts
  'detail.delete.error': "Couldn't delete the post. Please try again.",
  'detail.delete.banned': 'Your account is suspended — deleting is not possible.',
```

(Each anchor line occurs exactly once; assert that.)

- [ ] **Step 2: Replace the handler body.** In `ForumPostDetail.svelte` replace

```ts
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Löschen fehlgeschlagen.');
      }
      if (typeof window !== 'undefined') window.location.href = '/forum';
    } catch (err) {
      editError = err instanceof Error ? err.message : 'Löschen fehlgeschlagen.';
      deleting = false;
    }
```

with

```ts
      if (!res.ok) {
        // Never print the API's machine code (a banned member used to read "account_banned").
        const err = await res.json().catch(() => ({}));
        editError = err?.error === 'account_banned' ? $t['detail.delete.banned'] : $t['detail.delete.error'];
        deleting = false;
        return;
      }
      if (typeof window !== 'undefined') window.location.href = '/forum';
    } catch {
      editError = $t['detail.delete.error'];
      deleting = false;
    }
```

- [ ] **Step 3: Gates.** tsc 16; svelte-check 81; `grep -n "Löschen fehlgeschlagen" src/components/forum/kiosk/ForumPostDetail.svelte` → no output.

- [ ] **Step 4: Commit.** `git add src/lib/kiosk-i18n.ts src/components/forum/kiosk/ForumPostDetail.svelte && git commit -m "fix: refused post delete shows a localized sentence, not the API code"`

---

### Task 5: Tidy-ups (no behaviour change)

**Files:**
- Modify: `src/pages/api/listings/draft.ts`, `src/pages/api/listings/upload.ts`, `src/pages/api/news/upload.ts`, `src/pages/api/posts/upload.ts`
- Modify: `src/lib/forumMutations.ts`
- Modify: `src/components/forum/kiosk/compose/ComposePageInner.svelte` (comment only)
- Modify: `src/lib/adminModeration.ts` (comment only)

- [ ] **Step 1: Four unused variables.** In each of the four route files replace the one line `    const { session, userId } = gate;` with `    const { userId } = gate;`. Before replacing, confirm with `grep -n "session" <file>` that `session` appears on no other code line of that file (comments may mention it).

- [ ] **Step 2: The write-only store.** `lastSubmittedAt` in `src/lib/forumMutations.ts` is set after a post and read by nothing (the feed footer's live mode is driven by `?just_posted=1`). Remove:
  - in the header comment, the two lines starting ` * lastSubmittedAt: a tiny writable` and ` * topic create. FeedStatusFooter reads it` and the blank ` *` line directly above them;
  - `import { writable } from 'svelte/store';` — ONLY if `grep -n "writable" src/lib/forumMutations.ts` shows no other use after the removal below;
  - the whole block from `// ─── Live-mode signal for FeedStatusFooter` through the closing `}` of `function flagLive()` (the store, `LIVE_WINDOW_MS`, the function);
  - the single call line `      flagLive();` inside `onSuccess`.
  Then `grep -n "lastSubmittedAt\|flagLive\|LIVE_WINDOW_MS" src/lib/forumMutations.ts` → no output.

- [ ] **Step 3: The comment that named the store.** In `ComposePageInner.svelte` replace

```
  // home page (handles the cross-page navigation case the
  // forumMutations.ts in-memory `lastSubmittedAt` writable can't span).
```

with

```
  // home page (compose leaves by a hard navigation, so the signal travels in the URL).
```

- [ ] **Step 4: The stale comment.** In `src/lib/adminModeration.ts` replace

```
 * `ADM_REPORT_REASONS` is expanded from the JSX's 5 entries to the real
 * `ReportReason` schema's 7 (adds `hate_speech` + `violence`).
```

with

```
 * `AdmReportReason` lists the real `ReportReason` schema's 7 values (the JSX
 * had 5; `hate_speech` + `violence` were added).
```

- [ ] **Step 5: Gates.** tsc 16; svelte-check 81; `npx tsc --noEmit --noUnusedLocals 2>&1 | grep TS6133 | grep -c "'session'"` → 0; lib tests green.

- [ ] **Step 6: Commit.** `git add src/pages/api/listings/draft.ts src/pages/api/listings/upload.ts src/pages/api/news/upload.ts src/pages/api/posts/upload.ts src/lib/forumMutations.ts src/components/forum/kiosk/compose/ComposePageInner.svelte src/lib/adminModeration.ts && git commit -m "chore: drop four unused variables, a write-only store and a stale comment"`

---

## Final Gate (controller, not a subagent)

1. `npx tsc --noEmit | grep -c "error TS"` = 16; svelte-check 81; `pnpm test` = 287 pass; `npx astro build --config scratchpad/astro.config.preview.mjs` exits 0.
2. Serve the build (`PORT=4655 HOST=127.0.0.1 node --env-file=.env dist/server/entry.mjs`, stopped in its own shell call) and run `scratchpad/batch-1002/probe.cjs` at 390 px, logged in as the dev member:
   - `/newsboard?just_submitted=1`, `/calendar?just_posted=1`, `/calendar?event=000000000000000000000000`, `/marketplace?just_posted=1`: after the param is stripped, `typeof history.state?.index === 'number'`.
   - `/marketplace`: change one filter → URL changes and `typeof history.state?.index === 'number'`; browser back → the URL returns to the unfiltered one.
   - `POST /api/auth/register` with password `abcdefg1` → 400 `{ error: 'password_weak' }` (no account is created: the check runs before any write).
3. Opus final review of `main..HEAD`.
4. After the owner's merge + push: `gh run list --limit 3` — `checks` (with the new `lib tests` step) and `gitleaks` must be green on the new action versions. `schillerkiez-stats.yml` uses the same three actions as `checks.yml` and is not dispatched (it writes to the production database).
