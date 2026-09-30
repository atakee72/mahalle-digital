import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@auth/core/types';
import { gateMember, memberUnauthorizedResponse, MEMBER_UNAUTHORIZED_BODY } from './memberGate';

const member: Session = {
  user: { id: '64f000000000000000000001', name: 'Ayşe', email: 'ayse@mahalle-dev.test', role: 'user' },
  expires: '2099-01-01T00:00:00.000Z',
};

const neverBanned = async (_userId: string) => null;
const bannedResponse = new Response(JSON.stringify({ error: 'account_banned' }), {
  status: 403,
  headers: { 'Content-Type': 'application/json' },
});
const alwaysBanned = async (_userId: string) => bannedResponse;

test('no session → 401 with the exact legacy body and JSON header', async () => {
  const gate = await gateMember(null, neverBanned);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.equal(gate.response.status, 401);
  assert.equal(gate.response.headers.get('Content-Type'), 'application/json');
  assert.equal(await gate.response.text(), JSON.stringify(MEMBER_UNAUTHORIZED_BODY));
});

test('the 401 body is byte-identical to what the routes used to write', () => {
  assert.equal(JSON.stringify(MEMBER_UNAUTHORIZED_BODY), '{"error":"Unauthorized - Please login"}');
  assert.equal(memberUnauthorizedResponse().status, 401);
});

test('a session whose user has no id → 401, ban check never runs', async () => {
  let banCalls = 0;
  const counting = async (_userId: string) => { banCalls += 1; return null; };
  const idless = { ...member, user: { ...member.user, id: undefined as unknown as string } };
  const gate = await gateMember(idless, counting);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.equal(gate.response.status, 401);
  assert.equal(banCalls, 0);
});

test('a banned member → the ban response is returned as the SAME object', async () => {
  const gate = await gateMember(member, alwaysBanned);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.equal(gate.response, bannedResponse);
  assert.equal(gate.response.status, 403);
});

test('a member in good standing → ok with userId and the SAME session object', async () => {
  let seen = '';
  const recording = async (userId: string) => { seen = userId; return null; };
  const gate = await gateMember(member, recording);
  assert.equal(gate.ok, true);
  if (!gate.ok) return;
  assert.equal(gate.userId, '64f000000000000000000001');
  assert.equal(gate.session, member);
  assert.equal(seen, '64f000000000000000000001');
});
