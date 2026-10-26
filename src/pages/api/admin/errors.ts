import type { APIRoute } from 'astro';
import { requireAdminSession } from '../../../lib/auth';
import { isDemoDeployment } from '../../../lib/demo/demoMode';

// Server-only proxy to Sentry's REST API. Exists so SENTRY_AUTH_TOKEN
// never ships to the client and so the widget gets a minimal shape
// instead of raw Sentry payloads. 60s in-memory cache: Sentry's
// free-tier API rate limits are tight, and the cache is per-serverless-
// instance (fine for a one-admin route — audit item 5; don't Redis this).
const CACHE_TTL_MS = 60_000;
let cache: { data: unknown; expires: number } | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async ({ request }) => {
  const guard = await requireAdminSession(request);
  if (!guard.ok) return guard.response;
  // Demo deployment (spec 2026-10-26): nobody there may see the owner's real Sentry board — the
  // card shows its „nicht verfügbar" state. The middleware refuses the path for a demo session
  // too; this is the second lock and does not depend on path matching.
  if (isDemoDeployment()) return json({ enabled: false });

  const token = import.meta.env.SENTRY_AUTH_TOKEN;
  const org = import.meta.env.SENTRY_ORG;
  const project = import.meta.env.SENTRY_PROJECT;
  if (!token || !org || !project) return json({ enabled: false });

  if (cache && cache.expires > Date.now()) return json(cache.data);

  try {
    const res = await fetch(
      `https://sentry.io/api/0/projects/${org}/${project}/issues/?statsPeriod=24h&query=is:unresolved&limit=5`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return json({ error: 'sentry_unreachable' }, 502);

    type SentryIssue = {
      id: string;
      title: string;
      permalink: string;
      // With ?statsPeriod=24h the serializer includes per-issue 24h
      // buckets: stats['24h'] = [[unixTs, count], ...]. Summing these
      // is the TRUE last-24h event count. The top-level `count` /
      // `userCount` fields are issue-LIFETIME figures — never use
      // them under a "(24h)" label (Decision 10).
      stats?: { '24h'?: Array<[number, number]> };
    };
    const issues = (await res.json()) as SentryIssue[];

    const count24h = (i: SentryIssue) =>
      (i.stats?.['24h'] ?? []).reduce((s, [, n]) => s + n, 0);

    const withCounts = issues
      .map((i) => ({ id: i.id, title: i.title, permalink: i.permalink, count24h: count24h(i) }))
      .sort((a, b) => b.count24h - a.count24h);

    const data = {
      enabled: true,
      totalLast24h: withCounts.reduce((s, i) => s + i.count24h, 0),
      topIssues: withCounts.slice(0, 3),
    };
    cache = { data, expires: Date.now() + CACHE_TTL_MS };
    return json(data);
  } catch (err) {
    console.error('sentry proxy error:', err);
    return json({ error: 'sentry_unreachable' }, 502);
  }
};
