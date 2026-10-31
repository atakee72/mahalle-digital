// Should an auth form report the server's answer as unexpected? Pure, tested.
//
// Born from the 2026-10-27 → 10-31 outage: the register route answered 404 for three days and
// the form showed its generic error — nobody but the two newcomers knew. The forms' normal
// vocabulary (validation 400, unauthenticated 401, banned 403, taken 409, limited 429) is NOT
// reported; a 404, any 5xx, a non-JSON answer where JSON is the contract, an odd status, or a
// request that failed while the browser is online IS. `src/lib/sentry/reportUnexpectedAuth.ts`
// turns a true verdict into ONE static Sentry message.

export const EXPECTED_AUTH_STATUSES: ReadonlySet<number> = new Set([200, 201, 400, 401, 403, 409, 429]);

export function isUnexpectedAuthResponse(input: { status: number; contentType: string | null; online: boolean }): boolean {
  const { status, contentType, online } = input;
  if (status === 0) return online; // the request itself failed (network, CORS, aborted)
  if (status === 404 || status >= 500) return true;
  if (EXPECTED_AUTH_STATUSES.has(status)) return !(contentType ?? '').toLowerCase().includes('application/json');
  return true; // 3xx, 405, 413 (edge body cap), anything the forms never speak
}
