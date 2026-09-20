import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPreviewUrl, isPrivateAddress, safePreviewImage, clipPreviewText } from './previewUrlGuard';

test('a normal news article passes', () => {
  const r = checkPreviewUrl(' https://www.tagesspiegel.de/berlin/artikel-123.html?x=1 ');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.url.hostname, 'www.tagesspiegel.de');
});

test('only https, no credentials, no odd ports', () => {
  assert.deepEqual(checkPreviewUrl('http://example.org/a'), { ok: false, reason: 'scheme' });
  assert.deepEqual(checkPreviewUrl('file:///etc/passwd'), { ok: false, reason: 'scheme' });
  assert.deepEqual(checkPreviewUrl('gopher://example.org'), { ok: false, reason: 'scheme' });
  assert.deepEqual(checkPreviewUrl('https://user:pw@example.org/'), { ok: false, reason: 'credentials' });
  assert.deepEqual(checkPreviewUrl('https://example.org:8443/'), { ok: false, reason: 'port' });
  assert.equal(checkPreviewUrl('https://example.org:443/').ok, true);
  assert.deepEqual(checkPreviewUrl('not a url'), { ok: false, reason: 'invalid' });
});

test('IP literals in every spelling and internal names are refused', () => {
  for (const u of [
    'https://127.0.0.1/', 'https://169.254.169.254/latest/meta-data/', 'https://10.0.0.5/', 'https://8.8.8.8/',
    'https://2130706433/', 'https://0x7f000001/', 'https://0177.0.0.1/', 'https://[::1]/', 'https://[::ffff:10.0.0.1]/',
    'https://localhost/', 'https://intranet/', 'https://db.internal/', 'https://printer.local/', 'https://foo.localhost/', 'https://example.org./x'
  ]) {
    const r = checkPreviewUrl(u);
    if (u === 'https://example.org./x') assert.equal(r.ok, true, u);
    else assert.deepEqual(r, { ok: false, reason: 'host' }, u);
  }
});

test('private, loopback, link-local and mapped addresses are private', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd12:3456::1', 'ff02::1', '::ffff:192.168.0.1', '64:ff9b::a00:1', 'garbage'])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '100.63.0.1', '93.184.216.34', '2a00:1450:4001:81b::200e', '::ffff:8.8.8.8'])
    assert.equal(isPrivateAddress(ip), false, ip);
});

test('og:image: absolute https only, relative resolved against the page', () => {
  const base = new URL('https://www.rbb24.de/panorama/beitrag/2026/09/x.html');
  assert.equal(safePreviewImage('/content/img.jpg', base), 'https://www.rbb24.de/content/img.jpg');
  assert.equal(safePreviewImage('https://cdn.rbb24.de/a.jpg', base), 'https://cdn.rbb24.de/a.jpg');
  assert.equal(safePreviewImage('http://cdn.rbb24.de/a.jpg', base), '');
  assert.equal(safePreviewImage('data:image/png;base64,AAAA', base), '');
  assert.equal(safePreviewImage('https://192.168.0.1/a.jpg', base), '');
  assert.equal(safePreviewImage(undefined, base), '');
});

test('text is collapsed and cut to the field limit', () => {
  assert.equal(clipPreviewText('  Ein\n  Titel  ', 200), 'Ein Titel');
  const long = clipPreviewText('x'.repeat(300), 200);
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('…'));
  assert.equal(clipPreviewText(undefined, 10), '');
});
