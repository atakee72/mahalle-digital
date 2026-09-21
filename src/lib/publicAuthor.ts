// src/lib/publicAuthor.ts — dependency-pure.
// THE list of user fields that may reach a browser. Every join that ends up in
// an API response or in SSR props uses this projection — never `{ password: 0 }`,
// which ships e-mail, strike data, pendingEmail … to any logged-in member
// (found 2026-09-21: the comments list did exactly that, proven on dev).
// Widen only after checking every consumer of `.author.<field>`.

export const PUBLIC_AUTHOR_PROJECTION = {
  name: 1, image: 1, userPicture: 1, createdAt: 1, verified: 1, role: 1, handle: 1,
} as const;

export interface PublicAuthor {
  _id: string;
  name: string | null;
  image: string | null;
  createdAt: unknown;
  verified: boolean;
  role: string | null;
  handle: string | null;
}

export function toPublicAuthor(u: Record<string, any>): PublicAuthor {
  return {
    _id: String(u._id),
    name: typeof u.name === 'string' ? u.name : null,
    image: u.image || u.userPicture || null,
    createdAt: u.createdAt ?? null,
    verified: u.verified === true,
    role: typeof u.role === 'string' ? u.role : null,
    handle: typeof u.handle === 'string' ? u.handle : null,
  };
}
