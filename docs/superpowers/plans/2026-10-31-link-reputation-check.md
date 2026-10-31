# Link Reputation Check (Google Safe Browsing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every http(s) link a member submits in a post, comment, event, listing or news tip is looked up in Google Safe Browsing at submit time; a known malware / phishing / unwanted-software URL sends the content into the moderation queue with its own label.

**Architecture:** One server-only module `src/lib/linkReputation.ts` (env key, fetch with a 5 s timeout, Sentry warning on failure) over pure, tested helpers in `src/lib/linkReputationRules.ts` (URL extraction via `linkify.ts`, request body, verdict). The existing `moderateContent()` in `src/lib/moderation.ts` is renamed to the private `moderateWithOpenAI()` and a new `moderateContent()` runs both in parallel and merges — so all twelve create/edit routes that already call `moderateText()`/`moderatePost()` gain the check without being touched; `news/submit.ts` additionally checks its `sourceUrl`. A hit is a `ModerationResult` with category `unsafe_link`, urgent, merged through the existing `mergeModerationResults()`; the admin queue shows a new chip label.

**Tech Stack:** Node `fetch`, Google Safe Browsing Lookup API v4 (`POST https://safebrowsing.googleapis.com/v4/threatMatches:find?key=…`), `node:test` via tsx, `@sentry/astro`.

**Spec:** none written — the design is the audited research note in this plan's „Research audit (2026-10-31)" section below, confirmed by the owner in chat 2026-10-31 12:03 („let us verify/audit your research and then do it"). Rulings made without a spec are provisional.

## Research audit (2026-10-31)

Verified against Google's docs today (sources at the end):

- **API shape:** `POST /v4/threatMatches:find?key=API_KEY`, body `{ client: { clientId, clientVersion }, threatInfo: { threatTypes, platformTypes, threatEntryTypes: ['URL'], threatEntries: [{ url }] } }`; ≤ 500 URLs per request; response `{}` when clean, else `{ matches: [{ threatType, platformType, threatEntryType, threat: { url }, cacheDuration }] }`.
- **Enums:** `ThreatType` = `MALWARE`, `SOCIAL_ENGINEERING`, `UNWANTED_SOFTWARE`, `POTENTIALLY_HARMFUL_APPLICATION`; `PlatformType` includes `ANY_PLATFORM` („at least one platform"). We query all four threat types on `ANY_PLATFORM`.
- **Status:** v4 and v5 are both production; no v4 sunset announced (Google promises ≥ 1 year notice). v4 Lookup is the simplest fit.
- **Terms:** „The Safe Browsing API is for non-commercial use only (meaning ‚not for sale or revenue generating purposes')." Mahalle is PolyForm-noncommercial and takes no revenue → fits. Commercial use would need Web Risk (paid).
- **Quota:** a default daily quota is assigned on enabling the API and shown in the Cloud Console; no public number. Mahalle's volume (a few dozen link-bearing submissions a day) is far below any plausible default.
- **Privacy:** the Lookup API sends the full URL to Google (the Update API would send hash prefixes, but needs a local database — out of proportion here). Only URLs contained in the submitted text are sent, never account data → one DRAFT sentence in the Datenschutz processor list, owner reviews.
- **Warning rules:** Google's attribution/wording rules apply to warnings SHOWN TO USERS. We show members only the existing „under review" message; the admin-only chip and reason name Google Safe Browsing. No public warning page → no attribution UI needed.
- **Test URLs:** `https://testsafebrowsing.appspot.com/s/malware.html`, `/s/phishing.html`, `/s/unwanted.html` are Google's own test pages and match the lists — used by the contract probe and the e2e probe.
- **Rejected then and now:** fetching the link target server-side (SSRF surface; destination can change after the check). The lookup compares the URL string only.

Sources: [Lookup API v4](https://developers.google.com/safe-browsing/v4/lookup-api) · [Usage limits / permitted use](https://developers.google.com/safe-browsing/v4/usage-limits) · [ThreatType](https://developers.google.com/safe-browsing/reference/rest/v4/ThreatType) · [PlatformType](https://developers.google.com/safe-browsing/reference/rest/v4/PlatformType) · [v4 vs v5](https://developers.google.com/safe-browsing/reference) · [Test pages](https://testsafebrowsing.appspot.com/)

## Audit (2026-10-31 12:18, owner: „audit the plan")

Checked against the code, folded in: (1) `hitsFromLookup` no longer filters on „URLs we sent" — Google may echo a canonicalised URL and the filter would have dropped real hits; (2) the motto path and the anonymous contact relay already run `moderateText` and REFUSE on a non-approved result, so a flagged link is refused there — documented, plus a `shortTextVerdict` test; (3) the Datenschutz sentence stands apart from the Art. 28 sentence (no contract with Google for this API); (4) Telegram's `moderation_flagged` alert prints no category, so the raw key never reaches the phone; (5) `listings/create.ts` builds its record through `mergeModerationResults(moderationResult, …)`, so the merged `moderatePost` result carries the chip there too. Test count 533.

## Global Constraints

- Admins stay exempt from all moderation (routes skip the pipeline on `role === 'admin'`) — the check inherits that for free; do not add an admin bypass inside the module.
- A lookup FAILURE (network, 4xx/5xx, timeout, malformed JSON) NEVER holds content: return the approved shape and send ONE static Sentry message `link check: Safe Browsing lookup failed — content not held` (level `warning`, variable detail in `extra.reason`), `await Sentry.flush(2000)`. Rationale: a Google outage must not queue every post with a link; the OpenAI fail-safe already guards the content itself.
- `SAFE_BROWSING_API_KEY` unset ⇒ silent no-op (approved shape, no Sentry) — dev, preview and demo default. Read via `process.env` at request time (like `GOATCOUNTER_ENDPOINT`), never `import.meta.env`.
- Only `http(s)` URLs, deduplicated, trailing sentence punctuation stripped (reuse `linkify.ts` rules), at most 50 per check (`MAX_URLS_PER_CHECK = 50`).
- Timeout 5 000 ms via `AbortSignal.timeout`.
- Category key `unsafe_link` (one chip; the threat type rides in `adminReason`), `isUrgent: true`, `maxScore: 1`, `highestCategory: 'unsafe_link'`, `scores: {}`.
- `adminReason` format: `Safe Browsing: <THREAT_TYPE> — <url>` joined by `; ` for several hits, e.g. `Safe Browsing: SOCIAL_ENGINEERING — https://testsafebrowsing.appspot.com/s/phishing.html`.
- Client identification: `clientId: 'mahalle-digital'`, `clientVersion: '1.0.0'`.
- Budgets exact: tsc 16, svelte-check 81, `pnpm test` grows by exactly the new tests (511 today). Never raise a budget.
- Commit messages plain, no signature/footer. The USER pushes and sets the prod env var.
- i18n copy for the admin chip: DE `Unsicherer Link`, EN `Unsafe link`. Datenschutz sentence is DRAFT (owner reviews).

## Review Focus

1. A URL followed by sentence punctuation („… siehe https://evil.example/phish.") must be looked up without the trailing dot — Task 1 test `trailing punctuation is stripped before lookup`.
2. The same URL pasted three times must be sent once (quota, 500-URL cap) — Task 1 test `duplicates collapse`.
3. A profane post with a bad link short-circuits in the blocklist; the link check must still not throw or double-queue — Task 3 test `profanity short-circuit wins, link check result discarded or merged — never two records`.
4. Google answering `200 {}` (clean) vs `200 { matches: [] }` vs a match whose `threat.url` is a canonicalised form of what we sent — Task 1 tests `empty object is clean`, `empty matches is clean`, `a canonicalised echo still counts`.
5. A 50+ link spam post: only the first 50 are sent, the request is still one call — Task 1 test `cap at 50`.

---

### Task 1: Pure rules — URL extraction, request body, verdict

**Files:**
- Modify: `src/lib/linkify.ts` (export `extractUrls`)
- Create: `src/lib/linkReputationRules.ts`
- Test: `src/lib/linkReputationRules.test.ts`, `src/lib/linkify.test.ts` (one added test)

**Interfaces:**
- Consumes: `URL_RE`, `TRAILING_PUNCT` already in `linkify.ts` (module-private today).
- Produces:
  - `extractUrls(text: string): string[]` in `linkify.ts` — ordered, deduplicated, trailing punctuation stripped, http(s) only.
  - `MAX_URLS_PER_CHECK = 50`, `THREAT_TYPES`, `LOOKUP_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find'` in `linkReputationRules.ts`.
  - `export interface LookupBody { client: { clientId: string; clientVersion: string }; threatInfo: { threatTypes: readonly string[]; platformTypes: readonly string[]; threatEntryTypes: readonly string[]; threatEntries: { url: string }[] } }`
  - `buildLookupBody(urls: string[]): LookupBody` — `{ client: { clientId: 'mahalle-digital', clientVersion: '1.0.0' }, threatInfo: { threatTypes: THREAT_TYPES, platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: urls.slice(0, MAX_URLS_PER_CHECK).map(url => ({ url })) } }`.
  - `export interface LinkHit { url: string; threatType: string }`
  - `hitsFromLookup(json: unknown): LinkHit[]` — reads `matches[].threat.url` + `threatType`, dedupes by url (first threatType wins), tolerates `{}`, `null`, non-object, missing fields. Deliberately NO „only URLs we sent" filter: Google may echo a canonicalised form of the URL, and a filter on the exact string would silently drop real hits (audit 2026-10-31). Google only ever answers for what was sent.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/linkify.test.ts`:
```ts
import { extractUrls } from './linkify';
test('extractUrls: http(s) only, trailing punctuation stripped, duplicates collapse, order kept', () => {
  const text = 'Siehe https://a.example/x. Und http://b.example/y), nochmal https://a.example/x und ftp://c.example javascript:alert(1)';
  assert.deepEqual(extractUrls(text), ['https://a.example/x', 'http://b.example/y']);
  assert.deepEqual(extractUrls('kein link'), []);
});
```

`src/lib/linkReputationRules.test.ts`:
```ts
// Run: npx tsx --test src/lib/linkReputationRules.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLookupBody, hitsFromLookup, MAX_URLS_PER_CHECK, THREAT_TYPES } from './linkReputationRules';

test('body names the four threat types on ANY_PLATFORM with URL entries', () => {
  const b = buildLookupBody(['https://a.example/']);
  assert.deepEqual(b.client, { clientId: 'mahalle-digital', clientVersion: '1.0.0' });
  assert.deepEqual(b.threatInfo.threatTypes, THREAT_TYPES);
  assert.deepEqual(THREAT_TYPES, ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION']);
  assert.deepEqual(b.threatInfo.platformTypes, ['ANY_PLATFORM']);
  assert.deepEqual(b.threatInfo.threatEntryTypes, ['URL']);
  assert.deepEqual(b.threatInfo.threatEntries, [{ url: 'https://a.example/' }]);
});
test('cap at 50', () => {
  const urls = Array.from({ length: 60 }, (_, i) => `https://x.example/${i}`);
  assert.equal(MAX_URLS_PER_CHECK, 50);
  assert.equal(buildLookupBody(urls).threatInfo.threatEntries.length, 50);
  assert.equal(buildLookupBody(urls).threatInfo.threatEntries[49].url, 'https://x.example/49');
});
test('empty object is clean', () => { assert.deepEqual(hitsFromLookup({}), []); });
test('empty matches is clean', () => { assert.deepEqual(hitsFromLookup({ matches: [] }), []); });
test('garbage is clean', () => {
  assert.deepEqual(hitsFromLookup(null), []);
  assert.deepEqual(hitsFromLookup('x'), []);
  assert.deepEqual(hitsFromLookup({ matches: [{ threat: {} }] }), []);
  assert.deepEqual(hitsFromLookup({ matches: [{ threatType: 'MALWARE' }] }), []);
});
test('a match is a hit; one hit per url, first threat type wins', () => {
  const json = { matches: [
    { threatType: 'SOCIAL_ENGINEERING', platformType: 'ANY_PLATFORM', threatEntryType: 'URL', threat: { url: 'https://p.example/' }, cacheDuration: '300s' },
    { threatType: 'MALWARE', threat: { url: 'https://p.example/' } },
  ] };
  assert.deepEqual(hitsFromLookup(json), [{ url: 'https://p.example/', threatType: 'SOCIAL_ENGINEERING' }]);
});
test('a canonicalised echo still counts', () => {
  // we sent https://P.example/x/../y ; Google may answer with the canonical form
  assert.deepEqual(hitsFromLookup({ matches: [{ threatType: 'MALWARE', threat: { url: 'https://p.example/y' } }] }), [{ url: 'https://p.example/y', threatType: 'MALWARE' }]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test src/lib/linkReputationRules.test.ts src/lib/linkify.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|Error"`
Expected: module-not-found for `./linkReputationRules`; the linkify test fails with `extractUrls` not exported.

- [ ] **Step 3: Implement**

In `linkify.ts`: `export function extractUrls(text: string): string[]` using `URL_RE` and `TRAILING_PUNCT` (match, strip, dedupe with a `Set`, keep first-seen order). In `linkReputationRules.ts`: the constants and the two functions per the Interfaces block; `hitsFromLookup` narrows with `typeof` checks, never throws.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command. Expected: `ℹ pass 8` for the rules file (+ linkify's existing tests + 1), `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/linkify.ts src/lib/linkify.test.ts src/lib/linkReputationRules.ts src/lib/linkReputationRules.test.ts
git commit -m "feat: pure rules for the Safe Browsing link check (URL extraction, lookup body, verdict)"
```

---

### Task 2: Server module — `checkLinkReputation(text)`

**Files:**
- Create: `src/lib/linkReputation.ts`
- Test: `src/lib/linkReputation.test.ts` (fake fetch, fake env)

**Interfaces:**
- Consumes: Task 1 (`extractUrls`, `buildLookupBody`, `hitsFromLookup`, `LOOKUP_ENDPOINT`, `LinkHit`); `ModerationResult` type from `./moderation` (type-only import — no runtime cycle).
- Produces: `checkLinkReputation(text: string, deps?: { fetchImpl?: typeof fetch; apiKey?: string | undefined; report?: (reason: string) => Promise<void> }): Promise<ModerationResult>`; `unsafeLinkResult(hits: LinkHit[]): ModerationResult` (exported for Task 3's merge test); `LINK_CHECK_FAILED_MESSAGE = 'link check: Safe Browsing lookup failed — content not held'`.

Behaviour: no URLs or no key → approved shape (the same literal shape as `createApprovedResult()` in moderation.ts: decision `approved`, `canPublish: true`, `needsReview: false`, `isUrgent: false`, empty categories/scores, `highestCategory: ''`, `maxScore: 0`, `userMessage: ''`, `adminReason: ''`). Otherwise POST `LOOKUP_ENDPOINT + '?key=' + encodeURIComponent(key)` with `Content-Type: application/json`, `signal: AbortSignal.timeout(5000)`. Non-2xx, thrown fetch, JSON parse error → `await report(reason)` then approved shape. `report` default = `Sentry.captureMessage(LINK_CHECK_FAILED_MESSAGE, { level: 'warning', extra: { reason } })` + `await Sentry.flush(2000)`; `reason` is `status <code>` or `<ErrorName>: <message>` with any `key=` query scrubbed (`replace(/key=[^&\s]+/g, 'key=[key]')`). Hits → `unsafeLinkResult(hits)`: `decision: 'urgent_review'`, `canPublish: false`, `needsReview: true`, `isUrgent: true`, `flaggedCategories: ['unsafe_link']`, `scores: {}`, `highestCategory: 'unsafe_link'`, `maxScore: 1`, `userMessage: 'Your submission is under review by our moderation team.'`, `adminReason` per Global Constraints. The key is resolved as `deps.apiKey !== undefined ? deps.apiKey : process.env.SAFE_BROWSING_API_KEY`.

- [ ] **Step 1: Write the failing tests**

```ts
// Run: npx tsx --test src/lib/linkReputation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinkReputation, unsafeLinkResult, LINK_CHECK_FAILED_MESSAGE } from './linkReputation';

const PH = 'https://testsafebrowsing.appspot.com/s/phishing.html';
const fakeFetch = (status: number, body: unknown, capture?: { url?: string; init?: RequestInit }) =>
  (async (url: any, init?: RequestInit) => {
    if (capture) { capture.url = String(url); capture.init = init; }
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

test('no link → approved without a request', async () => {
  let called = false;
  const r = await checkLinkReputation('nur text', { apiKey: 'k', fetchImpl: (async () => { called = true; return new Response('{}'); }) as typeof fetch });
  assert.equal(called, false); assert.equal(r.canPublish, true); assert.equal(r.needsReview, false);
});
test('no key → approved without a request', async () => {
  let called = false;
  const r = await checkLinkReputation(`siehe ${PH}`, { apiKey: undefined, fetchImpl: (async () => { called = true; return new Response('{}'); }) as typeof fetch });
  assert.equal(called, false); assert.equal(r.canPublish, true);
});
test('clean answer → approved; request carries the key and the URL', async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  const r = await checkLinkReputation(`siehe https://ok.example/seite.`, { apiKey: 'K3Y', fetchImpl: fakeFetch(200, {}, cap) });
  assert.equal(r.canPublish, true);
  assert.ok(cap.url!.startsWith('https://safebrowsing.googleapis.com/v4/threatMatches:find?key=K3Y'));
  assert.equal(cap.init!.method, 'POST');
  assert.deepEqual(JSON.parse(String(cap.init!.body)).threatInfo.threatEntries, [{ url: 'https://ok.example/seite' }]);
});
test('a hit → urgent review with the unsafe_link category and Google-naming reason', async () => {
  const r = await checkLinkReputation(`Konto prüfen: ${PH}`, { apiKey: 'k', fetchImpl: fakeFetch(200, { matches: [{ threatType: 'SOCIAL_ENGINEERING', threat: { url: PH } }] }) });
  assert.equal(r.decision, 'urgent_review'); assert.equal(r.isUrgent, true); assert.equal(r.canPublish, false);
  assert.deepEqual(r.flaggedCategories, ['unsafe_link']); assert.equal(r.highestCategory, 'unsafe_link'); assert.equal(r.maxScore, 1);
  assert.equal(r.adminReason, `Safe Browsing: SOCIAL_ENGINEERING — ${PH}`);
});
test('two hits join with "; "', () => {
  const r = unsafeLinkResult([{ url: 'https://a.example/', threatType: 'MALWARE' }, { url: 'https://b.example/', threatType: 'UNWANTED_SOFTWARE' }]);
  assert.equal(r.adminReason, 'Safe Browsing: MALWARE — https://a.example/; Safe Browsing: UNWANTED_SOFTWARE — https://b.example/');
});
test('HTTP 403 → approved, reported once with the status and without the key', async () => {
  const reasons: string[] = [];
  const r = await checkLinkReputation(`siehe ${PH}`, { apiKey: 'SECRET', fetchImpl: fakeFetch(403, { error: 'x' }), report: async (reason) => { reasons.push(reason); } });
  assert.equal(r.canPublish, true); assert.equal(reasons.length, 1); assert.match(reasons[0], /403/); assert.doesNotMatch(reasons[0], /SECRET/);
});
test('thrown fetch (timeout) → approved, reported', async () => {
  const reasons: string[] = [];
  const r = await checkLinkReputation(`siehe ${PH}`, { apiKey: 'k', fetchImpl: (async () => { throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }); }) as typeof fetch, report: async (reason) => { reasons.push(reason); } });
  assert.equal(r.canPublish, true); assert.equal(reasons.length, 1); assert.match(reasons[0], /TimeoutError/);
});
test('non-JSON body → approved, reported', async () => {
  const reasons: string[] = [];
  const r = await checkLinkReputation(`siehe ${PH}`, { apiKey: 'k', fetchImpl: fakeFetch(200, '<html>'), report: async (reason) => { reasons.push(reason); } });
  assert.equal(r.canPublish, true); assert.equal(reasons.length, 1);
});
test('the static message is the one Sentry groups on', () => {
  assert.equal(LINK_CHECK_FAILED_MESSAGE, 'link check: Safe Browsing lookup failed — content not held');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsx --test src/lib/linkReputation.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|Error" | head`
Expected: module not found.

- [ ] **Step 3: Implement `src/lib/linkReputation.ts`** per the Interfaces block. Header comment: born from the open checklist item (09-13 research, built 10-31), why failures never hold content, why `process.env`, terms (non-commercial), what is sent to Google (URLs only).

- [ ] **Step 4: Run to verify they pass**

Run: same. Expected: `ℹ pass 9`, `ℹ fail 0`. (The `@sentry/astro` import must not break under tsx — `moderation.ts` already imports it the same way and is tested indirectly; if tsx complains, import `captureMessage`/`flush` lazily inside the default `report`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/linkReputation.ts src/lib/linkReputation.test.ts
git commit -m "feat: Safe Browsing link check module (never holds content on failure, one Sentry warning)"
```

---

### Task 3: Wire into the pipeline — `moderateContent` + news `sourceUrl`

**Files:**
- Modify: `src/lib/moderation.ts` (rename `moderateContent` → `moderateWithOpenAI`, new `moderateContent` composes; `createApprovedResult` unchanged)
- Modify: `src/pages/api/news/submit.ts:56-68` (add `checkLinkReputation(sourceUrl)` to the `Promise.all`, merge)
- Test: `src/lib/moderationLinkMerge.test.ts` (the new pure seam `composeModeration`; the OpenAI call itself is covered by the e2e probe in Task 5)

**Interfaces:**
- Consumes: Task 2 `checkLinkReputation`, `unsafeLinkResult`; existing `mergeModerationResults`, `createApprovedResult`.
- Produces: `export function composeModeration(omni: ModerationResult, link: ModerationResult): ModerationResult` = `link.needsReview ? mergeModerationResults(omni, link)! : omni` (returns the SAME `omni` object when the link is clean — approved results keep their scores, flagged ones stay untouched); `moderateContent(input)` = `const [omni, link] = await Promise.all([moderateWithOpenAI(input), checkLinkReputation(input.text ?? '')]); return composeModeration(omni, link);`. The profanity short-circuit lives inside `moderateWithOpenAI` and still wins; when the link also hit, its category merges in as a second chip — one record either way.

- [ ] **Step 1: Write the failing test**

```ts
// Run: npx tsx --test src/lib/moderationLinkMerge.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeModeration, type ModerationResult } from './moderation';
import { unsafeLinkResult } from './linkReputation';
import { shortTextVerdict } from './shortTextVerdict';

const approved: ModerationResult = { decision: 'approved', canPublish: true, needsReview: false, isUrgent: false, flaggedCategories: [], scores: { hate: 0.01 }, highestCategory: 'hate', maxScore: 0.01, userMessage: '', adminReason: '' };
const cleanLink: ModerationResult = { ...approved, scores: {}, highestCategory: '', maxScore: 0 };
const badLink = unsafeLinkResult([{ url: 'https://p.example/', threatType: 'MALWARE' }]);

test('an unsafe link alone makes the record urgent with the unsafe_link chip', () => {
  const m = composeModeration(approved, badLink);
  assert.equal(m.decision, 'urgent_review'); assert.equal(m.canPublish, false); assert.deepEqual(m.flaggedCategories, ['unsafe_link']); assert.equal(m.highestCategory, 'unsafe_link');
  assert.equal(m.adminReason, 'Safe Browsing: MALWARE — https://p.example/');
});
test('profanity short-circuit wins, link check result discarded or merged — never two records', () => {
  const profane: ModerationResult = { ...approved, decision: 'pending_review', canPublish: false, needsReview: true, flaggedCategories: ['turkish_profanity'], highestCategory: 'turkish_profanity', maxScore: 0.8, adminReason: 'Profanity' };
  const m = composeModeration(profane, badLink);
  assert.deepEqual(m.flaggedCategories, ['turkish_profanity', 'unsafe_link']); assert.equal(m.isUrgent, true); assert.equal(m.adminReason, 'Profanity | Safe Browsing: MALWARE — https://p.example/');
});
test('a flagged link in a short text (motto) is refused, not tolerated', () => {
  assert.equal(shortTextVerdict([badLink]), 'refused');
});
test('clean link → the OpenAI result itself, scores intact', () => {
  assert.equal(composeModeration(approved, cleanLink), approved);
  const flagged: ModerationResult = { ...approved, decision: 'pending_review', canPublish: false, needsReview: true, flaggedCategories: ['hate'], maxScore: 0.9 };
  assert.equal(composeModeration(flagged, cleanLink), flagged);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/lib/moderationLinkMerge.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|Error" | head`
Expected: FAIL — `composeModeration` is not exported (verified 2026-10-31: `moderation.ts` imports cleanly under tsx, `import.meta.env` is only read at call time).

- [ ] **Step 3: Implement**

`moderation.ts`: `async function moderateWithOpenAI(input: ModerationInput): Promise<ModerationResult>` = the current body verbatim; `export function composeModeration(...)` and the new `async function moderateContent(input)` as in Interfaces; `import { checkLinkReputation } from './linkReputation';`. Comment above it: links are checked for every caller of `moderateText`/`moderatePost` (12 routes, edits included); admins never reach here.
`news/submit.ts`: `const [moderationResult, spamResult, linkResult] = await Promise.all([moderateText(textToModerate), checkSpamWithGPT(…), checkLinkReputation(sourceUrl)]); mergedResult = mergeModerationResults(moderationResult, spamResult, linkResult);` + import. (The text itself is covered by `moderateText`; `sourceUrl` is a separate field, hence the explicit call.)

- [ ] **Step 4: Run tests + budgets**

Run: `npx tsx --test src/lib/moderationLinkMerge.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"` → `pass 4`.
Run: `pnpm test 2>&1 | grep -E "^ℹ (pass|fail)"` → pass = 511 + 1 + 8 + 9 + 4 = 533, fail 0.
Run: `pnpm type-check 2>&1 | grep -cE "error TS"` → `16`. `npx -y svelte-check@4 2>&1 | grep -iE "svelte-check found|errors"` → 81 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/moderation.ts src/pages/api/news/submit.ts src/lib/moderationLinkMerge.test.ts
git commit -m "feat: every moderated submission runs the Safe Browsing link check; news tips check their source URL"
```

---

### Task 4: Admin chip label + env + privacy sentence

**Files:**
- Modify: `src/lib/kiosk-i18n.ts` (DE after line 1499 `'admin.cat.spam_check:scam'`; EN after the matching line ≈ 3616)
- Modify: `.env.example` (new block after the Sentry block)
- Modify: `src/pages/datenschutz.astro:67-69` (one DRAFT sentence in the processor list)
- Test: none (copy and comments only; there is no i18n parity test in the repo — verified 2026-10-31). Step 4's grep count is the check.

- [ ] **Step 1: Add the keys**

DE: `'admin.cat.unsafe_link': 'Unsicherer Link',` · EN: `'admin.cat.unsafe_link': 'Unsafe link',` — `AdmCatChip.svelte` resolves `admin.cat.<key>` and falls back to the raw key, so without this the chip would print `unsafe_link`.

- [ ] **Step 2: `.env.example`**

```
# Link reputation (2026-10-31): Google Safe Browsing Lookup API v4 key. Every http(s) link in a
# member's post/comment/event/listing/news tip is looked up at submit time; a known malware or
# phishing URL sends the content to the moderation queue (chip „Unsicherer Link"). Unset ⇒ the
# check is a silent no-op (dev, preview, demo). Non-commercial terms. Restrict the key to the
# Safe Browsing API in the Google Cloud console. SERVER-ONLY.
# SAFE_BROWSING_API_KEY=
```

- [ ] **Step 3: Datenschutz (DRAFT, owner reviews)** — as its OWN sentence AFTER „Mit den Anbietern bestehen Auftragsverarbeitungsverträge nach Art. 28 DSGVO." (that sentence must not be read as covering Google: the Safe Browsing API runs under Google's API terms, there is no Art. 28 contract for it — the owner decides the final wording):

`Link-Prüfung: Google Safe Browsing (Google; übermittelt werden nur die in einem Beitrag enthaltenen Web-Adressen, keine Kontodaten).` — the legal entity (Google Ireland Ltd. vs Google LLC) is the owner's to confirm; the sentence names „Google" only until then.

Add `<!-- DRAFT 2026-10-31: Safe Browsing sentence, owner to review -->` comment in the frontmatter's note list (line 4 lists processors).

- [ ] **Step 4: Verify**

Run: `grep -c "admin.cat.unsafe_link" src/lib/kiosk-i18n.ts` → `2`. `pnpm test` unchanged count. Budgets unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kiosk-i18n.ts .env.example src/pages/datenschutz.astro
git commit -m "feat: admin chip label, env example and privacy sentence for the link check"
```

---

### Task 5: Contract probe + e2e probe on the local prod build (gitignored scratchpad)

**Files:**
- Create: `scratchpad/link-reputation/contract.mts` (real API; needs the key in `.env`; run with `npx tsx` so it can import `src/lib/linkReputationRules.ts`)
- Create: `scratchpad/link-reputation/e2e.mts` (local prod build on :4655, login as `ayse@mahalle-dev.test` with `scratchpad/devpw.txt`, like `scratchpad/upload-shrink/listing-e2e.mjs`)

Precondition: the OWNER has created the Google Cloud key and put `SAFE_BROWSING_API_KEY=` into local `.env` (his hand step; the plan waits here if it is missing — Tasks 1–4 do not need it).

- [ ] **Step 1: `contract.mts`** — `node --env-file=.env node_modules/.bin/tsx scratchpad/link-reputation/contract.mts` (imports `buildLookupBody`, `hitsFromLookup`, `LOOKUP_ENDPOINT` from `../../src/lib/linkReputationRules`). Sends the three Google test URLs + `https://mahalle.digital/` in ONE request. Expected printed: `phishing → SOCIAL_ENGINEERING`, `malware → MALWARE`, `unwanted → UNWANTED_SOFTWARE`, `mahalle.digital → clean`, HTTP 200. Never prints the key.

- [ ] **Step 2: Build + serve the prod bundle**

```bash
pnpm exec astro build --config scratchpad/astro.config.preview.mjs 2>&1 | tail -3
PORT=4655 HOST=127.0.0.1 TELEGRAM_BOT_TOKEN= TELEGRAM_ADMIN_CHAT_ID= nohup node --env-file=.env dist/server/entry.mjs > /tmp/claude-1000/-home-atakee-projects-fullstack-community-webApp-astro---v-3/0df14674-9a99-489a-8c32-9f1f2c2bf51a/scratchpad/srv.log 2>&1 &
```

- [ ] **Step 3: `e2e.mts`** (`node --env-file=.env node_modules/.bin/tsx scratchpad/link-reputation/e2e.mts`) — login as ayse (csrf → `/api/auth/callback/credentials`), then: (a) `POST /api/topics/create` with body containing `https://testsafebrowsing.appspot.com/s/phishing.html` → response `moderationStatus: 'pending'`; (b) same with `https://www.berlin.de/` → `approved` (unless OpenAI flags the text — use a plain neutral sentence); (c) `POST /api/comments/create` on the created-pending topic is gated — instead comment on an existing approved dev topic with the malware test URL → pending; (d) read the dev DB `flaggedContent` newest row via a tiny Mongo read (`MONGODB_URI` from `.env`, name must contain `dev`) and assert `flaggedCategories` includes `unsafe_link` and `adminReason` starts with `Safe Browsing: SOCIAL_ENGINEERING`. Print `N/N checks OK`. Expected: 5/5.

- [ ] **Step 4: Stop the server**

`fuser -k 4655/tcp`

- [ ] **Step 5: No commit** (scratchpad is gitignored). Ledger the probe results.

---

### Task 6: Docs

**Files:**
- Modify: root `CLAUDE.md` — „Content Moderation" gets one bullet **„Link reputation (2026-10-31)"** (what, where wired, fail-open rule + Sentry message, env, terms, test URLs, probes); the Environment Variables block gets `SAFE_BROWSING_API_KEY=` with its one-line comment.
- Modify (dated one-line POINTERS, per the area-doc rule): `src/components/admin/CLAUDE.md` (chip `unsafe_link`), `src/components/forum/kiosk/CLAUDE.md`, `src/components/calendar/kiosk/CLAUDE.md`, `src/components/marketplace/kiosk/CLAUDE.md`, `src/pages/api/news/CLAUDE.md` (sourceUrl is checked too).

- [ ] **Step 1: Write the bullets/pointers.** Keep each pointer to one line: „**Link check (2026-10-31):** every link in a moderated submission is looked up in Google Safe Browsing inside `moderateContent()`; a hit queues the content with the chip „Unsicherer Link" — rules in root CLAUDE.md → Content Moderation."

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md src/components/admin/CLAUDE.md src/components/forum/kiosk/CLAUDE.md src/components/calendar/kiosk/CLAUDE.md src/components/marketplace/kiosk/CLAUDE.md src/pages/api/news/CLAUDE.md
git commit -m "docs: Safe Browsing link check"
```

---

## Owner's hand steps (not in any task)

1. Google Cloud console → a project (any) → „APIs & Services" → enable **Safe Browsing API** → Credentials → API key → restrict it to the Safe Browsing API. Note the daily quota shown under Quotas.
2. Put the key into local `.env` as `SAFE_BROWSING_API_KEY=` (only then Task 5 can run).
3. After the push: `vercel env add SAFE_BROWSING_API_KEY production` (Sensitive) → redeploy (env is baked at deploy). Preview/demo stay without it on purpose.
4. Read the Datenschutz sentence (DRAFT) and the two chip labels.
5. Optional: post a test link on prod yourself once (`https://testsafebrowsing.appspot.com/s/phishing.html` in a forum post) — an ADMIN account skips moderation, so use a non-admin test account or skip this; the dev e2e is the proof.

## Not in this plan (said up front)

- No user-facing warning or link rewriting; members see only the generic „under review" text.
- No re-check of links already published (a URL that turns bad later stays until reported).
- No check of links in display names (the name rules forbid `:` anyway), event locations or other unmoderated fields. **Covered automatically, by design, and worth knowing:** the profile MOTTO (`checkMottoProfanity` → `moderateText` → `shortTextVerdict`, which tolerates only `moderation_error` and `spam_check:ad_promotional`) is REFUSED with „Motto contains inappropriate content" when it carries a flagged link — no queue for short texts; the marketplace CONTACT RELAY (`listings/[id]/contact.ts` line 183, `!moderationResult.canPublish` → refused) refuses an anonymous buyer's message with a flagged link before any mail goes out — the one place strangers can write, now covered.
- No Web Risk / commercial path.
