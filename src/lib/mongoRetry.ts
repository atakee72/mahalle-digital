/**
 * One retry for the FIRST database connect on a freshly started server. Pure
 * (no mongodb import) so it is unit-tested; `connectDB()` in mongodb.ts uses it.
 *
 * Why (2026-09-20, runbook docs/runbooks/mongo-region-incident.md): Sentry
 * MAHALLE-PROD-2 kept reopening with ONE event in the minute after a deploy —
 * three times in two days. Every stack was `MongoClient.connect → … →
 * Topology.selectServer`: the initial connect of a cold instance (no pool yet)
 * needing > 10 s once in a while. The request that happened to wait on that
 * connect failed; the very next one succeeded, because the failed attempt is
 * un-cached and a fresh client connects at once. So: do that retry for the
 * caller instead of failing it.
 *
 * NOT a Sentry filter on purpose — a real database outage looks exactly like
 * this and must stay loud. With a retry, an outage still fails (with the last
 * error, after two attempts ≈ 20 s instead of 10 s) and is captured by the
 * middleware as before.
 */
const RETRYABLE = new Set(['MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError']);

export function isColdStartConnectError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && RETRYABLE.has((err as { name?: string }).name ?? '');
}

/** `connect` must start a FRESH attempt when the previous one failed (mongodb.ts un-caches a rejected client promise). */
export async function connectWithRetry<T>(connect: () => Promise<T>): Promise<T> {
  try {
    return await connect();
  } catch (err) {
    if (!isColdStartConnectError(err)) throw err;
    return await connect();
  }
}
