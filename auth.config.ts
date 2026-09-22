import { defineConfig } from 'auth-astro';
import Credentials from "@auth/core/providers/credentials";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
// The adapter keeps the default export (a promise fixed at module load). It is
// never reached with Credentials + JWT (see the note below); everything that
// runs per request uses connectDB(), which retries a failed first connect —
// the fixed promise stays rejected for the life of the instance (2026-09-22).
import clientPromise, { connectDB } from "./src/lib/mongodb";
import { ObjectId } from "mongodb";
import bcrypt from "bcrypt";
import { peekRateLimit, consumeRateLimit, clearRateLimit, LOGIN_MAX_FAILS, LOGIN_WINDOW_MS, BAN_FLAG_WINDOW_MS } from "./src/lib/auth/rateLimit";

export default defineConfig({
    // NOTE (Aug 2026) — `users.email` carries a UNIQUE index
    // (`users_email_unique`: partial on `$type:'string'`, collation
    // {locale:'en',strength:2}). The adapter is effectively unreachable today
    // (Credentials-only provider + JWT sessions never call createUser), but
    // its `createUser` inserts the provider's email VERBATIM (no lowercasing)
    // and its `getUserByEmail` queries WITHOUT collation. Adding any OAuth /
    // magic-link provider therefore requires wrapping or overriding those two
    // methods first. The index makes that failure LOUD (a hard 11000) rather
    // than silent — before it, a second provider would have quietly created a
    // duplicate user row for an address that already had an account.
    adapter: MongoDBAdapter(clientPromise, {
        databaseName: new URL(import.meta.env.MONGODB_URI).pathname.substring(1),
    }),

    providers: [
        Credentials({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }

                // Normalized identifier for lockout + lookup. Collation
                // strength 2 makes the lookup case-insensitive so legacy
                // docs with mixed-case stored emails keep working.
                const emailNorm = String(credentials.email).trim().toLowerCase();
                const lockKey = `login:${emailNorm}`;

                // State-05 lockout: 5 failed attempts per 15 min per
                // identifier — checked BEFORE any DB/bcrypt work, and it
                // applies to existing AND unknown emails identically (no
                // enumeration signal). While locked, even a correct
                // password is refused (design: fields disabled).
                const gate = await peekRateLimit(lockKey, LOGIN_MAX_FAILS, LOGIN_WINDOW_MS);
                if (gate.limited) return null;

                const db = await connectDB();

                const user = await db.collection('users').findOne(
                    { email: emailNorm },
                    { collation: { locale: 'en', strength: 2 } }
                );

                if (!user) {
                    await consumeRateLimit(lockKey, LOGIN_MAX_FAILS, LOGIN_WINDOW_MS);
                    return null;
                }

                // Verify password using bcrypt
                const isValidPassword = await bcrypt.compare(
                    credentials.password as string,
                    user.password
                );

                if (!isValidPassword) {
                    await consumeRateLimit(lockKey, LOGIN_MAX_FAILS, LOGIN_WINDOW_MS);
                    return null;
                }

                // Ban enforcement (3-strike Sperre): a banned account never
                // gets a session — even with the correct password. Because
                // the password IS proven at this point, it is safe to drop a
                // short-lived flag that login-status may reveal to the UI
                // (prove-then-tell; no new enumeration oracle). Deliberately
                // does NOT consume the login lockout (not a credential
                // failure) and does NOT clear it either.
                if (user.isBanned === true) {
                    await consumeRateLimit(`banflag:${emailNorm}`, 1, BAN_FLAG_WINDOW_MS).catch(() => {});
                    return null;
                }

                // Success — clear accumulated failures for this identifier.
                await clearRateLimit(lockKey);

                // Return user object that will be stored in the session.
                // `role` defaults to 'user' if the field is missing on the
                // doc — admin role must be explicitly set in the DB.
                return {
                    id: user._id.toString(),
                    email: user.email,
                    name: user.name || user.userName || '',
                    image: user.image || user.userPicture || '',
                    role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user',
                    // Boolean-normalized: legacy docs may hold false/null/Date.
                    emailVerified: user.emailVerified === true,
                };
            }
        })
    ],

    session: {
        strategy: "jwt",
        maxAge: 7 * 24 * 60 * 60, // 7 days
    },

    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.id = user.id;
                token.role = (user as any).role ?? 'user';
                // Snapshot at login — goes stale if the user verifies mid-session;
                // VerifyEmailBanner live-checks /api/auth/verification-status.
                token.emailVerified = (user as any).emailVerified === true;
                token.pwdCheckedAt = Date.now();
                // Immutable login timestamp — set ONLY here, never touched again.
                // Unlike jose's auto `iat` (which @auth/core re-stamps on every
                // re-encode, including the session-cookie refresh on every GET
                // /api/auth/session), this stays fixed for the token's whole
                // lifetime, so it actually reflects "when this device logged in".
                token.loginAt = Date.now();
                return token;
            }
            // Other-device sign-out: invalidate tokens issued before passwordChangedAt.
            // DB read at most every 5 min per token (accepted ≤5-min lag, see profile CLAUDE.md).
            const PWD_RECHECK_MS = 5 * 60 * 1000;
            const last = typeof token.pwdCheckedAt === 'number' ? token.pwdCheckedAt : 0;
            if (Date.now() - last > PWD_RECHECK_MS && token.id) {
                try {
                    const db = await connectDB();
                    const userObjectId = new ObjectId(String(token.id));
                    const u = await db.collection('users').findOne(
                        { _id: userObjectId },
                        { projection: { passwordChangedAt: 1 } }
                    );
                    // „Active in the last 90 days" for the @alle Admin-Hinweis (2026-09-22):
                    // one stamp per token per 5 minutes, never fails the callback.
                    db.collection('users').updateOne({ _id: userObjectId }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
                    if (u?.passwordChangedAt) {
                        if (typeof token.loginAt === 'number') {
                            if (token.loginAt < new Date(u.passwordChangedAt).getTime()) {
                                return null; // token predates the change -> session invalidated
                            }
                        } else {
                            // Legacy token minted before loginAt existed: it can
                            // only predate this deploy, and passwordChangedAt is
                            // only ever written by the new endpoint (which shipped
                            // in the same deploy) — so any passwordChangedAt value
                            // necessarily postdates this token's login. Invalidate.
                            return null;
                        }
                    }
                    token.pwdCheckedAt = Date.now();
                } catch { /* DB hiccup: keep session, recheck next window */ }
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.id as string;
                session.user.role = (token as any).role ?? 'user';
                (session.user as any).emailVerified = (token as any).emailVerified === true;
            }
            return session;
        }
    },

    pages: {
        signIn: '/login',
        signOut: '/logout',
        error: '/login',
    },

    secret: import.meta.env.NEXTAUTH_SECRET || import.meta.env.JWT_SECRET,
});
