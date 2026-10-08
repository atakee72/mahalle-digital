// What register.astro hands the signup island about a personal invitation link (pure type).
export type RegisterInvite =
  | { code: string; inviterName: string; inviterHandle: string | null }
  | { dead: true };
