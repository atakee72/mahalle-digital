// Google Safe Browsing lookup for the http(s) links inside a member submission.
// Born from the open checklist item (09-13 research), built 2026-10-31.
//
// A lookup FAILURE (network, non-2xx, timeout, bad JSON) NEVER holds content:
// the link check is an extra net, and a Google outage must not lock members
// out of posting. Failures return the approved shape and raise ONE static
// Sentry warning (variable detail in extra.reason) so an outage stays visible.
// Missing SAFE_BROWSING_API_KEY = silent no-op (dev, preview).
//
// The key is read from process.env at call time (not import.meta.env, which
// Vite would inline at build time). Only URLs are sent to Google — never the
// surrounding text. Safe Browsing's terms cover non-commercial use only.
import * as Sentry from '@sentry/astro';
import type { ModerationResult } from './moderation';
import { extractUrls } from './linkify';
import { buildLookupBody, hitsFromLookup, LOOKUP_ENDPOINT, type LinkHit } from './linkReputationRules';

export const LINK_CHECK_FAILED_MESSAGE = 'link check: Safe Browsing lookup failed — content not held';

export interface LinkReputationDeps {
  fetchImpl?: typeof fetch;
  apiKey?: string | undefined;
  report?: (reason: string) => Promise<void>;
}

// Same shape as createApprovedResult() in moderation.ts.
function approved(): ModerationResult {
  return {
    decision: 'approved',
    canPublish: true,
    needsReview: false,
    isUrgent: false,
    flaggedCategories: [],
    scores: {},
    highestCategory: '',
    maxScore: 0,
    userMessage: '',
    adminReason: '',
  };
}

export function unsafeLinkResult(hits: LinkHit[]): ModerationResult {
  return {
    decision: 'urgent_review',
    canPublish: false,
    needsReview: true,
    isUrgent: true,
    flaggedCategories: ['unsafe_link'],
    scores: {},
    highestCategory: 'unsafe_link',
    maxScore: 1,
    userMessage: 'Your submission is under review by our moderation team.',
    adminReason: hits.map((h) => `Safe Browsing: ${h.threatType} — ${h.url}`).join('; '),
  };
}

async function defaultReport(reason: string): Promise<void> {
  Sentry.captureMessage(LINK_CHECK_FAILED_MESSAGE, { level: 'warning', extra: { reason } });
  await Sentry.flush(2000);
}

const scrub = (s: string) => s.replace(/key=[^&\s]+/g, 'key=[key]');

export async function checkLinkReputation(text: string, deps: LinkReputationDeps = {}): Promise<ModerationResult> {
  const urls = extractUrls(text);
  if (urls.length === 0) return approved();
  const key = deps.apiKey !== undefined ? deps.apiKey : process.env.SAFE_BROWSING_API_KEY;
  if (!key) return approved();
  const doFetch = deps.fetchImpl ?? fetch;
  const report = deps.report ?? defaultReport;

  let reason: string;
  try {
    const res = await doFetch(`${LOOKUP_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildLookupBody(urls)),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      reason = `status ${res.status}`;
    } else {
      const hits = hitsFromLookup(await res.json());
      return hits.length > 0 ? unsafeLinkResult(hits) : approved();
    }
  } catch (e) {
    const err = e as { name?: string; message?: string };
    reason = scrub(`${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`);
  }
  try { await report(reason); } catch { /* reporting must never break the submission */ }
  return approved();
}
