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
