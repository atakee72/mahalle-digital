// Run: npx tsx src/lib/linkify.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayUrl, linkifySegments, shortenUrlsInText } from './linkify';

test('short URLs lose only scheme, www and trailing slash', () => {
  assert.equal(displayUrl('https://www.berlin.de/'), 'berlin.de');
  assert.equal(displayUrl('http://example.com/pfad'), 'example.com/pfad');
});

test('long URLs cut at the last slash before the limit', () => {
  const u = 'https://www.berlin.de/ba-neukoelln/aktuelles/pressemitteilungen/2026/pressemitteilung.1234567.php';
  assert.equal(displayUrl(u), 'berlin.de/ba-neukoelln/aktuelles…');
  assert.ok(displayUrl(u).length <= 41);
});

test('long URLs without a slash inside the limit are hard-cut', () => {
  const u = 'https://example.com/' + 'a'.repeat(80);
  assert.equal(displayUrl(u), 'example.com/' + 'a'.repeat(28) + '…');
  const host = 'https://' + 'b'.repeat(60) + '.de';
  assert.equal(displayUrl(host), 'b'.repeat(40) + '…');
});

test('query-heavy links keep the readable prefix', () => {
  const u = 'https://maps.app.goo.gl/abc?utm_source=share&utm_medium=whatsapp&utm_campaign=x';
  assert.equal(displayUrl(u), 'maps.app.goo.gl/abc?utm_source=share&utm…');
});

test('shortenUrlsInText replaces every URL, keeps the rest verbatim', () => {
  const text = 'Siehe https://www.berlin.de/ba-neukoelln/aktuelles/pressemitteilungen/2026/x.php und http://a.de/.';
  assert.equal(shortenUrlsInText(text), 'Siehe berlin.de/ba-neukoelln/aktuelles… und a.de.');
  assert.equal(shortenUrlsInText('kein link'), 'kein link');
});

test('href segments are untouched by display shortening', () => {
  const u = 'https://example.com/' + 'x'.repeat(80);
  const segs = linkifySegments(`hi ${u}`);
  assert.equal(segs[1].value, u);
});
