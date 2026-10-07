# Personal Invitation Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every eligible member gets ONE permanent personal invitation link (with QR) that they share themselves; whoever registers through it is recorded as „eingeladen von …", at most 5 people per rolling 30 days, visible to the admin — and Mahalle never sends the invitation.

**Architecture:** A pure rules module decides eligibility, the rolling budget and the link/`mailto:` shapes; a server store mints and renews the code on the user document and resolves a code for the register page; the register route accepts an optional `inviteCode` and writes `invitedBy` + `invitedAt` on the NEW account — that row is the only record of a redemption, read by the budget, the member's card and the admin's invite tree. The profile gets an „Einladen" card (link, QR, share sheet / own mail program / clipboard, budget, invitees, renew), `/register?invite=<code>` names the inviter or says the link is dead, and `/admin/mitglieder` shows the tree and a per-member pause.

**Tech Stack:** Astro 5 SSR (one page, one API route), Svelte 5 islands, MongoDB driver, `qrcode` (already a dependency), node:test via tsx, Tailwind 3.4.

**Spec:** there is no separate spec. The owner's decisions (2026-10-07, „go with your recommendations") and the „Design decisions" section below are binding. Every code block below was built and run on a scratch branch first: 450 lib tests, type and Svelte budgets unchanged, and a 45-check browser probe against the local production build and the dev database.

## Design decisions

1. **Permanent link, rolling cap** — not a link that expires. Members print the QR on a card or paste the link into a group once; an expiring link would kill that card. The cap does the throttling: `INVITE_USES = 5` redemptions per rolling `INVITE_WINDOW_DAYS = 30`. Unused invitations do not pile up.
2. **Earned, not instant** (Gmail/Clubhouse pattern): a member may invite once the e-mail address is confirmed AND the account is `INVITE_MIN_AGE_DAYS = 7` days old. Banned, tombstoned and admin-paused members cannot. A blocked member reads WHY in the card and gets no code — nothing is minted or revealed for them.
3. **Invite ≠ shortcut:** the invitee still verifies the address and still passes moderation. The link only names the inviter.
4. **Visible invite tree** (Lobste.rs' core idea): every account stores who issued its link; the admin sees „eingeladen von @…" and „N eingeladen" on `/admin/mitglieder`, the `member_new` Telegram line names the inviter. Admin-only — members see only their OWN invitees.
5. **Revocable:** the member renews the link (the old code dies at once, printed cards included — a confirm dialog says so; 5 renewals per hour), the admin pauses one member (`invitesPaused`), the operator pauses everyone (env `INVITES_PAUSED=1`, a redeploy).
6. **Mahalle never sends the invitation** (BGH I ZR 208/12, the „Tell-a-friend" ruling). The member shares the link from their own apps: the phone's share sheet (`navigator.share`, only where it exists), **their own mail program** (`mailto:` with subject and body prefilled — no recipient field of ours, their address book is better and we never see the address), the clipboard, the QR. `mailto:` carries no image, so the QR lives on the card (shown or printed), the mail carries the link.
7. **The open door stays:** plain registration is unchanged. A dead link (unknown, malformed, inviter blocked, budget exhausted) shows „gilt nicht mehr … du kannst dich trotzdem anmelden" and the form posts WITHOUT a code; a code that dies between page load and submit is refused with `invite_invalid` (never silently dropped — the inviter counts on being named), the form shows the notice, and the member's second click registers plainly.
8. **The inviter's name is shown to whoever opens the link.** Display names are member-visible anyway and the visitor got the link from that person. A leaked link yields at most 5 strangers a month, all marked „eingeladen von", and the member can renew.
9. **Known limits (told to the owner):** the budget is count-then-insert — two simultaneous redemptions of the last slot both pass; a deleted invitee's tombstone loses `invitedBy`, so that slot frees early; the recorded redemption is the user row, there is no separate log.
10. **All new texts are drafts** (DE + EN in `src/lib/kiosk-i18n.ts`).

## Global Constraints

- Error budgets stay EXACTLY at `pnpm type-check` 16 errors and `npx -y svelte-check@4` 81 errors; `pnpm test` stays green (439 before this plan, 450 after Task 1).
- Commit messages: plain and concise. NO „🤖 Generated with Claude Code" line, NO „Co-Authored-By" footer.
- Never stage secrets; never print any `.env` value (names only). The dev password lives in `scratchpad/devpw.txt`, read by probes, never printed.
- `src/lib/invites/inviteRules.ts` and `src/components/auth/kiosk/registerInvite.ts` are dependency-pure (imported by Svelte islands): no `mongodb`, no `astro:*`, no Sentry, nothing that reads `import.meta.env`. `src/lib/invites/invites.ts` is server-only and the only module that reads `INVITES_PAUSED`.
- `PInviteCard.svelte` has NO `<style>` block (reachable only through `ProfileInner`; a scoped style would be orphaned in the production build). Its prop is `invite`, never `state` (a prop named `state` shadows the `$state` rune).
- New code uses `connectDB()` / a passed `Db`, never the default `clientPromise` export.
- `PATCH /api/admin/users/[id]` stays the ONLY writer of `invitesPaused`; `register.ts` is the only writer of `invitedBy`/`invitedAt`; the store is the only writer of `inviteCode`.
- Client-visible user joins keep their allowlists: `inviteCode`, `invitedBy`, `invitesPaused` never enter `PUBLIC_AUTHOR_PROJECTION` or any member-facing payload except the member's own `GET /api/profile/invite`.
- Apply every ```diff block with `git apply` from the repo root (extract the block BY SCRIPT, never retype it); a block introduced by a line ending in `` `path`: `` is the WHOLE file.
- Do not start `pnpm dev`. Do not push. Do not touch files outside the task's list.

## Review Focus

1. A link used by a 6th person inside 30 days, and the same link after the oldest redemption leaves the window — `inviteBudget` tests „exhausted → next free …" and „counts only the rolling window" (Task 1); probe D1–D4 (Task 6).
2. A member who may not invite (unconfirmed, 2 days old, paused, banned) must get no code by any path — not by reading the card, not by renewing, not through an old link — `inviterBlock` tests incl. order of reasons (Task 1); probe B1–B3, E7, F5, F6 (Task 6).
3. The link dies between page load and submit (used up, renewed, inviter paused): no silent drop, no 500, the second click registers plainly without an inviter — probe C7–C9 (Task 6); the route's `invite_invalid` branch (Task 2).
4. Renewing must kill the old link at once and keep the invite tree — probe E1–E4 (Task 6); `regenerateInviteCode` writes only `inviteCode` (Task 2).
5. Nothing of this leaks to other members (public author projection, admin-only tree) and the `mailto:` must open a real mail program (RFC 6068 CRLF, percent-encoding, no recipient) — `inviteMailto` test (Task 1); probe A4, G1 (Task 6).

---

### Task 1: Rules, types and texts

**Files:**
- Create: `src/lib/invites/inviteRules.ts`
- Test (create): `src/lib/invites/inviteRules.test.ts`
- Modify: `src/types/index.ts`, `src/lib/kiosk-i18n.ts`

**Interfaces:**
- Produces (pure, `src/lib/invites/inviteRules.ts`):
  - constants `INVITE_USES = 5`, `INVITE_WINDOW_DAYS = 30`, `INVITE_MIN_AGE_DAYS = 7`, `INVITE_CODE_LEN = 10`, `INVITE_CODE_ALPHABET`
  - `normalizeInviteCode(raw: unknown): string | null` — trimmed, lowercased, `/^[a-z0-9]{10}$/`
  - `codeFromBytes(bytes: ArrayLike<number>): string`
  - `type InviterBlock = 'anonymized' | 'banned' | 'paused_all' | 'paused' | 'unverified' | 'too_new'`, `type InviterFields` (index signature, like `UserFields`), `toDate(v: unknown): Date | null`
  - `inviteUnlockAt(createdAt: unknown): Date | null`, `inviterBlock(user: InviterFields, now: Date, pausedAll = false): InviterBlock | null`
  - `type InviteBudget = { used; left; nextFreeAt: Date | null }`, `inviteBudget(redeemedAt: unknown[], now: Date): InviteBudget`
  - `type InviteState` (what `GET /api/profile/invite` answers; ISO strings)
  - `inviteUrl(base: string, code: string): string` → `${base}/register?invite=${code}`
  - `inviteMailto(subject: string, body: string): string`
- Produces (types): `User` gains `inviteCode?`, `invitesPaused?`, `invitedBy?`, `invitedAt?`.
- Produces (texts, DE + EN, all DRAFT): `profile.invite.*` (26 keys), `auth.register.invite.title|body|dead.title|dead.body`, `admin.users.invitedBy|invited|invites.on|invites.off|invites.title`.

- [ ] **Step 1: Write the failing test**

`src/lib/invites/inviteRules.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_USES, INVITE_CODE_LEN, INVITE_CODE_ALPHABET,
  normalizeInviteCode, codeFromBytes, inviterBlock, inviteUnlockAt, inviteBudget, inviteUrl, inviteMailto,
} from './inviteRules';

const NOW = new Date('2026-10-07T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const fresh = { emailVerified: true, createdAt: days(30).toISOString() };

test('normalizeInviteCode: trims, lowercases, fixed length, lower alnum only', () => {
  assert.equal(normalizeInviteCode(' ABCDEFGH23 '), 'abcdefgh23');
  assert.equal(normalizeInviteCode('abcdefgh2'), null);
  assert.equal(normalizeInviteCode('abcdefgh234'), null);
  assert.equal(normalizeInviteCode('abcdefgh-3'), null);
  assert.equal(normalizeInviteCode(''), null);
  assert.equal(normalizeInviteCode(42), null);
  assert.equal(normalizeInviteCode(null), null);
});

test('codeFromBytes: length, alphabet, no look-alikes, deterministic', () => {
  const code = codeFromBytes(Array.from({ length: INVITE_CODE_LEN }, (_, i) => i * 37));
  assert.equal(code.length, INVITE_CODE_LEN);
  for (const ch of code) assert.ok(INVITE_CODE_ALPHABET.includes(ch), ch);
  assert.ok(!/[ilo01]/.test(INVITE_CODE_ALPHABET));
  assert.equal(normalizeInviteCode(code), code);
  assert.equal(codeFromBytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'aaaaaaaaaa');
});

test('inviterBlock: eligible member', () => {
  assert.equal(inviterBlock(fresh, NOW), null);
  assert.equal(inviterBlock({ ...fresh, createdAt: days(30) }, NOW), null);
});

test('inviterBlock: reasons and their order', () => {
  assert.equal(inviterBlock({ ...fresh, anonymized: true, isBanned: true }, NOW), 'anonymized');
  assert.equal(inviterBlock({ ...fresh, isBanned: true, invitesPaused: true }, NOW, true), 'banned');
  assert.equal(inviterBlock({ ...fresh, invitesPaused: true }, NOW, true), 'paused_all');
  assert.equal(inviterBlock({ ...fresh, invitesPaused: true, emailVerified: false }, NOW), 'paused');
  assert.equal(inviterBlock({ ...fresh, emailVerified: false, createdAt: days(1) }, NOW), 'unverified');
  assert.equal(inviterBlock({ emailVerified: true, createdAt: days(6.9) }, NOW), 'too_new');
  assert.equal(inviterBlock({ emailVerified: true, createdAt: days(7) }, NOW), null);
  assert.equal(inviterBlock({ emailVerified: true }, NOW), 'too_new');
  assert.equal(inviterBlock({ emailVerified: true, createdAt: 'garbage' }, NOW), 'too_new');
});

test('inviteUnlockAt: seven days after joining, null for unreadable dates', () => {
  assert.equal(inviteUnlockAt(days(3))?.toISOString(), days(-4).toISOString());
  assert.equal(inviteUnlockAt('no date'), null);
  assert.equal(inviteUnlockAt(undefined), null);
});

test('inviteBudget: counts only the rolling window', () => {
  assert.deepEqual(inviteBudget([], NOW), { used: 0, left: INVITE_USES, nextFreeAt: null });
  const b = inviteBudget([days(31), days(29), days(1), 'garbage', undefined], NOW);
  assert.equal(b.used, 2);
  assert.equal(b.left, 3);
  assert.equal(b.nextFreeAt, null);
});

test('inviteBudget: exhausted → next free when the oldest in-window redemption falls out', () => {
  const b = inviteBudget([days(2), days(20), days(5), days(10), days(29.5)], NOW);
  assert.equal(b.used, 5);
  assert.equal(b.left, 0);
  assert.equal(b.nextFreeAt?.toISOString(), days(-0.5).toISOString());
});

test('inviteBudget: more than the cap never reports a negative rest', () => {
  const b = inviteBudget([1, 2, 3, 4, 5, 6].map(days), NOW);
  assert.equal(b.left, 0);
  assert.equal(b.used, INVITE_USES);
  assert.equal(b.nextFreeAt?.toISOString(), days(-24).toISOString());
});

test('inviteBudget: a redemption dated in the future is not counted', () => {
  assert.equal(inviteBudget([days(-1)], NOW).used, 0);
});

test('inviteUrl: base with or without trailing slash', () => {
  assert.equal(inviteUrl('https://mahalle.digital', 'abcdefgh23'), 'https://mahalle.digital/register?invite=abcdefgh23');
  assert.equal(inviteUrl('http://127.0.0.1:4655/', 'abcdefgh23'), 'http://127.0.0.1:4655/register?invite=abcdefgh23');
});

test('inviteMailto: percent-encoded, CRLF line ends, no recipient', () => {
  const href = inviteMailto('Einladung zu Mahalle', 'Hallo,\n\nhier: https://x.y/register?invite=a&b\nGrüße');
  assert.ok(href.startsWith('mailto:?subject=Einladung%20zu%20Mahalle&body='));
  assert.ok(href.includes('%0D%0A%0D%0A'));
  assert.ok(href.includes('invite%3Da%26b'));
  assert.ok(!href.includes('\n'));
  assert.ok(href.includes('Gr%C3%BC%C3%9Fe'));
});
```

- [ ] **Step 2: Run it to see it fail** — `npx tsx --test src/lib/invites/inviteRules.test.ts` → fails to load (`Cannot find module './inviteRules'`).

- [ ] **Step 3: The rules**

`src/lib/invites/inviteRules.ts`:

```ts
// src/lib/invites/inviteRules.ts — dependency-pure (server routes AND islands import it).
// Personal invitation links (2026-10-07): every eligible member has ONE permanent code;
// a link carrying it opens /register with the inviter named, and the new account records
// who invited it. The code never expires — the cap does the throttling: at most
// INVITE_USES redemptions per rolling INVITE_WINDOW_DAYS. Mahalle never sends the
// invitation itself (the member shares the link from their own apps).

export const INVITE_USES = 5;
export const INVITE_WINDOW_DAYS = 30;
/** A member may invite once their address is confirmed AND the account is this old. */
export const INVITE_MIN_AGE_DAYS = 7;
export const INVITE_CODE_LEN = 10;
/** Lowercase letters and digits without the look-alikes (i l o 0 1) — the code is read off cards. */
export const INVITE_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** What the register page accepts: a lenient superset of the alphabet, fixed length. */
const CODE_REGEX = /^[a-z0-9]{10}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Query/body input → code, or null. Trims and lowercases (links get retyped from cards). */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return CODE_REGEX.test(code) ? code : null;
}

/** `bytes` → a code over INVITE_CODE_ALPHABET (one byte per character; the caller supplies randomness). */
export function codeFromBytes(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < INVITE_CODE_LEN; i++) {
    out += INVITE_CODE_ALPHABET[(bytes[i] ?? 0) % INVITE_CODE_ALPHABET.length];
  }
  return out;
}

export type InviterBlock = 'anonymized' | 'banned' | 'paused_all' | 'paused' | 'unverified' | 'too_new';

/**
 * The user-document fields the eligibility rule reads (createdAt is an ISO string on new
 * accounts, a Date on old ones). The index signature is load-bearing: without it TypeScript's
 * weak-type check refuses a MongoDB `WithId<Document>` (same as `UserFields` in memberType.ts).
 */
export type InviterFields = {
  emailVerified?: unknown;
  createdAt?: unknown;
  isBanned?: unknown;
  anonymized?: unknown;
  invitesPaused?: unknown;
  [k: string]: unknown;
};

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** When a too-new account may start inviting; null when createdAt is unreadable (then it never unlocks by age — treated as too new). */
export function inviteUnlockAt(createdAt: unknown): Date | null {
  const d = toDate(createdAt);
  return d ? new Date(d.getTime() + INVITE_MIN_AGE_DAYS * DAY_MS) : null;
}

/**
 * Why this member may not invite right now — or null when they may. Order matters: the
 * strongest reason wins, so a banned member is told about the ban, not about a missing
 * confirmation. `pausedAll` is the global switch (env INVITES_PAUSED on the server).
 */
export function inviterBlock(user: InviterFields, now: Date, pausedAll = false): InviterBlock | null {
  if (user.anonymized === true) return 'anonymized';
  if (user.isBanned === true) return 'banned';
  if (pausedAll) return 'paused_all';
  if (user.invitesPaused === true) return 'paused';
  if (user.emailVerified !== true) return 'unverified';
  const unlock = inviteUnlockAt(user.createdAt);
  if (!unlock || unlock.getTime() > now.getTime()) return 'too_new';
  return null;
}

export type InviteBudget = { used: number; left: number; nextFreeAt: Date | null };

/** What GET /api/profile/invite answers — the profile card's whole data (ISO strings, JSON-ready). */
export type InviteState = {
  /** null while the member is blocked (nothing is minted for them). */
  code: string | null;
  url: string | null;
  qrSvg: string | null;
  block: InviterBlock | null;
  /** ISO — when a too-new account unlocks. */
  unlockAt: string | null;
  used: number;
  left: number;
  /** ISO — when the next redemption is possible again; null while something is left. */
  nextFreeAt: string | null;
  invitees: { name: string; handle: string | null; joinedAt: string }[];
};

/**
 * Redemptions inside the rolling window → what is left. `nextFreeAt` is set only when
 * nothing is left: the moment the oldest redemption in the window falls out of it.
 * Unreadable dates are ignored (they cannot be inside the window).
 */
export function inviteBudget(redeemedAt: unknown[], now: Date): InviteBudget {
  const start = now.getTime() - INVITE_WINDOW_DAYS * DAY_MS;
  const inWindow = redeemedAt
    .map(toDate)
    .filter((d): d is Date => d !== null && d.getTime() > start && d.getTime() <= now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  const used = inWindow.length;
  const left = Math.max(0, INVITE_USES - used);
  const nextFreeAt = left === 0 && inWindow.length > 0
    ? new Date(inWindow[0].getTime() + INVITE_WINDOW_DAYS * DAY_MS)
    : null;
  return { used: Math.min(used, INVITE_USES), left, nextFreeAt };
}

/** The link a member shares. `base` without a trailing slash (getTrustedBaseUrl's shape). */
export function inviteUrl(base: string, code: string): string {
  return `${base.replace(/\/+$/, '')}/register?invite=${code}`;
}

/**
 * A mailto: link that opens the member's OWN mail program with subject and body prefilled
 * (RFC 6068: CRLF line ends, everything percent-encoded; no recipient — their program's
 * address book does that better than a field of ours would, and we never see the address).
 */
export function inviteMailto(subject: string, body: string): string {
  const crlf = body.replace(/\r?\n/g, '\r\n');
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(crlf)}`;
}
```

- [ ] **Step 4: Run the test** — `npx tsx --test src/lib/invites/inviteRules.test.ts` → `ℹ tests 11` / `ℹ pass 11`.

- [ ] **Step 5: The user type**

```diff
diff --git a/src/types/index.ts b/src/types/index.ts
index 21b9d51e..a9fb5600 100644
--- a/src/types/index.ts
+++ b/src/types/index.ts
@@ -35,6 +35,13 @@ export interface User {
   isBanned?: boolean;
   bannedAt?: Date;
   bannedReason?: string;
+  // Personal invitation link (2026-10-07, src/lib/invites): the member's own permanent code
+  // (minted on the first eligible read of the profile card), the admin's per-member pause,
+  // and — on the INVITED account — who issued the link and when (the redemption record).
+  inviteCode?: string;
+  invitesPaused?: boolean;
+  invitedBy?: ObjectId | string;
+  invitedAt?: Date;
   createdAt?: Date;
   updatedAt?: Date;
 }
```

- [ ] **Step 6: The texts** (German block first, English block second; all drafts; three places each: the profile card after `profile.konto.newsletter.error`, the register notice after `auth.register.alt`, the admin row after `admin.users.brief.title`)

```diff
diff --git a/src/lib/kiosk-i18n.ts b/src/lib/kiosk-i18n.ts
index 17c316df..5cd501c2 100644
--- a/src/lib/kiosk-i18n.ts
+++ b/src/lib/kiosk-i18n.ts
@@ -1316,6 +1316,11 @@ const de = {
   'auth.register.terms.privacyLink': 'Datenschutz',
   'auth.register.note': 'Kein Klarname nötig. Ohne Eingabe vergeben wir deinen @Namen automatisch. Dein „Verifiziert im Kiez“-Abzeichen vergibt das Team später separat. Als Mitglied bekommst du einmal die Woche den Kiez-Brief per E-Mail — abbestellbar jederzeit in der App oder über den Link im Brief.',
   'auth.register.alt': 'Schon dabei? ',
+  // Personal invitation link on /register (2026-10-07) — DRAFT copy
+  'auth.register.invite.title': 'Eingeladen von {name}',
+  'auth.register.invite.body': 'Schön, dass du kommst. Melde dich wie gewohnt an — der Link trägt dich bei {name} als eingeladen ein.',
+  'auth.register.invite.dead.title': 'Dieser Einladungslink gilt nicht mehr.',
+  'auth.register.invite.dead.body': 'Vielleicht ist er aufgebraucht oder wurde erneuert. Du kannst dich trotzdem anmelden.',
   'auth.register.altLink': 'Anmelden',
   'auth.register.successTitle': 'Konto erstellt — willkommen im Kiez',
   'auth.register.successBody': 'Du wirst weitergeleitet …',
@@ -1691,6 +1696,12 @@ const de = {
   'admin.users.brief.on': 'Kiez-Brief: an',
   'admin.users.brief.off': 'Kiez-Brief: aus',
   'admin.users.brief.title': 'Bekommt dieses Mitglied den wöchentlichen Kiez-Brief? Antippen schaltet um.',
+  // Invitations on the member row (2026-10-07) — DRAFT copy
+  'admin.users.invitedBy': 'eingeladen von @{h}',
+  'admin.users.invited': '{n} eingeladen',
+  'admin.users.invites.on': 'Einladen: an',
+  'admin.users.invites.off': 'Einladen: pausiert',
+  'admin.users.invites.title': 'Darf dieses Mitglied Nachbarn einladen? Antippen schaltet um.',
   'admin.users.empty': 'Keine Mitglieder gefunden.',
   'admin.users.loading': 'Melderegister wird geladen …',
   'admin.users.error': 'Liste konnte nicht geladen werden.',
@@ -1773,6 +1784,33 @@ const de = {
   'profile.konto.newsletter.turnOff': 'abbestellen',
   'profile.konto.newsletter.turnOn': 'einschalten',
   'profile.konto.newsletter.error': 'Die Einstellung konnte nicht gespeichert werden.',
+  // Einladen card (personal invitation link, 2026-10-07) — DRAFT copy
+  'profile.invite.title': 'Einladen',
+  'profile.invite.fold.hint': 'Link · QR-Code · 5 Einladungen in 30 Tagen',
+  'profile.invite.intro': 'Dein persönlicher Link. Wer sich darüber anmeldet, steht bei dir als eingeladen — bis zu {max} Personen in 30 Tagen. Teile ihn selbst, Mahalle verschickt nichts.',
+  'profile.invite.left': '{left} von {max} frei',
+  'profile.invite.nextFree': 'wieder ab {d}',
+  'profile.invite.share': 'Teilen',
+  'profile.invite.mail': 'per E-Mail',
+  'profile.invite.copy': 'Link kopieren',
+  'profile.invite.copied': 'Link kopiert.',
+  'profile.invite.copyFailed': 'Kopieren hat nicht geklappt — markiere den Link und kopiere ihn selbst.',
+  'profile.invite.renew': 'neuen Link erzeugen',
+  'profile.invite.renew.confirm': 'Der alte Link hört sofort auf zu gelten — auch auf gedruckten Karten. Neuen Link erzeugen?',
+  'profile.invite.renew.cta': 'Neuen Link erzeugen',
+  'profile.invite.renewed': 'Neuer Link erzeugt.',
+  'profile.invite.renewFailed': 'Der Link konnte nicht erneuert werden.',
+  'profile.invite.error': 'Die Einladungen konnten nicht geladen werden.',
+  'profile.invite.invitees': 'ÜBER DEINEN LINK DABEI',
+  'profile.invite.qr.alt': 'QR-Code deines Einladungslinks',
+  'profile.invite.block.unverified': 'Bestätige zuerst deine E-Mail-Adresse — danach kannst du Nachbarn einladen.',
+  'profile.invite.block.too_new': 'Einladen kannst du ab einer Woche Mitgliedschaft — bei dir ab {d}.',
+  'profile.invite.block.paused': 'Einladungen sind für dein Konto zurzeit pausiert.',
+  'profile.invite.block.paused_all': 'Einladungen sind zurzeit pausiert.',
+  'profile.invite.block.banned': 'Mit einem gesperrten Konto kannst du niemanden einladen.',
+  'profile.invite.mail.subject': 'Einladung zu Mahalle',
+  'profile.invite.mail.body': 'Hallo,\n\nich bin bei Mahalle, dem Nachbarschafts-Netzwerk für den Schillerkiez: Forum, Kalender, Marktplatz und Kiez-Nachrichten — ohne Werbung, ohne Algorithmus.\n\nHier ist meine persönliche Einladung:\n{url}\n\nViele Grüße\n{name}',
+  'profile.invite.share.text': 'Ich bin bei Mahalle, dem Nachbarschafts-Netzwerk für den Schillerkiez. Hier ist meine Einladung:',
 
   'profile.email.stage1.title': 'NEUE ADRESSE',
   'profile.email.stage1.newlabel': 'NEUE E-MAIL',
@@ -3377,6 +3415,11 @@ const en: Dict = {
   'auth.register.terms.privacyLink': 'Privacy Policy',
   'auth.register.note': 'No legal name required. Leave the @name empty and we assign one automatically. Your “Verified in the Kiez” badge is granted separately by the team later. As a member you receive the weekly Kiez-Brief by e-mail — unsubscribe any time in the app or via the link in the mail.',
   'auth.register.alt': 'Already here? ',
+  // Personal invitation link on /register (2026-10-07) — DRAFT copy
+  'auth.register.invite.title': 'Invited by {name}',
+  'auth.register.invite.body': 'Glad you are coming. Register as usual — the link records you as invited by {name}.',
+  'auth.register.invite.dead.title': 'This invitation link is no longer valid.',
+  'auth.register.invite.dead.body': 'It may be used up or renewed. You can still register.',
   'auth.register.altLink': 'Sign in',
   'auth.register.successTitle': 'Account created — welcome to the Kiez',
   'auth.register.successBody': 'Redirecting you …',
@@ -3750,6 +3793,12 @@ const en: Dict = {
   'admin.users.brief.on': 'Kiez-Brief: on',
   'admin.users.brief.off': 'Kiez-Brief: off',
   'admin.users.brief.title': 'Does this member get the weekly Kiez-Brief? Tap to switch.',
+  // Invitations on the member row (2026-10-07) — DRAFT copy
+  'admin.users.invitedBy': 'invited by @{h}',
+  'admin.users.invited': '{n} invited',
+  'admin.users.invites.on': 'Invites: on',
+  'admin.users.invites.off': 'Invites: paused',
+  'admin.users.invites.title': 'May this member invite neighbours? Tap to switch.',
   'admin.users.empty': 'No members found.',
   'admin.users.loading': 'Loading the member register …',
   'admin.users.error': 'Could not load the list.',
@@ -3832,6 +3881,33 @@ const en: Dict = {
   'profile.konto.newsletter.turnOff': 'unsubscribe',
   'profile.konto.newsletter.turnOn': 'turn on',
   'profile.konto.newsletter.error': 'The setting could not be saved.',
+  // Einladen card (personal invitation link, 2026-10-07) — DRAFT copy
+  'profile.invite.title': 'Invite',
+  'profile.invite.fold.hint': 'Link · QR code · 5 invitations per 30 days',
+  'profile.invite.intro': 'Your personal link. Whoever registers through it is recorded as invited by you — up to {max} people in 30 days. You share it yourself; Mahalle sends nothing.',
+  'profile.invite.left': '{left} of {max} left',
+  'profile.invite.nextFree': 'again from {d}',
+  'profile.invite.share': 'Share',
+  'profile.invite.mail': 'by e-mail',
+  'profile.invite.copy': 'Copy link',
+  'profile.invite.copied': 'Link copied.',
+  'profile.invite.copyFailed': 'Copying did not work — select the link and copy it yourself.',
+  'profile.invite.renew': 'make a new link',
+  'profile.invite.renew.confirm': 'The old link stops working at once — on printed cards too. Make a new link?',
+  'profile.invite.renew.cta': 'Make a new link',
+  'profile.invite.renewed': 'New link made.',
+  'profile.invite.renewFailed': 'The link could not be renewed.',
+  'profile.invite.error': 'The invitations could not be loaded.',
+  'profile.invite.invitees': 'JOINED THROUGH YOUR LINK',
+  'profile.invite.qr.alt': 'QR code of your invitation link',
+  'profile.invite.block.unverified': 'Confirm your e-mail address first — then you can invite neighbours.',
+  'profile.invite.block.too_new': 'You can invite after one week of membership — for you from {d}.',
+  'profile.invite.block.paused': 'Invitations are paused for your account at the moment.',
+  'profile.invite.block.paused_all': 'Invitations are paused at the moment.',
+  'profile.invite.block.banned': 'A suspended account cannot invite anyone.',
+  'profile.invite.mail.subject': 'Invitation to Mahalle',
+  'profile.invite.mail.body': 'Hello,\n\nI am on Mahalle, the neighbourhood network for the Schillerkiez: forum, calendar, marketplace and local news — no ads, no algorithm.\n\nHere is my personal invitation:\n{url}\n\nBest,\n{name}',
+  'profile.invite.share.text': 'I am on Mahalle, the neighbourhood network for the Schillerkiez. Here is my invitation:',
 
   'profile.email.stage1.title': 'NEW ADDRESS',
   'profile.email.stage1.newlabel': 'NEW EMAIL',
```

- [ ] **Step 7: Gates** — `pnpm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → `tests 450`, `pass 450`, `fail 0`; `pnpm type-check 2>&1 | grep -c "error TS"` → `16`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/invites/inviteRules.ts src/lib/invites/inviteRules.test.ts src/types/index.ts src/lib/kiosk-i18n.ts
git commit -m "feat: invites — rules, types and texts for personal invitation links"
```

---

### Task 2: Store, the member's route, the register route

**Files:**
- Create: `src/lib/invites/invites.ts`, `src/pages/api/profile/invite.ts`
- Modify: `src/pages/api/auth/register.ts`, `src/lib/adminAlerts.ts`, `src/lib/auth/accountDeletion.ts`, `scripts/create-auth-indexes.ts`

**Interfaces:**
- Consumes from Task 1: everything in `src/lib/invites/inviteRules.ts`.
- Consumes (already on main): `connectDB()`; `requireMemberSession(request)` → `{ ok: true, userId }` | `{ ok: false, response }` (`src/lib/auth.ts`); `getTrustedBaseUrl(request): string` (`''` when unset in prod; `src/lib/auth/baseUrl.ts`); `consumeRateLimit(baseKey, max, windowMs)` (`src/lib/auth/rateLimit.ts`); `QRCode.toString(text, { type: 'svg', … })` from `qrcode` (the Steckbrief recipe); `sendAdminAlert`/`trunc` inside `src/lib/adminAlerts.ts`; `ensureIndex(db, coll, keys, opts)` inside `scripts/create-auth-indexes.ts`.
- Produces (server-only, `src/lib/invites/invites.ts`):
  - `invitesPausedAll(): boolean` (env `INVITES_PAUSED === '1'`)
  - `getInviteState(db: Db, userId: string, base: string, now?: Date): Promise<InviteState | null>` — mints the code on the first ELIGIBLE read
  - `regenerateInviteCode(db: Db, userId: string, now?: Date): Promise<string | null>` (`null` = blocked or unknown)
  - `type ResolvedInvite = { ok: true; inviter: { _id: unknown; name: string; handle: string | null } } | { ok: false; reason: 'invalid' | 'blocked' | 'exhausted' }`, `resolveInvite(db: Db, rawCode: unknown, now?: Date): Promise<ResolvedInvite>`
  - re-exports `type InviteState`
- Produces (routes): `GET /api/profile/invite` → `InviteState` (member-gated incl. live ban check, `no-store`; 503 `base_url_unavailable` without a trusted base); `POST /api/profile/invite` `{ action: 'regenerate' }` → the new `InviteState` (400 other actions, 429 `rate_limited` after 5/h via `invitecode:<userId>`, 403 `not_allowed` for a blocked member). `POST /api/auth/register` accepts optional `inviteCode` → 400 `invite_invalid` when supplied but unusable; a redemption writes `invitedBy: <inviter _id>` + `invitedAt: new Date()` on the new user. `alertNewMember()` gains `invitedBy?: string | null` (the inviter's handle or name). The tombstone unsets the four new fields. `users_inviteCode_unique` (partial on `$type: 'string'`) joins the index script — the owner runs it against prod when he likes; the code works without it.

These modules import the database (and env), so they have no unit test; they are exercised end to end by the browser probe in Task 6 (the rules they call are tested in Task 1).

- [ ] **Step 1: The store**

`src/lib/invites/invites.ts`:

```ts
// src/lib/invites/invites.ts — SERVER-ONLY (mongodb, qrcode, import.meta.env). The store behind
// a member's personal invitation link: minting and renewing the code, the member's view of it
// (budget, QR, who joined through it) and the register page's check of a code.
// Rules are the pure src/lib/invites/inviteRules.ts; the register route records a redemption by
// writing `invitedBy` (the inviter's raw _id) + `invitedAt` on the NEW user document — that
// document is the only record of a redemption, so the invite tree and the budget read the same rows.
import { randomBytes } from 'crypto';
import { ObjectId, type Db } from 'mongodb';
import QRCode from 'qrcode';
import {
  codeFromBytes, inviteBudget, inviteUnlockAt, inviterBlock, inviteUrl, normalizeInviteCode,
  type InviteState,
} from './inviteRules';
export type { InviteState } from './inviteRules';

/** Global switch: env INVITES_PAUSED=1 (Vercel injects env at deploy time, so flipping it is a redeploy). */
export function invitesPausedAll(): boolean {
  return import.meta.env.INVITES_PAUSED === '1';
}

const INVITER_PROJECTION = { inviteCode: 1, emailVerified: 1, createdAt: 1, isBanned: 1, anonymized: 1, invitesPaused: 1 } as const;

function idFilter(userId: string): unknown {
  // Dev fixtures carry string _ids; prod has ObjectIds. Match either shape.
  return ObjectId.isValid(userId) ? { $in: [new ObjectId(userId), userId] } : userId;
}

async function mintCode(db: Db, _id: unknown): Promise<string | null> {
  // Up to 5 tries: a collision on the partial unique index (astronomically rare at 10 characters
  // over 31 symbols) just rolls again. The `$exists: false` guard keeps a parallel request from
  // overwriting a code minted a moment earlier — then the re-read below returns that one.
  for (let i = 0; i < 5; i++) {
    const code = codeFromBytes(randomBytes(10));
    try {
      const r = await db.collection('users').updateOne({ _id: _id as any, inviteCode: { $exists: false } }, { $set: { inviteCode: code } });
      if (r.matchedCount === 0) {
        const again = await db.collection('users').findOne({ _id: _id as any }, { projection: { inviteCode: 1 } });
        return typeof again?.inviteCode === 'string' ? again.inviteCode : null;
      }
      return code;
    } catch (e: any) {
      if (e?.code !== 11000) throw e;
    }
  }
  return null;
}

async function redemptionsOf(db: Db, inviterId: unknown) {
  // Tombstones lose `invitedBy` (the deletion pipeline unsets it), so a deleted invitee frees
  // the budget slot — accepted: the row that recorded the redemption is gone with the member.
  return db.collection('users')
    .find({ invitedBy: inviterId as any }, { projection: { name: 1, handle: 1, invitedAt: 1, anonymized: 1 } })
    .sort({ invitedAt: -1 })
    .limit(200)
    .toArray();
}

/** The member's own view. Mints the code on first eligible read. null = no such member. */
export async function getInviteState(db: Db, userId: string, base: string, now = new Date()): Promise<InviteState | null> {
  const user = await db.collection('users').findOne({ _id: idFilter(userId) as any }, { projection: INVITER_PROJECTION });
  if (!user) return null;
  const block = inviterBlock(user, now, invitesPausedAll());
  const rows = await redemptionsOf(db, user._id);
  const budget = inviteBudget(rows.map((r) => r.invitedAt), now);
  let code: string | null = null;
  if (!block) {
    code = typeof user.inviteCode === 'string' ? user.inviteCode : await mintCode(db, user._id);
  }
  const url = code ? inviteUrl(base, code) : null;
  let qrSvg: string | null = null;
  if (url) {
    // Same recipe as the Steckbrief card; the input is OUR url built from the trusted base and a
    // code of our own alphabet — never request input.
    try {
      qrSvg = await QRCode.toString(url, { type: 'svg', margin: 0, color: { dark: '#1b1a17', light: '#0000' } });
    } catch {
      qrSvg = null;
    }
  }
  return {
    code,
    url,
    qrSvg,
    block,
    unlockAt: block === 'too_new' ? inviteUnlockAt(user.createdAt)?.toISOString() ?? null : null,
    used: budget.used,
    left: budget.left,
    nextFreeAt: budget.nextFreeAt?.toISOString() ?? null,
    invitees: rows
      .filter((r) => r.anonymized !== true)
      .map((r) => ({
        name: typeof r.name === 'string' ? r.name : '',
        handle: typeof r.handle === 'string' ? r.handle : null,
        joinedAt: r.invitedAt instanceof Date ? r.invitedAt.toISOString() : String(r.invitedAt ?? ''),
      })),
  };
}

/** A new code for the member; the old one stops working at once. null when blocked or unknown. */
export async function regenerateInviteCode(db: Db, userId: string, now = new Date()): Promise<string | null> {
  const user = await db.collection('users').findOne({ _id: idFilter(userId) as any }, { projection: INVITER_PROJECTION });
  if (!user || inviterBlock(user, now, invitesPausedAll())) return null;
  for (let i = 0; i < 5; i++) {
    const code = codeFromBytes(randomBytes(10));
    try {
      await db.collection('users').updateOne({ _id: user._id }, { $set: { inviteCode: code } });
      return code;
    } catch (e: any) {
      if (e?.code !== 11000) throw e;
    }
  }
  return null;
}

export type ResolvedInvite =
  | { ok: true; inviter: { _id: unknown; name: string; handle: string | null } }
  | { ok: false; reason: 'invalid' | 'blocked' | 'exhausted' };

/** The register page / route asks: may this code still be used, and by whom was it issued? */
export async function resolveInvite(db: Db, rawCode: unknown, now = new Date()): Promise<ResolvedInvite> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, reason: 'invalid' };
  const inviter = await db.collection('users').findOne(
    { inviteCode: code },
    { projection: { ...INVITER_PROJECTION, name: 1, handle: 1 } },
  );
  if (!inviter) return { ok: false, reason: 'invalid' };
  if (inviterBlock(inviter, now, invitesPausedAll())) return { ok: false, reason: 'blocked' };
  const rows = await redemptionsOf(db, inviter._id);
  if (inviteBudget(rows.map((r) => r.invitedAt), now).left === 0) return { ok: false, reason: 'exhausted' };
  return {
    ok: true,
    inviter: {
      _id: inviter._id,
      name: typeof inviter.name === 'string' ? inviter.name : '',
      handle: typeof inviter.handle === 'string' ? inviter.handle : null,
    },
  };
}
```

- [ ] **Step 2: The member's route**

`src/pages/api/profile/invite.ts`:

```ts
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { ObjectId } from 'mongodb';
import { requireMemberSession } from '../../../lib/auth';
import { connectDB } from '../../../lib/mongodb';
import { getTrustedBaseUrl } from '../../../lib/auth/baseUrl';
import { consumeRateLimit } from '../../../lib/auth/rateLimit';
import { getInviteState, regenerateInviteCode } from '../../../lib/invites/invites';

// The member's personal invitation link (2026-10-07): GET = the card's data (mints the code on
// the first eligible read), POST { action: 'regenerate' } = a new code, the old one dies at once.
// GET is session-gated only: a banned member must READ why the card is empty (`block: 'banned'`
// from the rule — the store never mints for them); the live ban check on the POST keeps a banned
// member from writing anything.

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId || !ObjectId.isValid(userId)) return json({ error: 'Unauthorized' }, 401);
  const base = getTrustedBaseUrl(request);
  if (!base) return json({ error: 'base_url_unavailable' }, 503);
  const db = await connectDB();
  const state = await getInviteState(db, userId, base);
  if (!state) return json({ error: 'Not found' }, 404);
  return json(state);
};

export const POST: APIRoute = async ({ request }) => {
  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body || typeof body !== 'object' || (body as { action?: unknown }).action !== 'regenerate') {
    return json({ error: 'Invalid action' }, 400);
  }
  // Five renewals an hour: a renewal kills a link people may hold, and a loop of them is abuse.
  const limit = await consumeRateLimit(`invitecode:${gate.userId}`, 5, 60 * 60 * 1000);
  if (limit.limited) return json({ error: 'rate_limited', retryAfterSec: limit.retryAfterSec }, 429);
  const base = getTrustedBaseUrl(request);
  if (!base) return json({ error: 'base_url_unavailable' }, 503);
  const db = await connectDB();
  const code = await regenerateInviteCode(db, gate.userId);
  if (!code) return json({ error: 'not_allowed' }, 403);
  const state = await getInviteState(db, gate.userId, base);
  return json(state);
};
```

- [ ] **Step 3: The register route** — an optional code, checked right after `connectDB()` (before any OpenAI call), refused with `invite_invalid`, recorded on the insert, named in the Telegram line

```diff
diff --git a/src/pages/api/auth/register.ts b/src/pages/api/auth/register.ts
index fa66e2c2..be13e1e5 100644
--- a/src/pages/api/auth/register.ts
+++ b/src/pages/api/auth/register.ts
@@ -12,10 +12,11 @@ import { isAdminLookalike } from "../../../lib/profile/protectedNamesStore";
 import { alertNewMember } from "../../../lib/adminAlerts";
 import { parseMemberType } from "../../../lib/members/memberType";
 import { isAcceptablePassword } from "../../../lib/auth/passwordRule";
+import { resolveInvite } from "../../../lib/invites/invites";
 
 export const POST: APIRoute = async ({ request, clientAddress }) => {
     try {
-        const { name: rawName, email, password, handle: rawHandle, memberType: rawMemberType } = await request.json();
+        const { name: rawName, email, password, handle: rawHandle, memberType: rawMemberType, inviteCode: rawInvite } = await request.json();
         // Whitespace collapsed, invisible characters stripped — a name of only
         // spaces / zero-width characters ends up '' and is refused right below.
         const name = cleanDisplayName(rawName);
@@ -105,6 +106,23 @@ export const POST: APIRoute = async ({ request, clientAddress }) => {
         // name check needs it, and it must run BEFORE the OpenAI calls below).
         const db = await connectDB();
 
+        // Personal invitation link (2026-10-07). Optional: without a code this is a plain
+        // registration — the open door stays. With one, the code must still be usable (issuer
+        // eligible, budget left) or the form is told so and resubmits without it; a code is
+        // never silently dropped, the inviter counts on being named. Checked here, before any
+        // paid moderation call.
+        let inviter: { _id: unknown; name: string; handle: string | null } | null = null;
+        if (rawInvite !== undefined && rawInvite !== null && rawInvite !== '') {
+            const inv = await resolveInvite(db, rawInvite);
+            if (!inv.ok) {
+                return new Response(
+                    JSON.stringify({ error: 'invite_invalid' }),
+                    { status: 400, headers: { 'Content-Type': 'application/json' } }
+                );
+            }
+            inviter = inv.inviter;
+        }
+
         // Nobody poses as the team: official-sounding names and lookalikes of an
         // admin's own display name are refused (after both rate limits).
         if (isProtectedName(name) || await isAdminLookalike(db, name)) {
@@ -227,6 +245,8 @@ export const POST: APIRoute = async ({ request, clientAddress }) => {
                     ...(chosenHandle ? { handleChosen: true } : {}),
                     // person stores nothing — the absent field IS „person".
                     ...(memberType !== 'person' ? { memberType } : {}),
+                    // The redemption record: who invited this account, and when (the budget window reads it).
+                    ...(inviter ? { invitedBy: inviter._id, invitedAt: new Date() } : {}),
                     createdAt: new Date().toISOString(),
                     updatedAt: new Date().toISOString(),
                 });
@@ -278,7 +298,7 @@ export const POST: APIRoute = async ({ request, clientAddress }) => {
         // verification mail so a slow Telegram can't delay the user's own
         // signup email. finalHandle is captured in the retry loop above — no
         // extra DB read (a failing read would 500 a succeeded registration).
-        await alertNewMember({ name, handle: finalHandle, memberType });
+        await alertNewMember({ name, handle: finalHandle, memberType, invitedBy: inviter ? (inviter.handle ?? inviter.name) : null });
 
         return new Response(
             JSON.stringify({
```

- [ ] **Step 4: The Telegram line**

```diff
diff --git a/src/lib/adminAlerts.ts b/src/lib/adminAlerts.ts
index 67d38b48..e89155df 100644
--- a/src/lib/adminAlerts.ts
+++ b/src/lib/adminAlerts.ts
@@ -99,13 +99,15 @@ const MEMBER_TYPE_WORD: Record<'organisation' | 'business', string> = {
   business: 'Gewerbe',
 };
 
-export function alertNewMember(p: { name: string; handle: string; memberType?: 'person' | 'organisation' | 'business' }): Promise<void> {
+export function alertNewMember(p: { name: string; handle: string; memberType?: 'person' | 'organisation' | 'business'; invitedBy?: string | null }): Promise<void> {
   const typ = p.memberType === 'organisation' || p.memberType === 'business'
     ? ` — als ${MEMBER_TYPE_WORD[p.memberType]}`
     : '';
+  // The inviter's handle (or name) when the account came through a personal invitation link.
+  const via = p.invitedBy ? ` — eingeladen von ${trunc(p.invitedBy, 40)}` : '';
   return sendAdminAlert({
     kind: 'member_new',
-    text: `🆕 Neues Mitglied: ${trunc(p.name)} (@${p.handle})${typ}`,
+    text: `🆕 Neues Mitglied: ${trunc(p.name)} (@${p.handle})${typ}${via}`,
   });
 }
 
```

- [ ] **Step 5: The tombstone**

```diff
diff --git a/src/lib/auth/accountDeletion.ts b/src/lib/auth/accountDeletion.ts
index 67213fd4..82dcff17 100644
--- a/src/lib/auth/accountDeletion.ts
+++ b/src/lib/auth/accountDeletion.ts
@@ -450,6 +450,10 @@ export async function runDeletionPipeline(
           forumNotify: '',
           newsletter: '',
           locale: '',
+          inviteCode: '',
+          invitesPaused: '',
+          invitedBy: '',
+          invitedAt: '',
           deletionClaimedAt: '',
         },
       }
```

- [ ] **Step 6: The index**

```diff
diff --git a/scripts/create-auth-indexes.ts b/scripts/create-auth-indexes.ts
index 1f853278..720c607b 100644
--- a/scripts/create-auth-indexes.ts
+++ b/scripts/create-auth-indexes.ts
@@ -105,6 +105,15 @@ async function main() {
     { handle: 1 },
     { unique: true, partialFilterExpression: { handle: { $type: 'string' } }, name: 'users_handle_unique' });
 
+  // users_inviteCode_unique (2026-10-07) — a member's personal invitation code; the register
+  // page looks it up. PARTIAL for the same reason as the handle index: most documents have no
+  // code (minted on first eligible read; tombstones lose it). The lookup works without the
+  // index too (a neighbourhood-sized collection) — this makes the collision guard in
+  // src/lib/invites/invites.ts real.
+  await ensureIndex(db, 'users',
+    { inviteCode: 1 },
+    { unique: true, partialFilterExpression: { inviteCode: { $type: 'string' } }, name: 'users_inviteCode_unique' });
+
   // users_email_unique — closes the check-then-act race that let two accounts
   // share an address (register, e-mail-change start/confirm, and register-vs-
   // confirm across flows).
```

- [ ] **Step 7: Gates** — `pnpm type-check 2>&1 | grep -c "error TS"` → `16`; `pnpm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → `tests 450`, `pass 450`, `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/invites/invites.ts src/pages/api/profile/invite.ts src/pages/api/auth/register.ts src/lib/adminAlerts.ts src/lib/auth/accountDeletion.ts scripts/create-auth-indexes.ts
git commit -m "feat: invites — code store, the member's route, the register route records the inviter"
```

---

### Task 3: The register page names the inviter

**Files:**
- Create: `src/components/auth/kiosk/registerInvite.ts`
- Modify: `src/pages/register.astro`, `src/components/auth/kiosk/AuthRegisterInner.svelte`

**Interfaces:**
- Consumes from Task 2: `resolveInvite(db, rawCode)`; from Task 1: the `auth.register.invite.*` texts.
- Consumes (already on main): `AuthBanner` (`kind: 'warn' | 'danger' | 'success' | 'info'`, `title`, `body`), `tStr(template, vars)`.
- Produces: `type RegisterInvite = { code: string; inviterName: string; inviterHandle: string | null } | { dead: true }` (`registerInvite.ts`, pure); `AuthRegisterInner` prop `invite?: RegisterInvite | null`; hooks `[data-register-invite="ok"]` / `[data-register-invite="dead"]`; the POST carries `inviteCode` only while a valid code is held; `invite_invalid` from the route drops the code and shows the dead notice.

- [ ] **Step 1: The shared type**

`src/components/auth/kiosk/registerInvite.ts`:

```ts
// What register.astro hands the signup island about a personal invitation link (pure type).
export type RegisterInvite =
  | { code: string; inviterName: string; inviterHandle: string | null }
  | { dead: true };
```

- [ ] **Step 2: The page** — resolve `?invite=` server-side; a database hiccup renders the plain form

```diff
diff --git a/src/pages/register.astro b/src/pages/register.astro
index 68abfbdc..9a266f8b 100644
--- a/src/pages/register.astro
+++ b/src/pages/register.astro
@@ -1,10 +1,29 @@
 ---
 import AuthLayout from '../layouts/AuthLayout.astro';
 import AuthRegisterInner from '../components/auth/kiosk/AuthRegisterInner.svelte';
+import { connectDB } from '../lib/mongodb';
+import { resolveInvite } from '../lib/invites/invites';
+import type { RegisterInvite } from '../components/auth/kiosk/registerInvite';
 // Session-varying (logged-in members are bounced to /forum) — parity with reset/verify.
 Astro.response.headers.set('Cache-Control', 'no-store, must-revalidate');
+
+// Personal invitation link: /register?invite=<code>. Checked here so the visitor sees who
+// invited them (or that the link is dead) before typing; the register route checks again on
+// submit. A database hiccup must not take the register page down → plain form, no notice.
+let invite: RegisterInvite | null = null;
+const rawInvite = Astro.url.searchParams.get('invite');
+if (rawInvite !== null) {
+  try {
+    const inv = await resolveInvite(await connectDB(), rawInvite);
+    invite = inv.ok
+      ? { code: String(rawInvite).trim().toLowerCase(), inviterName: inv.inviter.name, inviterHandle: inv.inviter.handle }
+      : { dead: true };
+  } catch {
+    invite = null;
+  }
+}
 ---
 
 <AuthLayout title="Registrieren">
-  <AuthRegisterInner client:only="svelte" />
+  <AuthRegisterInner client:only="svelte" invite={invite} />
 </AuthLayout>
```

- [ ] **Step 3: The form** — the banner, the code in the POST, the `invite_invalid` branch

```diff
diff --git a/src/components/auth/kiosk/AuthRegisterInner.svelte b/src/components/auth/kiosk/AuthRegisterInner.svelte
index 0d5ef8ed..270dc105 100644
--- a/src/components/auth/kiosk/AuthRegisterInner.svelte
+++ b/src/components/auth/kiosk/AuthRegisterInner.svelte
@@ -10,6 +10,14 @@
   import AuthPrimaryBtn from './primitives/AuthPrimaryBtn.svelte';
   import AuthBanner from './primitives/AuthBanner.svelte';
   import AuthStrength from './primitives/AuthStrength.svelte';
+  import type { RegisterInvite } from './registerInvite';
+
+  // Personal invitation link (2026-10-07): the page resolved `?invite=` server-side. A valid
+  // code rides along in the POST; a dead one shows the notice and the form registers without it.
+  let { invite = null }: { invite?: RegisterInvite | null } = $props();
+  let inviteCode = $state(invite && 'code' in invite ? invite.code : '');
+  let inviteDead = $state(invite !== null && 'dead' in invite);
+  const inviterName = $derived(invite && 'code' in invite && inviteCode ? invite.inviterName : '');
 
   let name = $state('');
   // Optional one-time handle choice; empty → the server assigns the automatic one.
@@ -75,7 +83,7 @@
       const res = await fetch('/api/auth/register', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
-        body: JSON.stringify({ name: cleanName, email: email.trim(), password, ...(chosen ? { handle: chosen } : {}), memberType }),
+        body: JSON.stringify({ name: cleanName, email: email.trim(), password, ...(chosen ? { handle: chosen } : {}), memberType, ...(inviteCode ? { inviteCode } : {}) }),
       });
       const data = await res.json().catch(() => ({}));
       if (!res.ok) {
@@ -84,6 +92,9 @@
         if (code === 'name_protected') { nameErr = $t['auth.err.nameProtected']; status = 'idle'; return; }
         if (code === 'member_type_invalid') { memberTypeErr = $t['auth.err.memberType']; status = 'idle'; return; }
         if (code === 'password_weak') { pwErr = $t['auth.err.pwWeak']; status = 'idle'; return; }
+        // The link died between page load and submit (used up, renewed, inviter paused): drop
+        // the code, say so, and let the same form go through as a plain registration.
+        if (code === 'invite_invalid') { inviteCode = ''; inviteDead = true; status = 'idle'; return; }
         // 409 is ALSO the e-mail-taken status — the handle codes must be read first.
         if (code === 'handle_taken') { handleErr = $t['auth.err.handleTaken']; status = 'idle'; return; }
         if (code === 'handle_invalid') { handleErr = $t['auth.err.handleInvalid']; status = 'idle'; return; }
@@ -124,6 +135,15 @@
     {$t['auth.register.title.a']}<span class="font-instrument" style="font-style:italic; font-weight:400; color:var(--k-accent);">{$t['auth.register.title.accent']}</span>{$t['auth.register.title.b']}
   </h1>
 
+  {#if inviterName}
+    <div data-register-invite="ok">
+      <AuthBanner kind="info" title={tStr($t['auth.register.invite.title'], { name: inviterName })} body={tStr($t['auth.register.invite.body'], { name: inviterName })} />
+    </div>
+  {:else if inviteDead}
+    <div data-register-invite="dead">
+      <AuthBanner kind="warn" title={$t['auth.register.invite.dead.title']} body={$t['auth.register.invite.dead.body']} />
+    </div>
+  {/if}
   {#if emailTaken}
     <AuthBanner kind="danger" title={$t['auth.err.emailTakenTitle']} body={$t['auth.err.emailTakenBody']}
       action={$t['auth.err.emailTakenAction']} onaction={() => (window.location.href = '/login')} />
```

- [ ] **Step 4: Gates** — `pnpm type-check 2>&1 | grep -c "error TS"` → `16`; `npx -y svelte-check@4 2>&1 | tail -1` → `… 81 ERRORS …`. If svelte-check prints 82 or more, STOP and report the new error — do not „fix" it by loosening a type.

- [ ] **Step 5: Commit**

```bash
git add src/components/auth/kiosk/registerInvite.ts src/pages/register.astro src/components/auth/kiosk/AuthRegisterInner.svelte
git commit -m "feat: invites — the register page names the inviter or says the link is dead"
```

---

### Task 4: The „Einladen" card in the profile

**Files:**
- Create: `src/components/profile/kiosk/PInviteCard.svelte`
- Modify: `src/components/profile/kiosk/ProfileInner.svelte`

**Interfaces:**
- Consumes from Task 1: `INVITE_USES`, `inviteMailto`, `type InviteState`, the `profile.invite.*` texts; from Task 2: `GET`/`POST /api/profile/invite`.
- Consumes (already on main): `PCard`, `PCardHead({ n, title })`, `PBtn({ primary?, small?, href?, onclick?, class? })`, `PMobileFold({ title, hint?, open? })`, `formatDdMmYyyy(iso, 'de' | 'en')` (`src/lib/profile/profileShared.ts`), `showSuccess`/`showError`/`confirmAction` (`src/utils/toast.ts`), `t`/`tStr`/`locale`.
- Produces: `PInviteCard` props `{ invite?: InviteState | null; failed?; busy?; memberName?; onRegenerate?: () => Promise<void>; onRetry?: () => void; bare? }`; hooks `[data-invite-state="loading|failed|blocked|ready"]`, `[data-invite-block=<reason>]`, `[data-invite-url]`, `[data-invite-qr]`, `[data-invite-left]`, `[data-invite-share]`, `[data-invite-mail]`, `[data-invite-copy]`, `[data-invite-invitees]`, `[data-invite-renew]`, and the phone fold's `[data-invite-anchor]`. In `ProfileInner`: desktop card in the left column at `lg:row-start-4` (e-mail/password panels move to rows 5/6), phone fold `order-5` (panels `order-6/7`, archive `order-8`); state `inviteState`, `inviteFailed`, `inviteBusy`, `inviteRequested` ($state — it re-arms the effect), `retryInvite()`, `regenerateInvite()`.

- [ ] **Step 1: The card** (inline styles only — no `<style>`; prop `invite`, not `state`)

`src/components/profile/kiosk/PInviteCard.svelte`:

```svelte
<script lang="ts">
  // Einladen card — the member's personal invitation link (2026-10-07). Stateless/props-driven
  // like PKontoCard: it is double-mounted (desktop card + mobile fold), so the data, the one
  // fetch and the renew call live in ProfileInner. Reachable only through ProfileInner → no
  // <style> block (a scoped style would be orphaned in the production build); inline styles.
  //
  // What the member sees: who may not invite yet reads why (block); everyone else gets the
  // link as text, a QR code (server-rendered SVG of OUR url), three ways to pass it on —
  // the phone's share sheet, their own mail program (mailto:, prefilled), the clipboard —
  // the budget line and the members who joined through the link. Mahalle sends nothing.
  import { t, tStr, locale } from '../../../lib/kiosk-i18n';
  import { showSuccess, showError, confirmAction } from '../../../utils/toast';
  import { formatDdMmYyyy } from '../../../lib/profile/profileShared';
  import { INVITE_USES, inviteMailto, type InviteState } from '../../../lib/invites/inviteRules';
  import PCard from './atoms/PCard.svelte';
  import PCardHead from './atoms/PCardHead.svelte';
  import PBtn from './atoms/PBtn.svelte';

  // Prop is `invite`, not `state`: a prop called `state` would shadow the `$state` rune.
  let {
    invite = null,
    failed = false,
    busy = false,
    memberName = '',
    onRegenerate,
    onRetry,
    bare = false,
  }: {
    /** null = not loaded yet. */
    invite?: InviteState | null;
    failed?: boolean;
    busy?: boolean;
    memberName?: string;
    onRegenerate?: () => Promise<void>;
    onRetry?: () => void;
    bare?: boolean;
  } = $props();

  // The share sheet exists on phones and some desktops; decided after mount (SSR has no navigator).
  let canShare = $state(false);
  $effect(() => {
    canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  });

  const loc = $derived($locale === 'de' ? 'de' : 'en');
  const mailBody = $derived(invite?.url ? tStr($t['profile.invite.mail.body'], { url: invite.url, name: memberName }) : '');
  const mailHref = $derived(invite?.url ? inviteMailto($t['profile.invite.mail.subject'], mailBody) : '');

  async function share() {
    if (!invite?.url) return;
    try {
      await navigator.share({ title: $t['profile.invite.mail.subject'], text: $t['profile.invite.share.text'], url: invite.url });
    } catch {
      // Cancelled share sheets reject too — nothing to report.
    }
  }

  async function copy() {
    if (!invite?.url) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      showSuccess($t['profile.invite.copied']);
    } catch {
      showError($t['profile.invite.copyFailed']);
    }
  }

  async function renew() {
    if (busy || !onRegenerate) return;
    const ok = await confirmAction($t['profile.invite.renew.confirm'], {
      title: $t['profile.invite.renew.cta'],
      confirmLabel: $t['profile.invite.renew.cta'],
    });
    if (!ok) return;
    await onRegenerate();
  }
</script>

{#snippet body()}
  {#if failed}
    <div class="font-dmmono" data-invite-state="failed" style="font-size: 10.5px; color: var(--k-ink-mute); line-height: 1.55; padding-top: 10px;">
      {$t['profile.invite.error']}
      {#if onRetry}
        <button
          type="button"
          onclick={onRetry}
          style="font-family: var(--k-font-mono); font-size: 10.5px; font-weight: 700; color: var(--k-ink-mute); background: none; border: none; border-bottom: 1.5px solid var(--k-ink-mute); padding: 0; cursor: pointer;"
        >{$t['profile.save.retry']}</button>
      {/if}
    </div>
  {:else if !invite}
    <div data-invite-state="loading" aria-busy="true" style="height: 72px; margin-top: 10px; border-radius: var(--k-radius-sm); background: var(--k-rule); opacity: 0.35;"></div>
  {:else if invite.block}
    <div class="font-bricolage" data-invite-state="blocked" data-invite-block={invite.block} style="font-size: 13px; line-height: 1.5; color: var(--k-ink-soft); padding-top: 10px;">
      {#if invite.block === 'too_new'}
        {tStr($t['profile.invite.block.too_new'], { d: invite.unlockAt ? formatDdMmYyyy(invite.unlockAt, loc) : '—' })}
      {:else if invite.block === 'unverified'}
        {$t['profile.invite.block.unverified']}
      {:else if invite.block === 'paused'}
        {$t['profile.invite.block.paused']}
      {:else if invite.block === 'banned'}
        {$t['profile.invite.block.banned']}
      {:else}
        {$t['profile.invite.block.paused_all']}
      {/if}
    </div>
  {:else}
    <p class="font-bricolage" data-invite-state="ready" style="font-size: 12.5px; line-height: 1.5; color: var(--k-ink-soft); margin: 10px 0 0;">
      {tStr($t['profile.invite.intro'], { max: INVITE_USES })}
    </p>

    <div style="display: flex; gap: 14px; align-items: flex-start; margin-top: 14px;">
      {#if invite.qrSvg}
        <div data-invite-qr role="img" aria-label={$t['profile.invite.qr.alt']} style="flex-shrink: 0; width: 96px; height: 96px; padding: 6px; background: var(--k-paper); border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-sm);">
          {@html invite.qrSvg}
        </div>
      {/if}
      <div style="min-width: 0; flex: 1;">
        <div class="font-dmmono" style="font-size: 9.5px; color: var(--k-ink-mute); letter-spacing: 0.14em;">LINK</div>
        <div data-invite-url class="font-dmmono" style="font-size: 11.5px; line-height: 1.45; margin-top: 4px; overflow-wrap: anywhere; user-select: all;">{invite.url}</div>
        <div data-invite-left class="font-dmmono" style="font-size: 10px; color: {invite.left === 0 ? 'var(--k-warn)' : 'var(--k-ink-mute)'}; margin-top: 8px; letter-spacing: 0.05em;">
          {tStr($t['profile.invite.left'], { left: invite.left, max: INVITE_USES })}
          {#if invite.left === 0 && invite.nextFreeAt}
            &nbsp;·&nbsp;{tStr($t['profile.invite.nextFree'], { d: formatDdMmYyyy(invite.nextFreeAt, loc) })}
          {/if}
        </div>
      </div>
    </div>

    <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px;">
      {#if canShare}
        <PBtn primary small class="kiosk-tap" onclick={share}><span data-invite-share>{$t['profile.invite.share']}</span></PBtn>
      {/if}
      <PBtn small class="kiosk-tap" href={mailHref}><span data-invite-mail>{$t['profile.invite.mail']}</span></PBtn>
      <PBtn small class="kiosk-tap" onclick={copy}><span data-invite-copy>{$t['profile.invite.copy']}</span></PBtn>
    </div>

    {#if invite.invitees.length > 0}
      <div style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--k-rule);">
        <div class="font-dmmono" style="font-size: 9.5px; color: var(--k-ink-mute); letter-spacing: 0.14em;">{$t['profile.invite.invitees']}</div>
        <ul data-invite-invitees style="list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px;">
          {#each invite.invitees as person (person.handle ?? person.name + person.joinedAt)}
            <li class="font-bricolage" style="font-size: 12.5px; display: flex; gap: 8px; align-items: baseline; min-width: 0;">
              <span style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{person.name || '—'}</span>
              {#if person.handle}<span class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute);">@{person.handle}</span>{/if}
              <span class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute); margin-left: auto; white-space: nowrap;">{formatDdMmYyyy(person.joinedAt, loc)}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--k-rule);">
      <button
        type="button"
        data-invite-renew
        onclick={renew}
        disabled={busy}
        aria-busy={busy}
        class="font-dmmono"
        style="background: none; border: none; padding: 0; cursor: pointer; font-size: 10.5px; font-weight: 700; color: var(--k-ink-mute); border-bottom: 1.5px solid var(--k-ink-mute); opacity: {busy ? 0.5 : 1};"
      >{$t['profile.invite.renew']}</button>
    </div>
  {/if}
{/snippet}

{#if bare}
  {@render body()}
{:else}
  <PCard>
    <PCardHead n="04" title={$t['profile.invite.title']} />
    {@render body()}
  </PCard>
{/if}
```

- [ ] **Step 2: Mount it** — state and fetch in the orchestrator (double-mount rule), desktop row 4, phone fold after Konto

```diff
diff --git a/src/components/profile/kiosk/ProfileInner.svelte b/src/components/profile/kiosk/ProfileInner.svelte
index f48f28e0..51b66077 100644
--- a/src/components/profile/kiosk/ProfileInner.svelte
+++ b/src/components/profile/kiosk/ProfileInner.svelte
@@ -39,6 +39,8 @@
   import PIdentityCard from './PIdentityCard.svelte';
   import PModerationCard from './PModerationCard.svelte';
   import PKontoCard from './PKontoCard.svelte';
+  import PInviteCard from './PInviteCard.svelte';
+  import type { InviteState } from '../../../lib/invites/inviteRules';
   import PEmailChangePanel from './PEmailChangePanel.svelte';
   import PPasswordChangePanel from './PPasswordChangePanel.svelte';
   import PDeleteAccountModal from './PDeleteAccountModal.svelte';
@@ -142,6 +144,47 @@
       .catch(() => {});
   });
 
+  // ─── Einladen card (2026-10-07) ────────────────────────────────────────
+  // Same shape as the Kiez-Brief switch: the card is double-mounted, so the one fetch of
+  // GET /api/profile/invite and the renew call live here. `null` = not loaded.
+  let inviteState = $state<InviteState | null>(null);
+  let inviteFailed = $state(false);
+  let inviteBusy = $state(false);
+  let inviteRequested = $state(false);
+
+  $effect(() => {
+    if (!profile || inviteRequested) return;
+    inviteRequested = true;
+    inviteFailed = false;
+    fetch('/api/profile/invite')
+      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
+      .then((d: InviteState) => { inviteState = d; })
+      .catch(() => { inviteFailed = true; });
+  });
+
+  function retryInvite() {
+    inviteRequested = false;
+  }
+
+  async function regenerateInvite() {
+    if (inviteBusy) return;
+    inviteBusy = true;
+    try {
+      const res = await fetch('/api/profile/invite', {
+        method: 'POST',
+        headers: { 'Content-Type': 'application/json' },
+        body: JSON.stringify({ action: 'regenerate' }),
+      });
+      if (!res.ok) throw new Error(String(res.status));
+      inviteState = await res.json();
+      showSuccess($t['profile.invite.renewed']);
+    } catch {
+      showError($t['profile.invite.renewFailed']);
+    } finally {
+      inviteBusy = false;
+    }
+  }
+
   async function toggleNewsletter() {
     if (newsBusy || newsMode === null) return;
     const previous = newsMode;
@@ -457,18 +500,30 @@
         />
       </div>
 
+      <!-- Einladen — desktop card (lg+ only), under Konto -->
+      <div class="hidden min-w-0 lg:block lg:col-start-1 lg:row-start-4">
+        <PInviteCard
+          invite={inviteState}
+          failed={inviteFailed}
+          busy={inviteBusy}
+          memberName={profile.name}
+          onRegenerate={regenerateInvite}
+          onRetry={retryInvite}
+        />
+      </div>
+
       <!--
         E-mail change panel (Task 8) — SINGLE mount, own grid slot directly
         below the Konto card/fold on both breakpoints. See this file's
         "E-mail change" comment block above + PEmailChangePanel.svelte's
         header for why it can't be mounted inside PKontoCard itself (that
         component is double-mounted; a stateful panel would desync).
-        `lg:row-start-4` sits under Konto's `lg:row-start-3` in the same
-        column — the right column's `lg:row-span-3` only reserves rows 1–3,
-        so this doesn't force Archiv taller.
+        `lg:row-start-5` sits under the Einladen card's `lg:row-start-4` in
+        the same column — the right column's `lg:row-span-3` only reserves
+        rows 1–3, so this doesn't force Archiv taller.
       -->
       {#if emailPanelOpen}
-        <div class="order-5 min-w-0 lg:col-start-1 lg:row-start-4">
+        <div class="order-6 min-w-0 lg:col-start-1 lg:row-start-5">
           <PEmailChangePanel
             pendingEmail={profile.pendingEmail}
             onStarted={handleEmailStarted}
@@ -482,12 +537,12 @@
       <!--
         Password change panel (Task 9) — same single-mount reasoning as the
         e-mail panel above. Own grid slot one row further down
-        (`lg:row-start-5` / `order-6`) so it never collides with the e-mail
+        (`lg:row-start-6` / `order-7`) so it never collides with the e-mail
         panel's slot when both happen to be open at once; still inside the
         left column, still below the right column's `lg:row-span-3` reserve.
       -->
       {#if pwPanelOpen}
-        <div class="order-6 min-w-0 lg:col-start-1 lg:row-start-5">
+        <div class="order-7 min-w-0 lg:col-start-1 lg:row-start-6">
           <PPasswordChangePanel email={profile.email} onClose={closePwPanel} />
         </div>
       {/if}
@@ -506,8 +561,8 @@
       <!--
         Below lg the wrapper dissolves (`contents`) and its two children are
         grid items of their own: Chronik stays second, the archive goes LAST
-        (order-7) — after the Moderation and Konto folds and the e-mail /
-        password panels (order-3 … 6). From lg the wrapper is the right
+        (order-8) — after the Moderation, Konto and Einladen folds and the
+        e-mail / password panels (order-3 … 7). From lg the wrapper is the right
         column's flex stack again (the children's `order` is reset there).
       -->
       <div class="contents min-w-0 lg:flex lg:flex-col lg:gap-5 lg:col-start-2 lg:row-start-1 lg:row-span-3">
@@ -516,7 +571,7 @@
             <PChronikStrip chronik={initialChronik} />
           </div>
         {/if}
-        <div class="order-7 min-w-0 lg:order-none">
+        <div class="order-8 min-w-0 lg:order-none">
           <PActivityLedger />
         </div>
       </div>
@@ -570,6 +625,21 @@
           />
         </PMobileFold>
       </div>
+
+      <!-- Einladen — mobile fold (below lg only), closed like the other folds -->
+      <div data-invite-anchor class="order-5 min-w-0 lg:hidden">
+        <PMobileFold title={$t['profile.invite.title']} hint={$t['profile.invite.fold.hint']}>
+          <PInviteCard
+            invite={inviteState}
+            failed={inviteFailed}
+            busy={inviteBusy}
+            memberName={profile.name}
+            onRegenerate={regenerateInvite}
+            onRetry={retryInvite}
+            bare
+          />
+        </PMobileFold>
+      </div>
     </div>
   </div>
 
```

- [ ] **Step 3: Gates** — `pnpm type-check 2>&1 | grep -c "error TS"` → `16`; `npx -y svelte-check@4 2>&1 | tail -1` → `… 81 ERRORS …` (same STOP rule as Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/components/profile/kiosk/PInviteCard.svelte src/components/profile/kiosk/ProfileInner.svelte
git commit -m "feat: invites — the Einladen card in the profile"
```

---

### Task 5: The admin sees the tree and can pause a member

**Files:**
- Modify: `src/pages/api/admin/users/index.ts`, `src/pages/api/admin/users/[id].ts`, `src/components/admin/kiosk/MitgliederApp.svelte`

**Interfaces:**
- Consumes from Task 1: the `admin.users.invite*` texts; `User.invitedBy`/`invitesPaused` are read off raw documents.
- Consumes (already on main): `requireAdminSession`, `planAdminPatch(stored, body)` (`src/lib/members/memberTypeChange.ts`), `patchRow(row, patch, optimistic)` inside the island.
- Produces: `GET /api/admin/users` rows gain `invitedBy: { name: string; handle: string | null } | null`, `invited: number`, `invitesPaused: boolean`; `PATCH /api/admin/users/[id]` accepts `invitesPaused?: boolean` (only `true` stored; a body with only `newsletter`/`invitesPaused` writes nothing else) and echoes `invitesPaused`; the row prints `[data-admin-invite-line]` (`[data-admin-invited-by]`, `[data-admin-invited]`) under the meta line and a fifth control column with the pill `[data-admin-invites="on|off"]`; the list is 1160 px wide.

- [ ] **Step 1: The list** — the tree resolved from the loaded rows plus one lookup for inviters outside them

```diff
diff --git a/src/pages/api/admin/users/index.ts b/src/pages/api/admin/users/index.ts
index f9ee91a7..d44778e6 100644
--- a/src/pages/api/admin/users/index.ts
+++ b/src/pages/api/admin/users/index.ts
@@ -1,4 +1,5 @@
 import type { APIRoute } from 'astro';
+import { ObjectId } from 'mongodb';
 import { connectDB } from '../../../../lib/mongodb';
 import { requireAdminSession } from '../../../../lib/auth';
 import { storedMemberType } from '../../../../lib/members/memberType';
@@ -55,12 +56,32 @@ export const GET: APIRoute = async ({ request }) => {
       .collection('users')
       .find(
         { anonymized: { $ne: true } },
-        { projection: { name: 1, handle: 1, email: 1, createdAt: 1, emailVerified: 1, verified: 1, role: 1, memberType: 1, dailyLimit: 1, newsletter: 1 } }
+        { projection: { name: 1, handle: 1, email: 1, createdAt: 1, emailVerified: 1, verified: 1, role: 1, memberType: 1, dailyLimit: 1, newsletter: 1, invitedBy: 1, invitesPaused: 1 } }
       )
       .sort({ createdAt: -1 })
       .limit(1000)
       .toArray();
 
+    // The invite tree (2026-10-07): who issued the link each member came through, and how many
+    // members each one brought in. Inviters are resolved from the loaded rows (the list is the
+    // whole community) plus one lookup for inviters outside it (tombstones → „Ehemaliges Mitglied").
+    const byId = new Map(docs.map((u) => [u._id.toString(), u]));
+    const inviterIds = Array.from(new Set(docs.map((u) => u.invitedBy).filter((v) => v !== undefined && v !== null).map(String)));
+    const missing = inviterIds.filter((id) => !byId.has(id));
+    if (missing.length > 0) {
+      const extra = await db
+        .collection('users')
+        .find({ _id: { $in: missing.flatMap((id) => (ObjectId.isValid(id) ? [new ObjectId(id), id] : [id])) as any[] } }, { projection: { name: 1, handle: 1 } })
+        .toArray();
+      for (const u of extra) byId.set(u._id.toString(), u);
+    }
+    const invitedCount = new Map<string, number>();
+    for (const u of docs) {
+      if (u.invitedBy === undefined || u.invitedBy === null) continue;
+      const k = String(u.invitedBy);
+      invitedCount.set(k, (invitedCount.get(k) ?? 0) + 1);
+    }
+
     const users = docs.map((u) => ({
       id: u._id.toString(),
       name: typeof u.name === 'string' ? u.name : '',
@@ -81,6 +102,16 @@ export const GET: APIRoute = async ({ request }) => {
       // The stored number, shown only for an organisation (it counts for no one else).
       dailyLimit:
         storedMemberType(u) === 'organisation' && typeof u.dailyLimit === 'number' ? u.dailyLimit : null,
+      invitedBy: (() => {
+        if (u.invitedBy === undefined || u.invitedBy === null) return null;
+        const inviter = byId.get(String(u.invitedBy));
+        return {
+          name: typeof inviter?.name === 'string' ? inviter.name : '',
+          handle: typeof inviter?.handle === 'string' ? inviter.handle : null,
+        };
+      })(),
+      invited: invitedCount.get(u._id.toString()) ?? 0,
+      invitesPaused: u.invitesPaused === true,
     }));
 
     return new Response(JSON.stringify({ users }), {
```

- [ ] **Step 2: The pause**

```diff
diff --git a/src/pages/api/admin/users/[id].ts b/src/pages/api/admin/users/[id].ts
index d7ecad55..61c41230 100644
--- a/src/pages/api/admin/users/[id].ts
+++ b/src/pages/api/admin/users/[id].ts
@@ -21,6 +21,9 @@ const BodySchema = z.object({
   memberType: z.enum(MEMBER_TYPES).optional(),
   dailyLimit: z.number().int().min(1).max(MAX_DAILY_LIMIT).nullable().optional(),
   newsletter: z.enum(NEWSLETTER_MODES).optional(),
+  // Personal invitation link: pause one member's inviting (their link stops working, the card
+  // tells them). Admin-only writer, like `verified`.
+  invitesPaused: z.boolean().optional(),
 }).strict();
 
 export const PATCH: APIRoute = async ({ request, params }) => {
@@ -59,7 +62,7 @@ export const PATCH: APIRoute = async ({ request, params }) => {
     // Read first: the limit rule depends on the member's type AFTER this call.
     const stored = await users.findOne(
       { _id, anonymized: { $ne: true } },
-      { projection: { memberType: 1, dailyLimit: 1, verified: 1, newsletter: 1 } }
+      { projection: { memberType: 1, dailyLimit: 1, verified: 1, newsletter: 1, invitesPaused: 1 } }
     );
     if (!stored) {
       return new Response(JSON.stringify({ error: 'not_found' }), {
@@ -69,9 +72,11 @@ export const PATCH: APIRoute = async ({ request, params }) => {
     }
 
     // The planner knows `verified`, `memberType` and `dailyLimit`, and refuses a body with none
-    // of them — so a Kiez-Brief-only call gets an empty plan (nothing else changes).
-    const { newsletter, ...rest } = parsed.data;
-    const plan = newsletter !== undefined && Object.keys(rest).length === 0
+    // of them — so a call with only the fields outside its knowledge (Kiez-Brief, invites) gets
+    // an empty plan (nothing else changes).
+    const { newsletter, invitesPaused, ...rest } = parsed.data;
+    const outsideOnly = Object.keys(rest).length === 0;
+    const plan = outsideOnly
       ? planAdminPatch(stored, { verified: stored.verified === true })
       : planAdminPatch(stored, rest);
     if (!plan.ok) {
@@ -84,10 +89,13 @@ export const PATCH: APIRoute = async ({ request, params }) => {
     // Same storage rule as the member's own switch: absent = weekly, 'off' = none.
     const set: Record<string, unknown> = { ...plan.set };
     const unset: string[] = [...plan.unset];
-    // The Kiez-Brief-only plan above restates `verified` to satisfy the planner: do not write it.
-    if (newsletter !== undefined && Object.keys(rest).length === 0) delete set.verified;
+    // The outside-only plan above restates `verified` to satisfy the planner: do not write it.
+    if (outsideOnly) delete set.verified;
     if (newsletter === 'off') set.newsletter = 'off';
     if (newsletter === 'weekly') unset.push('newsletter');
+    // Absent = may invite; only `true` is stored.
+    if (invitesPaused === true) set.invitesPaused = true;
+    if (invitesPaused === false) unset.push('invitesPaused');
 
     const update: Record<string, Record<string, unknown>> = {};
     if (Object.keys(set).length > 0) update.$set = set;
@@ -102,6 +110,7 @@ export const PATCH: APIRoute = async ({ request, params }) => {
       memberType: plan.result.memberType,
       dailyLimit: plan.result.dailyLimit,
       newsletter: newsletter ?? storedNewsletterMode(stored.newsletter),
+      invitesPaused: invitesPaused ?? stored.invitesPaused === true,
     }), {
       status: 200,
       headers: { 'Content-Type': 'application/json' }
```

- [ ] **Step 3: The row**

```diff
diff --git a/src/components/admin/kiosk/MitgliederApp.svelte b/src/components/admin/kiosk/MitgliederApp.svelte
index d0423c08..34a92030 100644
--- a/src/components/admin/kiosk/MitgliederApp.svelte
+++ b/src/components/admin/kiosk/MitgliederApp.svelte
@@ -29,6 +29,11 @@
     memberType: MemberType;
     dailyLimit: number | null;
     newsletter: 'weekly' | 'off';
+    /** Who issued the invitation link this member came through (null = plain registration). */
+    invitedBy: { name: string; handle: string | null } | null;
+    /** How many members came through this member's link. */
+    invited: number;
+    invitesPaused: boolean;
   };
 
   let users = $state<AdminUserRow[]>([]);
@@ -95,7 +100,7 @@
     }
   }
 
-  type RowPatch = { verified?: boolean; memberType?: MemberType; dailyLimit?: number | null; newsletter?: 'weekly' | 'off' };
+  type RowPatch = { verified?: boolean; memberType?: MemberType; dailyLimit?: number | null; newsletter?: 'weekly' | 'off'; invitesPaused?: boolean };
 
   // „✓ gespeichert" beside the controls for two seconds after a successful save.
   let savedRow = $state<string | null>(null);
@@ -124,7 +129,7 @@
       if (!res.ok) throw new Error(`patch failed (${res.status})`);
       const j = await res.json();
       users = users.map((u) => (u.id === row.id
-        ? { ...u, verified: j.verified === true, memberType: j.memberType, dailyLimit: j.dailyLimit ?? null, newsletter: j.newsletter === 'off' ? 'off' : 'weekly' }
+        ? { ...u, verified: j.verified === true, memberType: j.memberType, dailyLimit: j.dailyLimit ?? null, newsletter: j.newsletter === 'off' ? 'off' : 'weekly', invitesPaused: j.invitesPaused === true }
         : u));
       // The type selector and the limit field save without a button — say so.
       // (The verify button already changes its own label; no mark for it.)
@@ -152,6 +157,12 @@
     return patchRow(row, { newsletter: next }, { newsletter: next });
   }
 
+  // Invitations on/off for this member (their personal link stops working while paused).
+  function toggleInvites(row: AdminUserRow) {
+    const next = !row.invitesPaused;
+    return patchRow(row, { invitesPaused: next }, { invitesPaused: next });
+  }
+
   function setType(row: AdminUserRow, next: MemberType) {
     if (next === row.memberType) return;
     return patchRow(row, { memberType: next }, {
@@ -190,7 +201,7 @@
   });
 </script>
 
-<div style="max-width: 1040px; margin: 0 auto; padding: 26px 18px 60px;">
+<div style="max-width: 1160px; margin: 0 auto; padding: 26px 18px 60px;">
   <!-- Title block -->
   <div style="margin-bottom: 18px;">
     <div class="font-dmmono" style="font-size: 10px; color: var(--k-accent); letter-spacing: 0.14em;">
@@ -282,17 +293,30 @@
               <div class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute); margin-top: 3px; letter-spacing: 0.05em;">
                 {tStr($t['admin.users.since'], { d: fmtDate(row.createdAt) })}
                 &nbsp;·&nbsp;
-                {row.emailVerified ? $t['admin.users.emailok'] : $t['admin.users.emailno']}
+                <span style="white-space: nowrap;">{row.emailVerified ? $t['admin.users.emailok'] : $t['admin.users.emailno']}</span>
                 {#if savedRow === row.id}
                   &nbsp;·&nbsp;
                   <span role="status" data-admin-saved style="font-weight: 600; color: var(--k-moss);">{$t['admin.users.saved']}</span>
                 {/if}
               </div>
+              <!-- The invite tree, on its own line so the meta line above keeps its shape:
+                   who issued the link this member came through · how many came through theirs. -->
+              {#if row.invitedBy || row.invited > 0}
+                <div data-admin-invite-line class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute); margin-top: 3px; letter-spacing: 0.05em;">
+                  {#if row.invitedBy}
+                    <span data-admin-invited-by>{row.invitedBy.handle ? tStr($t['admin.users.invitedBy'], { h: row.invitedBy.handle }) : `${$t['admin.users.invitedBy'].split('@')[0]}${row.invitedBy.name || '—'}`}</span>
+                  {/if}
+                  {#if row.invitedBy && row.invited > 0}&nbsp;·&nbsp;{/if}
+                  {#if row.invited > 0}
+                    <span data-admin-invited>{tStr($t['admin.users.invited'], { n: row.invited })}</span>
+                  {/if}
+                </div>
+              {/if}
             </div>
 
-            <!-- Phones: the controls flow and wrap. From lg: four fixed columns (type · limit · Kiez-Brief ·
-                 verify) so every row has the same shape; the limit column stays empty unless Initiative. -->
-            <div data-admin-controls class="flex flex-wrap items-center gap-2.5 lg:grid lg:grid-cols-[214px_158px_128px_112px]">
+            <!-- Phones: the controls flow and wrap. From lg: five fixed columns (type · limit · Kiez-Brief ·
+                 invites · verify) so every row has the same shape; the limit column stays empty unless Initiative. -->
+            <div data-admin-controls class="flex flex-wrap items-center gap-2.5 lg:grid lg:grid-cols-[214px_158px_128px_150px_112px]">
               <label class="font-dmmono" style="display: flex; align-items: center; gap: 6px; font-size: 9.5px; letter-spacing: 0.1em; color: var(--k-ink-mute);">
                 {$t['admin.users.type.label']}
                 <select
@@ -348,6 +372,24 @@
               >
                 {row.newsletter === 'off' ? $t['admin.users.brief.off'] : $t['admin.users.brief.on']}
               </button>
+              <button
+                type="button"
+                class="font-dmmono"
+                data-admin-invites={row.invitesPaused ? 'off' : 'on'}
+                title={$t['admin.users.invites.title']}
+                aria-pressed={!row.invitesPaused}
+                style="
+                  border: 1.5px {row.invitesPaused ? 'dashed' : 'solid'} var(--k-ink); border-radius: 999px;
+                  padding: 6px 12px; font-size: 11px; font-weight: 700; white-space: nowrap;
+                  cursor: pointer; min-height: 32px; background: var(--k-paper);
+                  color: {row.invitesPaused ? 'var(--k-ink-mute)' : 'var(--k-ink)'};
+                  {busy.has(row.id) ? 'opacity: 0.5; cursor: wait;' : ''}
+                "
+                disabled={busy.has(row.id)}
+                onclick={() => toggleInvites(row)}
+              >
+                {row.invitesPaused ? $t['admin.users.invites.off'] : $t['admin.users.invites.on']}
+              </button>
               <button
                 type="button"
                 class="font-dmmono"
```

- [ ] **Step 4: Gates** — `pnpm type-check 2>&1 | grep -c "error TS"` → `16`; `npx -y svelte-check@4 2>&1 | tail -1` → `… 81 ERRORS …`; `TELEGRAM_BOT_TOKEN= TELEGRAM_ADMIN_CHAT_ID= SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY= npx astro build --config scratchpad/astro.config.preview.mjs > scratchpad/invites/build.log 2>&1; echo $?` → `0`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/admin/users/index.ts "src/pages/api/admin/users/[id].ts" src/components/admin/kiosk/MitgliederApp.svelte
git commit -m "feat: invites — the admin list shows who invited whom and can pause a member"
```

---

### Task 6: Docs and the browser gate

**Files:**
- Modify: `CLAUDE.md`, `src/components/auth/kiosk/CLAUDE.md`, `src/components/profile/kiosk/CLAUDE.md`, `src/components/admin/CLAUDE.md`

- [ ] **Step 1: The notes** — the root file (users fields, rate-limit bucket, env var, Telegram line), the auth notes (the feature's home section), the profile notes (the card), the admin notes (the row)

```diff
diff --git a/CLAUDE.md b/CLAUDE.md
index 72302487..63f077e5 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -124,7 +124,7 @@ export const POST: APIRoute = async ({ request }) => {
 - **Prod transport is Resend** (since 2026-08-09, domain switch): `RESEND_API_KEY` + `SENDING_FROM_EMAIL="Mahalle <noreply@mahalle.digital>"` in Production; `SMTP_*` REMOVED from prod (mailbox.org SMTP retired there — it sent from the borrowed `noreply@ercan-atak.de`). Local `.env` still carries `SMTP_*`, so dev uses SMTP; that's fine. Resend domain `mahalle.digital` verified (EU region `eu-west-1`; DKIM/SPF/MX live on the `send.` subdomain at Porkbun, DMARC `p=none` on root). Preview deploys have no transport → auth mails dev-log into function logs; the contact relay 503s there since `import.meta.env.PROD` is true on Preview builds too. Runbook: `docs/runbooks/smtp-mailer-smoke.md` (SMTP-era, kept for the transport-chooser smoke pattern).
 
 ### Admin alerts (Telegram + email mirror)
-`src/lib/adminAlerts.ts` (server-only) pings the single admin: Telegram for everything (new member, moderation-queue item, report, new content/comment, marketplace contact, Sentry issue via `POST /api/hooks/sentry` — secret-guarded, middleware-allowlisted), email mirror (`ADMIN_ALERT_EMAIL`) only for member/moderation/report — the mirror is OFF in prod since 2026-09-14 (var removed to keep Resend Free under 100 mails/day for the debut event). Contract: never-throw (static `captureMessage` + flush), awaited best-effort in the request window, 10s TG timeout, silent no-op without `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ADMIN_CHAT_ID` (preview/dev default). Self-suppression: the admin's own actions never alert (rides the `skipModeration` gates), EXCEPT the marketplace contact relay (`/api/listings/[id]/contact`) which is session-less by design (buyer is anonymous) — an admin using the relay does ping himself. New kind `kiez_brief` (2026-10-04, Telegram only): what a Kiez-Brief run did — a group sent (with the count), a quiet week, a failed send, the admin's test copy; since 2026-10-05 also a member's OWN switch („📭 Kiez-Brief abbestellt" / „📬 wieder abonniert", with name, handle and where: profile, unsubscribe page, mail program) — sent by `setOwnNewsletterMode()` (`src/lib/newsletter/preference.ts`, the one writer for those three routes) only on a real change, at most 5 an hour per member (`briefpref:<userId>`), never for the admin's pill or the admin's own account. New kind `member_type` (2026-10-01, Telegram only): a member's own profile change that ends on Initiative or Gewerbe; `member_new` names the type when it is not person. Either/or rule: a creation sends `content_new` OR `moderation_flagged`, never both; news always sends `moderation_flagged` (editorial queue). The `moderation_flagged` alert on fail-safe `moderation_error` records doubles as an OpenAI-outage tripwire.
+`src/lib/adminAlerts.ts` (server-only) pings the single admin: Telegram for everything (new member, moderation-queue item, report, new content/comment, marketplace contact, Sentry issue via `POST /api/hooks/sentry` — secret-guarded, middleware-allowlisted), email mirror (`ADMIN_ALERT_EMAIL`) only for member/moderation/report — the mirror is OFF in prod since 2026-09-14 (var removed to keep Resend Free under 100 mails/day for the debut event). Contract: never-throw (static `captureMessage` + flush), awaited best-effort in the request window, 10s TG timeout, silent no-op without `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ADMIN_CHAT_ID` (preview/dev default). Self-suppression: the admin's own actions never alert (rides the `skipModeration` gates), EXCEPT the marketplace contact relay (`/api/listings/[id]/contact`) which is session-less by design (buyer is anonymous) — an admin using the relay does ping himself. New kind `kiez_brief` (2026-10-04, Telegram only): what a Kiez-Brief run did — a group sent (with the count), a quiet week, a failed send, the admin's test copy; since 2026-10-05 also a member's OWN switch („📭 Kiez-Brief abbestellt" / „📬 wieder abonniert", with name, handle and where: profile, unsubscribe page, mail program) — sent by `setOwnNewsletterMode()` (`src/lib/newsletter/preference.ts`, the one writer for those three routes) only on a real change, at most 5 an hour per member (`briefpref:<userId>`), never for the admin's pill or the admin's own account. New kind `member_type` (2026-10-01, Telegram only): a member's own profile change that ends on Initiative or Gewerbe; `member_new` names the type when it is not person. Since 2026-10-07 `member_new` also names the inviter („— eingeladen von @…") when the account came through a personal invitation link. Either/or rule: a creation sends `content_new` OR `moderation_flagged`, never both; news always sends `moderation_flagged` (editorial queue). The `moderation_flagged` alert on fail-safe `moderation_error` records doubles as an OpenAI-outage tripwire.
 
 ### Data Fetching
 - TanStack Svelte Query for client-side data fetching in the forum + calendar islands; plain `fetch` helpers elsewhere
@@ -174,7 +174,7 @@ See `src/pages/api/news/CLAUDE.md` — full notes load when working in that subt
 `public/manifest.webmanifest` + `public/icons/` + a push-only `public/sw.js` make Mahalle installable (home-screen install, incl. iOS) and let the service worker deliver web push when the tab is backgrounded or closed. **No offline caching** — locked 2026-08-06, deliberate: this is a push delivery mechanism, not an offline-first app. `sw.js` must never gain a `fetch` handler. Client opt-in lives in `src/lib/pushClient.ts`; see the `pushSubscriptions` collection below and `src/components/forum/kiosk/CLAUDE.md`'s "Notification bell + panel" for the UI states.
 
 ## Database Collections
-- `users` - User accounts. **Names may repeat, the handle is the identity (2026-09-21):** display names are NOT unique (prod has two „Petra"); `@handle` is, and it is shown next to the name in comments, post detail, the seller card and the event author slab. ONE display-name rule for signup and profile edit lives in the pure `src/lib/profile/nameRules.ts` (2–30 chars, letters of any script, digits, space, `. ' ’ - _ /` (the slash since the evening of 09-21, user decision — organisations write their names that way, e.g. „STK Schillerpromenade/Neukölln“; first and last character stay letter/digit); invisible/control characters stripped — until that day signup checked only „not empty + profanity"); the same file refuses team lookalikes (`isProtectedName`: „Mahalle", „Admin…", „Team" …, compared after lookalike folding — Cyrillic/Greek twins, leetspeak) and `src/lib/profile/protectedNamesStore.ts` refuses lookalikes of an admin's own display name; admins are exempt on rename. New members may CHOOSE their handle once at signup (`handleChosen?: true`; `RESERVED_HANDLES` + `chosenHandleProblem()` in `src/lib/profile/handle.ts`; error codes `name_invalid` / `name_protected` / `handle_invalid` / `handle_reserved` / `handle_taken` 409); without a choice the automatic slug applies. Existing handles never change (no change route — deliberate, user decision). **Client-visible user joins use ONE allowlist, `PUBLIC_AUTHOR_PROJECTION` + `toPublicAuthor()` in `src/lib/publicAuthor.ts` — never `{ password: 0 }`**: until 09-21 the comments list, all create/edit responses and the News list joined the full user document (e-mail, strike data, `pendingEmail`, tour stamps) for any logged-in member; proven on dev with `scratchpad/author-join-keys.mts` (prints key NAMES only). **Two unique indexes** (both **partial**, both ensured idempotently by `scripts/create-auth-indexes.ts`): `users_handle_unique` on `handle`, and `users_email_unique` on `email` — unique, `partialFilterExpression: { email: { $type: 'string' } }`, collation `{locale:'en',strength:2}`. Partial is load-bearing in both cases: the deletion tombstone `$unset`s those fields, and a full unique index would collide every such doc on one implicit null key. The email collation is a **one-way door** (MongoDB ≥7.3 forbids re-adding the same partial index with a different collation) and the index is **not** used by any query — partial indexes only become plan-eligible when the query restates the filter, which none of the five email lookups do. Because a second unique index now exists, `register.ts` must discriminate code 11000 on `e.keyPattern` (`handle` → retry with a suffix, `email` → 409, anything else → rethrow); never read `e.keyValue`, which is a raw ICU sort key for collated indexes. Full rationale + rollback: `docs/runbooks/users-email-unique-index.md`. Fields include `moderationStrikes`, `strikeHistory` (per-strike ledger: date/reason/contentType/contentId/reviewedBy), `isBanned` — ENFORCED: banned accounts cannot log in and all content-write APIs return 403 `account_banned` (see `src/lib/auth/banGuard.ts`); plus `role?: 'user' | 'admin'` — admin role unlocks `/admin/announcements`, the moderation queue, and the `isOfficial`-true admin-create endpoint; defaults to `'user'`; plus `handle?: string` — unique per-user slug (`[a-z0-9_]{3,20}`, see `src/lib/profile/handle.ts`), enforced by a **partial** unique index `users_handle_unique` (a full unique index would collide every handle-less user on the same implicit null key and break registration) — set at registration going forward, batch-backfilled for older accounts via `scripts/backfill-user-handles.ts`, and lazily self-healed on first profile load by `ensureHandle()` for any stragglers; plus `verified?: boolean` — Kiez-verification v1 (Aug 2026): STRICT, badge renders only on `verified === true` (absent/undefined = not verified); toggled by admins on `/admin/mitglieder` via `PATCH /api/admin/users/[id]` (the flag's only writer — keep it server-controlled); single source of truth so future proof sources (postcard code, event QR) can set the same flag; plus `motto?: string` — optional Steckbrief line, own-view/print-only, never on the public profile; `pendingEmail?: string` — set mid e-mail-change, cleared on confirm/cancel; `passwordChangedAt?: Date` — stamped on password change/reset, invalidates JWTs whose `loginAt` predates it (other-device sign-out, see `auth.config.ts`'s `jwt` callback); `deletionScheduledAt?: Date` — 7-day account-deletion grace timestamp (`src/lib/auth/accountDeletion.ts`), cleared on undo; `dankeCrossedAt?: Date` — stamp-on-first-observation date the user's summed likes crossed 100 (Kiez-Chronik milestone, `src/lib/profile/chronik.ts`); `anonymized?: boolean` + `deletedAt?: Date` — set together by the day-7 deletion pipeline's tombstone step, replacing `name` with "Ehemaliges Mitglied" and unsetting email/password/image/userPicture/hobbies/handle/verified/emailVerified/roleBadge/role/motto/pendingEmail/dankeCrossedAt/deletionScheduledAt/tours/tourHelloDismissedAt/deletionClaimedAt (last three added in the 2026-08-30 hardening batch) and memberType/dailyLimit while KEEPING moderationStrikes/strikeHistory/isBanned/bannedAt/bannedReason/createdAt/passwordChangedAt — see `src/components/profile/kiosk/CLAUDE.md`'s "Account deletion" section for the full ordered pipeline); plus `tours?: { forum?: Date, kalender?: Date, markt?: Date, kurier?: Date, kiezdaten?: Date, blog?: Date, profil?: Date }` + `tourHelloDismissedAt?: Date` — spotlight-tour per-chapter seen stamps (timestamps not booleans; first write wins; see `src/components/tour/CLAUDE.md`); plus `lastSeenAt?: Date` — stamped best-effort by the JWT callback's existing 5-minute recheck (since 2026-09-22), one activity signal among several that feed „active in the last 90 days" for the `@alle` Admin-Hinweis (see `src/components/forum/kiosk/CLAUDE.md` → „Mentions"); plus `memberType?: 'organisation' | 'business'` — self-chosen at signup or in profile edit (absent = person, no migration), shown as the tag „Initiative" / „Gewerbe" beside the name via `MemberTypeTag.svelte`, correctable by the admin on `/admin/mitglieder`, normalised by `storedMemberType()` in every member-data join; plus `dailyLimit?: number` — admin-only (the PATCH on `/api/admin/users/[id]` is its ONLY writer), honoured only while the type is organisation, cleared whenever the member or the admin moves the type away from organisation, never in a client-visible projection except the admin list; plus `lastVisit?: { forum?, kalender?, markt?, blog?: Date }` — last opening of each section's index page (`POST /api/profile/visit`), drives the „new since your last visit" tab dots (`GET /api/profile/section-news`) and the „neu" chips; absent = nothing new; unset by the deletion tombstone. Spec `docs/superpowers/specs/2026-10-01-member-types-design.md`, plan `docs/superpowers/plans/2026-10-01-member-types.md`); plus `forumNotify?: 'digest' | 'off'` — forum-notification preference (2026-10-03; absent = every new public post (the default since 03:41 the same night — it was the daily digest for a few hours), `'digest'` = one notification each morning, `'off'` = none; read/written by `GET/POST /api/profile/forum-notify`, not ban-gated; unset by the deletion tombstone); plus `newsletter?: 'off'` — Kiez-Brief preference (2026-10-03; absent = the weekly Kiez-Brief e-mail, `'off'` = none; read/written by `GET/POST /api/profile/newsletter` (the switch in the profile's Konto card), not ban-gated; also set by the unsubscribe link and the RFC 8058 one-click route, and by the admin on `/admin/mitglieder` (test accounts, bouncing addresses); the mail goes to unconfirmed addresses too since 2026-10-04; unset by the deletion tombstone); plus `locale?: 'en'` — the server's copy of the DE/EN toggle (2026-10-04; absent = German; written by `POST /api/profile/locale` from `src/lib/localeSync.ts`, which the nav calls on load and on every toggle; read by the Kiez-Brief to pick the mail's language; unset by the deletion tombstone)
+- `users` - User accounts. **Names may repeat, the handle is the identity (2026-09-21):** display names are NOT unique (prod has two „Petra"); `@handle` is, and it is shown next to the name in comments, post detail, the seller card and the event author slab. ONE display-name rule for signup and profile edit lives in the pure `src/lib/profile/nameRules.ts` (2–30 chars, letters of any script, digits, space, `. ' ’ - _ /` (the slash since the evening of 09-21, user decision — organisations write their names that way, e.g. „STK Schillerpromenade/Neukölln“; first and last character stay letter/digit); invisible/control characters stripped — until that day signup checked only „not empty + profanity"); the same file refuses team lookalikes (`isProtectedName`: „Mahalle", „Admin…", „Team" …, compared after lookalike folding — Cyrillic/Greek twins, leetspeak) and `src/lib/profile/protectedNamesStore.ts` refuses lookalikes of an admin's own display name; admins are exempt on rename. New members may CHOOSE their handle once at signup (`handleChosen?: true`; `RESERVED_HANDLES` + `chosenHandleProblem()` in `src/lib/profile/handle.ts`; error codes `name_invalid` / `name_protected` / `handle_invalid` / `handle_reserved` / `handle_taken` 409); without a choice the automatic slug applies. Existing handles never change (no change route — deliberate, user decision). **Client-visible user joins use ONE allowlist, `PUBLIC_AUTHOR_PROJECTION` + `toPublicAuthor()` in `src/lib/publicAuthor.ts` — never `{ password: 0 }`**: until 09-21 the comments list, all create/edit responses and the News list joined the full user document (e-mail, strike data, `pendingEmail`, tour stamps) for any logged-in member; proven on dev with `scratchpad/author-join-keys.mts` (prints key NAMES only). **Two unique indexes** (both **partial**, both ensured idempotently by `scripts/create-auth-indexes.ts`): `users_handle_unique` on `handle`, and `users_email_unique` on `email` — unique, `partialFilterExpression: { email: { $type: 'string' } }`, collation `{locale:'en',strength:2}`. Partial is load-bearing in both cases: the deletion tombstone `$unset`s those fields, and a full unique index would collide every such doc on one implicit null key. The email collation is a **one-way door** (MongoDB ≥7.3 forbids re-adding the same partial index with a different collation) and the index is **not** used by any query — partial indexes only become plan-eligible when the query restates the filter, which none of the five email lookups do. Because a second unique index now exists, `register.ts` must discriminate code 11000 on `e.keyPattern` (`handle` → retry with a suffix, `email` → 409, anything else → rethrow); never read `e.keyValue`, which is a raw ICU sort key for collated indexes. Full rationale + rollback: `docs/runbooks/users-email-unique-index.md`. Fields include `moderationStrikes`, `strikeHistory` (per-strike ledger: date/reason/contentType/contentId/reviewedBy), `isBanned` — ENFORCED: banned accounts cannot log in and all content-write APIs return 403 `account_banned` (see `src/lib/auth/banGuard.ts`); plus `role?: 'user' | 'admin'` — admin role unlocks `/admin/announcements`, the moderation queue, and the `isOfficial`-true admin-create endpoint; defaults to `'user'`; plus `handle?: string` — unique per-user slug (`[a-z0-9_]{3,20}`, see `src/lib/profile/handle.ts`), enforced by a **partial** unique index `users_handle_unique` (a full unique index would collide every handle-less user on the same implicit null key and break registration) — set at registration going forward, batch-backfilled for older accounts via `scripts/backfill-user-handles.ts`, and lazily self-healed on first profile load by `ensureHandle()` for any stragglers; plus `verified?: boolean` — Kiez-verification v1 (Aug 2026): STRICT, badge renders only on `verified === true` (absent/undefined = not verified); toggled by admins on `/admin/mitglieder` via `PATCH /api/admin/users/[id]` (the flag's only writer — keep it server-controlled); single source of truth so future proof sources (postcard code, event QR) can set the same flag; plus `motto?: string` — optional Steckbrief line, own-view/print-only, never on the public profile; `pendingEmail?: string` — set mid e-mail-change, cleared on confirm/cancel; `passwordChangedAt?: Date` — stamped on password change/reset, invalidates JWTs whose `loginAt` predates it (other-device sign-out, see `auth.config.ts`'s `jwt` callback); `deletionScheduledAt?: Date` — 7-day account-deletion grace timestamp (`src/lib/auth/accountDeletion.ts`), cleared on undo; `dankeCrossedAt?: Date` — stamp-on-first-observation date the user's summed likes crossed 100 (Kiez-Chronik milestone, `src/lib/profile/chronik.ts`); `anonymized?: boolean` + `deletedAt?: Date` — set together by the day-7 deletion pipeline's tombstone step, replacing `name` with "Ehemaliges Mitglied" and unsetting email/password/image/userPicture/hobbies/handle/verified/emailVerified/roleBadge/role/motto/pendingEmail/dankeCrossedAt/deletionScheduledAt/tours/tourHelloDismissedAt/deletionClaimedAt (last three added in the 2026-08-30 hardening batch) and memberType/dailyLimit while KEEPING moderationStrikes/strikeHistory/isBanned/bannedAt/bannedReason/createdAt/passwordChangedAt — see `src/components/profile/kiosk/CLAUDE.md`'s "Account deletion" section for the full ordered pipeline); plus `tours?: { forum?: Date, kalender?: Date, markt?: Date, kurier?: Date, kiezdaten?: Date, blog?: Date, profil?: Date }` + `tourHelloDismissedAt?: Date` — spotlight-tour per-chapter seen stamps (timestamps not booleans; first write wins; see `src/components/tour/CLAUDE.md`); plus `lastSeenAt?: Date` — stamped best-effort by the JWT callback's existing 5-minute recheck (since 2026-09-22), one activity signal among several that feed „active in the last 90 days" for the `@alle` Admin-Hinweis (see `src/components/forum/kiosk/CLAUDE.md` → „Mentions"); plus `memberType?: 'organisation' | 'business'` — self-chosen at signup or in profile edit (absent = person, no migration), shown as the tag „Initiative" / „Gewerbe" beside the name via `MemberTypeTag.svelte`, correctable by the admin on `/admin/mitglieder`, normalised by `storedMemberType()` in every member-data join; plus `dailyLimit?: number` — admin-only (the PATCH on `/api/admin/users/[id]` is its ONLY writer), honoured only while the type is organisation, cleared whenever the member or the admin moves the type away from organisation, never in a client-visible projection except the admin list; plus `lastVisit?: { forum?, kalender?, markt?, blog?: Date }` — last opening of each section's index page (`POST /api/profile/visit`), drives the „new since your last visit" tab dots (`GET /api/profile/section-news`) and the „neu" chips; absent = nothing new; unset by the deletion tombstone. Spec `docs/superpowers/specs/2026-10-01-member-types-design.md`, plan `docs/superpowers/plans/2026-10-01-member-types.md`); plus `forumNotify?: 'digest' | 'off'` — forum-notification preference (2026-10-03; absent = every new public post (the default since 03:41 the same night — it was the daily digest for a few hours), `'digest'` = one notification each morning, `'off'` = none; read/written by `GET/POST /api/profile/forum-notify`, not ban-gated; unset by the deletion tombstone); plus `newsletter?: 'off'` — Kiez-Brief preference (2026-10-03; absent = the weekly Kiez-Brief e-mail, `'off'` = none; read/written by `GET/POST /api/profile/newsletter` (the switch in the profile's Konto card), not ban-gated; also set by the unsubscribe link and the RFC 8058 one-click route, and by the admin on `/admin/mitglieder` (test accounts, bouncing addresses); the mail goes to unconfirmed addresses too since 2026-10-04; unset by the deletion tombstone); plus `locale?: 'en'` — the server's copy of the DE/EN toggle (2026-10-04; absent = German; written by `POST /api/profile/locale` from `src/lib/localeSync.ts`, which the nav calls on load and on every toggle; read by the Kiez-Brief to pick the mail's language; unset by the deletion tombstone); plus `inviteCode?: string`, `invitesPaused?: true`, `invitedBy?: <inviter _id>`, `invitedAt?: Date` — personal invitation links (2026-10-07): a member's permanent code (minted on the first eligible read of the profile's Einladen card, renewable, partial unique index `users_inviteCode_unique` in `scripts/create-auth-indexes.ts`), the admin's per-member pause, and on the INVITED account who issued the link and when — that row is the only record of a redemption (budget: 5 per rolling 30 days, counted from `invitedAt`); all four unset by the deletion tombstone; rules in the pure `src/lib/invites/inviteRules.ts`, store in `src/lib/invites/invites.ts`, notes in `src/components/auth/kiosk/CLAUDE.md` → „Personal invitation links"
 - `topics` - Forum posts (includes `moderationStatus`, `isUserReported`, `rejectionReason`, `images` fields — each image is `{ url, publicId, width?, height? }`; the optional pixel size, stored since 2026-09-25 and backfilled by `scripts/backfill-post-image-dimensions.ts`, lets the detail hero reserve its box before the file arrives (CLS). Same shape in `announcements`, `recommendations` and `postDrafts`.)
 - `events` - Calendar events (includes `moderationStatus`, `isUserReported` fields; since 2026-10-06 `movedAt` + `movedFromStart` when the author moved the date or time (drives the „verschoben" tag) and the short-lived `moveNoticeOwed` while a moved edit waits in the moderation queue — the members who answered or saved the event get an `event_moved` notification, see `src/components/calendar/kiosk/CLAUDE.md` → „kopieren" + „verschoben"; an author can also COPY an own event onto a new date, there are no recurring events by decision) **All-day events store Europe/Berlin day bounds since 2026-09-27** (00:00:00.000 → 23:59:59.999 Berlin; before: UTC bounds that Berlin read as two days — repair via `scripts/repair-allday-event-bounds.ts`, see `src/components/calendar/kiosk/CLAUDE.md` „All-day events are Berlin days").
 - `announcements` - Community + official announcements (includes `moderationStatus`, `isUserReported`, `rejectionReason`, `images`, plus **`isOfficial?: boolean`** + **`pinnedUntil?: Date | null`** for admin-posted official announcements with the 7-day pin lifecycle (up to `MAX_PINS` = 3 concurrent pins since Aug 2026, oldest displaced — `src/lib/announcements/pin.ts`; the forum index renders all pins as slim collapsed bars, one opening in place as a fused bar+card accordion — v3 2026-09-12; on phones 2–3 pins start as ONE summary bar and the tag row folds behind a „# Tags" chip since 2026-09-20, both with a slide animation that the posts below follow; see `src/components/forum/kiosk/CLAUDE.md`) — server-controlled, never settable from client input; **authors can change a post's kind from edit mode since 2026-09-13** (cross-collection move via `POST /api/posts/move/[id]`, `src/lib/forum/movePost.ts`; officials excluded; old URLs 302 — see `src/components/forum/kiosk/CLAUDE.md` „Kind change in edit mode"); plus **`editCount?: number`** — incremented server-side on every successful title/body `PATCH` from the admin composer's edit mode, surfaced in the kiosk `AnnCard` meta line ("Nx bearbeitet" / "edited Nx"); see admin dashboard at `/admin/announcements` (kiosk `AnnounceApp.svelte`, see `src/components/admin/CLAUDE.md`))
@@ -191,7 +191,7 @@ See `src/pages/api/news/CLAUDE.md` — full notes load when working in that subt
 - `flaggedContent` - Content flagged by AI or user reports (for admin review queue)
 - `passwordResetTokens` - Single-use password-reset tokens (`{ tokenHash (sha256 of raw), userId, expiresAt, usedAt, createdAt }`); raw token only in the emailed link. 30-min TTL, atomic single-use consume. See `src/lib/auth/passwordReset.ts`.
 - `emailVerifyTokens` - Single-use email-verification tokens (`{ tokenHash (sha256 of raw), userId, expiresAt, usedAt, createdAt }`); raw token only in the emailed link. 24h TTL, atomic single-use consume, sets `users.emailVerified: true`. See `src/lib/auth/emailVerify.ts`.
-- `rateLimits` - Fixed-window rate-limit buckets (`{ key: '<baseKey>#<windowId>', baseKey, count, expiresAt }`, TTL index). Used by login lockout (5 fails/15min), mentions (`mention:<userId>` 20 notifying saves/h — above that a mention is still stored and linked, but silent; `mentionsearch:<userId>` 600/h for the „@" autocomplete), the News link preview (30/h per member, `newsprev:<userId>` — SSRF-hardened `GET /api/news/preview`, see `src/pages/api/news/CLAUDE.md`), forgot-password (20/h IP + 3/h email, silent), register (40/h IP + 3/h email — IP gates are ROOM-sized since 2026-09-14: a tablet, hotspot or venue Wi-Fi is one IP; the email bucket is the per-person brake, and since 2026-09-28 it is charged only AFTER the name has passed every check — until then three refused names locked a newcomer out for the rest of the hour; both register 429s now return `retryAfterSec` + a `Retry-After` header and the form shows the minutes), resend-verification (10/h user), `membertype:<userId>` (5 member-type Telegram pings/h — the ping is skipped above that, the change itself is never refused). See `src/lib/auth/rateLimit.ts`; indexes via `scripts/create-auth-indexes.ts`.
+- `rateLimits` - Fixed-window rate-limit buckets (`{ key: '<baseKey>#<windowId>', baseKey, count, expiresAt }`, TTL index). Used by login lockout (5 fails/15min), mentions (`mention:<userId>` 20 notifying saves/h — above that a mention is still stored and linked, but silent; `mentionsearch:<userId>` 600/h for the „@" autocomplete), the News link preview (30/h per member, `newsprev:<userId>` — SSRF-hardened `GET /api/news/preview`, see `src/pages/api/news/CLAUDE.md`), forgot-password (20/h IP + 3/h email, silent), register (40/h IP + 3/h email — IP gates are ROOM-sized since 2026-09-14: a tablet, hotspot or venue Wi-Fi is one IP; the email bucket is the per-person brake, and since 2026-09-28 it is charged only AFTER the name has passed every check — until then three refused names locked a newcomer out for the rest of the hour; both register 429s now return `retryAfterSec` + a `Retry-After` header and the form shows the minutes), resend-verification (10/h user), `membertype:<userId>` (5 member-type Telegram pings/h — the ping is skipped above that, the change itself is never refused). `invitecode:<userId>` (5 renewals of the personal invitation link per hour, 2026-10-07 — a renewal kills a link people may hold). See `src/lib/auth/rateLimit.ts`; indexes via `scripts/create-auth-indexes.ts`.
 - `emailChangeTokens` - Single-use e-mail-change confirmation tokens (`{ tokenHash (sha256 of raw), userId, newEmail, expiresAt, usedAt, createdAt }`); raw token only in the emailed link. See `src/lib/auth/emailChange.ts`.
 - `accountDeletionTokens` - Single-use account-deletion undo tokens (`{ tokenHash (sha256 of raw), userId, expiresAt, usedAt, createdAt }`), issued alongside `users.deletionScheduledAt`. See `src/lib/auth/accountDeletion.ts`.
 - `chronikCache` - 24h-TTL (checked in-code, not a Mongo TTL index) cache of each user's derived Kiez-Chronik tenure timeline (`{ userId, payload: ChronikData, computedAt, expiresAt }`). See `src/lib/profile/chronik.ts`.
@@ -251,6 +251,7 @@ TELEGRAM_BOT_TOKEN=     # BotFather token for the admin-alerts bot. SERVER-ONLY
 TELEGRAM_ADMIN_CHAT_ID= # Numeric chat id of the admin↔bot DM (from getUpdates after /start). Server-only.
 ADMIN_ALERT_EMAIL=      # Email mirror recipient for admin-action alerts (member/moderation/report). Unset ⇒ email leg no-op. REMOVED from Vercel Production 2026-09-14 for the Schillermarkt debut (Resend Free = 100 mails/day; the mirror cost a third mail per signup) — Telegram carries every alert; re-add after the event if wanted.
 SENTRY_WEBHOOK_SECRET=  # Random 32+ chars guarding POST /api/hooks/sentry. Unset ⇒ endpoint fail-closed 401.
+INVITES_PAUSED=         # Optional kill switch for personal invitation links (2026-10-07): `1` pauses inviting for EVERY member (links die, the profile card says „zurzeit pausiert"). Read at request time, but Vercel injects env at deploy time — flipping it is a redeploy. Unset = invites on. Per-member pause: the admin's pill on /admin/mitglieder.
 ```
 
 ## Component Patterns
```

```diff
diff --git a/src/components/auth/kiosk/CLAUDE.md b/src/components/auth/kiosk/CLAUDE.md
index 1cdc72a1..3f21184b 100644
--- a/src/components/auth/kiosk/CLAUDE.md
+++ b/src/components/auth/kiosk/CLAUDE.md
@@ -234,6 +234,14 @@ Started from a member question („is there a uniqueness check for user names?"
 - Accepted: a signup attempt reveals whether a handle exists (bounded by 40/h per IP, 3/h per e-mail).
 - Tests: `npx tsx --test src/lib/profile/nameRules.test.ts src/lib/profile/handleChoice.test.ts`. Probes (dev): `scratchpad/e2e-handle-choice.mts` (9), `scratchpad/e2e-protected-names.mts` (6), `scratchpad/audit-names-handles.mts` (READ-ONLY, `--prod` switches the db path inside node; prod 09-21: 37 members, all with a handle, one name outside the rule — „STK Schillerpromenade/Neukölln", the slash — and one identical-name pair).
 
+## Personal invitation links (2026-10-07)
+Every eligible member has ONE permanent invitation code (`users.inviteCode`); the link `/register?invite=<code>` opens the signup door with the inviter named, and the new account records `invitedBy` (the inviter's raw `_id`) + `invitedAt`. That row is the ONLY record of a redemption — the member's budget (5 per rolling 30 days), the admin's invite tree and „über deinen Link dabei" all read it. Owner decisions (2026-10-07, after research — Lobste.rs' visible invite tree, Gmail/Clubhouse's earned small quotas): permanent link + rolling cap (a link that expires would kill printed QR cards), invites earned (confirmed address AND 7 days of membership, `INVITE_MIN_AGE_DAYS`), invite ≠ shortcut (invitees still verify and still pass moderation), revocable (member renews, admin pauses), the open door stays (plain registration unchanged), and **Mahalle never sends the invitation** — the member shares the link from their own apps (share sheet, `mailto:` into their own mail program, clipboard, QR); BGH I ZR 208/12 is the reason, and we never see the recipient's address.
+- **Rules** are the dependency-pure `src/lib/invites/inviteRules.ts` (tests `inviteRules.test.ts`): `normalizeInviteCode` (10 lowercase alnum), `codeFromBytes` over an alphabet without i/l/o/0/1, `inviterBlock(user, now, pausedAll)` → `'anonymized' | 'banned' | 'paused_all' | 'paused' | 'unverified' | 'too_new' | null` (strongest reason first), `inviteBudget(redeemedAt[], now)` → `{ used, left, nextFreeAt }`, `inviteUrl`, `inviteMailto` (RFC 6068: CRLF + percent-encoding, no recipient). **Store** is `src/lib/invites/invites.ts` (server-only): `getInviteState` (mints the code on the first ELIGIBLE read — a blocked member gets `code: null`, nothing is minted or revealed), `regenerateInviteCode`, `resolveInvite(db, code)` → `{ ok, inviter } | { ok: false, reason: 'invalid' | 'blocked' | 'exhausted' }`, `invitesPausedAll()` (env `INVITES_PAUSED=1`). QR = the Steckbrief recipe (`qrcode` → SVG of OUR url).
+- **Register page** (`register.astro`) resolves `?invite=` server-side and hands `AuthRegisterInner` a `RegisterInvite` (`registerInvite.ts`): valid → info banner „Eingeladen von {name}" (`[data-register-invite="ok"]`), the code rides in the POST; invalid/blocked/exhausted → warn banner „gilt nicht mehr … trotzdem anmelden" (`[data-register-invite="dead"]`), the form posts WITHOUT a code. A DB hiccup renders the plain form (never a 500 on the door). **Route** (`register.ts`): `inviteCode` is optional; a supplied code is checked right after `connectDB()` (before any OpenAI call) and refused with 400 `invite_invalid` — never silently dropped, the inviter counts on being named; the form then shows the dead banner, drops the code and the member's SECOND click registers plainly (probe C8/C9). The insert adds `invitedBy` + `invitedAt`; the `member_new` Telegram line names the inviter.
+- **The inviter's name is shown to whoever opens the link** (display names are member-visible anyway; the invitee got the link from that person). A leaked permanent link yields at most 5 strangers a month, all marked „eingeladen von", and the member can renew (old link dies at once) — accepted by design.
+- **Known limits (told to the owner):** the budget is count-then-insert, two simultaneous redemptions of the last slot both pass (a 6th in a race); a deleted invitee's tombstone loses `invitedBy`, so that slot frees early; the per-member pause and the global `INVITES_PAUSED` are the only brakes besides the cap. Texts are DRAFT copy (`auth.register.invite.*`, `profile.invite.*`, `admin.users.invite*`).
+- Probe: `scratchpad/invites/probe.cjs` (45 checks: card desktop + phone fold, too-new / unconfirmed / banned member, register through the link, dead/malformed/exhausted/paused links, link dying between load and submit, renew + 429, admin pause pill, no leak in the public projection) with `scratchpad/invites/db.mts seed|state|fill|unfill|cleanup`. Registrations send a verify mail and a Telegram line — build AND start the local server with `TELEGRAM_BOT_TOKEN= TELEGRAM_ADMIN_CHAT_ID= SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY=` in front.
+
 ## One password rule for new passwords (2026-10-02)
 `isAcceptablePassword()` in the pure `src/lib/auth/passwordRule.ts` (8–100 characters, a lowercase letter, an uppercase letter, a digit; tests `passwordRule.test.ts`, one of them pins it against `ResetPasswordSchema`) is used by BOTH the signup form (`pwOk`) and `POST /api/auth/register` (400 `password_weak`, mapped to the password field's `auth.err.pwWeak`). Until that day the route accepted 6 characters of anything and a number/object as `password` slipped through. The check runs before the rate-limit charges and before any write. Password change and reset already enforced the same rule through their zod schemas. **Login is deliberately not bound to it** (`LoginSchema` min 6, `authorize` untouched): members with an older, shorter password keep logging in. Probes: `scratchpad/batch-1002/probe.cjs` (API) and `form.cjs` (form).
 
```

```diff
diff --git a/src/components/profile/kiosk/CLAUDE.md b/src/components/profile/kiosk/CLAUDE.md
index d814c6fe..582c30a5 100644
--- a/src/components/profile/kiosk/CLAUDE.md
+++ b/src/components/profile/kiosk/CLAUDE.md
@@ -35,6 +35,9 @@ PIdentityCard            — avatar + name/handle/since + verified + stats +
 PModerationCard          — §02 standing display (stateless, `bare` prop)
 PKontoCard                — §03 email/password rows + logout + "ändern" action
                             + §08 pending banner (stateless, `bare` prop)
+PInviteCard               — §04 Einladen: personal invitation link, QR, share /
+                            mailto / copy, budget, invitees, renew (stateless,
+                            `bare` prop; see "Einladen card" below)
 PEmailChangePanel         — e-mail change stages 01/02 (STATEFUL, single
                             mount; see "E-mail change" below)
 PChronikStrip             — Kiez-Chronik tenure strip (stateless, SSR-only
@@ -286,6 +289,9 @@ content on mobile with no visible cause, check for missing `min-w-0` first.
 ## Kiez-Brief switch in the Konto card (2026-10-04)
 The weekly mail's on/off is a third row in `PKontoCard` under PASSWORT: label „KIEZ-BRIEF (E-MAIL)", state „jeden Sonntag" / „abbestellt", action „abbestellen" / „einschalten" (same underlined text-button as „ändern"). Props `newsletterMode` (`null` = not loaded → no row), `newsletterBusy`, `onToggleNewsletter`; state, the one fetch of `GET /api/profile/newsletter` and the optimistic toggle live in `ProfileInner` (double-mount rule, like the e-mail and password panels). (A warn-coloured hint for unverified members existed for one hour on 2026-10-04 and left again: since that afternoon the mail goes to unconfirmed addresses too, with its own note inside the mail.) Why here and not in the bell panel, the unsubscribe page's undo step and the probe: `src/components/forum/kiosk/CLAUDE.md` → „Kiez-Brief" → „The switch lives in the PROFILE".
 
+## Einladen card (personal invitation link, 2026-10-07)
+`PInviteCard.svelte` — §04 under Konto on desktop (`lg:row-start-4`; the e-mail and password panels moved to rows 5/6), a closed `PMobileFold` „Einladen" after the Konto fold on phones (`order-5`, hint `profile.invite.fold.hint`; panels `order-6/7`, archive `order-8`). Stateless and double-mounted like PKontoCard: the one fetch of `GET /api/profile/invite`, `retryInvite()` and `regenerateInvite()` (POST `{ action: 'regenerate' }`, confirm dialog first — the old link dies at once, printed cards included) live in `ProfileInner`. Prop is `invite`, NOT `state` — a prop named `state` shadows the `$state` rune (svelte-check: „Cannot use 'state' as a store"). No `<style>` block (reachable only through ProfileInner). What it shows: a blocked member reads WHY (`[data-invite-block]`: unverified / too_new with the unlock date / paused / paused_all / banned) and gets no code; otherwise the link as selectable text (`[data-invite-url]`, built from the trusted `NEXTAUTH_URL` — on the local build it reads `localhost:3000`, not the probe's origin), a 96 px QR (`[data-invite-qr]`, server SVG via `{@html}` of OUR string), „Teilen" only where `navigator.share` exists (decided after mount; headless has none), „per E-Mail" = `<a href="mailto:…">` with subject + body prefilled (`inviteMailto`; the member's own mail program, no recipient field of ours), „Link kopieren" (clipboard + toast), the budget line `[data-invite-left]` („5 von 5 frei", warn-coloured „0 von 5 frei · wieder ab dd.mm.yyyy" when exhausted), the invitees list (`[data-invite-invitees]`, name · @handle · date) and „neuen Link erzeugen" (`[data-invite-renew]`, 5/h via `invitecode:<userId>`). Rules + store + probe: `src/components/auth/kiosk/CLAUDE.md` → „Personal invitation links".
+
 ## E-mail change (Plan B, Task 8)
 
 Design source: `kiosk-profile-flows.jsx` §03 `EmailChangeFlow` (stages 01
```

```diff
diff --git a/src/components/admin/CLAUDE.md b/src/components/admin/CLAUDE.md
index 23d76508..e03afce4 100644
--- a/src/components/admin/CLAUDE.md
+++ b/src/components/admin/CLAUDE.md
@@ -93,7 +93,8 @@ Kiez-verification v1 (Aug 2026): `users.verified` is strict (`=== true`) and adm
 - **Row layout (2026-10-04 evening, owner: „looks so untidy")**: the green „✓ VERIFIZIERT" badge sits beside the name (`data-admin-verified`, after the @handle / admin chip), no longer among the controls; the „✓ gespeichert" note prints in the meta line under the name, so it moves nothing. The controls (`data-admin-controls`) flow and wrap below `lg`; from `lg` they are a grid of four FIXED columns — type 214 px · limit 158 px · Kiez-Brief 128 px · verify 112 px — and the limit column stays empty (a hidden placeholder `<span>`) for everyone who is not an Initiative, so every row has the same shape. The list is 1040 px wide (was 880) to leave the name column ~300 px. Before: the badge, the limit field and the different widths of „Verifizieren"/„Entziehen" pushed the type selector to a different place in each row, and an Initiative row wrapped onto a second line. When a label gets longer (new member type, new language), widen its column — a `<select>` clips silently. Probe: `scratchpad/kiez-brief/admin-layout-probe.cjs` (26 checks, DE + EN, 1440 / 1024 / 390 px; it sets one member to Initiative and one to verified and restores both).
 - **Each row shows the member's address (2026-10-04 evening)**: `GET /api/admin/users` returns `email` (string or `null`), the row prints it under the name as a `mailto:` link (`data-admin-email`, wraps anywhere). Reason: the owner asked for a new member's address and no admin surface showed one (list, search and Telegram alert all carried none). Admin-only payload, `Cache-Control: no-store`; a pending change's address is not shown. The search below still asks the server (it also matches `pendingEmail`).
 - **Search by e-mail address, while typing (2026-10-04)**: a bounce names an address, so the one search field also searches addresses. From three characters (`emailFragment()`: trimmed, no spaces, not an „@handle" search) the island asks `GET /api/admin/users?email=<piece>` 250 ms after the last keystroke; the route answers `{ ids }` only (literal, case-insensitive substring on `email` and `pendingEmail` — the fragment goes through `escapeRegex()`; at most 50; 400 below three characters) and the matching rows are shown TOGETHER with the name/@handle matches from the already loaded list. The first version wanted the whole address („get it?" — the owner wanted it to narrow as he types; same afternoon). Helpers pure and tested: `src/lib/members/emailLookup.ts`. First use: the one bounce of the first Kiez-Brief (an Apple hide-my-mail alias; Resend suppresses a hard-bounced address by itself, so later issues skip it — and so do login mails to it). Probe: `scratchpad/kiez-brief/email-search-probe.cjs` (18 checks, the address line included).
+- **Invitations (2026-10-07)**: `GET /api/admin/users` also returns `invitedBy: { name, handle } | null` (who issued the link this member came through — resolved from the loaded rows plus one lookup for inviters outside the list; a tombstoned inviter reads „Ehemaliges Mitglied"), `invited` (how many came through this member's link) and `invitesPaused`. The row prints them on their OWN line under the meta line (`[data-admin-invite-line]`: `[data-admin-invited-by]` „eingeladen von @handle" · `[data-admin-invited]` „N eingeladen") so the meta line keeps its shape, and the controls gained a fifth fixed column (150 px) for the „Einladen: an | pausiert" pill (`[data-admin-invites="on|off"]`, dashed + muted when paused) — `PATCH /api/admin/users/[id]` accepts `invitesPaused: boolean` (only `true` is stored; a body with only fields outside the planner's knowledge — `newsletter`, `invitesPaused` — writes nothing else). A paused member's link is dead at once and their card says „pausiert"; the code survives the pause. The list is 1160 px wide now (was 1040) and the „E-MAIL ✓" meta item is `nowrap`. Probe: `scratchpad/invites/probe.cjs` section F.
 - **Kiez-Brief switch (2026-10-04)**: each row has a „Kiez-Brief: an | aus" pill (`data-admin-brief`, dashed and muted when off) — the admin's way to keep the weekly mail from test accounts and bouncing addresses. `GET /api/admin/users` returns `newsletter: 'weekly' | 'off'`; `PATCH /api/admin/users/[id]` accepts `newsletter` (same storage as the member's own switch: `'off'` set, weekly = field unset). A body with ONLY `newsletter` bypasses `planAdminPatch()`'s refusal of a body without `verified`/`memberType`/`dailyLimit` and writes nothing else. Probe: `scratchpad/kiez-brief/admin-brief-probe.cjs` (it narrows the list through the search field — the rows are not in the API's order).
 - **Member type + limit (2026-10-01)**: the list rows also carry `memberType` and `dailyLimit`; `MitgliederApp.svelte` shows a type selector per row and, for organisations only, a limit field 1–50 (empty = 5, placeholder 5 — nothing is raised until the admin types a number). No save button: the selector saves on change, the field on Enter or on leaving it, with „✓ gespeichert" for two seconds. The PATCH body is decided by the pure `planAdminPatch()` (`src/lib/members/memberTypeChange.ts`); a limit for a non-organisation is refused with `limit_needs_organisation`, moving the type away from organisation clears the limit. Any change of type drops `dailyLimit` (it only ever exists by the admin's number on a current organisation); the profile form sends `memberType` only when the member changed it; the `member_type` ping is capped at 5 an hour per member (`membertype:<userId>` bucket).
-- **`PATCH /api/admin/users/[id]`** — body strictly any of `{ verified?: boolean, memberType?: 'person'|'organisation'|'business', dailyLimit?: 1–50 | null }` (Zod `.strict()`, at least one key), match excludes tombstones (404). This endpoint is the ONLY writer of `users.verified` and `users.dailyLimit`.
+- **`PATCH /api/admin/users/[id]`** — body strictly any of `{ verified?: boolean, memberType?: 'person'|'organisation'|'business', dailyLimit?: 1–50 | null, newsletter?: 'weekly'|'off', invitesPaused?: boolean }` (Zod `.strict()`, at least one key), match excludes tombstones (404). This endpoint is the ONLY writer of `users.verified`, `users.dailyLimit` and `users.invitesPaused`.
 - Badge sites flipped to strict in the same feature: `getProfileMe`/`getPublicProfile` (`verified === true`), `ForumPostDetail` (`topic.author?.verified === true`), marketplace `populateSellers` → `sellerVerified` → `SellerCard`.
```

- [ ] **Step 2: Commit the docs**

```bash
git add CLAUDE.md src/components/auth/kiosk/CLAUDE.md src/components/profile/kiosk/CLAUDE.md src/components/admin/CLAUDE.md
git commit -m "docs: invites — personal invitation links"
```

- [ ] **Step 3: Browser gate (run by the controller, not by an implementer).** The probe registers two accounts; each sends the admin a real Telegram line AND a verification mail through the configured transport, so BOTH the build and the server start with the six variables emptied. The dev-db helper refuses any database without „dev" in its name.

```bash
TELEGRAM_BOT_TOKEN= TELEGRAM_ADMIN_CHAT_ID= SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY= npx astro build --config scratchpad/astro.config.preview.mjs
TELEGRAM_BOT_TOKEN= TELEGRAM_ADMIN_CHAT_ID= SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY= PORT=4655 HOST=127.0.0.1 node --env-file=.env dist/server/entry.mjs &
npx tsx --env-file=.env scratchpad/invites/db.mts seed
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/invites/probe.cjs http://127.0.0.1:4655
npx tsx --env-file=.env scratchpad/invites/db.mts cleanup
fuser -k 4655/tcp
```

Expected: `45/45 checks passed`. Screenshots in `scratchpad/invites/` (`card-desktop.png`, `card-phone.png`, `register-phone.png`, `admin-row.png`) — look at them.
