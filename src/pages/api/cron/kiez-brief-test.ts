import type { APIRoute } from 'astro';
import { sendKiezBriefTest } from '../../../lib/newsletter/kiezBrief';

// The admin's test copy BEFORE the members' mail, rung by .github/workflows/kiez-brief.yml as
// the first step of the Sunday job (the job then waits two hours and rings /api/cron/kiez-brief).
// Sends this week's issue to the admins' own addresses and a Telegram line; claims nothing.
// FAIL-CLOSED like its sibling: without CRON_SECRET nobody can ring it.
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) return json({ error: 'cron_disabled' }, 503);
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return json({ error: 'Unauthorized' }, 401);
  return json(await sendKiezBriefTest());
};
