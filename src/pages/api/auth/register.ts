import type { APIRoute } from "astro";
import clientPromise from "../../../lib/mongodb";
import bcrypt from "bcrypt";
import { checkNameProfanity } from "../../../lib/moderation";
import { createEmailVerifyToken } from "../../../lib/auth/emailVerify";
import { sendVerifyEmail } from "../../../lib/auth/sendVerifyEmail";
import { getTrustedBaseUrl } from "../../../lib/auth/baseUrl";
import { consumeRateLimit, hashIp, clientIpFrom } from "../../../lib/auth/rateLimit";
import { slugifyHandle, normalizeChosenHandle, chosenHandleProblem, HANDLE_FALLBACK } from "../../../lib/profile/handle";
import { cleanDisplayName, isValidDisplayName, isProtectedName } from "../../../lib/profile/nameRules";
import { isAdminLookalike } from "../../../lib/profile/protectedNamesStore";
import { alertNewMember } from "../../../lib/adminAlerts";

export const POST: APIRoute = async ({ request, clientAddress }) => {
    try {
        const { name: rawName, email, password, handle: rawHandle } = await request.json();
        // Whitespace collapsed, invisible characters stripped — a name of only
        // spaces / zero-width characters ends up '' and is refused right below.
        const name = cleanDisplayName(rawName);

        // Validate input
        if (!name || !email || !password) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Same rule as the profile edit (src/lib/profile/nameRules.ts). Until
        // 2026-09-21 signup checked only „not empty + profanity": a direct call
        // could register any length, emoji, markup or line breaks.
        if (!isValidDisplayName(name)) {
            return new Response(
                JSON.stringify({ error: 'name_invalid' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        if (password.length < 6) {
            return new Response(
                JSON.stringify({ error: 'Password must be at least 6 characters' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Per-IP throttle: 40 registrations/hour. Sits BEFORE the profanity
        // check so bulk signups can't burn OpenAI moderation calls. Sized for
        // a room, not a person (2026-09-14, Schillermarkt stand): a tablet
        // doing assisted signups, a phone hotspot, or one venue Wi-Fi is ONE
        // IP — 5/h refused the sixth neighbour. The per-person brake is the
        // per-email limit below.
        const ipHash = hashIp(clientIpFrom(request, clientAddress));
        const ipLimit = await consumeRateLimit(`reg:ip:${ipHash}`, 40, 60 * 60 * 1000);
        if (ipLimit.limited) {
            return new Response(
                JSON.stringify({ error: 'rate_limited' }),
                { status: 429, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Canonical form: emails are stored lowercase (legacy mixed-case docs
        // are matched via collation on lookups).
        const emailNorm = typeof email === 'string' ? email.trim().toLowerCase() : '';

        // Reject anything that isn't structurally an e-mail. Without this,
        // input like "   " normalizes to '' and gets INSERTED — and '' is a
        // string, so it occupies a slot in users_email_unique: one such
        // request would permanently squat it and the next would get a
        // nonsensical "already exists" 409.
        //
        // Deliberately NOT zod's .email() (nor RegisterSchema.shape.email,
        // which wraps it): that regex is ASCII-only and rejects every
        // internationalised address — `ali@müller.de` and `ümit@example.com`
        // both fail it, and only punycode (`xn--mller-kva.de`) passes.
        // Turning a Kiez resident away at registration over an umlaut domain
        // is a worse bug than the one being fixed here, so this checks only
        // the structure that actually protects the index: non-empty local and
        // domain parts, exactly one @, no whitespace, a dot in the domain.
        // (`src/pages/api/profile/email-change/start.ts` is still zod-strict,
        // so an IDN address can be registered but not switched TO — worth
        // aligning if a real user ever hits it.)
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(emailNorm)) {
            return new Response(
                JSON.stringify({ error: 'Invalid email address' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Per-email throttle: 3 attempts/hour for the same address. The
        // person-level brake now that the IP gate is room-sized; also caps
        // the duplicate-account probing (409) a single address can do.
        const emailLimit = await consumeRateLimit(`reg:email:${emailNorm}`, 3, 60 * 60 * 1000);
        if (emailLimit.limited) {
            return new Response(
                JSON.stringify({ error: 'rate_limited' }),
                { status: 429, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Connect to MongoDB using singleton (moved up 2026-09-21: the protected-
        // name check needs it, and it must run BEFORE the OpenAI calls below).
        const client = await clientPromise;
        const db = client.db();

        // Nobody poses as the team: official-sounding names and lookalikes of an
        // admin's own display name are refused (after both rate limits).
        if (isProtectedName(name) || await isAdminLookalike(db, name)) {
            return new Response(
                JSON.stringify({ error: 'name_protected' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Optional handle choice — ONCE, here at signup (2026-09-21). No choice →
        // the automatic slug below. Same order of gates as the name: format and
        // reserved words first (free), then uniqueness, then the paid profanity check.
        const chosenHandle = normalizeChosenHandle(rawHandle);
        if (chosenHandle) {
            const problem = chosenHandleProblem(chosenHandle);
            if (problem) {
                return new Response(
                    JSON.stringify({ error: problem === 'format' ? 'handle_invalid' : 'handle_reserved' }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }
            const taken = await db.collection('users').findOne({ handle: chosenHandle }, { projection: { _id: 1 } });
            if (taken) {
                return new Response(
                    JSON.stringify({ error: 'handle_taken' }),
                    { status: 409, headers: { 'Content-Type': 'application/json' } }
                );
            }
            // „_" → space so the blocklists' word-boundary matching works. An
            // OpenAI outage never refuses (shortTextVerdict inside).
            const handleCheck = await checkNameProfanity(chosenHandle.replace(/_/g, ' '));
            if (!handleCheck.clean) {
                return new Response(
                    JSON.stringify({ error: 'handle_invalid' }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }
        }

        // Check display name for profanity (Turkish + English + German + OpenAI)
        const nameCheck = await checkNameProfanity(name);
        if (!nameCheck.clean) {
            return new Response(
                JSON.stringify({ error: nameCheck.reason || 'Invalid display name' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Check if user already exists (case-insensitive — catches legacy
        // mixed-case docs too)
        const existingUser = await db.collection('users').findOne(
            { email: emailNorm },
            { collation: { locale: 'en', strength: 2 } }
        );
        if (existingUser) {
            return new Response(
                JSON.stringify({ error: 'User with this email already exists' }),
                { status: 409, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Hash password
        const saltRounds = 12; // Using a higher salt round for better security
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create user.
        //
        // TWO unique indexes exist on `users`: users_handle_unique and (since
        // Aug 2026) users_email_unique. So a code 11000 here is ambiguous and
        // must be discriminated on `keyPattern`, which carries the index KEY
        // SPEC ({ handle: 1 } / { email: 1 }) and is unaffected by collation:
        //   - handle  → retry with the next suffix (what this loop is for)
        //   - email   → the findOne+409 above lost a TOCTOU race; return that
        //               same 409 instead of burning attempts on a duplicate
        //               that no amount of handle-rewriting can fix
        //   - neither → unknown index, fail closed and rethrow. Retrying an
        //               unrecognized violation would spend 6 attempts and
        //               surface a misleading 500 (exactly the bug this
        //               replaces, one index later).
        // Never read `keyValue`: for a collated index the server reports the
        // raw ICU sort key, which is not valid UTF-8 (SERVER-50454) — so it is
        // useless for branching and garbage in logs.
        // A CHOSEN handle gets one attempt and no suffix (a lost race → 409
        // handle_taken); the automatic base must never be a reserved word
        // (a member called „Forum" gets @nachbar…, not @forum).
        let baseHandle = slugifyHandle(name);
        if (chosenHandleProblem(baseHandle) === 'reserved') baseHandle = HANDLE_FALLBACK;
        let result: { insertedId: any } | null = null;
        let finalHandle = '';
        let emailTaken = false;
        let handleTaken = false;
        const maxAttempts = chosenHandle ? 1 : 6;
        for (let attempt = 0; attempt < maxAttempts && !result; attempt++) {
            const suffix = attempt === 0 ? '' : String(attempt + 1);
            const handle = chosenHandle || baseHandle.slice(0, 20 - suffix.length) + suffix;
            try {
                finalHandle = handle;
                result = await db.collection('users').insertOne({
                    name,
                    email: emailNorm,
                    password: hashedPassword,
                    image: '',
                    emailVerified: false,
                    roleBadge: 'resident',
                    hobbies: [],
                    handle,
                    ...(chosenHandle ? { handleChosen: true } : {}),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                });
            } catch (e: any) {
                if (e?.code !== 11000) throw e;
                if (e?.keyPattern?.email !== undefined) { emailTaken = true; break; }
                if (e?.keyPattern?.handle === undefined) throw e;
                if (chosenHandle) { handleTaken = true; break; }
            }
        }
        if (emailTaken) {
            return new Response(
                JSON.stringify({ error: 'User with this email already exists' }),
                { status: 409, headers: { 'Content-Type': 'application/json' } }
            );
        }
        if (handleTaken) {
            return new Response(
                JSON.stringify({ error: 'handle_taken' }),
                { status: 409, headers: { 'Content-Type': 'application/json' } }
            );
        }
        if (!result) {
            return new Response(
                JSON.stringify({ error: 'Registration failed' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Send the verification email (best-effort — registration must succeed
        // even if this fails; the user can resend from /verify-email).
        try {
            const rawToken = await createEmailVerifyToken(result.insertedId.toString());
            if (rawToken) {
                // SECURITY: link base from trusted NEXTAUTH_URL, fail-closed in
                // prod (CWE-640 — see src/lib/auth/baseUrl.ts).
                const base = getTrustedBaseUrl(request);
                if (base) {
                    await sendVerifyEmail(emailNorm, `${base}/verify-email?token=${rawToken}`);
                } else {
                    console.error('register: NEXTAUTH_URL not configured in production — skipping verification email (user can resend once configured)');
                }
            }
        } catch (err) {
            console.error('register: verification email failed (registration still succeeded):', err);
        }

        // Operational admin alert (never-throw; no-op without env). After the
        // verification mail so a slow Telegram can't delay the user's own
        // signup email. finalHandle is captured in the retry loop above — no
        // extra DB read (a failing read would 500 a succeeded registration).
        await alertNewMember({ name, handle: finalHandle });

        return new Response(
            JSON.stringify({
                success: true,
                userId: result.insertedId.toString()
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Registration error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};
