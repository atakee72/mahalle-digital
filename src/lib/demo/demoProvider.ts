// SERVER-ONLY. Passwordless Auth.js Credentials provider `demo` (spec 2026-10-26, §7).
// Only constructed on a demo deployment (see auth.config.ts). Signs a visitor in as one
// of the two fixed seeded users; no rate limit, no bcrypt.
import Credentials from '@auth/core/providers/credentials';
import { connectDB } from '../mongodb';

export function demoCredentialsProvider() {
  return Credentials({
    id: 'demo',
    name: 'Demo',
    credentials: { role: { label: 'Role', type: 'text' } },
    async authorize(credentials) {
      const role = credentials?.role;
      if (role !== 'member' && role !== 'admin') return null;
      const db = await connectDB();
      const user = await db.collection('users').findOne({
        handle: role === 'admin' ? 'demo_admin' : 'demo_member',
        demo: true,
      });
      if (!user) return null;
      return {
        id: user._id.toString(),
        email: user.email,
        name: user.name || user.userName || '',
        image: user.image || user.userPicture || '',
        role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user',
        emailVerified: true,
        demo: true as const,
      };
    },
  });
}
