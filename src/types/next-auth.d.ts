// Auth.js / @auth/core module augmentation — extends the default
// Session/User/JWT shapes so `session.user.role` (and the matching JWT
// field) typecheck across the project. Without this, every read of
// `session.user.role` triggers TS2339 "Property 'role' does not exist".
//
// auth-astro wraps `@auth/core` (NOT `next-auth`), so we augment those
// module names. We also augment `next-auth` for any code paths that
// might import its types directly.
//
// Source of truth for the runtime values lives in `auth.config.ts`
// callbacks (authorize → jwt → session). Keep this file in sync if
// either side adds new fields.

import '@auth/core/types';
import '@auth/core/jwt';

declare module '@auth/core/types' {
  interface Session {
    user: {
      id: string;
      role?: 'user' | 'admin';
      emailVerified?: boolean;
      // Demo session marker (spec 2026-10-26-demo-instance-and-engineering-tour-design.md).
      demo?: true;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }

  interface User {
    id?: string;
    role?: 'user' | 'admin';
    // Wide union: AdapterUser narrows this to Date | null; our credentials
    // authorize() returns a boolean. Keep all three assignable.
    emailVerified?: boolean | Date | null;
    // Demo user marker (spec 2026-10-26-demo-instance-and-engineering-tour-design.md).
    demo?: true;
    email?: string | null;
    name?: string | null;
    image?: string | null;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id?: string;
    role?: 'user' | 'admin';
    emailVerified?: boolean;
    // Demo session marker (spec 2026-10-26-demo-instance-and-engineering-tour-design.md).
    demo?: true;
    // Task 9 (password change / other-device sign-out): wall-clock ms of the
    // last passwordChangedAt DB recheck for this token — see auth.config.ts's
    // jwt callback. Absent on tokens minted before this shipped; treated as 0.
    pwdCheckedAt?: number;
    // Immutable wall-clock ms of login, set once in the `if (user)` branch of
    // the jwt callback and never rewritten. Used (instead of jose's
    // auto-managed `iat`, which @auth/core re-stamps on every re-encode) to
    // key other-device sign-out off actual login time. Absent on tokens
    // minted before this shipped — treated as invalid/legacy (see auth.config.ts).
    loginAt?: number;
  }
}
