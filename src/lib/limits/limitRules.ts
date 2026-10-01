// src/lib/limits/limitRules.ts — dependency-pure decision behind every daily limit.
// Four buckets, each per rolling 24 hours. The three forum kinds share ONE bucket
// (until 2026-10-01 each kind counted alone: 15 forum posts a day were possible).
import { effectiveDailyLimit, type UserFields } from '../members/memberType';

export type LimitBucket = 'forum' | 'events' | 'listings' | 'news';

export interface LimitResult {
  count: number;
  limit: number;
  remaining: number;
  allowed: boolean;
}

export function decideLimit(input: {
  count: number;
  role?: string | null;
  user: UserFields | null;
}): LimitResult {
  const limit = effectiveDailyLimit(input.user);
  // Admins post official content in bursts — exempt, and the count endpoints
  // report the full limit as remaining (unchanged behaviour).
  if (input.role === 'admin') return { count: input.count, limit, remaining: limit, allowed: true };
  return {
    count: input.count,
    limit,
    remaining: Math.max(0, limit - input.count),
    allowed: input.count < limit,
  };
}
