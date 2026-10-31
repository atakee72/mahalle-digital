// Run: npx tsx --test src/lib/linkReputationRules.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLookupBody, hitsFromLookup, MAX_URLS_PER_CHECK, THREAT_TYPES } from './linkReputationRules';

test('body names the four threat types on ANY_PLATFORM with URL entries', () => {
  const b = buildLookupBody(['https://a.example/']);
  assert.deepEqual(b.client, { clientId: 'mahalle-digital', clientVersion: '1.0.0' });
  assert.deepEqual(b.threatInfo.threatTypes, THREAT_TYPES);
  assert.deepEqual(THREAT_TYPES, ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION']);
  assert.deepEqual(b.threatInfo.platformTypes, ['ANY_PLATFORM']);
  assert.deepEqual(b.threatInfo.threatEntryTypes, ['URL']);
  assert.deepEqual(b.threatInfo.threatEntries, [{ url: 'https://a.example/' }]);
});
test('cap at 50', () => {
  const urls = Array.from({ length: 60 }, (_, i) => `https://x.example/${i}`);
  assert.equal(MAX_URLS_PER_CHECK, 50);
  assert.equal(buildLookupBody(urls).threatInfo.threatEntries.length, 50);
  assert.equal(buildLookupBody(urls).threatInfo.threatEntries[49].url, 'https://x.example/49');
});
test('empty object is clean', () => { assert.deepEqual(hitsFromLookup({}), []); });
test('empty matches is clean', () => { assert.deepEqual(hitsFromLookup({ matches: [] }), []); });
test('garbage is clean', () => {
  assert.deepEqual(hitsFromLookup(null), []);
  assert.deepEqual(hitsFromLookup('x'), []);
  assert.deepEqual(hitsFromLookup({ matches: [{ threat: {} }] }), []);
  assert.deepEqual(hitsFromLookup({ matches: [{ threatType: 'MALWARE' }] }), []);
});
test('a match is a hit; one hit per url, first threat type wins', () => {
  const json = { matches: [
    { threatType: 'SOCIAL_ENGINEERING', platformType: 'ANY_PLATFORM', threatEntryType: 'URL', threat: { url: 'https://p.example/' }, cacheDuration: '300s' },
    { threatType: 'MALWARE', threat: { url: 'https://p.example/' } },
  ] };
  assert.deepEqual(hitsFromLookup(json), [{ url: 'https://p.example/', threatType: 'SOCIAL_ENGINEERING' }]);
});
test('a canonicalised echo still counts', () => {
  // we sent https://P.example/x/../y ; Google may answer with the canonical form
  assert.deepEqual(hitsFromLookup({ matches: [{ threatType: 'MALWARE', threat: { url: 'https://p.example/y' } }] }), [{ url: 'https://p.example/y', threatType: 'MALWARE' }]);
});
