import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHECKS, judge, runSmoke } from '../../../scripts/smoke-auth.mjs';

test('the table covers every own /api/auth/* route, the member gate and the 404', () => {
  const dir = fileURLToPath(new URL('../../pages/api/auth/', import.meta.url));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const path = `/api/auth/${f.replace(/\.ts$/, '')}`;
    assert.ok(CHECKS.some((c) => c.path === path), `${path} has no smoke check`);
  }
  const reg = CHECKS.find((c) => c.path === '/api/auth/register')!;
  assert.deepEqual({ method: reg.method, expect: reg.expect, json: reg.json }, { method: 'POST', expect: 400, json: true });
  assert.ok(CHECKS.some((c) => c.path === '/api/topics' && c.expect === 401));
  assert.ok(CHECKS.some((c) => c.path.startsWith('/api/auth/') && c.expect === 404));
});

test('judge: status mismatch, non-JSON body, request error, pass', () => {
  const reg = CHECKS.find((c) => c.path === '/api/auth/register')!;
  assert.equal(judge(reg, { status: 404, bodyText: '<html>' }).ok, false);
  assert.match(judge(reg, { status: 404, bodyText: '<html>' }).detail, /expected 400, got 404/);
  assert.equal(judge(reg, { status: 400, bodyText: '<html>' }).ok, false);
  assert.match(judge(reg, { status: 400, bodyText: '<html>' }).detail, /JSON/);
  assert.equal(judge(reg, { status: 400, bodyText: '{"error":"x"}' }).ok, true);
  assert.match(judge(reg, { error: 'TypeError: fetch failed' }).detail, /request failed/);
});

test('runSmoke: one line per check, never throws, POSTs carry JSON + Origin', async () => {
  const seen: { url: string; init: any }[] = [];
  const fakeFetch = async (url: any, init: any) => {
    seen.push({ url: String(url), init });
    const path = new URL(url).pathname;
    const c = CHECKS.find((x) => x.path === path);
    if (path === '/api/auth/forgot-password') throw new Error('boom');
    return new Response(c?.json ? '{}' : 'x', { status: c?.expect ?? 500 });
  };
  const r = await runSmoke('https://example.test', fakeFetch as any);
  assert.equal(r.lines.length, CHECKS.length);
  assert.equal(r.ok, false);
  assert.equal(r.lines.filter((l) => l.startsWith('FAIL')).length, 1);
  const post = seen.find((s) => s.init?.method === 'POST')!;
  assert.equal(post.init.headers['Content-Type'], 'application/json');
  assert.equal(post.init.headers['Origin'], 'https://example.test');
  assert.equal(post.init.redirect, 'manual');
});
