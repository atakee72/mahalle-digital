// Run: npx tsx --test src/lib/linkReputation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinkReputation, unsafeLinkResult, LINK_CHECK_FAILED_MESSAGE } from './linkReputation';

const PH = 'https://testsafebrowsing.appspot.com/s/phishing.html';
const fakeFetch = (status: number, body: unknown, capture?: { url?: string; init?: RequestInit }) =>
  (async (url: any, init?: RequestInit) => {
    if (capture) { capture.url = String(url); capture.init = init; }
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

test('no link → approved without a request', async () => {
  let called = false;
  const r = await checkLinkReputation('nur text', { apiKey: 'k', fetchImpl: (async () => { called = true; return new Response('{}'); }) as typeof fetch });
  assert.equal(called, false); assert.equal(r.canPublish, true); assert.equal(r.needsReview, false);
});
test('no key → approved without a request', async () => {
  let called = false;
  const r = await checkLinkReputation(`siehe ${PH}`, { apiKey: undefined, fetchImpl: (async () => { called = true; return new Response('{}'); }) as typeof fetch });
  assert.equal(called, false); assert.equal(r.canPublish, true);
});
test('clean answer → approved; request carries the key and the URL', async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  const r = await checkLinkReputation(`siehe https://ok.example/seite.`, { apiKey: 'K3Y', fetchImpl: fakeFetch(200, {}, cap) });
  assert.equal(r.canPublish, true);
  assert.ok(cap.url!.startsWith('https://safebrowsing.googleapis.com/v4/threatMatches:find?key=K3Y'));
  assert.equal(cap.init!.method, 'POST');
  assert.deepEqual(JSON.parse(String(cap.init!.body)).threatInfo.threatEntries, [{ url: 'https://ok.example/seite' }]);
});
test('URLs are sent in canonical form', async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  await checkLinkReputation('siehe https://straße.example/ä', { apiKey: 'k', fetchImpl: fakeFetch(200, {}, cap) });
  assert.deepEqual(JSON.parse(String(cap.init!.body)).threatInfo.threatEntries, [{ url: 'https://xn--strae-oqa.example/%C3%A4' }]);
});
test('a hit → urgent review with the unsafe_link category and Google-naming reason', async () => {
  const r = await checkLinkReputation(`Konto prüfen: ${PH}`, { apiKey: 'k', fetchImpl: fakeFetch(200, { matches: [{ threatType: 'SOCIAL_ENGINEERING', threat: { url: PH } }] }) });
  assert.equal(r.decision, 'urgent_review'); assert.equal(r.isUrgent, true); assert.equal(r.canPublish, false);
  assert.deepEqual(r.flaggedCategories, ['unsafe_link']); assert.equal(r.highestCategory, 'unsafe_link'); assert.equal(r.maxScore, 1); assert.equal((r.scores as Record<string, number>).unsafe_link, 1);
  assert.equal(r.adminReason, `Safe Browsing: SOCIAL_ENGINEERING — ${PH}`);
});
test('two hits join with "; "', () => {
  const r = unsafeLinkResult([{ url: 'https://a.example/', threatType: 'MALWARE' }, { url: 'https://b.example/', threatType: 'UNWANTED_SOFTWARE' }]);
  assert.equal(r.adminReason, 'Safe Browsing: MALWARE — https://a.example/; Safe Browsing: UNWANTED_SOFTWARE — https://b.example/');
});
test('HTTP 403 → approved, reported once with the status and without the key', async () => {
  const reasons: string[] = [];
  const r = await checkLinkReputation(`siehe ${PH}`, { apiKey: 'SECRET', fetchImpl: fakeFetch(403, { error: 'x' }), report: async (reason) => { reasons.push(reason); } });
  assert.equal(r.canPublish, true); assert.equal(reasons.length, 1); assert.match(reasons[0], /403/); assert.doesNotMatch(reasons[0], /SECRET/);
});
test('thrown fetch (timeout) → approved, reported', async () => {
  const reasons: string[] = [];
  const r = await checkLinkReputation(`siehe ${PH}`, { apiKey: 'k', fetchImpl: (async () => { throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }); }) as typeof fetch, report: async (reason) => { reasons.push(reason); } });
  assert.equal(r.canPublish, true); assert.equal(reasons.length, 1); assert.match(reasons[0], /TimeoutError/);
});
test('non-JSON body → approved, reported', async () => {
  const reasons: string[] = [];
  const r = await checkLinkReputation(`siehe ${PH}`, { apiKey: 'k', fetchImpl: fakeFetch(200, '<html>'), report: async (reason) => { reasons.push(reason); } });
  assert.equal(r.canPublish, true); assert.equal(reasons.length, 1);
});
test('the static message is the one Sentry groups on', () => {
  assert.equal(LINK_CHECK_FAILED_MESSAGE, 'link check: Safe Browsing lookup failed — content not held');
});

test('501 links → two requests, hits from both merged', async () => {
  const text = Array.from({ length: 501 }, (_, i) => `https://x.example/${i}`).join(' ');
  let calls = 0;
  const f = (async (_u: any, init?: RequestInit) => {
    calls++;
    const sent = JSON.parse(String(init!.body)).threatInfo.threatEntries as { url: string }[];
    const bad = sent.find((e) => e.url === 'https://x.example/500');
    return new Response(JSON.stringify(bad ? { matches: [{ threatType: 'MALWARE', threat: { url: bad.url } }] } : {}), { status: 200 });
  }) as typeof fetch;
  const r = await checkLinkReputation(text, { apiKey: 'k', fetchImpl: f });
  assert.equal(calls, 2); assert.deepEqual(r.flaggedCategories, ['unsafe_link']);
});
test('a thrown error that embeds the key is scrubbed', async () => {
  const reasons: string[] = [];
  const f = (async () => { throw new Error('request to https://safebrowsing.googleapis.com/v4/threatMatches:find?key=SECRET failed'); }) as typeof fetch;
  const r = await checkLinkReputation(`siehe ${PH}`, { apiKey: 'SECRET', fetchImpl: f, report: async (x) => { reasons.push(x); } });
  assert.equal(r.canPublish, true); assert.equal(reasons.length, 1);
  assert.doesNotMatch(reasons[0], /SECRET/); assert.match(reasons[0], /key=\[key\]/);
});
test('one chunk fails, the other hits → still unsafe, reported once', async () => {
  const text = Array.from({ length: 501 }, (_, i) => `https://x.example/${i}`).join(' ');
  let calls = 0;
  const reasons: string[] = [];
  const f = (async () => {
    calls++;
    if (calls === 1) throw new Error('boom');
    return new Response(JSON.stringify({ matches: [{ threatType: 'MALWARE', threat: { url: 'https://x.example/500' } }] }), { status: 200 });
  }) as typeof fetch;
  const r = await checkLinkReputation(text, { apiKey: 'k', fetchImpl: f, report: async (x) => { reasons.push(x); } });
  assert.deepEqual(r.flaggedCategories, ['unsafe_link']); assert.equal(reasons.length, 1);
});
test('an unparsable URL is dropped before the lookup', async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  const r = await checkLinkReputation('a https://[bad und https://ok.example/', { apiKey: 'k', fetchImpl: fakeFetch(200, {}, cap) });
  assert.equal(r.canPublish, true);
  assert.deepEqual(JSON.parse(String(cap.init!.body)).threatInfo.threatEntries, [{ url: 'https://ok.example/' }]);
});
test('a long URL is still sent', async () => {
  const long = 'https://p.example/' + 'a'.repeat(3000);
  const cap: { url?: string; init?: RequestInit } = {};
  await checkLinkReputation(`siehe ${long}`, { apiKey: 'k', fetchImpl: fakeFetch(200, {}, cap) });
  assert.deepEqual(JSON.parse(String(cap.init!.body)).threatInfo.threatEntries, [{ url: long }]);
});
